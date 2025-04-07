import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs-extra"
import { DiffViewProvider } from "../integrations/editor/DiffViewProvider"
import { RooIgnoreController, LOCK_TEXT_SYMBOL } from "./ignore/RooIgnoreController"
import { DiffStrategy, DiffResult } from "./diff/types" // Import DiffResult type
import { BrowserSession } from "../services/browser/BrowserSession"
import { McpHub } from "../services/mcp/McpHub"
import { TerminalRegistry } from "../integrations/terminal/TerminalRegistry"
import { Terminal } from "../integrations/terminal/Terminal"
import { ExitCodeDetails } from "../integrations/terminal/TerminalProcess"
import { ClineProvider } from "./webview/ClineProvider"
import { ToolParamName, ToolUse } from "./assistant-message"
import { ClineSayTool, ToolProgressStatus, ClineAsk, ClineAskUseMcpServer } from "../shared/ExtensionMessage" // Import ClineAsk, ClineAskUseMcpServer
import { ClineAskResponse } from "../shared/WebviewMessage"
import { getReadablePath } from "../utils/path"
import { fileExistsAtPath } from "../utils/fs"
import { addLineNumbers, extractTextFromFile } from "../integrations/misc/extract-text"
import { listFiles } from "../services/glob/list-files"
import { detectCodeOmission } from "../integrations/editor/detect-omission"
import { parseSourceCodeForDefinitionsTopLevel } from "../services/tree-sitter"
import { regexSearchFiles } from "../services/ripgrep"
import { insertGroups } from "./diff/insert-groups"
import { formatResponse } from "./prompts/responses"
import { serializeError } from "serialize-error"
import delay from "delay"
import Anthropic from "@anthropic-ai/sdk";
import { getModeBySlug, defaultModeSlug } from "../shared/modes" // Added imports

// Helper function to escape special regex characters
function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Define ToolResponse locally as it's a type alias in Cline.ts
type ToolResponse = string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>;

// Define types for functions passed from Cline
type SayFunction = (type: string, message: string, images?: string[]) => Promise<void>;
type AskFunction = (type: string, message: string, partial?: boolean, status?: ToolProgressStatus | string | undefined) => Promise<{ response: ClineAskResponse; text?: string; images?: string[] }>;
type AskApprovalFunction = (type: ClineAsk, message: string, status?: ToolProgressStatus | undefined) => Promise<boolean>;
type PushToolResultFunction = (result: ToolResponse) => void;
type HandleErrorFunction = (action: string, error: Error) => Promise<void>;
type RemoveClosingTagFunction = (tag: ToolParamName, text?: string) => string | undefined;

export class ToolExecutor {
    private diffViewProvider: DiffViewProvider;
    private rooIgnoreController: RooIgnoreController | undefined;
    private diffStrategy: DiffStrategy | undefined;
    private browserSession: BrowserSession;
    private mcpHub: McpHub;
    // terminalRegistry is used statically, no need to store instance
    private providerRef: WeakRef<ClineProvider>;
    private cwd: string;
    private say: SayFunction;
    private ask: AskFunction;
    private consecutiveMistakeCount: number = 0;
    private didEditFile: boolean = false;
    private didRejectTool: boolean = false;
    private consecutiveMistakeCountForApplyDiff: Map<string, number> = new Map();

    constructor(
        dependencies: {
            diffViewProvider: DiffViewProvider,
            rooIgnoreController: RooIgnoreController | undefined,
            diffStrategy: DiffStrategy | undefined,
            browserSession: BrowserSession,
            mcpHub: McpHub,
            terminalRegistry: typeof TerminalRegistry, // Expecting the static class
            providerRef: WeakRef<ClineProvider>,
            cwd: string,
            say: SayFunction,
            ask: AskFunction,
        }
    ) {
        this.diffViewProvider = dependencies.diffViewProvider;
        this.rooIgnoreController = dependencies.rooIgnoreController;
        this.diffStrategy = dependencies.diffStrategy;
        this.browserSession = dependencies.browserSession;
        this.mcpHub = dependencies.mcpHub;
        // No need to store terminalRegistry if used statically
        this.providerRef = dependencies.providerRef;
        this.cwd = dependencies.cwd;
        this.say = dependencies.say;
        this.ask = dependencies.ask;
    }

    // Helper for missing parameters
    private async sayAndCreateMissingParamError(toolName: string, paramName: string, say: SayFunction): Promise<string> {
        const message = `Missing required parameter: ${paramName}`
        await say("error", message)
        return formatResponse.toolError(message)
    }

    // --- Tool Execution Methods ---

    private async _executeWriteToFile(
        block: ToolUse,
        pushToolResult: PushToolResultFunction,
        handleError: HandleErrorFunction,
        removeClosingTag: RemoveClosingTagFunction,
        askApproval: AskApprovalFunction
    ): Promise<void> {
        const relPath: string | undefined = block.params.path
        const content: string | undefined = block.params.content
        const lineCountStr: string | undefined = block.params.line_count

        const sharedMessageProps: ClineSayTool = {
            tool: "newFileCreated", // Default, will be updated if file exists
            path: getReadablePath(this.cwd, removeClosingTag("path", relPath)),
        }

        try {
            if (block.partial) {
                const partialMessage = JSON.stringify({
                    ...sharedMessageProps,
                    content: removeClosingTag("content", content),
                    line_count: removeClosingTag("line_count", lineCountStr),
                })
                await this.ask("tool", partialMessage, block.partial).catch(() => {})
                return
            }

            // Validate required parameters
            if (!relPath) {
                this.consecutiveMistakeCount++
                pushToolResult(await this.sayAndCreateMissingParamError("write_to_file", "path", this.say))
                return
            }
            if (content === undefined) {
                this.consecutiveMistakeCount++
                pushToolResult(await this.sayAndCreateMissingParamError("write_to_file", "content", this.say))
                return
            }
            if (!lineCountStr) {
                this.consecutiveMistakeCount++
                pushToolResult(await this.sayAndCreateMissingParamError("write_to_file", "line_count", this.say))
                return
            }

            const lineCount = parseInt(lineCountStr, 10)
            if (isNaN(lineCount)) {
                this.consecutiveMistakeCount++
                await this.say("error", `Invalid line_count parameter: ${lineCountStr}`)
                pushToolResult(formatResponse.toolError("Invalid line_count parameter"))
                return
            }

            const absolutePath = path.resolve(this.cwd, relPath)
            const fileExists = await fileExistsAtPath(absolutePath)

            if (fileExists) {
                sharedMessageProps.tool = "editedExistingFile"
            }
            let originalContent = ""; // Declare originalContent here

            // Read original content *only if* the file exists
            if (fileExists) {
                originalContent = await fs.readFile(absolutePath, "utf-8");
            }
            this.diffViewProvider.originalContent = originalContent

            // Now check for omission, *after* originalContent is potentially loaded
            const omissionDetected = detectCodeOmission(originalContent, content, lineCount)
            if (omissionDetected) {
                this.consecutiveMistakeCount++ // Increment again if omission detected
                const omissionMessage = "Potential code omission detected. The generated content might be incomplete. Please review carefully."
                await this.say("error", omissionMessage)
                pushToolResult(formatResponse.toolError(omissionMessage))
                return // Stop processing if omission detected
            }
            this.consecutiveMistakeCount = 0 // Reset mistake count before diffing

            // Prepare diff view
            this.diffViewProvider.editType = fileExists ? "modify" : "create"

            const diff = formatResponse.createPrettyPatch(relPath, originalContent, content)

            if (!diff && fileExists) {
                pushToolResult(`No changes needed for '${relPath}'`)
                return
            }

            await this.diffViewProvider.open(relPath)
            await this.diffViewProvider.update(content, true)
            this.diffViewProvider.scrollToFirstDiff()

            const completeMessage = JSON.stringify({
                ...sharedMessageProps,
                diff,
            } satisfies ClineSayTool)

            const approved = await askApproval("tool", completeMessage)
            if (!approved) {
                await this.diffViewProvider.revertChanges()
                // No feedback needed for write_to_file denial, just deny
                pushToolResult(formatResponse.toolDenied())
                this.didRejectTool = true;
                return
            }

            // No feedback needed for write_to_file approval, just proceed

            const { newProblemsMessage, userEdits, finalContent } =
                await this.diffViewProvider.saveChanges()
            this.didEditFile = true

            if (userEdits) {
                await this.say(
                    "user_feedback_diff",
                    JSON.stringify({
                        tool: fileExists ? "editedExistingFile" : "newFileCreated",
                        path: getReadablePath(this.cwd, relPath),
                        diff: userEdits,
                    } satisfies ClineSayTool),
                )
                pushToolResult(
                    `The user made the following updates to your content:\n\n${userEdits}\n\n` +
                        `The updated content, which includes both your original modifications and the user's edits, has been successfully saved to ${relPath.toPosix()}. Here is the full, updated content of the file, including line numbers:\n\n` +
                        `<final_file_content path="${relPath.toPosix()}">\n${addLineNumbers(finalContent || "")}\n</final_file_content>\n\n` +
                        `Please note:\n` +
                        `1. You do not need to re-write the file with these changes, as they have already been applied.\n` +
                        `2. Proceed with the task using this updated file content as the new baseline.\n` +
                        `3. If the user's edits have addressed part of the task or changed the requirements, adjust your approach accordingly.` +
                        `${newProblemsMessage}`,
                )
            } else {
                pushToolResult(
                    `${fileExists ? "Changes successfully applied to" : "File successfully created at"} ${relPath.toPosix()}.${newProblemsMessage}`,
                )
            }
            await this.diffViewProvider.reset()
        } catch (error) {
            await handleError("writing file", error as Error)
            await this.diffViewProvider.reset()
        }
    }

