import * as vscode from "vscode"
import * as dotenvx from "@dotenvx/dotenvx"

// Load environment variables from .env file
try {
	// Specify path to .env file in the project root directory
	const envPath = __dirname + "/../.env"
	dotenvx.config({ path: envPath })
} catch (e) {
	// Silently handle environment loading errors
	console.warn("Failed to load environment variables:", e)
}

import "./utils/path" // Necessary to have access to String.prototype.toPosix.

import { ClineProvider } from "./core/webview/ClineProvider"
import { CodeActionProvider } from "./core/CodeActionProvider"
import { DIFF_VIEW_URI_SCHEME } from "./integrations/editor/DiffViewProvider"
import { McpServerManager } from "./services/mcp/McpServerManager"
import { telemetryService } from "./services/telemetry/TelemetryService"
import { natsService } from "./services/nats/NatsService" // Import NatsService
import { TerminalRegistry } from "./integrations/terminal/TerminalRegistry"

import { handleUri, registerCommands, registerCodeActions, createRooCodeAPI, registerTerminalActions } from "./activate"

/**
 * Built using https://github.com/microsoft/vscode-webview-ui-toolkit
 *
 * Inspired by:
 *  - https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/default/weather-webview
 *  - https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/frameworks/hello-world-react-cra
 */

let outputChannel: vscode.OutputChannel
let extensionContext: vscode.ExtensionContext

// This method is called when your extension is activated.
// Your extension is activated the very first time the command is executed.
export async function activate(context: vscode.ExtensionContext) { // Make activate async
	extensionContext = context
	outputChannel = vscode.window.createOutputChannel("Roo-Code")
	context.subscriptions.push(outputChannel)
	outputChannel.appendLine("Roo-Code extension activated")

	// Initialize telemetry service after environment variables are loaded
	telemetryService.initialize()
	// Initialize terminal shell execution handlers
	TerminalRegistry.initialize()

	// Initialize NATS Service (async) and potentially get initial command
	const initialNatsCommandPayload = await natsService.initialize(context);

	// Get default commands from configuration.
	const defaultCommands = vscode.workspace.getConfiguration("roo-cline").get<string[]>("allowedCommands") || []

	// Initialize global state if not already set.
	if (!context.globalState.get("allowedCommands")) {
		context.globalState.update("allowedCommands", defaultCommands)
	}
	const sidebarProvider = new ClineProvider(context, outputChannel)
	telemetryService.setProvider(sidebarProvider)

	// Apply initial NATS command configuration *before* registering the webview provider
	// This ensures the initial state is set correctly when the UI loads.
	if (initialNatsCommandPayload) {
		// We need access to the Cline instance managed by sidebarProvider
		// This might require exposing a method or initializing Cline earlier.
		// For now, assume sidebarProvider can handle this internally or expose Cline.
		// TODO: Refactor ClineProvider/Cline initialization if needed to apply initial config here.
		try {
			await sidebarProvider.applyInitialNatsConfiguration(initialNatsCommandPayload);
		} catch (e) {
			outputChannel.appendLine(`Error applying initial NATS configuration: ${e}`);
		}
	}

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ClineProvider.sideBarId, sidebarProvider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	)

	registerCommands({ context, outputChannel, provider: sidebarProvider })

	/**
	 * We use the text document content provider API to show the left side for diff
	 * view by creating a virtual document for the original content. This makes it
	 * readonly so users know to edit the right side if they want to keep their changes.
	 *
	 * This API allows you to create readonly documents in VSCode from arbitrary
	 * sources, and works by claiming an uri-scheme for which your provider then
	 * returns text contents. The scheme must be provided when registering a
	 * provider and cannot change afterwards.
	 *
	 * Note how the provider doesn't create uris for virtual documents - its role
	 * is to provide contents given such an uri. In return, content providers are
	 * wired into the open document logic so that providers are always considered.
	 *
	 * https://code.visualstudio.com/api/extension-guides/virtual-documents
	 */
	const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
		provideTextDocumentContent(uri: vscode.Uri): string {
			return Buffer.from(uri.query, "base64").toString("utf-8")
		}
	})()

	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider(DIFF_VIEW_URI_SCHEME, diffContentProvider),
	)

	context.subscriptions.push(vscode.window.registerUriHandler({ handleUri }))

	// Register code actions provider.
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider({ pattern: "**/*" }, new CodeActionProvider(), {
			providedCodeActionKinds: CodeActionProvider.providedCodeActionKinds,
		}),
	)

	registerCodeActions(context)
	registerTerminalActions(context)

	return createRooCodeAPI(outputChannel, sidebarProvider)
}

// This method is called when your extension is deactivated
export async function deactivate() {
	outputChannel.appendLine("Roo-Code extension deactivated")
	// Clean up MCP server manager
	await McpServerManager.cleanup(extensionContext)
	await telemetryService.shutdown() // Assuming shutdown might become async
	await natsService.shutdown() // Shutdown NATS service

	// Clean up terminal handlers
	TerminalRegistry.cleanup()
}
