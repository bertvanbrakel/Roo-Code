import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs-extra"
import { DiffViewProvider } from "../integrations/editor/DiffViewProvider" // Corrected path
import { RooIgnoreController } from "./ignore/RooIgnoreController"
import { DiffStrategy } from "./diff/DiffStrategy" // Corrected path
import { BrowserSession } from "../services/browser/BrowserSession"
import { McpHub } from "../services/mcp/McpHub"
import { ClineProvider } from "./webview/ClineProvider"
import { ToolParamName, ToolUse } from "./assistant-message" // Corrected path for ToolUse, ToolParamName
import { ClineSayTool, ToolProgressStatus } from "../shared/ExtensionMessage" // Corrected path and added ToolProgressStatus
import { ClineAskResponse } from "../shared/WebviewMessage"
import { getReadablePath } from "../utils/path" // Corrected path
import { fileExistsAtPath } from "../utils/fs" // Corrected path
import { addLineNumbers, stripLineNumbers, everyLineHasLineNumbers, extractTextFromFile } from "../integrations/misc/extract-text" // Corrected path
import { listFiles } from "../services/glob/list-files" // Corrected path
import { detectCodeOmission } from "../integrations/editor/detect-omission" // Added import for detectCodeOmission
import { parseSourceCodeForDefinitionsTopLevel } from "../services/tree-sitter" // Corrected path
import { regexSearchFiles } from "../services/ripgrep" // Corrected path
import { insertGroups } from "./diff/insert-groups" // Corrected path
import { formatResponse } from "./prompts/responses" // Corrected path
import { serializeError } from "serialize-error"
import delay from "delay" // Direct import
// Assuming escapeRegExp and WeakRef are available globally or defined elsewhere for now
// Define ToolResponse locally as it's a type alias in Cline.ts
type ToolResponse = string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>; // Copied from Cline.ts
import Anthropic from "@anthropic-ai/sdk"; // Need this for ToolResponse definition

// Define types for functions passed from Cline
type SayFunction = (type: string, message: string, images?: string[]) => Promise<void>;
type AskFunction = (type: string, message: string, partial?: boolean, status?: ToolProgressStatus | string | undefined) => Promise<{ response: ClineAskResponse; text?: string; images?: string[] }>; // Updated status type
import { ClineAsk } from "../shared/ExtensionMessage"; // Import ClineAsk
type AskApprovalFunction = (type: ClineAsk, message: string, status?: ToolProgressStatus | undefined) => Promise<boolean>; // Align status type with Cline.askApproval
type PushToolResultFunction = (result: ToolResponse) => void;
type HandleErrorFunction = (action: string, error: Error) => Promise<void>; // Assuming async based on previous usage
type RemoveClosingTagFunction = (tag: ToolParamName, text?: string) => string | undefined;

export class ToolExecutor {
    private diffViewProvider: DiffViewProvider;
    private rooIgnoreController: RooIgnoreController | undefined;
    private diffStrategy: DiffStrategy | undefined;