    private async _executeApplyDiff(
        block: ToolUse,
        pushToolResult: PushToolResultFunction,
        handleError: HandleErrorFunction,
        removeClosingTag: RemoveClosingTagFunction,
        askApproval: AskApprovalFunction
    ): Promise<void> {
        const relPath: string | undefined = block.params.path
        const diffContent: string | undefined = block.params.diff

        const sharedMessageProps: ClineSayTool = {
            tool: "appliedDiff",
            path: getReadablePath(this.cwd, removeClosingTag("path", relPath)),
        }

        try {
            if (block.partial) {
                const partialMessage = JSON.stringify({
                    ...sharedMessageProps,
                    diff: removeClosingTag("diff", diffContent),
                })
                await this.ask("tool", partialMessage, block.partial).catch(() => {})
                return
            }

            // Validate required parameters
            if (!relPath) {
                this.consecutiveMistakeCount++
                pushToolResult(await this.sayAndCreateMissingParamError("apply_diff", "path", this.say))
                return
            }
            if (!diffContent) {
                this.consecutiveMistakeCount++
                pushToolResult(await this.sayAndCreateMissingParamError("apply_diff", "diff", this.say))
                return
            }

            const absolutePath = path.resolve(this.cwd, relPath)
            const fileExists = await fileExistsAtPath(absolutePath)

            if (!fileExists) {
                this.consecutiveMistakeCount++
                const formattedError = `File does not exist at path: ${absolutePath}\n\n<error_details>\nThe specified file could not be found. Please verify the file path and try again.\n</error_details>`
                await this.say("error", formattedError)
                pushToolResult(formattedError)
                return
            }

            // Read the original file content
            const fileContent = await fs.readFile(absolutePath, "utf-8")
            this.diffViewProvider.editType = "modify"
            this.diffViewProvider.originalContent = fileContent

            if (!this.diffStrategy) {
                throw new Error("Diff strategy is not initialized")
            }

            // Apply the diff using the strategy
            const diffResult = await this.diffStrategy.applyDiff(fileContent, diffContent) // Use applyDiff

            if (!diffResult.success) {
                // Handle error based on the DiffResult structure
                const errorMessage = `Failed to apply changes to ${relPath}:\n${diffResult.error ?? "Unknown diff application error"}`
                // Extract line number if available in details (assuming structure based on previous error message)
                const lineNumber = (diffResult.details as any)?.lineNumber; // Use 'any' for potential dynamic structure
                const mistakeKey = `${relPath}-${lineNumber ?? 'unknown'}`
                const currentMistakeCount = (this.consecutiveMistakeCountForApplyDiff.get(mistakeKey) ?? 0) + 1
                this.consecutiveMistakeCountForApplyDiff.set(mistakeKey, currentMistakeCount)

                await this.say("error", errorMessage)

                if (currentMistakeCount >= 3) {
                    pushToolResult(
                        formatResponse.toolError(
                            `${errorMessage}\n\nI have failed to apply the diff multiple times. Please provide the full file content using the write_to_file tool instead.`,
                        ),
                    )
                } else {
                    pushToolResult(formatResponse.toolError(errorMessage)) // Use the constructed errorMessage
                }
                return
            }

            // Reset mistake count for this file on success
            this.consecutiveMistakeCountForApplyDiff.forEach((_, key) => {
                if (key.startsWith(relPath + "-")) {
                    this.consecutiveMistakeCountForApplyDiff.delete(key)
                }
            })
            this.consecutiveMistakeCount = 0 // Reset general mistake count on success

            // Get the new content from the successful result
            const newContent = diffResult.content;

            // Show diff preview
            const diff = formatResponse.createPrettyPatch(relPath, fileContent, newContent)

            if (!diff) {
                pushToolResult(`No changes needed for '${relPath}'`)
                return
            }

            await this.diffViewProvider.open(relPath)
            await this.diffViewProvider.update(newContent, true)
            this.diffViewProvider.scrollToFirstDiff()

            const completeMessage = JSON.stringify({
                ...sharedMessageProps,
                diff,
            } satisfies ClineSayTool)

            const approved = await askApproval("tool", completeMessage)
            if (!approved) {
                await this.diffViewProvider.revertChanges()
                // No feedback needed for apply_diff denial
                pushToolResult(formatResponse.toolDenied())
                this.didRejectTool = true;
                return
            }

            // No feedback needed for apply_diff approval

            const { newProblemsMessage, userEdits, finalContent } =
                await this.diffViewProvider.saveChanges()
            this.didEditFile = true

            if (userEdits) {
                await this.say(
                    "user_feedback_diff",
                    JSON.stringify({
                        tool: "editedExistingFile", // Consistent UI message
                        path: getReadablePath(this.cwd, relPath),
                        diff: userEdits,
                    } satisfies ClineSayTool),
                )
                pushToolResult(
                    `The user made the following updates to your content:\n\n${userEdits}\n\n` +
                        `The updated content, which includes both your original modifications and the user's edits, has been successfully saved to ${relPath.toPosix()}. Here is the full, updated content of the file, including line numbers:\n\n` +
                        `<final_file_content path="${relPath.toPosix()}">\n${addLineNumbers(finalContent || "")}\n</final_file_content>\n\n` +
                        `Please note:\n` +
                        `1. You do not need to re-write the file with these changes, as they have already been applied.\n` +
                        `2. Proceed with the task using this updated file content as the new baseline.\n` +
                        `3. If the user's edits have addressed part of the task or changed the requirements, adjust your approach accordingly.` +
                        `${newProblemsMessage}`,
                )
            } else {
                pushToolResult(
                    `Changes successfully applied to ${relPath.toPosix()}.${newProblemsMessage}`,
                )
            }
            await this.diffViewProvider.reset()
        } catch (error) {
            await handleError("applying diff", error as Error)
            await this.diffViewProvider.reset()
        }
    }

