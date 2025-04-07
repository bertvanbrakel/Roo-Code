import Anthropic from "@anthropic-ai/sdk"
import { ToolUse } from "./assistant-message" // Import correct ToolUse type
import cloneDeep from "clone-deep"
import { DiffStrategy, getDiffStrategy } from "./diff/DiffStrategy"
import { validateToolUse, isToolAllowedForMode, ToolName } from "./mode-validator"
import delay from "delay"
import fs from "fs/promises"
import os from "os"
import pWaitFor from "p-wait-for"
import getFolderSize from "get-folder-size"
import * as path from "path"
import { serializeError } from "serialize-error"
import * as vscode from "vscode"

import { ApiHandler, buildApiHandler } from "../api"
// import { ApiStream } from "../api/transform/stream" // Not used directly now
import { DIFF_VIEW_URI_SCHEME, DiffViewProvider } from "../integrations/editor/DiffViewProvider"
import {
	CheckpointServiceOptions,
	RepoPerTaskCheckpointService,
	RepoPerWorkspaceCheckpointService,
} from "../services/checkpoints"
import { findToolName, formatContentBlockToMarkdown } from "../integrations/misc/export-markdown"
import {
	extractTextFromFile,
	addLineNumbers,
	stripLineNumbers,
	everyLineHasLineNumbers,
} from "../integrations/misc/extract-text"
import { ExitCodeDetails } from "../integrations/terminal/TerminalProcess"
import { Terminal } from "../integrations/terminal/Terminal"
import { TerminalRegistry } from "../integrations/terminal/TerminalRegistry"
import { UrlContentFetcher } from "../services/browser/UrlContentFetcher"
import { listFiles } from "../services/glob/list-files"
import { regexSearchFiles } from "../services/ripgrep"
import { parseSourceCodeForDefinitionsTopLevel } from "../services/tree-sitter"
import { CheckpointStorage } from "../shared/checkpoints"
import { ApiConfiguration, ModelInfo } from "../shared/api" // Added ModelInfo
import { findLastIndex } from "../shared/array"
import { combineApiRequests } from "../shared/combineApiRequests"
import { combineCommandSequences } from "../shared/combineCommandSequences"
import {
	BrowserAction,
	BrowserActionResult,
	browserActions,
	ClineApiReqCancelReason,
	ClineApiReqInfo,
	ClineAsk,
	ClineAskUseMcpServer,
	ClineMessage,
	ClineSay,
	ClineSayBrowserAction,
	ClineSayTool,
	ToolProgressStatus,
} from "../shared/ExtensionMessage"
import { getApiMetrics } from "../shared/getApiMetrics"
import { HistoryItem } from "../shared/HistoryItem"
import { ClineAskResponse } from "../shared/WebviewMessage"
import { GlobalFileNames } from "../shared/globalFileNames"
import { defaultModeSlug, getModeBySlug, getFullModeDetails, Mode, ModeConfig } from "../shared/modes" // Added Mode, ModeConfig
import { EXPERIMENT_IDS, experiments as Experiments, ExperimentId } from "../shared/experiments"
import { calculateApiCostAnthropic } from "../utils/cost"
import { fileExistsAtPath } from "../utils/fs"
import { arePathsEqual, getReadablePath } from "../utils/path"
import { parseMentions } from "./mentions"
import { RooIgnoreController, LOCK_TEXT_SYMBOL } from "./ignore/RooIgnoreController"
import { AssistantMessageContent, parseAssistantMessage, ToolParamName, ToolUseName, TextContent } from "./assistant-message" // Added TextContent
import { formatResponse } from "./prompts/responses"
import { SYSTEM_PROMPT } from "./prompts/system"
import { truncateConversationIfNeeded } from "./sliding-window"
import { ClineProvider } from "./webview/ClineProvider"
import { detectCodeOmission } from "../integrations/editor/detect-omission"
import { BrowserSession } from "../services/browser/BrowserSession"
import { McpHub } from "../services/mcp/McpHub"
import crypto from "crypto"
import { insertGroups } from "./diff/insert-groups"
import { telemetryService } from "../services/telemetry/TelemetryService"
import { ToolExecutor } from "./ToolExecutor"

const cwd =
	vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0) ?? path.join(os.homedir(), "Desktop") // may or may not exist but fs checking existence would immediately ask for permission which would be bad UX, need to come up with a better solution

type ToolResponse = string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>
type UserContent = Array<Anthropic.Messages.ContentBlockParam>

export type ClineOptions = {
	provider: ClineProvider
	apiConfiguration: ApiConfiguration
	customInstructions?: string
	enableDiff?: boolean
	enableCheckpoints?: boolean
	checkpointStorage?: CheckpointStorage
	fuzzyMatchThreshold?: number
	task?: string
	images?: string[]
	historyItem?: HistoryItem
	experiments?: Record<string, boolean>
	startTask?: boolean
}

export class Cline {
	readonly taskId: string
	private taskNumber: number
	// a flag that indicated if this Cline instance is a subtask (on finish return control to parent task)
	private isSubTask: boolean = false
	// a flag that indicated if this Cline instance is paused (waiting for provider to resume it after subtask completion)
	private isPaused: boolean = false
	// this is the parent task work mode when it launched the subtask to be used when it is restored (so the last used mode by parent task will also be restored)
	private pausedModeSlug: string = defaultModeSlug
	// if this is a subtask then this member holds a pointer to the parent task that launched it
	private parentTask: Cline | undefined = undefined
	// if this is a subtask then this member holds a pointer to the top parent task that launched it
	private rootTask: Cline | undefined = undefined
	readonly apiConfiguration: ApiConfiguration
	api: ApiHandler
	private urlContentFetcher: UrlContentFetcher
	private browserSession: BrowserSession
	private didEditFile: boolean = false
	customInstructions?: string
	diffStrategy?: DiffStrategy
	diffEnabled: boolean = false
	fuzzyMatchThreshold: number = 1.0

	apiConversationHistory: (Anthropic.MessageParam & { ts?: number })[] = []
	clineMessages: ClineMessage[] = []
	rooIgnoreController?: RooIgnoreController
	private askResponse?: ClineAskResponse
	private askResponseText?: string
	private askResponseImages?: string[]
	private lastMessageTs?: number
	private consecutiveMistakeCount: number = 0
	private consecutiveMistakeCountForApplyDiff: Map<string, number> = new Map()
	private providerRef: WeakRef<ClineProvider>
	private abort: boolean = false
	didFinishAbortingStream = false
	abandoned = false
	private diffViewProvider: DiffViewProvider
	private toolExecutor!: ToolExecutor
	private lastApiRequestTime?: number
	isInitialized = false
	private outputChannel: vscode.OutputChannel; // Added for logging

	// checkpoints
	private enableCheckpoints: boolean
	private checkpointStorage: CheckpointStorage
	private checkpointService?: RepoPerTaskCheckpointService | RepoPerWorkspaceCheckpointService

	// streaming
	isWaitingForFirstChunk = false
	isStreaming = false
	private currentStreamingContentIndex = 0
	private assistantMessageContent: AssistantMessageContent[] = []
	private presentAssistantMessageLocked = false
	private presentAssistantMessageHasPendingUpdates = false
	private userMessageContent: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = []
	private userMessageContentReady = false
	private didRejectTool = false
	private didAlreadyUseTool = false
	private didCompleteReadingStream = false

	constructor({
		provider,
		apiConfiguration,
		customInstructions,
		enableDiff,
		enableCheckpoints = true,
		checkpointStorage = "task",
		fuzzyMatchThreshold,
		task,
		images,
		historyItem,
		experiments,
		startTask = true,
	}: ClineOptions) {
		if (startTask && !task && !images && !historyItem) {
			throw new Error("Either historyItem or task/images must be provided")
		}

		this.providerRef = new WeakRef(provider); // Store provider ref first
		// Access outputChannel safely
		const resolvedProviderForOutput = this.providerRef.deref();
		if (!resolvedProviderForOutput) {
			throw new Error("ClineProvider reference lost during constructor.");
		}
		// Assuming outputChannel is public or has a getter on ClineProvider
		this.outputChannel = (resolvedProviderForOutput as any).outputChannel; // Use 'any' assertion if private

		this.rooIgnoreController = new RooIgnoreController(cwd)
		this.rooIgnoreController.initialize().catch((error) => {
			console.error("Failed to initialize RooIgnoreController:", error);
		})

		this.taskId = historyItem ? historyItem.id : crypto.randomUUID()
		this.taskNumber = -1
		this.apiConfiguration = apiConfiguration
		this.api = buildApiHandler(apiConfiguration)
		this.urlContentFetcher = new UrlContentFetcher(provider.context)
		this.browserSession = new BrowserSession(provider.context)
		this.customInstructions = customInstructions
		this.diffEnabled = enableDiff ?? false
		this.fuzzyMatchThreshold = fuzzyMatchThreshold ?? 1.0
		this.diffViewProvider = new DiffViewProvider(cwd)
		this.enableCheckpoints = enableCheckpoints
		this.checkpointStorage = checkpointStorage

		if (historyItem) {
			telemetryService.captureTaskRestarted(this.taskId)
		} else {
			telemetryService.captureTaskCreated(this.taskId)
		}
		// Initialize diffStrategy based on current state

		this.updateDiffStrategy(
			Experiments.isEnabled(experiments ?? {}, EXPERIMENT_IDS.DIFF_STRATEGY),
			Experiments.isEnabled(experiments ?? {}, EXPERIMENT_IDS.MULTI_SEARCH_AND_REPLACE),
		)

		// Initialize ToolExecutor after diffStrategy is set up
		const resolvedProvider = this.providerRef.deref()
		if (!resolvedProvider) {
			throw new Error("ClineProvider reference is lost during Cline initialization.")
		}
		this.toolExecutor = new ToolExecutor({
			diffViewProvider: this.diffViewProvider,
			rooIgnoreController: this.rooIgnoreController,
			diffStrategy: this.diffStrategy,
			browserSession: this.browserSession,
			mcpHub: (resolvedProvider as any).mcpHub!,
			terminalRegistry: TerminalRegistry, // Pass the static class
			providerRef: this.providerRef,
			cwd,
			say: (type: string, message: string, images?: string[]) => this.say(type as ClineSay, message, images),
			ask: (type: string, message: string, partial?: boolean, status?: ToolProgressStatus | string) =>
				this.ask(type as ClineAsk, message, partial, status as ToolProgressStatus),
		});

		if (startTask) {
			if (task || images) {
				this.startTask(task, images)
			} else if (historyItem) {
				this.resumeTaskFromHistory()
			} else {
				throw new Error("Either historyItem or task/images must be provided")
			}
		}
	}