    private async _executeInsertContent(
        block: ToolUse,
        cwd: string,
        say: SayFunction,
        ask: AskFunction,
        pushToolResult: PushToolResultFunction,
        handleError: HandleErrorFunction,
        removeClosingTag: RemoveClosingTagFunction
    ): Promise<void> {
        const relPath: string | undefined = block.params.path
        const operations: string | undefined = block.params.operations

        const sharedMessageProps: ClineSayTool = {
            tool: "appliedDiff",
            path: getReadablePath(cwd, removeClosingTag("path", relPath)),
        }

        try {
            if (block.partial) {
                const partialMessage = JSON.stringify(sharedMessageProps)
                await ask("tool", partialMessage, block.partial).catch(() => {})
                return
            }

            // Validate required parameters
            if (!relPath) {
                pushToolResult(await this.sayAndCreateMissingParamError("insert_content", "path", say))
                return
            }

            if (!operations) {
                pushToolResult(await this.sayAndCreateMissingParamError("insert_content", "operations", say))
                return
            }

            const absolutePath = path.resolve(cwd, relPath)
            const fileExists = await fileExistsAtPath(absolutePath)

            if (!fileExists) {
                const formattedError = `File does not exist at path: ${absolutePath}\n\n<error_details>\nThe specified file could not be found. Please verify the file path and try again.\n</error_details>`
                await say("error", formattedError)
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
            } catch (error) {
                await say("error", `Failed to parse operations JSON: ${error.message}`)
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
                        index: elem.start_line - 1,
                        elements: elem.content.split("\n"),
                    }
                }),
            ).join("\n")

            // Show changes in diff view
            if (!this.diffViewProvider.isEditing) {
                await ask("tool", JSON.stringify(sharedMessageProps), true).catch(() => {})
                // First open with original content
                await this.diffViewProvider.open(relPath)
                await this.diffViewProvider.update(fileContent, false)
                this.diffViewProvider.scrollToFirstDiff()
                await delay(200)
            }

            const diff = formatResponse.createPrettyPatch(relPath, fileContent, updatedContent)

            if (!diff) {
                pushToolResult(`No changes needed for '${relPath}'`)
                await this.diffViewProvider.reset() // Reset diff view even if no changes
                return
            }

            await this.diffViewProvider.update(updatedContent, true)

            const completeMessage = JSON.stringify({
                ...sharedMessageProps,
                diff,
            } satisfies ClineSayTool)

            // Re-using askApproval logic from apply_diff helper
            const askResult = await ask("tool", completeMessage, false)
            const approved = askResult.response === "yesButtonClicked";
            const { text: feedbackText, images: feedbackImages } = askResult;

            if (!approved) {
                await this.diffViewProvider.revertChanges()
                if (feedbackText) {
                    await say("user_feedback", feedbackText, feedbackImages)
                    pushToolResult(formatResponse.toolResult(formatResponse.toolDeniedWithFeedback(feedbackText), feedbackImages))
                } else {
                    pushToolResult(formatResponse.toolDenied())
                }
                return
            }

            // Handle approval with feedback
            if (feedbackText) {
                await say("user_feedback", feedbackText, feedbackImages)
                pushToolResult(formatResponse.toolResult(formatResponse.toolApprovedWithFeedback(feedbackText), feedbackImages))
            }

            const { newProblemsMessage, userEdits, finalContent } =
                await this.diffViewProvider.saveChanges()

            if (!userEdits) {
                pushToolResult(
                    `The content was successfully inserted in ${relPath.toPosix()}.${newProblemsMessage}`,
                )
            } else {
                const userFeedbackDiff = JSON.stringify({
                    tool: "appliedDiff", // Keep consistent UI message
                    path: getReadablePath(cwd, relPath),
                    diff: userEdits,
                } satisfies ClineSayTool)

                await say("user_feedback_diff", userFeedbackDiff)
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
            }
            await this.diffViewProvider.reset()
        } catch (error) {
            handleError("insert content", error)
            await this.diffViewProvider.reset()
        }
    }

    private async sayAndCreateMissingParamError(toolName: string, paramName: string, say: SayFunction): Promise<string> {
        const message = `Missing required parameter: ${paramName}`
        await say("error", message)
        return formatResponse.toolError(message)
    }
    private browserSession: BrowserSession;
    private mcpHub: McpHub;
    private providerRef: WeakRef<ClineProvider>;
    private cwd: string;
    private say: SayFunction;
    private ask: AskFunction;
    // private askApproval: AskApprovalFunction; // This needs careful handling due to its complex return/logic
    private consecutiveMistakeCount: number = 0; // Manage state internally or pass ref/callback
    private didEditFile: boolean = false; // Manage state internally or pass ref/callback
    private didRejectTool: boolean = false; // Manage state internally or pass ref/callback
    private consecutiveMistakeCountForApplyDiff: Map<string, number> = new Map(); // Manage state internally

    constructor(
        dependencies: {
            diffViewProvider: DiffViewProvider,
            rooIgnoreController: RooIgnoreController | undefined,
            diffStrategy: DiffStrategy | undefined,
            browserSession: BrowserSession,
            mcpHub: McpHub,
            providerRef: WeakRef<ClineProvider>,
            cwd: string,
            say: SayFunction,
            ask: AskFunction,
            // askApproval: AskApprovalFunction,
        }
    ) {
        this.diffViewProvider = dependencies.diffViewProvider;
        this.rooIgnoreController = dependencies.rooIgnoreController;
        this.diffStrategy = dependencies.diffStrategy;
        this.browserSession = dependencies.browserSession;
        this.mcpHub = dependencies.mcpHub;
        this.providerRef = dependencies.providerRef;
        this.cwd = dependencies.cwd;
        this.say = dependencies.say;
        this.ask = dependencies.ask;
        // this.askApproval = dependencies.askApproval;
    }

    // Central method to execute a tool based on the block name
    public async executeToolBlock(
        block: ToolUse,
        pushToolResult: PushToolResultFunction,
        handleError: HandleErrorFunction,
        removeClosingTag: RemoveClosingTagFunction,
        askApproval: AskApprovalFunction // Pass askApproval here for now
    ): Promise<{ didEditFile: boolean, didRejectTool: boolean, consecutiveMistakeCount: number }> { // Return state changes

        // Reset state flags for this execution
        this.didEditFile = false;
        this.didRejectTool = false;

        // Define sayAndCreateMissingParamError locally or pass it
        const sayAndCreateMissingParamError = async (toolName: string, paramName: string): Promise<ToolResponse> => {
            const errorMsg = `Missing required parameter "${paramName}" for tool "${toolName}".`;
            await this.say("error", errorMsg);
            return formatResponse.toolError(errorMsg);
        };

        try {
            switch (block.name) {
                case "write_to_file":
                    await this._executeWriteToFile(block, pushToolResult, handleError, removeClosingTag, askApproval, sayAndCreateMissingParamError);
                    break;
                case "apply_diff":
                    await this._executeApplyDiff(block, pushToolResult, handleError, removeClosingTag, askApproval, sayAndCreateMissingParamError);
                    break;
                case "insert_content":
                    await this._executeInsertContent(block, this.cwd, this.say, this.ask, pushToolResult, handleError, removeClosingTag);
                    break;
                case "insert_content":
                     // TODO: Move logic here, calling _executeInsertContent
                    console.log("Executing insert_content (placeholder)");
                    break;
                case "search_and_replace":
                     // TODO: Move logic here, calling _executeSearchAndReplace
                    console.log("Executing search_and_replace (placeholder)");
                    break;
                case "read_file":
                     // TODO: Move logic here, calling _executeReadFile
                    console.log("Executing read_file (placeholder)");
                    break;
                case "list_files":
                     // TODO: Move logic here, calling _executeListFiles
                    console.log("Executing list_files (placeholder)");
                    break;
                case "list_code_definition_names":
                     // TODO: Move logic here, calling _executeListCodeDefinitionNames
                    console.log("Executing list_code_definition_names (placeholder)");
                    break;
                case "search_files":
                     // TODO: Move logic here, calling _executeSearchFiles
                    console.log("Executing search_files (placeholder)");
                    break;
                // case "browser_action": // Keep browser logic in Cline for now due to complexity?
                //     console.log("Executing browser_action (placeholder)");
                //     break;
                case "execute_command":
                     // TODO: Move logic here, calling _executeExecuteCommand
                    console.log("Executing execute_command (placeholder)");
                    break;
                case "use_mcp_tool":
                     // TODO: Move logic here, calling _executeUseMcpTool
                    console.log("Executing use_mcp_tool (placeholder)");
                    break;
                case "access_mcp_resource":
                     // TODO: Move logic here, calling _executeAccessMcpResource
                    console.log("Executing access_mcp_resource (placeholder)");
                    break;
                case "ask_followup_question":
                     // TODO: Move logic here, calling _executeAskFollowupQuestion
                    console.log("Executing ask_followup_question (placeholder)");
                    break;
                case "attempt_completion":
                    // This should likely remain in Cline as it finalizes the interaction
                    console.log("Attempting completion (handled in Cline)");
                    break;
                case "switch_mode":
                     // TODO: Move logic here, calling _executeSwitchMode
                    console.log("Executing switch_mode (placeholder)");
                    break;
                case "new_task":
                     // TODO: Move logic here, calling _executeNewTask
                    console.log("Executing new_task (placeholder)");
                    break;
                case "fetch_instructions":
                     // TODO: Move logic here, calling _executeFetchInstructions
                    console.log("Executing fetch_instructions (placeholder)");
                    break;
                default:
                    this.consecutiveMistakeCount++;
                    const errorMsg = `Unknown tool: ${block.name}`;
                    await this.say("error", errorMsg);
                    pushToolResult(formatResponse.toolError(errorMsg));
            }
        } catch (error) {
            // Generic catch block for unexpected errors during tool execution setup/dispatch
            await handleError(`dispatching tool ${block.name}`, error as Error);
        }

        // Return updated state
        return {
            didEditFile: this.didEditFile,
            didRejectTool: this.didRejectTool,
            consecutiveMistakeCount: this.consecutiveMistakeCount,
        };
    }

    private async _executeWriteToFile(
        block: ToolUse,
        pushToolResult: PushToolResultFunction,
        handleError: HandleErrorFunction,
        removeClosingTag: RemoveClosingTagFunction,
        askApproval: AskApprovalFunction,
        sayAndCreateMissingParamError: (toolName: string, paramName: string) => Promise<ToolResponse>
    ): Promise<void> {
        const relPath: string | undefined = block.params.path;
        let newContent: string | undefined = block.params.content;
        const predictedLineCount: number | undefined = parseInt(block.params.line_count ?? "");

        // Basic cleanup for common LLM formatting issues
        if (newContent) {
            if (newContent.startsWith("```")) newContent = newContent.split("\n").slice(1).join("\n").trim();
            if (newContent.endsWith("```")) newContent = newContent.split("\n").slice(0, -1).join("\n").trim();
            // Handle HTML entities if needed
            if (newContent.includes("&gt;") || newContent.includes("&lt;") || newContent.includes("&quot;")) {
                newContent = newContent.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, '"');
            }
        }

        const absolutePath = path.resolve(this.cwd, relPath ?? "");
        let fileExists = false;
        let originalContent = "";
        if (relPath) {
            try {
                originalContent = await fs.readFile(absolutePath, "utf-8");
                fileExists = true;
            } catch (e) {
                // File doesn't exist, which is okay for write_to_file
            }
        }

        const sharedMessageProps: ClineSayTool = {
            tool: fileExists ? "editedExistingFile" : "newFileCreated",
            path: getReadablePath(this.cwd, removeClosingTag("path", relPath)),
        };

        try {
            if (block.partial) {
                // Update GUI message
                const partialMessage = JSON.stringify(sharedMessageProps);
                await this.ask("tool", partialMessage, block.partial).catch(() => {});
                
                // Update editor
                if (relPath && !this.diffViewProvider.isEditing) {
                    // Open the editor and prepare to stream content in
                    await this.diffViewProvider.open(relPath);
                }
                
                // Editor is open, stream content in
                if (newContent !== undefined) {
                    await this.diffViewProvider.update(
                        everyLineHasLineNumbers(newContent) ? stripLineNumbers(newContent) : newContent,
                        false,
                    );
                }
                return;
            } else {
                // Validate required parameters
                if (!relPath) {
                    this.consecutiveMistakeCount++;
                    pushToolResult(await sayAndCreateMissingParamError("write_to_file", "path"));
                    await this.diffViewProvider.reset();
                    return;
                }
                if (newContent === undefined) {
                    this.consecutiveMistakeCount++;
                    pushToolResult(await sayAndCreateMissingParamError("write_to_file", "content"));
                    await this.diffViewProvider.reset();
                    return;
                }
                if (predictedLineCount === undefined || isNaN(predictedLineCount)) {
                    this.consecutiveMistakeCount++;
                    pushToolResult(await sayAndCreateMissingParamError("write_to_file", "line_count"));
                    await this.diffViewProvider.reset();
                    return;
                }

                // Check file access permissions
                const accessAllowed = this.rooIgnoreController?.validateAccess(relPath);
                if (!accessAllowed) {
                    await this.say("rooignore_error", relPath);
                    pushToolResult(formatResponse.toolError(formatResponse.rooIgnoreError(relPath)));
                    await this.diffViewProvider.reset();
                    this.didRejectTool = true;
                    return;
                }

                // Reset mistake counter on successful validation
                this.consecutiveMistakeCount = 0;

                // Update diff view provider state
                if (this.diffViewProvider.editType === undefined) {
                    this.diffViewProvider.editType = fileExists ? "modify" : "create";
                } else {
                    // If editType is already set, ensure fileExists reflects it
                    fileExists = this.diffViewProvider.editType === "modify";
                }
                this.diffViewProvider.originalContent = originalContent;

                // Open the diff view if not already editing
                if (!this.diffViewProvider.isEditing) {
                    const partialMessage = JSON.stringify(sharedMessageProps);
                    await this.ask("tool", partialMessage, true).catch(() => {});
                    await this.diffViewProvider.open(relPath);
                }
                
                // Update the diff view with the new content
                await this.diffViewProvider.update(
                    everyLineHasLineNumbers(newContent) ? stripLineNumbers(newContent) : newContent,
                    true,
                );
                await delay(300);
                await this.diffViewProvider.scrollToFirstDiff();

                // Check for code omission
                if (detectCodeOmission(
                    this.diffViewProvider.originalContent || "",
                    newContent,
                    predictedLineCount,
                )) {
                    if (this.diffStrategy) {
                        await this.diffViewProvider.revertChanges();
                        pushToolResult(
                            formatResponse.toolError(
                                "Content appears to be truncated. Please ensure you're providing the complete file content without omissions like '// rest of code unchanged'. The line_count parameter should match the actual number of lines in your content."
                            ),
                        );
                        return;
                    } else {
                        // Show warning but continue if no diff strategy
                        const provider = this.providerRef.deref();
                        if (provider) {
                            vscode.window
                                .showWarningMessage(
                                    "Potential code truncation detected. The content may be incomplete.",
                                    "Follow this guide to fix the issue"
                                )
                                .then((selection) => {
                                    if (selection === "Follow this guide to fix the issue") {
                                        vscode.env.openExternal(
                                            vscode.Uri.parse(
                                                "https://github.com/cline/cline/wiki/Troubleshooting-%E2%80%90-Cline-Deleting-Code-with-%22Rest-of-Code-Here%22-Comments"
                                            ),
                                        );
                                    }
                                });
                        }
                    }
                }

                // Prepare message for approval
                const completeMessage = JSON.stringify({
                    ...sharedMessageProps,
                    content: fileExists ? undefined : newContent,
                    diff: fileExists
                        ? formatResponse.createPrettyPatch(
                            relPath,
                            this.diffViewProvider.originalContent,
                            newContent,
                        )
                        : undefined,
                } satisfies ClineSayTool);

                // Ask for user approval
                const approved = await askApproval("tool", completeMessage);
                if (!approved) {
                    await this.diffViewProvider.revertChanges();
                    pushToolResult(formatResponse.toolDenied());
                    this.didRejectTool = true;
                    return;
                }

                // Save changes if approved
                const { newProblemsMessage, userEdits, finalContent } =
                    await this.diffViewProvider.saveChanges();
                this.didEditFile = true;

                // Handle user edits if any
                if (userEdits) {
                    await this.say(
                        "user_feedback_diff",
                        JSON.stringify({
                            tool: fileExists ? "editedExistingFile" : "newFileCreated",
                            path: getReadablePath(this.cwd, relPath),
                            diff: userEdits,
                        } satisfies ClineSayTool),
                    );
                    pushToolResult(
                        `The user made the following updates to your content:\n\n${userEdits}\n\n` +
                        `The updated content has been successfully saved to ${relPath}. Here is the full, updated content of the file, including line numbers:\n\n` +
                        `<final_file_content path="${relPath}">\n${addLineNumbers(
                            finalContent || "",
                        )}\n</final_file_content>\n\n` +
                        `Please note:\n` +
                        `1. You do not need to re-write the file with these changes, as they have already been applied.\n` +
                        `2. Proceed with the task using this updated file content as the new baseline.\n` +
                        `3. If the user's edits have addressed part of the task or changed the requirements, adjust your approach accordingly.` +
                        `${newProblemsMessage}`,
                    );
                } else {
                    pushToolResult(
                        `The content was successfully saved to ${relPath}.${newProblemsMessage}`,
                    );
                }
                await this.diffViewProvider.reset();
                return;
            }
        } catch (error) {
            await handleError("writing file", error as Error);
            await this.diffViewProvider.reset();
            return;
        }
    }

    // ... other private helper methods for each tool ...

 private async _executeApplyDiff(
  block: ToolUse,
  pushToolResult: PushToolResultFunction,
  handleError: HandleErrorFunction,
  removeClosingTag: RemoveClosingTagFunction,
  askApproval: AskApprovalFunction,
  sayAndCreateMissingParamError: (toolName: string, paramName: string) => Promise<ToolResponse>
 ): Promise<void> {
  const relPath: string | undefined = block.params.path
  const diffContent: string | undefined = block.params.diff

  const sharedMessageProps: ClineSayTool = {
   tool: "appliedDiff",
   path: getReadablePath(this.cwd, removeClosingTag("path", relPath)),
  }

  try {
   if (block.partial) {
    // update gui message
    let toolProgressStatus
    if (this.diffStrategy && this.diffStrategy.getProgressStatus) {
    	toolProgressStatus = this.diffStrategy.getProgressStatus(block)
    }
    const partialMessage = JSON.stringify(sharedMessageProps)
    await this.ask("tool", partialMessage, block.partial, toolProgressStatus).catch(() => {})
    return; // Replaced break
   } else {
    if (!relPath) {
    	this.consecutiveMistakeCount++
    	pushToolResult(await sayAndCreateMissingParamError("apply_diff", "path"))
    	return; // Replaced break
    }
    if (!diffContent) {
    	this.consecutiveMistakeCount++
    	pushToolResult(await sayAndCreateMissingParamError("apply_diff", "diff"))
    	return; // Replaced break
    }

    const accessAllowed = this.rooIgnoreController?.validateAccess(relPath)
    if (!accessAllowed) {
    	await this.say("rooignore_error", relPath)
    	pushToolResult(formatResponse.toolError(formatResponse.rooIgnoreError(relPath)))
    	this.didRejectTool = true; // Set rejection flag
    	return; // Replaced break
    }

    const absolutePath = path.resolve(this.cwd, relPath)
    const fileExists = await fileExistsAtPath(absolutePath)

    if (!fileExists) {
    	this.consecutiveMistakeCount++
    	const formattedError = `File does not exist at path: ${absolutePath}\n\n<error_details>\nThe specified file could not be found. Please verify the file path and try again.\n</error_details>`
    	await this.say("error", formattedError)
    	pushToolResult(formattedError)
    	return; // Replaced break
    }

    const originalContent = await fs.readFile(absolutePath, "utf-8")

    // Apply the diff to the original content
    const diffResult = (await this.diffStrategy?.applyDiff(
    	originalContent,
    	diffContent,
    	parseInt(block.params.start_line ?? ""),
    	parseInt(block.params.end_line ?? ""),
    )) ?? {
    	success: false,
    	error: "No diff strategy available",
    }
    let partResults = ""

    if (!diffResult.success) {
    	this.consecutiveMistakeCount++
    	const currentCount =
    		(this.consecutiveMistakeCountForApplyDiff.get(relPath) || 0) + 1
    	this.consecutiveMistakeCountForApplyDiff.set(relPath, currentCount)
    	let formattedError = ""
    	if (diffResult.failParts && diffResult.failParts.length > 0) {
    		for (const failPart of diffResult.failParts) {
    			if (failPart.success) continue
    			const errorDetails = failPart.details ? JSON.stringify(failPart.details, null, 2) : ""
    			formattedError = `<error_details>\n${failPart.error}${errorDetails ? `\n\nDetails:\n${errorDetails}` : ""}\n</error_details>`
    			partResults += formattedError
    		}
    	} else {
    		const errorDetails = diffResult.details ? JSON.stringify(diffResult.details, null, 2) : ""
    		formattedError = `Unable to apply diff to file: ${absolutePath}\n\n<error_details>\n${diffResult.error}${errorDetails ? `\n\nDetails:\n${errorDetails}` : ""}\n</error_details>`
    	}

    	if (currentCount >= 2) {
    		await this.say("error", formattedError)
    	}
    	pushToolResult(formattedError)
    	return; // Replaced break
    }

    this.consecutiveMistakeCount = 0
    this.consecutiveMistakeCountForApplyDiff.delete(relPath)
    // Show diff view before asking for approval
    this.diffViewProvider.editType = "modify"
    await this.diffViewProvider.open(relPath)
    await this.diffViewProvider.update(diffResult.content, true)
    await this.diffViewProvider.scrollToFirstDiff()

    const completeMessage = JSON.stringify({
    	...sharedMessageProps,
    	diff: diffContent,
    } satisfies ClineSayTool)

    let toolProgressStatus
    if (this.diffStrategy && this.diffStrategy.getProgressStatus) {
    	toolProgressStatus = this.diffStrategy.getProgressStatus(block, diffResult)
    }

    const approved = await askApproval("tool", completeMessage, toolProgressStatus) // Use askApproval directly
    if (!approved) {
    	await this.diffViewProvider.revertChanges()
    	pushToolResult(formatResponse.toolDenied()) // Simplified denial
    	this.didRejectTool = true;
    	return; // Replaced break
    }

    // Handle approval with feedback (assuming askApproval doesn't return feedback directly here)
    // Feedback handling might need adjustment based on how askApproval is implemented/passed

    const { newProblemsMessage, userEdits, finalContent } =
    	await this.diffViewProvider.saveChanges()
    this.didEditFile = true
    let partFailHint = ""
    if (diffResult.failParts && diffResult.failParts.length > 0) {
    	partFailHint = `But unable to apply all diff parts to file: ${absolutePath}, silently use <read_file> tool to check newest file version and re-apply diffs\n`
    }
    if (userEdits) {
    	const fileStillExists = await fileExistsAtPath(absolutePath)
    	await this.say(
    		"user_feedback_diff",
    		JSON.stringify({
    			tool: fileStillExists ? "editedExistingFile" : "newFileCreated",
    			path: getReadablePath(this.cwd, relPath),
    			diff: userEdits,
    		} satisfies ClineSayTool),
    	);
    	pushToolResult(
    		`The user made the following updates to your content:\n\n${userEdits}\n\n` +
    			partFailHint +
    			`The updated content, which includes both your original modifications and the user's edits, has been successfully saved to ${relPath}. Here is the full, updated content of the file, including line numbers:\n\n` +
    			`<final_file_content path="${relPath}">\n${addLineNumbers(
    				finalContent || "",
    			)}\n</final_file_content>\n\n` +
    			`Please note:\n` +
    			`1. You do not need to re-write the file with these changes, as they have already been applied.\n` +
    			`2. Proceed with the task using this updated file content as the new baseline.\n` +
    			`3. If the user's edits have addressed part of the task or changed the requirements, adjust your approach accordingly.` +
    			`${newProblemsMessage}`,
    	);
    } else {
    	pushToolResult(
    		`Changes successfully applied to ${relPath}:\n\n${newProblemsMessage}\n` +
    			partFailHint,
    	);
    }
    await this.diffViewProvider.reset()
    return; // Replaced break
   }
  } catch (error) {
   await handleError("applying diff", error as Error) // Use handleError directly
   await this.diffViewProvider.reset()
   return; // Replaced break
  }
 } // End of _executeApplyDiff method

} // End of ToolExecutor class