    private async _executeInsertContent(
        block: ToolUse,
        pushToolResult: PushToolResultFunction,
        handleError: HandleErrorFunction,
        removeClosingTag: RemoveClosingTagFunction,
        askApproval: AskApprovalFunction
    ): Promise<void> {
        const relPath: string | undefined = block.params.path
        const operations: string | undefined = block.params.operations

        const sharedMessageProps: ClineSayTool = {
            tool: "appliedDiff", // Use consistent message type for UI
            path: getReadablePath(this.cwd, removeClosingTag("path", relPath)),
        }

        try {
            if (block.partial) {
                const partialMessage = JSON.stringify({
                    ...sharedMessageProps,
                    // Include operations in partial for context, though UI might not show it
                    operations: removeClosingTag("operations", operations),
                })
                await this.ask("tool", partialMessage, block.partial).catch(() => {})
                return
            }

            // Validate required parameters
            if (!relPath) {
                pushToolResult(await this.sayAndCreateMissingParamError("insert_content", "path", this.say))
                return
            }

            if (!operations) {
                pushToolResult(await this.sayAndCreateMissingParamError("insert_content", "operations", this.say))
                return
            }

            const absolutePath = path.resolve(this.cwd, relPath)
            const fileExists = await fileExistsAtPath(absolutePath)

            if (!fileExists) {
                const formattedError = `File does not exist at path: ${absolutePath}\n\n<error_details>\nThe specified file could not be found. Please verify the file path and try again.\n</error_details>`
                await this.say("error", formattedError)
                pushToolResult(formattedError)
                return
            }

            let parsedOperations: Array<{
                start_line: number
                content: string
            }>

            try {
                parsedOperations = JSON.parse(operations)
                if (!Array.isArray(parsedOperations)) {
                    throw new Error("Operations must be an array")
                }
                // Basic validation for each operation object
                for (const op of parsedOperations) {
                    if (typeof op.start_line !== 'number' || typeof op.content !== 'string') {
                        throw new Error("Each operation must have a numeric 'start_line' and a string 'content'.")
                    }
                }
            } catch (error) {
                await this.say("error", `Failed to parse operations JSON: ${(error as Error).message}`)
                pushToolResult(formatResponse.toolError("Invalid operations JSON format"))
                return
            }

            // Read the file
            const fileContent = await fs.readFile(absolutePath, "utf8")
            this.diffViewProvider.editType = "modify"
            this.diffViewProvider.originalContent = fileContent
            const lines = fileContent.split("\n")

            const updatedContent = insertGroups(
                lines,
                parsedOperations.map((elem) => {
                    return {
                        index: elem.start_line - 1, // Convert to 0-based index
                        elements: elem.content.split("\n"),
                    }
                }),
            ).join("\n")

            // Show changes in diff view
            const diff = formatResponse.createPrettyPatch(relPath, fileContent, updatedContent)

            if (!diff) {
                pushToolResult(`No changes needed for '${relPath}'`)
                return // No need to show diff if no changes
            }

            await this.diffViewProvider.open(relPath)
            await this.diffViewProvider.update(updatedContent, true)
            this.diffViewProvider.scrollToFirstDiff()

            const completeMessage = JSON.stringify({
                ...sharedMessageProps,
                diff,
            } satisfies ClineSayTool)

            const approved = await askApproval("tool", completeMessage)
            if (!approved) {
                await this.diffViewProvider.revertChanges()
                // No feedback needed for insert_content denial
                pushToolResult(formatResponse.toolDenied())
                this.didRejectTool = true;
                return
            }

            // No feedback needed for insert_content approval

            const { newProblemsMessage, userEdits, finalContent } =
                await this.diffViewProvider.saveChanges()
            this.didEditFile = true

            if (userEdits) {
                await this.say(
                    "user_feedback_diff",
                    JSON.stringify({
                        tool: "editedExistingFile", // Consistent UI message
                        path: getReadablePath(this.cwd, relPath),
                        diff: userEdits,
                    } satisfies ClineSayTool),
                )
                pushToolResult(
                    `The user made the following updates to your content:\n\n${userEdits}\n\n` +
                        `The updated content, which includes both your original modifications and the user's edits, has been successfully saved to ${relPath.toPosix()}. Here is the full, updated content of the file:\n\n` +
                        `<final_file_content path="${relPath.toPosix()}">\n${addLineNumbers(finalContent || "")}\n</final_file_content>\n\n` +
                        `Please note:\n` +
                        `1. You do not need to re-write the file with these changes, as they have already been applied.\n` +
                        `2. Proceed with the task using this updated file content as the new baseline.\n` +
                        `3. If the user's edits have addressed part of the task or changed the requirements, adjust your approach accordingly.` +
                        `${newProblemsMessage}`,
                )
            } else {
                pushToolResult(
                    `The content was successfully inserted in ${relPath.toPosix()}.${newProblemsMessage}`,
                )
            }
            await this.diffViewProvider.reset()
        } catch (error) {
            handleError("insert content", error as Error)
            await this.diffViewProvider.reset()
        }
    }

    private async _executeSearchAndReplace(
        block: ToolUse,
        pushToolResult: PushToolResultFunction,
        handleError: HandleErrorFunction,
        removeClosingTag: RemoveClosingTagFunction,
        askApproval: AskApprovalFunction
    ): Promise<void> {
        const relPath: string | undefined = block.params.path
        const operations: string | undefined = block.params.operations

        const sharedMessageProps: ClineSayTool = {
            tool: "appliedDiff", // Use consistent message type for UI
            path: getReadablePath(this.cwd, removeClosingTag("path", relPath)),
        }

        try {
            if (block.partial) {
                const partialMessage = JSON.stringify({
                    ...sharedMessageProps,
                    operations: removeClosingTag("operations", operations),
                })
                await this.ask("tool", partialMessage, block.partial).catch(() => {})
                return
            }

            // Validate required parameters
            if (!relPath) {
                this.consecutiveMistakeCount++
                pushToolResult(await this.sayAndCreateMissingParamError("search_and_replace", "path", this.say))
                return
            }
            if (!operations) {
                this.consecutiveMistakeCount++
                pushToolResult(await this.sayAndCreateMissingParamError("search_and_replace", "operations", this.say))
                return
            }

            const absolutePath = path.resolve(this.cwd, relPath)
            const fileExists = await fileExistsAtPath(absolutePath)

            if (!fileExists) {
                this.consecutiveMistakeCount++
                const formattedError = `File does not exist at path: ${absolutePath}\n\n<error_details>\nThe specified file could not be found. Please verify the file path and try again.\n</error_details>`
                await this.say("error", formattedError)
                pushToolResult(formattedError)
                return
            }

            let parsedOperations: Array<{
                search: string
                replace: string
                start_line?: number
                end_line?: number
                use_regex?: boolean
                ignore_case?: boolean
                regex_flags?: string
            }>

            try {
                parsedOperations = JSON.parse(operations)
                if (!Array.isArray(parsedOperations)) {
                    throw new Error("Operations must be an array")
                }
                // Basic validation for each operation object
                for (const op of parsedOperations) {
                    if (typeof op.search !== 'string' || typeof op.replace !== 'string') {
                        throw new Error("Each operation must have string 'search' and 'replace' properties.")
                    }
                }
            } catch (error) {
                this.consecutiveMistakeCount++
                await this.say("error", `Failed to parse operations JSON: ${(error as Error).message}`)
                pushToolResult(formatResponse.toolError("Invalid operations JSON format"))
                return
            }

            // Read the original file content
            const fileContent = await fs.readFile(absolutePath, "utf-8")
            this.diffViewProvider.editType = "modify"
            this.diffViewProvider.originalContent = fileContent
            let modifiedContent = fileContent // Start with original content

            for (const op of parsedOperations) {
                const flags = op.regex_flags ?? (op.ignore_case ? "gi" : "g")
                // Ensure 'm' flag is present for multiline matching if start/end lines are used or implied
                const multilineFlags = flags.includes("m") ? flags : flags + "m"

                const searchPattern = op.use_regex
                    ? new RegExp(op.search, multilineFlags)
                    : new RegExp(escapeRegExp(op.search), multilineFlags) // Use multiline flags even for literal search

                if (op.start_line || op.end_line) {
                    const currentLines = modifiedContent.split('\n');
                    const startLine = Math.max((op.start_line ?? 1) - 1, 0)
                    const endLine = Math.min((op.end_line ?? currentLines.length), currentLines.length) // end_line is inclusive, slice is exclusive

                    // Get the content before and after the target section
                    const beforeLines = currentLines.slice(0, startLine)
                    const afterLines = currentLines.slice(endLine) // Slice from endLine

                    // Get the target section and perform replacement
                    const targetContent = currentLines.slice(startLine, endLine).join("\n")
                    const sectionModifiedContent = targetContent.replace(searchPattern, op.replace)
                    const modifiedLines = sectionModifiedContent.split("\n")

                    // Reconstruct the full content with the modified section
                    modifiedContent = [...beforeLines, ...modifiedLines, ...afterLines].join("\n")
                } else {
                    // Global replacement on the current state of modifiedContent
                    modifiedContent = modifiedContent.replace(searchPattern, op.replace)
                }
            }

            const newContent = modifiedContent
            this.consecutiveMistakeCount = 0

            // Show diff preview
            const diff = formatResponse.createPrettyPatch(relPath, fileContent, newContent)

            if (!diff) {
                pushToolResult(`No changes needed for '${relPath}'`)
                return
            }

            await this.diffViewProvider.open(relPath)
            await this.diffViewProvider.update(newContent, true)
            this.diffViewProvider.scrollToFirstDiff()

            const completeMessage = JSON.stringify({
                ...sharedMessageProps,
                diff,
            } satisfies ClineSayTool)

            const approved = await askApproval("tool", completeMessage)
            if (!approved) {
                await this.diffViewProvider.revertChanges()
                // No feedback needed for search_and_replace denial
                pushToolResult(formatResponse.toolDenied())
                this.didRejectTool = true;
                return
            }

            // No feedback needed for search_and_replace approval

            const { newProblemsMessage, userEdits, finalContent } =
                await this.diffViewProvider.saveChanges()
            this.didEditFile = true

            if (userEdits) {
                await this.say(
                    "user_feedback_diff",
                    JSON.stringify({
                        tool: "editedExistingFile", // Consistent UI message
                        path: getReadablePath(this.cwd, relPath),
                        diff: userEdits,
                    } satisfies ClineSayTool),
                )
                pushToolResult(
                    `The user made the following updates to your content:\n\n${userEdits}\n\n` +
                        `The updated content, which includes both your original modifications and the user's edits, has been successfully saved to ${relPath.toPosix()}. Here is the full, updated content of the file, including line numbers:\n\n` +
                        `<final_file_content path="${relPath.toPosix()}">\n${addLineNumbers(finalContent || "")}\n</final_file_content>\n\n` +
                        `Please note:\n` +
                        `1. You do not need to re-write the file with these changes, as they have already been applied.\n` +
                        `2. Proceed with the task using this updated file content as the new baseline.\n` +
                        `3. If the user's edits have addressed part of the task or changed the requirements, adjust your approach accordingly.` +
                        `${newProblemsMessage}`,
                )
            } else {
                pushToolResult(
                    `Changes successfully applied to ${relPath.toPosix()}.${newProblemsMessage}`,
                )
            }
            await this.diffViewProvider.reset()
        } catch (error) {
            await handleError("applying search and replace", error as Error)
            await this.diffViewProvider.reset()
        }
    }