	static create(options: ClineOptions): [Cline, Promise<void>] {
		const instance = new Cline({ ...options, startTask: false })
		const { images, task, historyItem } = options
		let promise

		if (images || task) {
			promise = instance.startTask(task, images)
		} else if (historyItem) {
			promise = instance.resumeTaskFromHistory()
		} else {
			throw new Error("Either historyItem or task/images must be provided")
		}

		return [instance, promise]
	}

	// a helper function to set the private member isSubTask to true
	// and by that set this Cline instance to be a subtask (on finish return control to parent task)
	setSubTask() {
		this.isSubTask = true
	}

	// sets the task number (sequencial number of this task from all the subtask ran from this main task stack)
	setTaskNumber(taskNumber: number) {
		this.taskNumber = taskNumber
	}

	// gets the task number, the sequencial number of this task from all the subtask ran from this main task stack
	getTaskNumber() {
		return this.taskNumber
	}

	// this method returns the cline instance that is the parent task that launched this subtask (assuming this cline is a subtask)
	// if undefined is returned, then there is no parent task and this is not a subtask or connection has been severed
	getParentTask(): Cline | undefined {
		return this.parentTask
	}

	// this method sets a cline instance that is the parent task that called this task (assuming this cline is a subtask)
	// if undefined is set, then the connection is broken and the parent is no longer saved in the subtask member
	setParentTask(parentToSet: Cline | undefined) {
		this.parentTask = parentToSet
	}

	// this method returns the cline instance that is the root task (top most parent) that eventually launched this subtask (assuming this cline is a subtask)
	// if undefined is returned, then there is no root task and this is not a subtask or connection has been severed
	getRootTask(): Cline | undefined {
		return this.rootTask
	}

	// this method sets a cline instance that is the root task (top most patrnt) that called this task (assuming this cline is a subtask)
	// if undefined is set, then the connection is broken and the root is no longer saved in the subtask member
	setRootTask(rootToSet: Cline | undefined) {
		this.rootTask = rootToSet
	}

	// Add method to update diffStrategy
	async updateDiffStrategy(experimentalDiffStrategy?: boolean, multiSearchReplaceDiffStrategy?: boolean) {
		// If not provided, get from current state
		if (experimentalDiffStrategy === undefined || multiSearchReplaceDiffStrategy === undefined) {
			const { experiments: stateExperimental } = (await this.providerRef.deref()?.getState()) ?? {}
			if (experimentalDiffStrategy === undefined) {
				experimentalDiffStrategy = stateExperimental?.[EXPERIMENT_IDS.DIFF_STRATEGY] ?? false
			}
			if (multiSearchReplaceDiffStrategy === undefined) {
				multiSearchReplaceDiffStrategy = stateExperimental?.[EXPERIMENT_IDS.MULTI_SEARCH_AND_REPLACE] ?? false
			}
		}
		this.diffStrategy = getDiffStrategy(
			this.api.getModel().id,
			this.fuzzyMatchThreshold,
			experimentalDiffStrategy,
			multiSearchReplaceDiffStrategy,
		)
	}

	// Storing task to disk for history

	private async ensureTaskDirectoryExists(): Promise<string> {
		const globalStoragePath = this.providerRef.deref()?.context.globalStorageUri.fsPath
		if (!globalStoragePath) {
			throw new Error("Global storage uri is invalid")
		}
		const taskDir = path.join(globalStoragePath, "tasks", this.taskId)
		await fs.mkdir(taskDir, { recursive: true })
		return taskDir
	}

	private async getSavedApiConversationHistory(): Promise<Anthropic.MessageParam[]> {
		const filePath = path.join(await this.ensureTaskDirectoryExists(), GlobalFileNames.apiConversationHistory)
		const fileExists = await fileExistsAtPath(filePath)
		if (fileExists) {
			return JSON.parse(await fs.readFile(filePath, "utf8"))
		}
		return []
	}

	private async addToApiConversationHistory(message: Anthropic.MessageParam) {
		const messageWithTs = { ...message, ts: Date.now() }
		this.apiConversationHistory.push(messageWithTs)
		await this.saveApiConversationHistory()
	}

	async overwriteApiConversationHistory(newHistory: Anthropic.MessageParam[]) {
		this.apiConversationHistory = newHistory
		await this.saveApiConversationHistory()
	}

	private async saveApiConversationHistory() {
		try {
			const filePath = path.join(await this.ensureTaskDirectoryExists(), GlobalFileNames.apiConversationHistory)
			await fs.writeFile(filePath, JSON.stringify(this.apiConversationHistory))
		} catch (error) {
			// in the off chance this fails, we don't want to stop the task
			console.error("Failed to save API conversation history:", error)
		}
	}

	private async getSavedClineMessages(): Promise<ClineMessage[]> {
		const filePath = path.join(await this.ensureTaskDirectoryExists(), GlobalFileNames.uiMessages)
		if (await fileExistsAtPath(filePath)) {
			return JSON.parse(await fs.readFile(filePath, "utf8"))
		} else {
			// check old location
			const oldPath = path.join(await this.ensureTaskDirectoryExists(), "claude_messages.json")
			if (await fileExistsAtPath(oldPath)) {
				const data = JSON.parse(await fs.readFile(oldPath, "utf8"))
				await fs.unlink(oldPath) // remove old file
				return data
			}
		}
		return []
	}

	private async addToClineMessages(message: ClineMessage) {
		this.clineMessages.push(message)
		await this.saveClineMessages()
	}

	public async overwriteClineMessages(newMessages: ClineMessage[]) {
		this.clineMessages = newMessages
		await this.saveClineMessages()
	}