    private async _executeReadFile(
        block: ToolUse,
        pushToolResult: PushToolResultFunction,
        handleError: HandleErrorFunction,
        removeClosingTag: RemoveClosingTagFunction
        // No askApproval needed for read_file
    ): Promise<void> {
        const relPath: string | undefined = block.params.path
        const startLineStr: string | undefined = block.params.start_line
        const endLineStr: string | undefined = block.params.end_line

        const sharedMessageProps: ClineSayTool = {
            tool: "readFile",
            path: getReadablePath(this.cwd, removeClosingTag("path", relPath)),
        }

        try {
            if (block.partial) {
                const partialMessage = JSON.stringify({
                    ...sharedMessageProps,
                    // Include line numbers in partial for context
                    start_line: removeClosingTag("start_line", startLineStr),
                    end_line: removeClosingTag("end_line", endLineStr),
                })
                await this.ask("tool", partialMessage, block.partial).catch(() => {})
                return
            }

            if (!relPath) {
                this.consecutiveMistakeCount++
                pushToolResult(await this.sayAndCreateMissingParamError("read_file", "path", this.say))
                return
            }

            const accessAllowed = this.rooIgnoreController?.validateAccess(relPath)
            if (!accessAllowed) {
                await this.say("rooignore_error", relPath)
                pushToolResult(formatResponse.toolError(formatResponse.rooIgnoreError(relPath)))
                return
            }

            this.consecutiveMistakeCount = 0
            const absolutePath = path.resolve(this.cwd, relPath)

            // Parse line numbers
            let startLine: number | undefined = undefined
            if (startLineStr) {
                startLine = parseInt(startLineStr, 10)
                if (isNaN(startLine)) {
                    await this.say("error", `Invalid start_line parameter: ${startLineStr}`)
                    pushToolResult(formatResponse.toolError("Invalid start_line parameter"))
                    return
                }
            }
            let endLine: number | undefined = undefined
            if (endLineStr) {
                endLine = parseInt(endLineStr, 10)
                if (isNaN(endLine)) {
                    await this.say("error", `Invalid end_line parameter: ${endLineStr}`)
                    pushToolResult(formatResponse.toolError("Invalid end_line parameter"))
                    return
                }
            }

            // Approval message - show path and line range if specified
            const approvalPath = getReadablePath(this.cwd, relPath);
            let approvalMessageText = `Read file: ${approvalPath}`;
            if (startLine !== undefined || endLine !== undefined) {
                approvalMessageText += ` (Lines: ${startLine ?? 'start'}-${endLine ?? 'end'})`;
            }
            const completeMessage = JSON.stringify({
                tool: "readFile",
                path: approvalPath, // Use readable path for message
                // No content needed for approval message
            } satisfies ClineSayTool)


            const { response: askResponse, text: feedbackText, images: feedbackImages } = await this.ask("tool", completeMessage, false)
            const didApprove = askResponse === "yesButtonClicked";
            if (!didApprove) {
                // Handle denial with feedback
                if (feedbackText) {
                    await this.say("user_feedback", feedbackText, feedbackImages)
                    pushToolResult(formatResponse.toolResult(formatResponse.toolDeniedWithFeedback(feedbackText), feedbackImages))
                } else {
                    pushToolResult(formatResponse.toolDenied())
                }
                this.didRejectTool = true;
                return
            }

            // Handle approval with feedback
            if (feedbackText) {
                await this.say("user_feedback", feedbackText, feedbackImages)
                // Continue with reading the file after acknowledging feedback
            }

            // Execute the tool - extractTextFromFile handles adding line numbers
            let content = await extractTextFromFile(absolutePath)

            // If a line range was specified, filter the content
            if (startLine !== undefined || endLine !== undefined) {
                const lines = content.split('\n');
                const actualStartLine = startLine ?? 1; // Default to 1 if startLine is undefined
                const actualEndLine = endLine ?? lines.length; // Default to end if endLine is undefined

                // Filter lines based on the range (adjusting for 0-based index vs 1-based line numbers)
                // The line numbers are already part of the string from extractTextFromFile
                const filteredLines = lines.filter(line => {
                    const match = line.match(/^\s*(\d+)\s+\|/);
                    if (match) {
                        const currentLineNum = parseInt(match[1], 10);
                        return currentLineNum >= actualStartLine && currentLineNum <= actualEndLine;
                    }
                    return false; // Should not happen if addLineNumbers worked correctly
                });
                content = filteredLines.join('\n');
            }

            pushToolResult(content)
        } catch (error) {
            await handleError("reading file", error as Error)
        }
    }

    private async _executeListFiles(
        block: ToolUse,
        pushToolResult: PushToolResultFunction,
        handleError: HandleErrorFunction,
        removeClosingTag: RemoveClosingTagFunction
        // No askApproval needed for list_files
    ): Promise<void> {
        const relPath: string | undefined = block.params.path
        const recursiveStr: string | undefined = block.params.recursive
        const isRecursive = recursiveStr === "true"
        const limit = 1000 // Default limit

        const toolType: ClineSayTool["tool"] = isRecursive ? "listFilesRecursive" : "listFilesTopLevel"

        const sharedMessageProps: ClineSayTool = {
            tool: toolType,
            path: getReadablePath(this.cwd, removeClosingTag("path", relPath)),
        }

        try {
            if (block.partial) {
                const partialMessage = JSON.stringify(sharedMessageProps)
                await this.ask("tool", partialMessage, block.partial).catch(() => {})
                return
            }

            if (!relPath) {
                this.consecutiveMistakeCount++
                pushToolResult(await this.sayAndCreateMissingParamError("list_files", "path", this.say))
                return
            }

            this.consecutiveMistakeCount = 0
            const absolutePath = path.resolve(this.cwd, relPath)
            const completeMessage = JSON.stringify(sharedMessageProps satisfies ClineSayTool)

            const { response: askResponse, text: feedbackText, images: feedbackImages } = await this.ask("tool", completeMessage, false)
            const didApprove = askResponse === "yesButtonClicked";
            if (!didApprove) {
                if (feedbackText) {
                    await this.say("user_feedback", feedbackText, feedbackImages)
                    pushToolResult(formatResponse.toolResult(formatResponse.toolDeniedWithFeedback(feedbackText), feedbackImages))
                } else {
                    pushToolResult(formatResponse.toolDenied())
                }
                this.didRejectTool = true;
                return
            }

            if (feedbackText) {
                await this.say("user_feedback", feedbackText, feedbackImages)
                // Continue after acknowledging feedback
            }

            // Execute the tool using the correct signature: listFiles(dirPath, recursive, limit)
            const [files, wasLimited] = await listFiles(absolutePath, isRecursive, limit)

            // Format the output, checking ignore status with the controller's validateAccess method
            const formattedFiles = files.map((filePath) => {
                // Check if the file is NOT accessible (i.e., ignored)
                const isIgnored = !this.rooIgnoreController?.validateAccess(filePath); // Remove redundant ?? false
                // Use LOCK_TEXT_SYMBOL if ignored
                return isIgnored ? `${filePath} ${LOCK_TEXT_SYMBOL}` : filePath;
            }).join("\n")

            let result = formattedFiles
            if (wasLimited) {
                result += `\n\n(Result limited to ${limit} items)`
            }

            pushToolResult(result)
        } catch (error) {
            await handleError("listing files", error as Error)
        }
    }

    private async _executeExecuteCommand(
        block: ToolUse,
        taskId: string, // Added taskId parameter
        pushToolResult: PushToolResultFunction,
        handleError: HandleErrorFunction,
        removeClosingTag: RemoveClosingTagFunction
        // No askApproval needed for execute_command by default
    ): Promise<void> {
        const command: string | undefined = block.params.command
        const customCwd: string | undefined = block.params.cwd // Optional cwd from tool params

        try {
            if (block.partial) {
                // Show partial command execution message
                const partialMessage = JSON.stringify({
                    tool: "executeCommand", // Assuming a tool type for UI
                    command: removeClosingTag("command", command),
                    cwd: removeClosingTag("cwd", customCwd),
                })
                await this.ask("tool", partialMessage, block.partial).catch(() => {})
                return
            }

            if (!command) {
                this.consecutiveMistakeCount++
                pushToolResult(await this.sayAndCreateMissingParamError("execute_command", "command", this.say))
                return
            }

            // Validate command against rooignore rules
            const forbiddenPath = this.rooIgnoreController?.validateCommand(command)
            if (forbiddenPath) {
                const errorMsg = formatResponse.rooIgnoreError(forbiddenPath); // Correct: only pass path
                await this.say("rooignore_error", errorMsg) // Use formatted message for say
                pushToolResult(formatResponse.toolError(errorMsg))
                return
            }


            // Determine working directory
            let workingDir: string
            if (!customCwd) {
                workingDir = this.cwd // Use the default cwd if not specified
            } else if (path.isAbsolute(customCwd)) {
                workingDir = customCwd
            } else {
                workingDir = path.resolve(this.cwd, customCwd)
            }

            // Check if directory exists
            try {
                await fs.access(workingDir)
            } catch (error) {
                await handleError(`checking working directory ${workingDir}`, error as Error)
                // Don't push tool result here, handleError should do it
                return
            }

            // Get or create terminal using static method
            const terminalInfo = await TerminalRegistry.getOrCreateTerminal(workingDir, !!customCwd, taskId)

            // Update workingDir based on actual terminal CWD
            workingDir = terminalInfo.getCurrentWorkingDirectory()
            const workingDirInfo = workingDir ? ` from '${workingDir.toPosix()}'` : ""

            // Show terminal and run command
            terminalInfo.terminal.show()
            const process = terminalInfo.runCommand(command)

            // --- Simplified Output Handling ---
            let fullOutput = "";
            const provider = this.providerRef.deref();
             if (!provider) {
                throw new Error("ClineProvider reference lost during command execution");
            }
            const { terminalOutputLineLimit } = (await provider.getState()) ?? {}

            process.on("line", (line: string) => { // Add type annotation
                const compressedLine = Terminal.compressTerminalOutput(line, terminalOutputLineLimit);
                fullOutput += compressedLine + "\n"; // Accumulate output
                // Stream output to the UI without asking for feedback
                this.say("command_output", compressedLine);
            });

            process.once("no_shell_integration", async (message: string) => {
                await this.say("shell_integration_warning", message)
            })

            // Wait for completion and get exit details
            let exitDetails: ExitCodeDetails | undefined;
            process.once("shell_execution_complete", (details: ExitCodeDetails) => {
                exitDetails = details;
            });

            await process; // Wait for the process promise to resolve/reject

            // Short delay for final messages
            await delay(50);

            // Format final result
            let exitStatus: string;
            if (exitDetails !== undefined) {
                if (exitDetails.signal) {
                    exitStatus = `Process terminated by signal ${exitDetails.signal} (${exitDetails.signalName})`
                    if (exitDetails.coreDumpPossible) {
                        exitStatus += " - core dump possible"
                    }
                } else if (exitDetails.exitCode === undefined) {
                    fullOutput += "<VSCE exit code is undefined: terminal output and command execution status is unknown.>"
                    exitStatus = `Exit code: <undefined, notify user>`
                } else {
                    exitStatus = `Exit code: ${exitDetails.exitCode}`
                }
            } else {
                // This case might happen if shell integration isn't working fully
                fullOutput += "<VSCE exitDetails == undefined: terminal output and command execution status is unknown.>"
                exitStatus = `Exit code: <unknown, shell integration might be missing>`
            }

            const outputInfo = `\nOutput:\n${Terminal.compressTerminalOutput(fullOutput.trimEnd(), terminalOutputLineLimit)}`; // Compress final accumulated output
            const finalMessage = `Command executed in terminal ${terminalInfo.id}${workingDirInfo}. ${exitStatus}${outputInfo}`;

            pushToolResult(finalMessage);

        } catch (error) {
            await handleError("executing command", error as Error)
        }
    }

    private async _executeListCodeDefinitionNames(
        block: ToolUse,
        pushToolResult: PushToolResultFunction,
        handleError: HandleErrorFunction,
        removeClosingTag: RemoveClosingTagFunction,
        askApproval: AskApprovalFunction
    ): Promise<void> {
        const relDirPath: string | undefined = block.params.path
        const sharedMessageProps: ClineSayTool = {
            tool: "listCodeDefinitionNames",
            path: getReadablePath(this.cwd, removeClosingTag("path", relDirPath)),
        }
        try {
            if (block.partial) {
                const partialMessage = JSON.stringify({
                    ...sharedMessageProps,
                    content: "", // Placeholder for partial message
                } satisfies ClineSayTool)
                await this.ask("tool", partialMessage, block.partial).catch(() => {})
                return
            }

            if (!relDirPath) {
                this.consecutiveMistakeCount++
                pushToolResult(await this.sayAndCreateMissingParamError("list_code_definition_names", "path", this.say))
                return
            }

            this.consecutiveMistakeCount = 0
            const absolutePath = path.resolve(this.cwd, relDirPath)

            // Execute the tool logic
            const result = await parseSourceCodeForDefinitionsTopLevel(
                absolutePath,
                this.rooIgnoreController,
            )

            // Ask for approval
            const completeMessage = JSON.stringify({
                ...sharedMessageProps,
                content: result, // Include result in approval message
            } satisfies ClineSayTool)
            const didApprove = await askApproval("tool", completeMessage)
            if (!didApprove) {
                pushToolResult(formatResponse.toolDenied())
                this.didRejectTool = true;
                return
            }

            // Push the result if approved
            pushToolResult(result)

        } catch (error) {
            await handleError("parsing source code definitions", error as Error)
        }
    }