	private async saveClineMessages() {
		try {
			const taskDir = await this.ensureTaskDirectoryExists()
			const filePath = path.join(taskDir, GlobalFileNames.uiMessages)
			await fs.writeFile(filePath, JSON.stringify(this.clineMessages))
			// combined as they are in ChatView
			const apiMetrics = getApiMetrics(combineApiRequests(combineCommandSequences(this.clineMessages.slice(1))))
			const taskMessage = this.clineMessages[0] // first message is always the task say
			const lastRelevantMessage =
				this.clineMessages[
					findLastIndex(
						this.clineMessages,
						(m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"),
					)
				]

			let taskDirSize = 0

			try {
				taskDirSize = await getFolderSize.loose(taskDir)
			} catch (err) {
				console.error(
					`[saveClineMessages] failed to get task directory size (${taskDir}): ${err instanceof Error ? err.message : String(err)}`,
				)
			}

			await this.providerRef.deref()?.updateTaskHistory({
				id: this.taskId,
				number: this.taskNumber,
				ts: lastRelevantMessage.ts,
				task: taskMessage.text ?? "",
				tokensIn: apiMetrics.totalTokensIn,
				tokensOut: apiMetrics.totalTokensOut,
				cacheWrites: apiMetrics.totalCacheWrites,
				cacheReads: apiMetrics.totalCacheReads,
				totalCost: apiMetrics.totalCost,
				size: taskDirSize,
			})
		} catch (error) {
			console.error("Failed to save cline messages:", error)
		}
	}

	// Communicate with webview

	// partial has three valid states true (partial message), false (completion of partial message), undefined (individual complete message)
	async ask(
		type: ClineAsk,
		text?: string,
		partial?: boolean,
		progressStatus?: ToolProgressStatus,
	): Promise<{ response: ClineAskResponse; text?: string; images?: string[] }> {
		// If this Cline instance was aborted by the provider, then the only thing keeping us alive is a promise still running in the background, in which case we don't want to send its result to the webview as it is attached to a new instance of Cline now. So we can safely ignore the result of any active promises, and this class will be deallocated. (Although we set Cline = undefined in provider, that simply removes the reference to this instance, but the instance is still alive until this promise resolves or rejects.)
		if (this.abort) {
			throw new Error(`Task: ${this.taskNumber} Roo Code instance aborted (#1)`)
		}
		let askTs: number
		if (partial !== undefined) {
			const lastMessage = this.clineMessages.at(-1)
			const isUpdatingPreviousPartial =
				lastMessage && lastMessage.partial && lastMessage.type === "ask" && lastMessage.ask === type
			if (partial) {
				if (isUpdatingPreviousPartial) {
					// existing partial message, so update it
					lastMessage.text = text
					lastMessage.partial = partial
					lastMessage.progressStatus = progressStatus
					// todo be more efficient about saving and posting only new data or one whole message at a time so ignore partial for saves, and only post parts of partial message instead of whole array in new listener
					// await this.saveClineMessages()
					// await this.providerRef.deref()?.postStateToWebview()
					await this.providerRef
						.deref()
						?.postMessageToWebview({ type: "partialMessage", partialMessage: lastMessage })
					throw new Error("Current ask promise was ignored (#1)")
				} else {
					// this is a new partial message, so add it with partial state
					// this.askResponse = undefined
					// this.askResponseText = undefined
					// this.askResponseImages = undefined
					askTs = Date.now()
					this.lastMessageTs = askTs
					await this.addToClineMessages({ ts: askTs, type: "ask", ask: type, text, partial })
					await this.providerRef.deref()?.postStateToWebview()
					throw new Error("Current ask promise was ignored (#2)")
				}
			} else {
				// partial=false means its a complete version of a previously partial message
				if (isUpdatingPreviousPartial) {
					// this is the complete version of a previously partial message, so replace the partial with the complete version
					this.askResponse = undefined
					this.askResponseText = undefined
					this.askResponseImages = undefined

					/*
					Bug for the history books:
					In the webview we use the ts as the chatrow key for the virtuoso list. Since we would update this ts right at the end of streaming, it would cause the view to flicker. The key prop has to be stable otherwise react has trouble reconciling items between renders, causing unmounting and remounting of components (flickering).
					The lesson here is if you see flickering when rendering lists, it's likely because the key prop is not stable.
					So in this case we must make sure that the message ts is never altered after first setting it.
					*/
					askTs = lastMessage.ts
					this.lastMessageTs = askTs
					// lastMessage.ts = askTs
					lastMessage.text = text
					lastMessage.partial = false
					lastMessage.progressStatus = progressStatus

					await this.saveClineMessages()
					// await this.providerRef.deref()?.postStateToWebview()
					await this.providerRef
						.deref()
						?.postMessageToWebview({ type: "partialMessage", partialMessage: lastMessage })
				} else {
					// this is a new partial=false message, so add it like normal
					this.askResponse = undefined
					this.askResponseText = undefined
					this.askResponseImages = undefined
					askTs = Date.now()
					this.lastMessageTs = askTs
					await this.addToClineMessages({ ts: askTs, type: "ask", ask: type, text })
					await this.providerRef.deref()?.postStateToWebview()
				}
			}
		} else {
			// this is a new individual complete message, so add it like normal
			this.askResponse = undefined
			this.askResponseText = undefined
			this.askResponseImages = undefined
			askTs = Date.now()
			this.lastMessageTs = askTs
			await this.addToClineMessages({ ts: askTs, type: "ask", ask: type, text })
			await this.providerRef.deref()?.postStateToWebview()
		}

		// Wait for response from webview
		await pWaitFor(() => this.askResponse !== undefined, { interval: 100 })
		if (this.abort) {
			throw new Error(`Task: ${this.taskNumber} Roo Code instance aborted (#2)`)
		}
		const askResponse = this.askResponse!
		const askResponseText = this.askResponseText
		const askResponseImages = this.askResponseImages
		this.askResponse = undefined
		this.askResponseText = undefined
		this.askResponseImages = undefined
		return { response: askResponse, text: askResponseText, images: askResponseImages }
	}

	async handleWebviewAskResponse(askResponse: ClineAskResponse, text?: string, images?: string[]) {
		this.askResponse = askResponse
		this.askResponseText = text
		this.askResponseImages = images
	}

	async say(
		type: ClineSay,
		text?: string,
		images?: string[],
		partial?: boolean,
		// toolProps?: ClineSayTool, // Removed toolProps as it's not on ClineMessage
	): Promise<void> {
		// If this Cline instance was aborted by the provider, then the only thing keeping us alive is a promise still running in the background, in which case we don't want to send its result to the webview as it is attached to a new instance of Cline now. So we can safely ignore the result of any active promises, and this class will be deallocated. (Although we set Cline = undefined in provider, that simply removes the reference to this instance, but the instance is still alive until this promise resolves or rejects.)
		if (this.abort) {
			throw new Error(`Task: ${this.taskNumber} Roo Code instance aborted (#3)`)
		}
		let sayTs: number
		if (partial !== undefined) {
			const lastMessage = this.clineMessages.at(-1)
			const isUpdatingPreviousPartial =
				lastMessage && lastMessage.partial && lastMessage.type === "say" && lastMessage.say === type
			if (partial) {
				if (isUpdatingPreviousPartial) {
					// existing partial message, so update it
					lastMessage.text = text
					lastMessage.images = images
					lastMessage.partial = partial
					// lastMessage.toolProps = toolProps // ClineMessage doesn't have toolProps
					// todo be more efficient about saving and posting only new data or one whole message at a time so ignore partial for saves, and only post parts of partial message instead of whole array in new listener
					// await this.saveClineMessages()
					// await this.providerRef.deref()?.postStateToWebview()
					await this.providerRef
						.deref()
						?.postMessageToWebview({ type: "partialMessage", partialMessage: lastMessage })
					throw new Error("Current say promise was ignored (#1)")
				} else {
					// this is a new partial message, so add it with partial state
					sayTs = Date.now()
					this.lastMessageTs = sayTs
					await this.addToClineMessages({ ts: sayTs, type: "say", say: type, text, images, partial }) // Removed toolProps
					await this.providerRef.deref()?.postStateToWebview()
					throw new Error("Current ask promise was ignored (#2)")
				}
			} else {
				// partial=false means its a complete version of a previously partial message
				if (isUpdatingPreviousPartial) {
					// this is the complete version of a previously partial message, so replace the partial with the complete version
					/*
					Bug for the history books:
					In the webview we use the ts as the chatrow key for the virtuoso list. Since we would update this ts right at the end of streaming, it would cause the view to flicker. The key prop has to be stable otherwise react has trouble reconciling items between renders, causing unmounting and remounting of components (flickering).
					The lesson here is if you see flickering when rendering lists, it's likely because the key prop is not stable.
					So in this case we must make sure that the message ts is never altered after first setting it.
					*/
					sayTs = lastMessage.ts
					this.lastMessageTs = sayTs
					// lastMessage.ts = askTs
					lastMessage.text = text
					lastMessage.images = images
					lastMessage.partial = false
					// lastMessage.toolProps = toolProps // ClineMessage doesn't have toolProps
					await this.saveClineMessages()
					// await this.providerRef.deref()?.postStateToWebview()
					await this.providerRef
						.deref()
						?.postMessageToWebview({ type: "partialMessage", partialMessage: lastMessage })
				} else {
					// this is a new partial=false message, so add it like normal
					sayTs = Date.now()
					this.lastMessageTs = sayTs
					await this.addToClineMessages({ ts: sayTs, type: "say", say: type, text, images }) // Removed toolProps
					await this.providerRef.deref()?.postStateToWebview()
				}
			}
		} else {
			// this is a new individual complete message, so add it like normal
			sayTs = Date.now()
			this.lastMessageTs = sayTs
			await this.addToClineMessages({ ts: sayTs, type: "say", say: type, text, images }) // Removed toolProps
			await this.providerRef.deref()?.postStateToWebview()
		}
	}


	async sayAndCreateMissingParamError(toolName: ToolUseName, paramName: string, relPath?: string) {
		const message = formatResponse.missingToolParameterError(paramName)
		await this.say("error", message)
		if (relPath) {
			const mistakeKey = `${relPath}-${paramName}`
			const currentMistakeCount = (this.consecutiveMistakeCountForApplyDiff.get(mistakeKey) ?? 0) + 1
			this.consecutiveMistakeCountForApplyDiff.set(mistakeKey, currentMistakeCount)
		}
		return message
	}

	// Start task

	private async startTask(task?: string, images?: string[]): Promise<void> {
		await this.providerRef.deref()?.addClineToStack(this) // Use providerRef
		await this.say("task", task, images)
		await this.initiateTaskLoop([{ type: "text", text: task ?? "" }, ...formatResponse.imageBlocks(images)])
	}

	async resumePausedTask(lastMessage?: string) {
		this.isPaused = false
		this.providerRef.deref()?.log(`[subtasks] Task: ${this.taskNumber} resumed`) // Use providerRef
		// resume the task mode
		const currentMode = (await this.providerRef.deref()?.getState())?.mode ?? defaultModeSlug
		if (currentMode !== this.pausedModeSlug) {
			// the mode has changed, we need to switch back to the paused mode
			await this.providerRef.deref()?.handleModeSwitch(this.pausedModeSlug)
			// wait for mode to actually switch in UI and in State
			await delay(500) // delay to allow mode change to take effect before next tool is executed
			this.providerRef
				.deref()
				?.log(
					`[subtasks] Task: ${this.taskNumber} has switched back to mode: '${this.pausedModeSlug}' from mode: '${currentMode}'`,
				)
		}
		// if there is a last message from the subtask, add it to the conversation history
		if (lastMessage) {
			await this.say("user_feedback", lastMessage)
			await this.initiateTaskLoop([{ type: "text", text: lastMessage }])
		} else {
			// if there is no last message, just continue the task loop without adding anything
			await this.initiateTaskLoop([])
		}
	}

	private async resumeTaskFromHistory() {
		await this.providerRef.deref()?.addClineToStack(this) // Use providerRef
		this.clineMessages = await this.getSavedClineMessages()
		this.apiConversationHistory = await this.getSavedApiConversationHistory()

		// Check if the last message is a completion result
		const lastMessage = this.clineMessages.at(-1)
		const isCompleted = lastMessage?.say === "completion_result" && !lastMessage.partial

		// Post initial state
		await this.providerRef.deref()?.postStateToWebview() // Use providerRef

		// If completed, ask to resume or start new
		if (isCompleted) {
			const { response, text, images } = await this.ask("resume_completed_task")
			if (response === "yesButtonClicked") {
				// User wants to continue the completed task
				await this.say("user_feedback", text ?? "", images)
				await this.initiateTaskLoop([{ type: "text", text: text ?? "" }, ...formatResponse.imageBlocks(images)])
			} else {
				// User wants a new task (or closed the panel) - do nothing, let UI handle new task input
			}
		} else {
			// If not completed, ask to resume
			const { response, text, images } = await this.ask("resume_task")
			if (response === "yesButtonClicked") {
				// User wants to resume
				await this.say("user_feedback", text ?? "", images)
				await this.initiateTaskLoop([{ type: "text", text: text ?? "" }, ...formatResponse.imageBlocks(images)])
			} else {
				// User wants a new task (or closed the panel) - do nothing, let UI handle new task input
			}
		}
	}

	// Task loop

	private async initiateTaskLoop(userContent: UserContent): Promise<void> {
		// Reset state for new loop iteration
		this.userMessageContent = []
		this.userMessageContentReady = false
		this.didRejectTool = false
		this.didAlreadyUseTool = false
		this.didCompleteReadingStream = false
		this.assistantMessageContent = []
		this.currentStreamingContentIndex = 0
		this.presentAssistantMessageLocked = false
		this.presentAssistantMessageHasPendingUpdates = false

		// Start the recursive request loop
		await this.recursivelyMakeClineRequests(userContent)
	}

	async abortTask(isAbandoned = false) {
		this.abort = true
		this.abandoned = isAbandoned
		this.isPaused = false // Ensure task is not paused if aborted
		// Wait for any ongoing stream to finish aborting
		if (this.isStreaming) {
			await pWaitFor(() => this.didFinishAbortingStream, { interval: 100 })
		}
	}

	// This method is kept in Cline.ts as it directly uses TerminalRegistry and interacts with UI state (ask/say)
	// It could potentially be moved if TerminalRegistry interaction is abstracted, but it's complex.
	async executeCommandTool(command: string, customCwd?: string): Promise<[boolean, ToolResponse]> {
		let workingDir: string
		if (!customCwd) {
			workingDir = cwd
		} else if (path.isAbsolute(customCwd)) {
			workingDir = customCwd
		} else {
			workingDir = path.resolve(cwd, customCwd)
		}

		// Check if directory exists
		try {
			await fs.access(workingDir)
		} catch (error) {
			return [false, `Working directory '${workingDir}' does not exist.`]
		}

		const terminalInfo = await TerminalRegistry.getOrCreateTerminal(workingDir, !!customCwd, this.taskId)

		// Update the working directory in case the terminal we asked for has
		// a different working directory so that the model will know where the
		// command actually executed:
		workingDir = terminalInfo.getCurrentWorkingDirectory()

		const workingDirInfo = workingDir ? ` from '${workingDir.toPosix()}'` : ""
		terminalInfo.terminal.show() // weird visual bug when creating new terminals (even manually) where there's an empty space at the top.
		const process = terminalInfo.runCommand(command)

		let userFeedback: { text?: string; images?: string[] } | undefined
		let didContinue = false
		const sendCommandOutput = async (line: string): Promise<void> => {
			try {
				const { response, text, images } = await this.ask("command_output", line)
				if (response === "yesButtonClicked") {
					// proceed while running
				} else {
					userFeedback = { text, images }
				}
				didContinue = true
				process.continue() // continue past the await
			} catch {
				// This can only happen if this ask promise was ignored, so ignore this error
			}
		}

		const { terminalOutputLineLimit } = (await this.providerRef.deref()?.getState()) ?? {}

		process.on("line", (line) => {
			if (!didContinue) {
				sendCommandOutput(Terminal.compressTerminalOutput(line, terminalOutputLineLimit))
			} else {
				this.say("command_output", Terminal.compressTerminalOutput(line, terminalOutputLineLimit))
			}
		})

		let completed = false
		let result: string = ""
		let exitDetails: ExitCodeDetails | undefined
		process.once("completed", (output?: string) => {
			// Use provided output if available, otherwise keep existing result.
			result = output ?? ""
			completed = true
		})

		process.once("shell_execution_complete", (details: ExitCodeDetails) => {
			exitDetails = details
		})

		process.once("no_shell_integration", async (message: string) => {
			await this.say("shell_integration_warning", message)
		})

		await process

		// Wait for a short delay to ensure all messages are sent to the webview
		// This delay allows time for non-awaited promises to be created and
		// for their associated messages to be sent to the webview, maintaining
		// the correct order of messages (although the webview is smart about
		// grouping command_output messages despite any gaps anyways)
		await delay(50)

		result = Terminal.compressTerminalOutput(result, terminalOutputLineLimit)

		if (userFeedback) {
			await this.say("user_feedback", userFeedback.text, userFeedback.images)
			return [
				true,
				formatResponse.toolResult(
					`Command is still running in terminal ${terminalInfo.id}${workingDirInfo}.${
						result.length > 0 ? `\nHere's the output so far:\n${result}` : ""
					}\n\nThe user provided the following feedback:\n<feedback>\n${userFeedback.text}\n</feedback>`,
					userFeedback.images,
				),
			]
		} else if (completed) {
			let exitStatus: string
			if (exitDetails !== undefined) {
				if (exitDetails.signal) {
					exitStatus = `Process terminated by signal ${exitDetails.signal} (${exitDetails.signalName})`
					if (exitDetails.coreDumpPossible) {
						exitStatus += " - core dump possible"
					}
				} else if (exitDetails.exitCode === undefined) {
					result += "<VSCE exit code is undefined: terminal output and command execution status is unknown.>"
					exitStatus = `Exit code: <undefined, notify user>`
				} else {
					exitStatus = `Exit code: ${exitDetails.exitCode}`
				}
			} else {
				result += "<VSCE exitDetails == undefined: terminal output and command execution status is unknown.>"
				exitStatus = `Exit code: <undefined, notify user>`
			}
			const workingDirInfo = workingDir ? ` from '${workingDir.toPosix()}'` : ""

			const outputInfo = `\nOutput:\n${result}`
			return [
				false,
				`Command executed in terminal ${terminalInfo.id}${workingDirInfo}. ${exitStatus}${outputInfo}`,
			]
		} else {
			return [
				false,
				`Command is still running in terminal ${terminalInfo.id}${workingDirInfo}.${
					result.length > 0 ? `\nHere's the output so far:\n${result}` : ""
				}\n\nYou will be updated on the terminal status and new output in the future.`,
			]
		}
	}

	// API request and response handling

	async *attemptApiRequest(previousApiReqIndex: number, retryAttempt: number = 0): AsyncGenerator<Anthropic.Messages.MessageStreamEvent> { // Keep Anthropic type
		if (this.abort) {
			throw new Error(`Task: ${this.taskNumber} Roo Code instance aborted (#5)`)
		}
		const { apiConfiguration, mode, customModePrompts, customInstructions: globalInstructions, preferredLanguage } = await this.providerRef.deref()!.getState() // Use providerRef, get preferredLanguage
		const { experiments } = await this.providerRef.deref()!.getState()
		const modeDetails = await getFullModeDetails(mode, customModePrompts) // Await this

		// Combine global and mode-specific instructions
		const combinedInstructions = [globalInstructions, modeDetails.customInstructions, this.customInstructions] // Remove await
			.filter(Boolean)
			.join("\n\n")

		const systemPrompt = await (async () => {
			const { experiments } = await this.providerRef.deref()!.getState()
			// const systemPromptExperiment = Experiments.isEnabled(experiments ?? {}, EXPERIMENT_IDS.SYSTEM_PROMPT) // Removed check
			// Assuming system prompt is always enabled for now
			// if (systemPromptExperiment) {
				// Provide all required args based on definition
				return SYSTEM_PROMPT(
					this.providerRef.deref()!.context, // Pass context
					cwd,
					true, // Assuming supportsComputerUse is true
					this.providerRef.deref()?.getMcpHub(), // Access via providerRef
					this.diffStrategy,
					undefined, // browserViewportSize - assuming undefined
					mode,
					customModePrompts,
					undefined, // customModes - assuming undefined
					combinedInstructions, // Use combined
					preferredLanguage, // Pass preferredLanguage
					this.diffEnabled,
					experiments,
					undefined, // enableMcpServerCreation - assuming undefined
					this.rooIgnoreController?.getInstructions()
				)
			// } else {
			// 	return undefined
			// }
		})()

		// Truncate conversation history if needed
		const truncatedHistory = await truncateConversationIfNeeded({ // Use options object and await
			messages: this.apiConversationHistory,
			totalTokens: getApiMetrics(this.clineMessages.slice(0, previousApiReqIndex + 1)).totalTokensIn, // Use totalTokensIn
			contextWindow: this.api.getModel().info.contextWindow, // Use contextWindow from model info
			maxTokens: undefined, // Assuming no specific maxTokens override here
			apiHandler: this.api // Pass apiHandler
		});
		this.apiConversationHistory = truncatedHistory; // Assign awaited result

		// Map conversation history to the format expected by the API handler
		const cleanConversationHistory = this.apiConversationHistory.map(({ role, content }) => {
			if (typeof content === "string") {
				// Handle old format where content was just a string
				content = [{ type: "text", text: content }]
			} else {
				// Filter out any non-text/image blocks if necessary, or handle tool_calls/tool_results appropriately
				content = content.map((block) => {
					if (block.type === "tool_use") {
						// Keep tool_use blocks as they are
						return block
					} else if (block.type === "tool_result") {
						// Keep tool_result blocks as they are
						return block
					} else if (block.type === "text") {
						return block
					} else if (block.type === "image") {
						// Check if the current model accepts images
						if (this.api.getModel().info.supportsImages) { // Use supportsImages property
							return block // Keep image block if model supports it
						} else {
							// Replace with placeholder text if model doesn't support images
							return { type: "text", text: "[Referenced image in conversation]" } as Anthropic.TextBlockParam
						}
					}
					// Filter out other types or return a default text block
					return { type: "text", text: "[Unsupported content block filtered]" } as Anthropic.TextBlockParam
				})
			}
			return { role, content }
		})

		this.lastApiRequestTime = Date.now()
		// Use createMessage, adjust args if needed
		// Explicitly loop/map the stream to handle potential type mismatches
		const stream = this.api.createMessage(systemPrompt ?? "", cleanConversationHistory);
		for await (const event of stream) {
			// Cast the event from the SDK stream to our internal type.
			// If errors persist, a more detailed mapping might be needed.
			yield event as unknown as Anthropic.Messages.RawMessageStreamEvent;
		}
	}

	// This method processes the streamed assistant message, handles tool calls, and updates the UI.
	async presentAssistantMessage() {
		// Prevent concurrent execution
		if (this.presentAssistantMessageLocked) {
			this.presentAssistantMessageHasPendingUpdates = true
			return
		}
		this.presentAssistantMessageLocked = true
		this.presentAssistantMessageHasPendingUpdates = false

		// Check if the task was aborted
		if (this.abort) {
			this.presentAssistantMessageLocked = false
			return
		}

		// Ensure the current index is valid
		if (this.currentStreamingContentIndex >= this.assistantMessageContent.length) {
			// If we are out of bounds and the stream has completed, signal readiness for user input
			if (this.didCompleteReadingStream) {
				this.userMessageContentReady = true
			}
			this.presentAssistantMessageLocked = false
			return
		}

		const block = this.assistantMessageContent[this.currentStreamingContentIndex]

		// Helper functions passed to ToolExecutor or used directly
		const pushToolResult = (content: ToolResponse) => {
			if (typeof content === "string") {
				this.userMessageContent.push({ type: "text", text: content })
			} else if (Array.isArray(content)) {
				this.userMessageContent.push(...content)
			}
		}

		const askApproval = async (
			type: ClineAsk,
			message: string,
			status?: ToolProgressStatus,
		): Promise<boolean> => {
			const { response, text, images } = await this.ask(type, message, false, status)
			const approved = response === "yesButtonClicked"
			if (!approved) {
				this.didRejectTool = true
				if (text) {
					await this.say("user_feedback", text, images)
					pushToolResult(formatResponse.toolResult(formatResponse.toolDeniedWithFeedback(text), images))
				} else {
					pushToolResult(formatResponse.toolDenied())
				}
			} else if (text) {
				// Handle approval with feedback
				await this.say("user_feedback", text, images)
				pushToolResult(formatResponse.toolResult(formatResponse.toolApprovedWithFeedback(text), images))
			}
			return approved
		}

		const askFinishSubTaskApproval = async (): Promise<boolean> => {
			const { response } = await this.ask("tool", "Mark sub-task as complete and return to parent task?", false) // Use "tool"
			return response === "yesButtonClicked"
		}

		const handleError = async (action: string, error: Error) => {
			console.error(`Error ${action}:`, error)
			const serialized = serializeError(error)
			const errorMessage = `Error ${action}: ${serialized.message}`
			await this.say("error", errorMessage)
			pushToolResult(formatResponse.toolError(errorMessage))
		}

		// Helper to remove closing XML tag if present (handles streaming)
		const removeClosingTag = (tag: ToolParamName, text?: string) => {
			if (!text) return undefined
			const closingTag = `</${tag}>`
			if (text.endsWith(closingTag)) {
				return text.slice(0, -closingTag.length)
			}
			return text
		}

		// Determine if checkpointing is possible for this block
		const isCheckpointPossible =
			this.enableCheckpoints &&
			block.type === "tool_use" &&
			["write_to_file", "apply_diff", "insert_content", "search_and_replace"].includes(block.name) &&
			!block.partial // Only checkpoint on complete tool use

		// Process the block based on its type
		switch (block.type) {
			case "text": {
				// Handle text block - simply display it
				await this.say("text", block.content, undefined, block.partial) // Use "text", access .content
				break
			}
			case "tool_use": {
				// Handle tool use block
				this.didAlreadyUseTool = true // Mark that a tool was used

				// Validate tool use against mode restrictions
				const { mode, customModes } = await this.providerRef.deref()!.getState() // Use providerRef
				const allowed = isToolAllowedForMode(block.name as ToolName, mode, customModes ?? [], { apply_diff: this.diffEnabled }) // Keep added args
				if (!allowed) {
					const errorMsg = `Tool '${block.name}' is not allowed in mode '${mode}'.`
					await this.say("error", errorMsg)
					pushToolResult(formatResponse.toolError(errorMsg))
					this.didRejectTool = true // Treat as rejection
					break // Skip execution
				}

				// Validate tool parameters (basic check for now)
				const validationError = validateToolUse(block as any, mode, customModes ?? [], { apply_diff: this.diffEnabled }) // Keep added args, assert type
				if (typeof validationError === 'string') { // Check if error string was returned
					await this.say("error", validationError)
					pushToolResult(formatResponse.toolError(validationError))
					this.didRejectTool = true // Treat as rejection
					break // Skip execution
				}

				// Execute the tool using ToolExecutor
				const executorResult = await this.toolExecutor.executeToolBlock(
					block,
					this.taskId,
					this.isSubTask,
					pushToolResult,
					handleError,
					removeClosingTag,
					askApproval
				);

				// Update Cline state based on executor result
				this.didEditFile = executorResult.didEditFile;
				this.didRejectTool = executorResult.didRejectTool;
				this.consecutiveMistakeCount = executorResult.consecutiveMistakeCount;

				// Handle pausing for new_task
				if (block.name === "new_task" && executorResult.needsPause) {
					const currentMode = (await this.providerRef.deref()?.getState())?.mode ?? defaultModeSlug;
					this.pausedModeSlug = currentMode; // Save current mode before pausing
					this.isPaused = true;
					this.providerRef.deref()?.log(`[subtasks] Task: ${this.taskNumber} paused for new subtask.`);
				}

				// If the task was paused or aborted during tool execution, stop processing here
				if (this.isPaused || this.abort) {
					break;
				}

				break; // Break for case "tool_use"
			}
		} // End of outer switch (block.type)


		if (isCheckpointPossible) {
			this.checkpointSave()
		}

		/*
		Seeing out of bounds is fine, it means that the next too call is being built up and ready to add to assistantMessageContent to present.
		When you see the UI inactive during this, it means that a tool is breaking without presenting any UI. For example the write_to_file tool was breaking when relpath was undefined, and for invalid relpath it never presented UI.
		*/
		this.presentAssistantMessageLocked = false // this needs to be placed here, if not then calling this.presentAssistantMessage below would fail (sometimes) since it's locked
		// NOTE: when tool is rejected, iterator stream is interrupted and it waits for userMessageContentReady to be true. Future calls to present will skip execution since didRejectTool and iterate until contentIndex is set to message length and it sets userMessageContentReady to true itself (instead of preemptively doing it in iterator)
		if (!block.partial || this.didRejectTool || this.didAlreadyUseTool) {
			// block is finished streaming and executing
			if (this.currentStreamingContentIndex === this.assistantMessageContent.length - 1) {
				// its okay that we increment if !didCompleteReadingStream, it'll just return bc out of bounds and as streaming continues it will call presentAssitantMessage if a new block is ready. if streaming is finished then we set userMessageContentReady to true when out of bounds. This gracefully allows the stream to continue on and all potential content blocks be presented.
				// last block is complete and it is finished executing
				this.userMessageContentReady = true // will allow pwaitfor to continue
			}

			// call next block if it exists (if not then read stream will call it when its ready)
			this.currentStreamingContentIndex++ // need to increment regardless, so when read stream calls this function again it will be streaming the next block

			if (this.currentStreamingContentIndex < this.assistantMessageContent.length) {
				// there are already more content blocks to stream, so we'll call this function ourselves
				// await this.presentAssistantContent()

				this.presentAssistantMessage()
				return
			}
		}
		// block is partial, but the read stream may have finished
		if (this.presentAssistantMessageHasPendingUpdates) {
			this.presentAssistantMessage()
		}
	}

	// this function checks if this Cline instance is set to pause state and wait for being resumed,
	// this is used when a sub-task is launched and the parent task is waiting for it to finish
	async waitForResume() {
		// wait until isPaused is false
		await new Promise<void>((resolve) => {
			const interval = setInterval(() => {
				if (!this.isPaused) {
					clearInterval(interval)
					resolve()
				}
			}, 1000) // TBD: the 1 sec should be added to the settings, also should add a timeout to prevent infinit wait
		})
	}

	async recursivelyMakeClineRequests(
		userContent: UserContent,
		includeFileDetails: boolean = false,
	): Promise<boolean> {
		if (this.abort) {
			throw new Error(`Task: ${this.taskNumber} Roo Code instance aborted (#4)`)
		}

		if (this.consecutiveMistakeCount >= 3) {
			const { response, text, images } = await this.ask(
				"mistake_limit_reached",
				this.api.getModel().id.includes("claude")
					? `This may indicate a failure in his thought process or inability to use a tool properly, which can be mitigated with some user guidance (e.g. "Try breaking down the task into smaller steps").`
					: "Roo Code uses complex prompts and iterative task execution that may be challenging for less capable models. For best results, it's recommended to use Claude 3.7 Sonnet for its advanced agentic coding capabilities.",
			)
			if (response === "messageResponse") {
				userContent.push(
					...[
						{
							type: "text",
							text: formatResponse.tooManyMistakes(text),
						} as Anthropic.Messages.TextBlockParam,
						...formatResponse.imageBlocks(images),
					],
				)
			}
			this.consecutiveMistakeCount = 0
		}

		// get previous api req's index to check token usage and determine if we need to truncate conversation history
		const previousApiReqIndex = findLastIndex(this.clineMessages, (m) => m.say === "api_req_started")

		// in this Cline request loop, we need to check if this cline (Task) instance has been asked to wait
		// for a sub-task (it has launched) to finish before continuing
		if (this.isPaused) {
			this.providerRef.deref()?.log(`[subtasks] Task: ${this.taskNumber} has paused`)
			await this.waitForResume()
			this.providerRef.deref()?.log(`[subtasks] Task: ${this.taskNumber} has resumed`)
			// waiting for resume is done, resume the task mode
			const currentMode = (await this.providerRef.deref()?.getState())?.mode ?? defaultModeSlug
			if (currentMode !== this.pausedModeSlug) {
				// the mode has changed, we need to switch back to the paused mode
				await this.providerRef.deref()?.handleModeSwitch(this.pausedModeSlug)
				// wait for mode to actually switch in UI and in State
				await delay(500) // delay to allow mode change to take effect before next tool is executed
				this.providerRef
					.deref()
					?.log(
						`[subtasks] Task: ${this.taskNumber} has switched back to mode: '${this.pausedModeSlug}' from mode: '${currentMode}'`,
					)
			}
		}

		// getting verbose details is an expensive operation, it uses globby to top-down build file structure of project which for large projects can take a few seconds
		// for the best UX we show a placeholder api_req_started message with a loading spinner as this happens
		await this.say(
			"api_req_started",
			JSON.stringify({
				request:
					userContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n") + "\n\nLoading...",
			}),
		)

		const [parsedUserContent, environmentDetails] = await this.loadContext(userContent, includeFileDetails)
		userContent = parsedUserContent
		// add environment details as its own text block, separate from tool results
		userContent.push({ type: "text", text: environmentDetails })

		await this.addToApiConversationHistory({ role: "user", content: userContent })
		telemetryService.captureConversationMessage(this.taskId, "user")

		// since we sent off a placeholder api_req_started message to update the webview while waiting to actually start the API request (to load potential details for example), we need to update the text of that message
		const lastApiReqIndex = findLastIndex(this.clineMessages, (m) => m.say === "api_req_started")
		this.clineMessages[lastApiReqIndex].text = JSON.stringify({
			request: userContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n"),
		} satisfies ClineApiReqInfo)
		await this.saveClineMessages()
		await this.providerRef.deref()?.postStateToWebview()

		try {
			let cacheWriteTokens = 0
			let cacheReadTokens = 0
			let inputTokens = 0
			let outputTokens = 0
			let totalCost: number | undefined

			// update api_req_started. we can't use api_req_finished anymore since it's a unique case where it could come after a streaming message (ie in the middle of being updated or executed)
			// fortunately api_req_finished was always parsed out for the gui anyways, so it remains solely for legacy purposes to keep track of prices in tasks from history
			// (it's worth removing a few months from now)
			const updateApiReqMsg = (cancelReason?: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
				this.clineMessages[lastApiReqIndex].text = JSON.stringify({
					...JSON.parse(this.clineMessages[lastApiReqIndex].text || "{}"),
					tokensIn: inputTokens,
					tokensOut: outputTokens,
					cacheWrites: cacheWriteTokens,
					cacheReads: cacheReadTokens,
					cost:
						totalCost ??
						calculateApiCostAnthropic(
							this.api.getModel().info,
							inputTokens,
							outputTokens,
							cacheWriteTokens,
							cacheReadTokens,
						),
					cancelReason,
					streamingFailedMessage,
				} satisfies ClineApiReqInfo)
			}

			const abortStream = async (cancelReason: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
				if (this.diffViewProvider.isEditing) {
					await this.diffViewProvider.revertChanges() // closes diff view
				}

				// if last message is a partial we need to update and save it
				const lastMessage = this.clineMessages.at(-1)
				if (lastMessage && lastMessage.partial) {
					// lastMessage.ts = Date.now() DO NOT update ts since it is used as a key for virtuoso list
					lastMessage.partial = false
					// instead of streaming partialMessage events, we do a save and post like normal to persist to disk
					console.log("updating partial message", lastMessage)
					// await this.saveClineMessages()
				}

				// Map internal AssistantMessageContent to Anthropic's ContentBlock[] for history
				const historyContent: Anthropic.Messages.ContentBlock[] = this.assistantMessageContent.map((block) => { // Remove explicit return type annotation
					if (block.type === 'text') {
						// Map TextContent to TextBlockParam (add citations: undefined)
						return { type: 'text', text: block.content, citations: null };
					} else { // block.type === 'tool_use'
						// Map ToolUse to ToolUseBlockParam
						const inputContent = block.input ?? block.params;
						const toolId = block.id ?? `tool_${crypto.randomUUID()}`; // Ensure ID exists
						return { type: 'tool_use', id: toolId, name: block.name, input: inputContent };
					}
				});
				await this.addToApiConversationHistory({
					role: "assistant",
					content: historyContent // Use mapped content
				})

				// update api_req_started to have cancelled and cost, so that we can display the cost of the partial stream
				updateApiReqMsg(cancelReason, streamingFailedMessage)
				await this.saveClineMessages()

				// signals to provider that it can retrieve the saved messages from disk, as abortTask can not be awaited on in nature
				this.didFinishAbortingStream = true
			}

			let assistantMessage = ""
			this.assistantMessageContent = []
			this.currentStreamingContentIndex = 0
			this.isWaitingForFirstChunk = true
			this.isStreaming = true
			this.didCompleteReadingStream = false

			const stream = this.attemptApiRequest(previousApiReqIndex, this.consecutiveMistakeCount)
			// Handle Anthropic SDK stream events correctly
			for await (const chunk of stream as AsyncGenerator<Anthropic.Messages.MessageStreamEvent>) { // Explicitly type chunk
				if (this.abort) {
					await abortStream("user_cancelled") // Use correct reason
					return false // Stop processing this request loop
				}
				this.isWaitingForFirstChunk = false;

				switch (chunk.type) {
					case 'message_start':
						inputTokens = chunk.message.usage.input_tokens;
						// Initialize content if needed (handled by content_block_start)
						break;
					case 'content_block_start':
						if (chunk.content_block.type === 'text') {
							assistantMessage = chunk.content_block.text; // Start new text block
							this.assistantMessageContent.push({ type: "text", content: assistantMessage, partial: true }); // Use .content
							this.presentAssistantMessage();
						} else if (chunk.content_block.type === 'tool_use') {
							this.assistantMessageContent.push({
								type: "tool_use",
								id: chunk.content_block.id,
								name: chunk.content_block.name as ToolUseName, // Assert type
								input: chunk.content_block.input,
								params: {}, // Initialize params
								partial: true
							});
							assistantMessage = ""; // Reset text buffer for potential next text block
							this.presentAssistantMessage();
						}
						break;
					case 'content_block_delta':
						if (chunk.delta.type === 'text_delta') {
							assistantMessage += chunk.delta.text;
							const lastContentBlock = this.assistantMessageContent.at(-1);
							if (lastContentBlock?.type === "text") {
								lastContentBlock.content = assistantMessage; // Use .content
								lastContentBlock.partial = true; // Still streaming
							} else {
								// If a text delta arrives unexpectedly, create a new block
								this.assistantMessageContent.push({ type: "text", content: assistantMessage, partial: true }); // Use .content
							}
							this.presentAssistantMessage();
						}
						break;
					case 'content_block_stop':
						const lastBlock = this.assistantMessageContent.at(-1);
						if (lastBlock) {
							lastBlock.partial = false;
							// Parse tool input if it's a completed tool_use block
							if (lastBlock.type === 'tool_use' && typeof lastBlock.input === 'string') {
								try {
									lastBlock.params = JSON.parse(lastBlock.input);
								} catch (e) {
									console.warn("Tool input was not valid JSON:", lastBlock.input);
									// Keep raw input in lastBlock.input, params remains {}
								}
							}
						}
						this.presentAssistantMessage(); // Present the completed block
						break;
					case 'message_delta':
						outputTokens = chunk.usage.output_tokens;
						break;
					case 'message_stop':
						// Final usage is typically included in the message_delta events
						// No need to access usage here specifically for message_stop
						break;
					// Removed 'error' case as errors should be caught by the main try/catch
					default:
						// Log unexpected chunk types
						console.warn("Unhandled stream chunk type:", (chunk as any).type);
				}
			}
			this.isStreaming = false
			this.didCompleteReadingStream = true

			// Final update for the last content block to mark it as not partial (redundant?)
			const lastBlockFinal = this.assistantMessageContent.at(-1)
			if (lastBlockFinal) {
				lastBlockFinal.partial = false
			}

			// Ensure the last block is presented if it hasn't been fully processed
			this.presentAssistantMessage()

			// Wait for all tool executions and UI updates triggered by presentAssistantMessage to settle
			await pWaitFor(() => this.userMessageContentReady || this.abort, { interval: 100 })

			if (this.abort) {
				// If aborted during tool execution/wait, ensure cleanup and exit
				await abortStream("user_cancelled") // Use correct reason
				return false
			}

			// Add final assistant message to history
			// Map internal AssistantMessageContent to Anthropic's ContentBlock[] for history
			const historyContent: Anthropic.Messages.ContentBlock[] = this.assistantMessageContent.map((block) => { // Remove explicit return type annotation
				if (block.type === 'text') {
					// Map TextContent to TextBlockParam (add citations: undefined)
					return { type: 'text', text: block.content, citations: null };
				} else { // block.type === 'tool_use'
					// Map ToolUse to ToolUseBlockParam
					const inputContent = block.input ?? block.params;
					const toolId = block.id ?? `tool_${crypto.randomUUID()}`; // Ensure ID exists
					return { type: 'tool_use', id: toolId, name: block.name, input: inputContent };
				}
			});
			await this.addToApiConversationHistory({ role: "assistant", content: historyContent }) // Use mapped content
			telemetryService.captureConversationMessage(this.taskId, "assistant")

			// Update final cost and status in the API request message
			updateApiReqMsg()
			await this.saveClineMessages()
			await this.providerRef.deref()?.postStateToWebview() // Use providerRef

			// If a tool was rejected, stop the loop and wait for user input
			if (this.didRejectTool) {
				return false
			}

			// If no tool was used, inform the user and prompt for retry/clarification
			if (!this.didAlreadyUseTool) {
				const { response, text, images } = await this.ask("tool", formatResponse.noToolsUsed()) // Use "tool"
				if (response === "messageResponse") {
					// User provided feedback, continue the loop with their feedback
					return this.recursivelyMakeClineRequests(
						[{ type: "text", text: text ?? "" }, ...formatResponse.imageBlocks(images)],
						true,
					)
				} else {
					// User cancelled or closed, stop the loop
					return false
				}
			}

			// If tools were used and not rejected, continue the loop with the tool results
			return this.recursivelyMakeClineRequests(this.userMessageContent, true)
		} catch (error) {
			console.error("Error in recursivelyMakeClineRequests:", error)
			await this.say("error", `An unexpected error occurred: ${error.message}`)
			return false // Stop the loop on unexpected errors
		}
	}

	// Context loading

	async loadContext(userContent: UserContent, includeFileDetails: boolean = false) {
		const parsedUserContent = await Promise.all(
			userContent.map(async (block) => {
				if (block.type === "text") {
					// Only parse mentions if the text contains task or feedback tags
					if (/<task>|<feedback>/.test(block.text)) {
						block.text = await parseMentions(block.text, cwd, this.urlContentFetcher);
					}
					// Mentions are appended to the text by parseMentions if called
					return [block]; // Return the (potentially modified) block
				} else if (block.type === "tool_result") {
					// Ensure content is an array
					if (!Array.isArray(block.content)) {
						block.content = [{ type: "text", text: String(block.content) }]
					}
					// Process text blocks within tool_result content for mentions
					block.content = (
						await Promise.all(
							block.content.map(async (contentBlock) => {
								if (contentBlock.type === "text") {
									// Only parse mentions if the text contains task or feedback tags
									if (/<task>|<feedback>/.test(contentBlock.text)) {
										contentBlock.text = await parseMentions(contentBlock.text, cwd, this.urlContentFetcher);
									}
									// Mentions are appended to the text by parseMentions if called
									return [contentBlock];
								}
								return [contentBlock]; // Keep non-text blocks as they are
							})
						)
					).flat();
					return [block];
				}
				return [block]; // Keep other block types as they are
			}),
		)

		const environmentDetails = await this.getEnvironmentDetails(includeFileDetails)
		return [parsedUserContent.flat(), environmentDetails] as [UserContent, string]
	}


	async getEnvironmentDetails(includeFileDetails: boolean = false) {
		const osName = await import("os-name").then((mod) => mod.default())
		const shell = (await import("default-shell")).default

		const { experiments } = await this.providerRef.deref()!.getState()
		// const fileTreeExperiment = Experiments.isEnabled(experiments ?? {}, EXPERIMENT_IDS.FILE_TREE) // Removed check for missing experiment ID

		let fileDetails = ""
		if (includeFileDetails) { // Removed fileTreeExperiment check
			try {
				const [files, wasLimited] = await listFiles(cwd, true, 1000) // Recursive, limit 1000
				const { showRooIgnoredFiles } = (await this.providerRef.deref()?.getState()) ?? {}
				fileDetails = `\n\n# Current Working Directory (${cwd}) Files\n${formatResponse.formatFilesList(
					cwd,
					files,
					wasLimited,
					this.rooIgnoreController,
					showRooIgnoredFiles ?? true,
				)}`
			} catch (error) {
				console.error("Error listing files for environment details:", error)
				fileDetails = "\n\n# Current Working Directory Files\n(Error listing files)"
			}
		} else if (includeFileDetails) {
			// Fallback or alternative representation if experiment is off
			fileDetails = "\n\n# Current Working Directory Files\n(File tree details disabled)"
		}

		// Active Terminals
		const activeTerminals = TerminalRegistry.getTerminals(true, this.taskId) // Use getTerminals with true and taskId
		let terminalDetails = ""
		if (activeTerminals.length > 0) {
			terminalDetails = "\n\n# Actively Running Terminals\n"
			const terminalsWithOutput = activeTerminals.filter((terminal: any) => { // Add type any
				const output = terminal.getCurrentOutput()
				return output && output.trim().length > 0
			})
			if (terminalsWithOutput.length > 0) {
				terminalDetails += terminalsWithOutput
					.map(
						(terminal: any) => // Add type any
							`## Terminal ID: ${terminal.id} (CWD: ${terminal.getCurrentWorkingDirectory().toPosix()})\n\`\`\`\n${terminal.getCurrentOutput(100)}\n\`\`\``,
					) // Limit output preview
					.join("\n\n")
			} else {
				terminalDetails += "(No terminals with recent output)"
			}
		}

		// Open Tabs
		const openTabs = vscode.window.tabGroups.all
			.flatMap((tabGroup) => tabGroup.tabs)
			.map((tab) => {
				if (tab.input instanceof vscode.TabInputText) {
					return getReadablePath(cwd, tab.input.uri.fsPath)
				} else if (typeof tab.input === 'object' && tab.input !== null && 'viewType' in tab.input) { // Check if object and has viewType
					// Handle custom editors like notebooks, diff views, etc.
					// Cast to access specific properties safely after the check
					const customInput = tab.input as vscode.TabInputCustom;
					return getReadablePath(cwd, customInput.uri.fsPath) + ` (${customInput.viewType})`
				// Check for NotebookDiff properties FIRST (has original & modified)
				} else if (typeof tab.input === 'object' && tab.input !== null && 'original' in tab.input && 'modified' in tab.input) {
					const diffInput = tab.input as vscode.TabInputNotebookDiff;
					// Note: Assuming mock URIs have fsPath. Adjust if mock structure differs.
					const originalPath = typeof diffInput.original === 'object' && diffInput.original !== null && 'fsPath' in diffInput.original ? diffInput.original.fsPath as string : 'unknown';
					const modifiedPath = typeof diffInput.modified === 'object' && diffInput.modified !== null && 'fsPath' in diffInput.modified ? diffInput.modified.fsPath as string : 'unknown';
					return `Notebook Diff: ${getReadablePath(cwd, originalPath)} vs ${getReadablePath(
						cwd,
						modifiedPath,
					)} (${diffInput.notebookType})`
				// Check for Notebook properties (if not Diff) (has notebookType)
				} else if (typeof tab.input === 'object' && tab.input !== null && 'uri' in tab.input && 'notebookType' in tab.input) { // Check for uri AND notebookType
					const notebookInput = tab.input as vscode.TabInputNotebook;
					return getReadablePath(cwd, notebookInput.uri.fsPath) + ` (Notebook: ${notebookInput.notebookType})`
				// Assume Terminal if it's an object and none of the above matched
				} else if (typeof tab.input === 'object' && tab.input !== null) {
					return `Terminal` // Terminals don't have a direct file path
				} else if (tab.input instanceof vscode.TabInputTextDiff) {
					return `Diff: ${getReadablePath(cwd, tab.input.original.fsPath)} vs ${getReadablePath(
						cwd,
						tab.input.modified.fsPath,
					)}`
				} else if (tab.input instanceof vscode.TabInputWebview) {
					return `Webview: ${tab.input.viewType}`
				}
				return tab.label // Fallback to tab label
			})
			.filter((label): label is string => !!label) // Filter out undefined/empty labels

		let openTabsDetails = ""
		if (openTabs.length > 0) {
			openTabsDetails = `\n\n# VSCode Open Tabs\n${openTabs.join("\n")}`
		}

		// Visible Files
		const visibleFiles = vscode.window.visibleTextEditors
			.map((editor) => getReadablePath(cwd, editor.document.uri.fsPath))
			.filter((p): p is string => !!p) // Ensure path is valid

		let visibleFilesDetails = ""
		if (visibleFiles.length > 0) {
			visibleFilesDetails = `\n\n# VSCode Visible Files\n${visibleFiles.join(",")}`
		}

		// Format current time and timezone information
		const now = new Date();
		const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		// Get the offset string (e.g., "PST UTC-7:00") and extract the UTC part
		const offsetFormatter = new Intl.DateTimeFormat("en-US", { timeZoneName: 'shortOffset', timeZone: timeZone });
		const formattedOffsetString = offsetFormatter.format(now);
		const offsetMatch = formattedOffsetString.match(/UTC[+-]\d{1,2}(:\d{2})?/); // Match UTC offset like UTC-7 or UTC+10:30
		const offset = offsetMatch ? offsetMatch[0] : 'UTC'; // Fallback

		const formattedTime = now.toLocaleString("en-US", {
			year: 'numeric', month: 'numeric', day: 'numeric',
			hour: 'numeric', minute: 'numeric', second: 'numeric',
			hour12: true, timeZone: timeZone
		});
		const timeDetails = `\n\n# Current Time\n${formattedTime} (${timeZone}, ${offset})`;

		// Construct the final details string including the time information
		return `====

SYSTEM INFORMATION

Operating System: ${osName}
Default Shell: ${shell}
Home Directory: ${os.homedir()}
Current Working Directory: ${cwd}

When the user initially gives you a task, a recursive list of all filepaths in the current working directory ('${cwd}') will be included in environment_details. This provides an overview of the project's file structure, offering key insights into the project from directory/file names (how developers conceptualize and organize their code) and file extensions (the language used). This can also guide decision-making on which files to explore further. If you need to further explore directories such as outside the current working directory, you can use the list_files tool. If you pass 'true' for the recursive parameter, it will list files recursively. Otherwise, it will list files at the top level, which is better suited for generic directories where you don't necessarily need the nested structure, like the Desktop.${timeDetails}${visibleFilesDetails}${openTabsDetails}${terminalDetails}${fileDetails}

====`
	}

	// Checkpoints

	private getCheckpointService({
		storage,
		options,
	}: {
		storage: CheckpointStorage
		options: CheckpointServiceOptions
	}) {
		if (!this.enableCheckpoints) {
			return undefined
		}

		if (this.checkpointService) {
			return this.checkpointService
		}

		const log = (message: string) => {
			console.log(message)

			try {
				this.providerRef.deref()?.log(message)
			} catch (err) {
				// NO-OP
			}
		}

		try {
			const workspaceDir = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0)

			if (!workspaceDir) {
				log("[Cline#initializeCheckpoints] workspace folder not found, disabling checkpoints")
				this.enableCheckpoints = false
				return undefined
			}

			const globalStorageDir = this.providerRef.deref()?.context.globalStorageUri.fsPath

			if (!globalStorageDir) {
				log("[Cline#initializeCheckpoints] globalStorageDir not found, disabling checkpoints")
				this.enableCheckpoints = false
				return undefined
			}

			const optionsWithLog: CheckpointServiceOptions = { // Ensure log is included
				taskId: this.taskId,
				workspaceDir,
				shadowDir: globalStorageDir,
				log,
			}

			// Only `task` is supported at the moment until we figure out how
			// to fully isolate the `workspace` variant.
			// const service =
			// 	this.checkpointStorage === "task"
			// 		? RepoPerTaskCheckpointService.create(options)
			// 		: RepoPerWorkspaceCheckpointService.create(options)

			const service = RepoPerTaskCheckpointService.create(optionsWithLog) // Use optionsWithLog

			service.on("initialize", () => {
				try {
					const isCheckpointNeeded =
						typeof this.clineMessages.find(({ say }) => say === "checkpoint_saved") === "undefined"

					this.checkpointService = service

					if (isCheckpointNeeded) {
						log("[Cline#initializeCheckpoints] no checkpoints found, saving initial checkpoint")
						this.checkpointSave()
					}
				} catch (err) {
					log("[Cline#initializeCheckpoints] caught error in on('initialize'), disabling checkpoints")
					this.enableCheckpoints = false
				}
			})

			service.on("checkpoint", ({ isFirst, fromHash: from, toHash: to }) => {
				try {
					this.providerRef.deref()?.postMessageToWebview({ type: "currentCheckpointUpdated", text: to })

					this.say("checkpoint_saved", to).catch((err) => { // Keep toolProps removed
						log("[Cline#initializeCheckpoints] caught unexpected error in say('checkpoint_saved')")
						console.error(err)
					})
				} catch (err) {
					log(
						"[Cline#initializeCheckpoints] caught unexpected error in on('checkpoint'), disabling checkpoints",
					)
					console.error(err)
					this.enableCheckpoints = false
				}
			})

			service.initShadowGit().catch((err) => {
				log("[Cline#initializeCheckpoints] caught unexpected error in initShadowGit, disabling checkpoints")
				console.error(err)
				this.enableCheckpoints = false
			})

			return service
		} catch (err) {
			log("[Cline#initializeCheckpoints] caught unexpected error, disabling checkpoints")
			this.enableCheckpoints = false
			return undefined
		}
	}

	private async getInitializedCheckpointService({
		interval = 250,
		timeout = 15_000,
	}: { interval?: number; timeout?: number } = {}) {
		const globalStorageDir = this.providerRef.deref()?.context.globalStorageUri.fsPath;
		if (!globalStorageDir) {
			console.error("Global storage directory not found, cannot initialize checkpoint service.");
			this.enableCheckpoints = false; // Disable checkpoints if storage path is missing
			return undefined;
		}
		const service = this.getCheckpointService({ storage: this.checkpointStorage, options: { taskId: this.taskId, workspaceDir: cwd, shadowDir: globalStorageDir } }) // Keep correct args

		if (!service || service.isInitialized) {
			return service
		}

		try {
			await pWaitFor(
				() => {
					console.log("[Cline#getCheckpointService] waiting for service to initialize")
					return service.isInitialized
				},
				{ interval, timeout },
			)
			return service
		} catch (err) {
			return undefined
		}
	}

	public async checkpointDiff({
		ts,
		previousCommitHash,
		commitHash,
		mode,
	}: {
		ts: number
		previousCommitHash?: string
		commitHash: string
		mode: "full" | "checkpoint"
	}) {
		const service = await this.getInitializedCheckpointService()

		if (!service) {
			return
		}

		telemetryService.captureCheckpointDiffed(this.taskId)

		if (!previousCommitHash && mode === "checkpoint") {
			const previousCheckpoint = this.clineMessages
				.filter(({ say }) => say === "checkpoint_saved")
				.sort((a, b) => b.ts - a.ts)
				.find((message) => message.ts < ts)

			previousCommitHash = previousCheckpoint?.text
		}

		try {
			const changes = await service.getDiff({ from: previousCommitHash, to: commitHash })

			if (!changes?.length) {
				vscode.window.showInformationMessage("No changes found.")
				return
			}

			await vscode.commands.executeCommand(
				"vscode.changes",
				mode === "full" ? "Changes since task started" : "Changes since previous checkpoint",
				changes.map((change) => [
					vscode.Uri.file(change.paths.absolute),
					vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${change.paths.relative}`).with({
						query: Buffer.from(change.content.before ?? "").toString("base64"),
					}),
					vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${change.paths.relative}`).with({
						query: Buffer.from(change.content.after ?? "").toString("base64"),
					}),
				]),
			)
		} catch (err) {
			this.providerRef.deref()?.log("[checkpointDiff] disabling checkpoints for this task")
			this.enableCheckpoints = false
		}
	}

	public checkpointSave() {
		const globalStorageDir = this.providerRef.deref()?.context.globalStorageUri.fsPath;
		if (!globalStorageDir) {
			console.error("Global storage directory not found, cannot save checkpoint.");
			this.enableCheckpoints = false; // Disable checkpoints if storage path is missing
			return;
		}
		const service = this.getCheckpointService({ storage: this.checkpointStorage, options: { taskId: this.taskId, workspaceDir: cwd, shadowDir: globalStorageDir } }) // Keep correct args

		if (!service) {
			return
		}

		if (!service.isInitialized) {
			this.providerRef
				.deref()
				?.log("[checkpointSave] checkpoints didn't initialize in time, disabling checkpoints for this task")
			this.enableCheckpoints = false
			return
		}

		telemetryService.captureCheckpointCreated(this.taskId)

		// Start the checkpoint process in the background.
		service.saveCheckpoint(`Task: ${this.taskId}, Time: ${Date.now()}`).catch((err) => {
			console.error("[Cline#checkpointSave] caught unexpected error, disabling checkpoints", err)
			this.enableCheckpoints = false
		})
	}

	public async checkpointRestore({
		ts,
		commitHash,
		mode,
	}: {
		ts: number
		commitHash: string
		mode: "preview" | "restore"
	}) {
		const service = await this.getInitializedCheckpointService()

		if (!service) {
			return
		}

		const index = this.clineMessages.findIndex((m) => m.ts === ts)

		if (index === -1) {
			return
		}

		try {
			await service.restoreCheckpoint(commitHash)

			telemetryService.captureCheckpointRestored(this.taskId)

			await this.providerRef.deref()?.postMessageToWebview({ type: "currentCheckpointUpdated", text: commitHash })

			if (mode === "restore") {
				await this.overwriteApiConversationHistory(
					this.apiConversationHistory.filter((m) => !m.ts || m.ts < ts),
				)

				const deletedMessages = this.clineMessages.slice(index + 1)

				const { totalTokensIn, totalTokensOut, totalCacheWrites, totalCacheReads, totalCost } = getApiMetrics(
					combineApiRequests(combineCommandSequences(deletedMessages)),
				)

				await this.overwriteClineMessages(this.clineMessages.slice(0, index + 1))

				// TODO: Verify that this is working as expected.
				await this.say(
					"api_req_deleted",
					JSON.stringify({
						tokensIn: totalTokensIn,
						tokensOut: totalTokensOut,
						cacheWrites: totalCacheWrites,
						cacheReads: totalCacheReads,
						cost: totalCost,
					} satisfies ClineApiReqInfo),
				)
			}

			// The task is already cancelled by the provider beforehand, but we
			// need to re-init to get the updated messages.
			//
			// This was take from Cline's implementation of the checkpoints
			// feature. The cline instance will hang if we don't cancel twice,
			// so this is currently necessary, but it seems like a complicated
			// and hacky solution to a problem that I don't fully understand.
			// I'd like to revisit this in the future and try to improve the
			// task flow and the communication between the webview and the
			// Cline instance.
			this.providerRef.deref()?.cancelTask()
		} catch (err) {
			this.providerRef.deref()?.log("[checkpointRestore] disabling checkpoints for this task")
			this.enableCheckpoints = false
		}
	}
	// _executeWriteToFileTool method removed as it's now handled by ToolExecutor
	// _executeApplyDiffTool method removed as it's now handled by ToolExecutor
	// _executeInsertContentTool method removed as it's now handled by ToolExecutor

} // End of Cline class

function escapeRegExp(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