    private async _executeSearchFiles(
        block: ToolUse,
        pushToolResult: PushToolResultFunction,
        handleError: HandleErrorFunction,
        removeClosingTag: RemoveClosingTagFunction,
        askApproval: AskApprovalFunction
    ): Promise<void> {
        const relDirPath: string | undefined = block.params.path
        const regex: string | undefined = block.params.regex
        const filePattern: string | undefined = block.params.file_pattern
        const sharedMessageProps: ClineSayTool = {
            tool: "searchFiles",
            path: getReadablePath(this.cwd, removeClosingTag("path", relDirPath)),
            regex: removeClosingTag("regex", regex),
            filePattern: removeClosingTag("file_pattern", filePattern),
        }
        try {
            if (block.partial) {
                const partialMessage = JSON.stringify({
                    ...sharedMessageProps,
                    content: "", // Placeholder for partial message
                } satisfies ClineSayTool)
                await this.ask("tool", partialMessage, block.partial).catch(() => {})
                return
            }

            if (!relDirPath) {
                this.consecutiveMistakeCount++
                pushToolResult(await this.sayAndCreateMissingParamError("search_files", "path", this.say))
                return
            }
            if (!regex) {
                this.consecutiveMistakeCount++
                pushToolResult(await this.sayAndCreateMissingParamError("search_files", "regex", this.say))
                return
            }

            this.consecutiveMistakeCount = 0
            const absolutePath = path.resolve(this.cwd, relDirPath)

            // Execute the tool logic
            const results = await regexSearchFiles(
                this.cwd, // Pass cwd
                absolutePath,
                regex,
                filePattern,
                this.rooIgnoreController,
            )

            // Ask for approval
            const completeMessage = JSON.stringify({
                ...sharedMessageProps,
                content: results, // Include results in approval message
            } satisfies ClineSayTool)
            const didApprove = await askApproval("tool", completeMessage)
            if (!didApprove) {
                pushToolResult(formatResponse.toolDenied())
                this.didRejectTool = true;
                return
            }

            // Push the result if approved
            pushToolResult(results)

        } catch (error) {
            await handleError("searching files", error as Error)
        }
    }

    private async _executeAskFollowupQuestion(
        block: ToolUse,
        pushToolResult: PushToolResultFunction,
        handleError: HandleErrorFunction,
        removeClosingTag: RemoveClosingTagFunction
        // No askApproval needed
    ): Promise<void> {
        const question: string | undefined = block.params.question
        try {
            if (block.partial) {
                await this.ask("followup", removeClosingTag("question", question) ?? "", block.partial).catch( // Add fallback for undefined
                    () => {},
                )
                return // Don't proceed further for partial
            }

            if (!question) {
                this.consecutiveMistakeCount++
                pushToolResult(
                    await this.sayAndCreateMissingParamError("ask_followup_question", "question", this.say),
                )
                return
            }

            this.consecutiveMistakeCount = 0
            // Ask the question and wait for the user's response
            const { text, images } = await this.ask("followup", question, false)
            // Send the user's response back as a tool result
            await this.say("user_feedback", text ?? "", images) // Also show feedback in UI
            pushToolResult(formatResponse.toolResult(`<answer>\n${text}\n</answer>`, images))

        } catch (error) {
            await handleError("asking question", error as Error)
        }
    }

    private async _executeSwitchMode(
        block: ToolUse,
        pushToolResult: PushToolResultFunction,
        handleError: HandleErrorFunction,
        removeClosingTag: RemoveClosingTagFunction,
        askApproval: AskApprovalFunction
    ): Promise<void> {
        const mode_slug: string | undefined = block.params.mode_slug
        const reason: string | undefined = block.params.reason
        const provider = this.providerRef.deref();
        if (!provider) {
            throw new Error("ClineProvider reference lost");
        }
        const state = await provider.getState();

        try {
            if (block.partial) {
                const partialMessage = JSON.stringify({
                    tool: "switchMode",
                    mode: removeClosingTag("mode_slug", mode_slug),
                    reason: removeClosingTag("reason", reason),
                })
                await this.ask("tool", partialMessage, block.partial).catch(() => {})
                return
            }

            if (!mode_slug) {
                this.consecutiveMistakeCount++
                pushToolResult(await this.sayAndCreateMissingParamError("switch_mode", "mode_slug", this.say))
                return
            }
            this.consecutiveMistakeCount = 0

            // Verify the mode exists
            const targetMode = getModeBySlug(mode_slug, state.customModes)
            if (!targetMode) {
                pushToolResult(formatResponse.toolError(`Invalid mode: ${mode_slug}`))
                return
            }

            // Check if already in requested mode
            const currentModeSlug = state.mode ?? defaultModeSlug
            if (currentModeSlug === mode_slug) {
                pushToolResult(`Already in ${targetMode.name} mode.`)
                return
            }

            const completeMessage = JSON.stringify({
                tool: "switchMode",
                mode: mode_slug,
                reason,
            })

            const didApprove = await askApproval("tool", completeMessage)
            if (!didApprove) {
                pushToolResult(formatResponse.toolDenied())
                this.didRejectTool = true;
                return
            }

            // Switch the mode using shared handler
            await provider.handleModeSwitch(mode_slug)
            const currentMode = getModeBySlug(currentModeSlug, state.customModes);
            pushToolResult(
                `Successfully switched from ${currentMode?.name ?? currentModeSlug} mode to ${
                    targetMode.name
                } mode${reason ? ` because: ${reason}` : ""}.`,
            )
            await delay(500) // delay to allow mode change to take effect before next tool is executed

        } catch (error) {
            await handleError("switching mode", error as Error)
        }
    }

    private async _executeNewTask(
        block: ToolUse,
        pushToolResult: PushToolResultFunction,
        handleError: HandleErrorFunction,
        removeClosingTag: RemoveClosingTagFunction,
        askApproval: AskApprovalFunction
    ): Promise<{ needsPause: boolean }> { // Return flag
        const mode: string | undefined = block.params.mode
        const message: string | undefined = block.params.message
        const provider = this.providerRef.deref();
        if (!provider) {
            throw new Error("ClineProvider reference lost");
        }
        const state = await provider.getState();

        try {
            if (block.partial) {
                const partialMessage = JSON.stringify({
                    tool: "newTask",
                    mode: removeClosingTag("mode", mode),
                    message: removeClosingTag("message", message),
                })
                await this.ask("tool", partialMessage, block.partial).catch(() => {})
                return { needsPause: false }; // No pause needed for partial
            }

            if (!mode) {
                this.consecutiveMistakeCount++
                pushToolResult(await this.sayAndCreateMissingParamError("new_task", "mode", this.say))
                return { needsPause: false };
            }
            if (!message) {
                this.consecutiveMistakeCount++
                pushToolResult(await this.sayAndCreateMissingParamError("new_task", "message", this.say))
                return { needsPause: false };
            }
            this.consecutiveMistakeCount = 0

            // Verify the mode exists
            const targetMode = getModeBySlug(mode, state.customModes)
            if (!targetMode) {
                pushToolResult(formatResponse.toolError(`Invalid mode: ${mode}`))
                return { needsPause: false };
            }

            // Show what we're about to do
            const toolMessage = JSON.stringify({
                tool: "newTask",
                mode: targetMode.name,
                content: message, // Use 'content' for consistency in approval UI? Or keep 'message'? Check UI. Assuming 'content'.
            })

            const didApprove = await askApproval("tool", toolMessage)
            if (!didApprove) {
                pushToolResult(formatResponse.toolDenied())
                this.didRejectTool = true;
                return { needsPause: false };
            }

            // Switch mode first, then create new task instance via provider
            await provider.handleModeSwitch(mode)
            await delay(500) // delay to allow mode change to take effect
            await provider.initClineWithSubTask(message) // Provider handles creating new Cline instance

            pushToolResult(
                `Successfully created new task in ${targetMode.name} mode with message: ${message}`,
            )
            // Signal that Cline needs to set its pause state
            return { needsPause: true };

        } catch (error) {
            await handleError("creating new task", error as Error)
            return { needsPause: false }; // Ensure flag is returned even on error
        }
    }

    private async _executeFetchInstructions(
        block: ToolUse,
        pushToolResult: PushToolResultFunction,
        handleError: HandleErrorFunction
        // No removeClosingTag or askApproval needed
    ): Promise<void> {
        const task: string | undefined = block.params.task
        const provider = this.providerRef.deref();
        if (!provider) {
            throw new Error("ClineProvider reference lost");
        }

        try {
            // No partial handling needed for this internal tool

            if (!task) {
                this.consecutiveMistakeCount++
                pushToolResult(await this.sayAndCreateMissingParamError("fetch_instructions", "task", this.say))
                return
            }
            this.consecutiveMistakeCount = 0

            // Fetch instructions directly from the provider
            // const instructions = await provider.fetchInstructions(task); // Method doesn't exist on provider
            const instructions = "Instructions fetching not implemented yet."; // Placeholder

            if (!instructions) {
                pushToolResult(formatResponse.toolError(`Could not fetch instructions for task: ${task}`))
                return
            }

            // Push the fetched instructions as the result
            pushToolResult(instructions);

        } catch (error) {
            await handleError("fetching instructions", error as Error)
        }
    }

    private async _executeUseMcpTool(
        block: ToolUse,
        pushToolResult: PushToolResultFunction,
        handleError: HandleErrorFunction,
        removeClosingTag: RemoveClosingTagFunction,
        askApproval: AskApprovalFunction
    ): Promise<void> {
        const server_name: string | undefined = block.params.server_name
        const tool_name: string | undefined = block.params.tool_name
        const mcp_arguments: string | undefined = block.params.arguments
        try {
            if (block.partial) {
                const partialMessage = JSON.stringify({
                	type: "use_mcp_tool",
                	serverName: removeClosingTag("server_name", server_name) ?? "", // Add fallback
                	toolName: removeClosingTag("tool_name", tool_name),
                	arguments: removeClosingTag("arguments", mcp_arguments),
                } satisfies ClineAskUseMcpServer)
                await this.ask("use_mcp_server", partialMessage, block.partial).catch(() => {})
                return
            }

            if (!server_name) {
                this.consecutiveMistakeCount++
                pushToolResult(
                    await this.sayAndCreateMissingParamError("use_mcp_tool", "server_name", this.say),
                )
                return
            }
            if (!tool_name) {
                this.consecutiveMistakeCount++
                pushToolResult(
                    await this.sayAndCreateMissingParamError("use_mcp_tool", "tool_name", this.say),
                )
                return
            }

            let parsedArguments: Record<string, unknown> | undefined
            if (mcp_arguments) {
                try {
                    parsedArguments = JSON.parse(mcp_arguments)
                } catch (error) {
                    this.consecutiveMistakeCount++
                    await this.say(
                        "error",
                        `Roo tried to use ${tool_name} with an invalid JSON argument. Retrying...`,
                    )
                    pushToolResult(
                        formatResponse.toolError(
                            formatResponse.invalidMcpToolArgumentError(server_name, tool_name),
                        ),
                    )
                    return
                }
            }
            this.consecutiveMistakeCount = 0

            const completeMessage = JSON.stringify({
                type: "use_mcp_tool",
                serverName: server_name,
                toolName: tool_name,
                arguments: mcp_arguments, // Keep original string for approval message
            } satisfies ClineAskUseMcpServer) // Assuming ClineAskUseMcpServer is defined/imported

            const didApprove = await askApproval("use_mcp_server", completeMessage)
            if (!didApprove) {
                pushToolResult(formatResponse.toolDenied())
                this.didRejectTool = true;
                return
            }

            // now execute the tool via McpHub
            await this.say("mcp_server_request_started", `Requesting ${tool_name} from ${server_name}...`) // Add message
            const toolResult = await this.mcpHub.callTool(server_name, tool_name, parsedArguments)

            // Format the result
            const toolResultPretty =
                (toolResult?.isError ? "Error:\n" : "") +
                    toolResult?.content
                        .map((item) => {
                            if (item.type === "text") {
                                return item.text
                            }
                            if (item.type === "resource") {
                                const { blob, ...rest } = item.resource // Exclude blob if present
                                return JSON.stringify(rest, null, 2)
                            }
                            return ""
                        })
                        .filter(Boolean)
                        .join("\n\n") || "(No response)"

            await this.say("mcp_server_response", toolResultPretty)
            pushToolResult(formatResponse.toolResult(toolResultPretty))

        } catch (error) {
            await handleError("executing MCP tool", error as Error)
        }
    }

    private async _executeAccessMcpResource(
        block: ToolUse,
        pushToolResult: PushToolResultFunction,
        handleError: HandleErrorFunction,
        removeClosingTag: RemoveClosingTagFunction,
        askApproval: AskApprovalFunction
    ): Promise<void> {
        const server_name: string | undefined = block.params.server_name
        const uri: string | undefined = block.params.uri
        try {
            if (block.partial) {
                const partialMessage = JSON.stringify({
                	type: "access_mcp_resource",
                	serverName: removeClosingTag("server_name", server_name) ?? "", // Add fallback
                	uri: removeClosingTag("uri", uri),
                } satisfies ClineAskUseMcpServer)
                await this.ask("use_mcp_server", partialMessage, block.partial).catch(() => {})
                return
            }

            if (!server_name) {
                this.consecutiveMistakeCount++
                pushToolResult(
                    await this.sayAndCreateMissingParamError("access_mcp_resource", "server_name", this.say),
                )
                return
            }
            if (!uri) {
                this.consecutiveMistakeCount++
                pushToolResult(
                    await this.sayAndCreateMissingParamError("access_mcp_resource", "uri", this.say),
                )
                return
            }
            this.consecutiveMistakeCount = 0

            const completeMessage = JSON.stringify({
                type: "access_mcp_resource",
                serverName: server_name,
                uri,
            } satisfies ClineAskUseMcpServer) // Assuming ClineAskUseMcpServer is defined/imported

            const didApprove = await askApproval("use_mcp_server", completeMessage)
            if (!didApprove) {
                pushToolResult(formatResponse.toolDenied())
                this.didRejectTool = true;
                return
            }

            // now execute the tool via McpHub
            await this.say("mcp_server_request_started", `Accessing resource ${uri} from ${server_name}...`) // Add message
            const resourceResult = await this.mcpHub.readResource(server_name, uri)

            // Format the result
            const resourceResultPretty =
                resourceResult?.contents
                    .map((item) => {
                        if (item.text) {
                            return item.text
                        }
                        // Handle other potential content types if necessary
                        return ""
                    })
                    .filter(Boolean)
                    .join("\n\n") || "(Empty response)"

            await this.say("mcp_server_response", resourceResultPretty)
            pushToolResult(formatResponse.toolResult(resourceResultPretty))

        } catch (error) {
            await handleError("accessing MCP resource", error as Error)
        }
    }

    private async _executeAttemptCompletion(
        block: ToolUse,
        taskId: string,
        pushToolResult: PushToolResultFunction,
        handleError: HandleErrorFunction,
        removeClosingTag: RemoveClosingTagFunction,
        askApproval: AskApprovalFunction,
        isSubTask: boolean // Add isSubTask parameter
        // Requires access to pausedModeSlug, taskNumber, providerRef.deref().finishSubTask, telemetryService
    ): Promise<void> {
        const result: string | undefined = block.params.result
        const command: string | undefined = block.params.command
        const provider = this.providerRef.deref();
        if (!provider) {
            throw new Error("ClineProvider reference lost");
        }
        // const state = await provider.getState(); // Get current state - Not needed if isSubTask is passed

        try {
            // NOTE: Partial handling for attempt_completion is complex due to potential command execution.
            // Simplified initial implementation: Handle only non-partial for now.
            if (block.partial) {
                // Basic partial handling: show result text
                await this.say("completion_result", removeClosingTag("result", result) ?? ""); // Remove 4th arg
                return;
            }

            if (!result) {
                this.consecutiveMistakeCount++
                pushToolResult(
                    await this.sayAndCreateMissingParamError("attempt_completion", "result", this.say),
                )
                return
            }
            this.consecutiveMistakeCount = 0

            // Send the main result first
            await this.say("completion_result", result) // Remove 4th arg
            // telemetryService.captureTaskCompleted(taskId) // Removed telemetry call

            let commandOutputForFeedback: string | undefined;

            if (command) {
                // Ask for command approval
                const didApproveCommand = await askApproval("command", command)
                if (!didApproveCommand) {
                    // If command denied, proceed to final feedback step without command result
                    pushToolResult(formatResponse.toolDenied()) // Indicate command was denied
                    this.didRejectTool = true; // Set rejection flag
                    // Fall through to the final feedback/completion ask
                } else {
                    // Execute command - Simplified: Assume _executeExecuteCommand handles output and pushes its own result.
                    // We need a way to know if it succeeded/failed or was rejected if we want to include that info here.
                    // For now, just execute it. The result will appear separately.
                    await this._executeExecuteCommand(block, taskId, ()=>{}, handleError, removeClosingTag); // Pass dummy pushToolResult
                    // How to get commandResult back here? Needs refactoring _executeExecuteCommand or using events.
                    // commandOutputForFeedback = "Command execution result will appear separately.";
                }
            }

            // Handle subtask completion
            if (isSubTask) { // Use passed parameter
                const didApproveFinish = await this.ask("finish_sub_task", "Mark sub-task as complete and return to parent task?", false)
                if (didApproveFinish.response === "yesButtonClicked") {
                    // Tell the provider to finish the subtask
                    await provider.finishSubTask(`Sub-task complete: ${result.substring(0, 100)}...`) // Pass completion message
                    // Don't pushToolResult here, as the task is ending.
                    return; // Stop further processing in this executor instance
                } else {
                    // User chose not to finish subtask, proceed to normal completion feedback
                }
            }

            // Ask for final feedback / allow new input (Relinquish control)
            // Send empty string to signal completion and enable user input field
            const { response, text, images } = await this.ask("completion_result", "", false)
            if (response === "yesButtonClicked") {
                // This typically triggers a new task via UI, signal loop to stop?
                pushToolResult("") // Let Cline handle stopping the loop
            } else {
                // User provided feedback, send it back to the model
                await this.say("user_feedback", text ?? "", images)
                // Combine command output (if captured) and user feedback
                let feedbackResult = `<user_feedback>\n${text}\n</user_feedback>`;
                // if (commandOutputForFeedback) {
                // 	feedbackResult = `${commandOutputForFeedback}\n\n${feedbackResult}`;
                // }
                pushToolResult(formatResponse.toolResult(feedbackResult, images))
            }

        } catch (error) {
            await handleError("attempting completion", error as Error)
        }
    }


    // --- Central Execution Logic ---

    // Central method to execute a tool based on the block name
    public async executeToolBlock(
        block: ToolUse,
        taskId: string, // Added taskId
        isSubTask: boolean, // Added isSubTask
        pushToolResult: PushToolResultFunction,
        handleError: HandleErrorFunction,
        removeClosingTag: RemoveClosingTagFunction,
        askApproval: AskApprovalFunction // Pass askApproval here for now
    ): Promise<{ didEditFile: boolean, didRejectTool: boolean, consecutiveMistakeCount: number, needsPause?: boolean }> { // Add needsPause to return type

        // Reset state flags for this execution
        this.didEditFile = false;
        this.didRejectTool = false;
        // Note: consecutiveMistakeCount is managed per-tool where needed (e.g., write_to_file, apply_diff)

        // Helper function specific to this execution context
        const sayAndCreateMissingParamError = async (toolName: string, paramName: string): Promise<ToolResponse> => {
            return this.sayAndCreateMissingParamError(toolName, paramName, this.say);
        };

        try {
            switch (block.name) {
                case "write_to_file":
                    await this._executeWriteToFile(block, pushToolResult, handleError, removeClosingTag, askApproval)
                    break
                case "apply_diff":
                    await this._executeApplyDiff(block, pushToolResult, handleError, removeClosingTag, askApproval)
                    break
                case "insert_content":
                    await this._executeInsertContent(block, pushToolResult, handleError, removeClosingTag, askApproval)
                    break
                case "search_and_replace":
                    await this._executeSearchAndReplace(block, pushToolResult, handleError, removeClosingTag, askApproval)
                    break
                case "read_file":
                    await this._executeReadFile(block, pushToolResult, handleError, removeClosingTag)
                    break
                case "list_files":
                    await this._executeListFiles(block, pushToolResult, handleError, removeClosingTag)
                    break
                case "list_code_definition_names":
                    await this._executeListCodeDefinitionNames(block, pushToolResult, handleError, removeClosingTag, askApproval)
                    break
                case "search_files":
                    await this._executeSearchFiles(block, pushToolResult, handleError, removeClosingTag, askApproval)
                    break
                // case "browser_action": // Handled directly in Cline? Or move here?
                //     pushToolResult(formatResponse.toolError("browser_action not implemented in ToolExecutor yet"))
                //     break;
                case "execute_command":
                    await this._executeExecuteCommand(block, taskId, pushToolResult, handleError, removeClosingTag) // Pass taskId
                    break
                case "ask_followup_question":
                    await this._executeAskFollowupQuestion(block, pushToolResult, handleError, removeClosingTag)
                    break
                case "attempt_completion":
                    await this._executeAttemptCompletion(block, taskId, pushToolResult, handleError, removeClosingTag, askApproval, isSubTask) // Pass isSubTask
                    break
                case "use_mcp_tool":
                    await this._executeUseMcpTool(block, pushToolResult, handleError, removeClosingTag, askApproval)
                    break
                case "access_mcp_resource":
                    await this._executeAccessMcpResource(block, pushToolResult, handleError, removeClosingTag, askApproval)
                    break
                case "switch_mode":
                    await this._executeSwitchMode(block, pushToolResult, handleError, removeClosingTag, askApproval)
                    break
                case "new_task": {
                    const { needsPause } = await this._executeNewTask(block, pushToolResult, handleError, removeClosingTag, askApproval)
                    // Return the pause signal along with other state
                    return {
                        didEditFile: this.didEditFile,
                        didRejectTool: this.didRejectTool,
                        consecutiveMistakeCount: this.consecutiveMistakeCount,
                        needsPause: needsPause,
                    };
                    // No break needed as we return directly
                }
                case "fetch_instructions":
                    await this._executeFetchInstructions(block, pushToolResult, handleError)
                    break
                default:
                    // Handle unknown tool
                    await this.say("error", `Unknown tool: ${block.name}`)
                    pushToolResult(formatResponse.toolError(`Unknown tool: ${block.name}`))
            }
        } catch (error) {
            // Catch any unexpected errors during tool execution dispatch
            await handleError(`executing tool ${block.name}`, error as Error)
        }

        // Return the state flags potentially modified by the tool execution methods
        return {
            didEditFile: this.didEditFile,
            didRejectTool: this.didRejectTool,
            consecutiveMistakeCount: this.consecutiveMistakeCount,
            needsPause: false // Default needsPause to false if not set by a specific tool
        };
    }
}