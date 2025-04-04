# How-To Guide

This document provides guidance on how to perform common tasks in the Roo Code codebase. It serves as a practical guide for developers who want to contribute to the project or customize its functionality.

For a general overview of how VS Code extensions work, see the [VS Code Extensions document](vscode-extensions.md).

- [How to Create an IntelliJ Plugin](intellij-plugin.md)
- [How to Make Roo Code Run as a Standalone Cross-Platform App](cross-platform-app.md)

## Changing System Prompts

To change the way system prompts work, you need to modify the `src/shared/modes.ts` file. This file defines the different modes of the extension, and each mode has a `roleDefinition` and `customInstructions` property that define the system prompt for that mode.

```ts
import * as vscode from "vscode"
import { TOOL_GROUPS, ToolGroup, ALWAYS_AVAILABLE_TOOLS } from "./tool-groups"
import { addCustomInstructions } from "../core/prompts/sections/custom-instructions"

// Mode types
export type Mode = string

// Group options type
export type GroupOptions = {
	fileRegex?: string // Regular expression pattern
	description?: string // Human-readable description of the pattern
}

// Group entry can be either a string or tuple with options
export type GroupEntry = ToolGroup | readonly [ToolGroup, GroupOptions]

// Mode configuration type
export type ModeConfig = {
	slug: string
	name: string
	roleDefinition: string
	customInstructions?: string
	groups: readonly GroupEntry[] // Now supports both simple strings and tuples with options
	source?: "global" | "project" // Where this mode was loaded from
}

// Mode-specific prompts only
export type PromptComponent = {
	roleDefinition?: string
	customInstructions?: string
}

export type CustomModePrompts = {
	[key: string]: PromptComponent | undefined
}

// Helper to extract group name regardless of format
export function getGroupName(group: GroupEntry): ToolGroup {
	if (typeof group === "string") {
		return group
	}

	return group[0]
}

// Helper to get group options if they exist
function getGroupOptions(group: GroupEntry): GroupOptions | undefined {
	return Array.isArray(group) ? group[1] : undefined
}

// Helper to check if a file path matches a regex pattern
export function doesFileMatchRegex(filePath: string, pattern: string): boolean {
	try {
		const regex = new RegExp(pattern)
		return regex.test(filePath)
	} catch (error) {
		console.error(`Invalid regex pattern: ${pattern}`, error)
		return false
	}
}

// Helper to get all tools for a mode
export function getToolsForMode(groups: readonly GroupEntry[]): string[] {
	const tools = new Set<string>()

	// Add tools from each group
	groups.forEach((group) => {
		const groupName = getGroupName(group)
		const groupConfig = TOOL_GROUPS[groupName]
		groupConfig.tools.forEach((tool: string) => tools.add(tool))
	})

	// Always add required tools
	ALWAYS_AVAILABLE_TOOLS.forEach((tool) => tools.add(tool))

	return Array.from(tools)
}

// Main modes configuration as an ordered array
export const modes: readonly ModeConfig[] = [
	{
		slug: "code",
		name: "Code",
		roleDefinition:
			"You are Roo, a highly skilled software engineer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.",
		groups: ["read", "edit", "browser", "command", "mcp"],
	},
	{
		slug: "architect",
		name: "Architect",
		roleDefinition:
			"You are Roo, an experienced technical leader who is inquisitive and an excellent planner. Your goal is to gather information and get context to create a detailed plan for accomplishing the user's task, which the user will review and approve before they switch into another mode to implement the solution.",
		groups: ["read", ["edit", { fileRegex: "\\.md$", description: "Markdown files only" }], "browser", "mcp"],
		customInstructions:
			"1. Do some information gathering (for example using read_file or search_files) to get more context about the task.\n\n2. You should also ask the user clarifying questions to get a better understanding of the task.\n\n3. Once you've gained more context about the user's request, you should create a detailed plan for how to accomplish the task. Include Mermaid diagrams if they help make your plan clearer.\n\n4. Ask the user if they are pleased with this plan, or if they would like to make any changes. Think of this as a brainstorming session where you can discuss the task and plan the best way to accomplish it.\n\n5. Once the user confirms the plan, ask them if they'd like you to write it to a markdown file.\n\n6. Use the switch_mode tool to request that the user switch to another mode to implement the solution.",
	},
	{
		slug: "ask",
		name: "Ask",
		roleDefinition:
			"You are Roo, a knowledgeable technical assistant focused on answering questions and providing information about software development, technology, and related topics.",
		groups: ["read", "browser", "mcp"],
		customInstructions:
			"You can analyze code, explain concepts, and access external resources. Make sure to answer the user's questions and don't rush to switch to implementing code. Include Mermaid diagrams if they help make your response clearer.",
	},
	{
		slug: "debug",
		name: "Debug",
		roleDefinition:
			"You are Roo, an expert software debugger specializing in systematic problem diagnosis and resolution.",
		groups: ["read", "edit", "browser", "command", "mcp"],
		customInstructions:
			"Reflect on 5-7 different possible sources of the problem, distill those down to 1-2 most likely sources, and then add logs to validate your assumptions. Explicitly ask the user to confirm the diagnosis before fixing the problem.",
	},
] as const

// Export the default mode slug
export const defaultModeSlug = modes[0].slug

// Helper functions
export function getModeBySlug(slug: string, customModes?: ModeConfig[]): ModeConfig | undefined {
	// Check custom modes first
	const customMode = customModes?.find((mode) => mode.slug === slug)
	if (customMode) {
		return customMode
	}
	// Then check built-in modes
	return modes.find((mode) => mode.slug === slug)
}

export function getModeConfig(slug: string, customModes?: ModeConfig[]): ModeConfig {
	const mode = getModeBySlug(slug, customModes)
	if (!mode) {
		throw new Error(`No mode found for slug: ${slug}`)
	}
	return mode
}

// Get all available modes, with custom modes overriding built-in modes
export function getAllModes(customModes?: ModeConfig[]): ModeConfig[] {
	if (!customModes?.length) {
		return [...modes]
	}

	// Start with built-in modes
	const allModes = [...modes]

	// Process custom modes
	customModes.forEach((customMode) => {
		const index = allModes.findIndex((mode) => mode.slug === customMode.slug)
		if (index !== -1) {
			// Override existing mode
			allModes[index] = customMode
		} else {
			// Add new mode
			allModes.push(customMode)
		}
	})

	return allModes
}

// Check if a mode is custom or an override
export function isCustomMode(slug: string, customModes?: ModeConfig[]): boolean {
	return !!customModes?.some((mode) => mode.slug === slug)
}

// Custom error class for file restrictions
export class FileRestrictionError extends Error {
	constructor(mode: string, pattern: string, description: string | undefined, filePath: string) {
		super(
			`This mode (${mode}) can only edit files matching pattern: ${pattern}${description ? ` (${description})` : ""}. Got: ${filePath}`,
		)
		this.name = "FileRestrictionError"
	}
}

export function isToolAllowedForMode(
	tool: string,
	modeSlug: string,
	customModes: ModeConfig[],
	toolRequirements?: Record<string, boolean>,
	toolParams?: Record<string, any>, // All tool parameters
	experiments?: Record<string, boolean>,
): boolean {
	// Always allow these tools
	if (ALWAYS_AVAILABLE_TOOLS.includes(tool as any)) {
		return true
	}

	if (experiments && tool in experiments) {
		if (!experiments[tool]) {
			return false
		}
	}

	// Check tool requirements if any exist
	if (toolRequirements && tool in toolRequirements) {
		if (!toolRequirements[tool]) {
			return false
		}
	}

	const mode = getModeBySlug(modeSlug, customModes)
	if (!mode) {
		return false
	}

	// Check if tool is in any of the mode's groups and respects any group options
	for (const group of mode.groups) {
		const groupName = getGroupName(group)
		const options = getGroupOptions(group)

		const groupConfig = TOOL_GROUPS[groupName]

		// If the tool isn't in this group's tools, continue to next group
		if (!groupConfig.tools.includes(tool)) {
			continue
		}

		// If there are no options, allow the tool
		if (!options) {
			return true
		}

		// For the edit group, check file regex if specified
		if (groupName === "edit" && options.fileRegex) {
			const filePath = toolParams?.path
			if (
				filePath &&
				(toolParams.diff || toolParams.content || toolParams.operations) &&
				!doesFileMatchRegex(filePath, options.fileRegex)
			) {
				throw new FileRestrictionError(mode.name, options.fileRegex, options.description, filePath)
			}
		}

		return true
	}

	return false
}

// Create the mode-specific default prompts
export const defaultPrompts: Readonly<CustomModePrompts> = Object.freeze(
	Object.fromEntries(
		modes.map((mode) => [
			mode.slug,
			{
				roleDefinition: mode.roleDefinition,
				customInstructions: mode.customInstructions,
			},
		]),
	),
)

// Helper function to get all modes with their prompt overrides from extension state
export async function getAllModesWithPrompts(context: vscode.ExtensionContext): Promise<ModeConfig[]> {
	const customModes = (await context.globalState.get<ModeConfig[]>("customModes")) || []
	const customModePrompts = (await context.globalState.get<CustomModePrompts>("customModePrompts")) || {}

	const allModes = getAllModes(customModes)
	return allModes.map((mode) => ({
		...mode,
		roleDefinition: customModePrompts[mode.slug]?.roleDefinition ?? mode.roleDefinition,
		customInstructions: customModePrompts[mode.slug]?.customInstructions ?? mode.customInstructions,
	}))
}

// Helper function to get complete mode details with all overrides
export async function getFullModeDetails(
	modeSlug: string,
	customModes?: ModeConfig[],
	customModePrompts?: CustomModePrompts,
	options?: {
		cwd?: string
		globalCustomInstructions?: string
		preferredLanguage?: string
	},
): Promise<ModeConfig> {
	// First get the base mode config from custom modes or built-in modes
	const baseMode = getModeBySlug(modeSlug, customModes) || modes.find((m) => m.slug === modeSlug) || modes[0]

	// Check for any prompt component overrides
	const promptComponent = customModePrompts?.[modeSlug]

	// Get the base custom instructions
	const baseCustomInstructions = promptComponent?.customInstructions || baseMode.customInstructions || ""

	// If we have cwd, load and combine all custom instructions
	let fullCustomInstructions = baseCustomInstructions
	if (options?.cwd) {
		fullCustomInstructions = await addCustomInstructions(
			baseCustomInstructions,
			options.globalCustomInstructions || "",
			options.cwd,
			modeSlug,
			{ preferredLanguage: options.preferredLanguage },
		)
	}

	// Return mode with any overrides applied
	return {
		...baseMode,
		roleDefinition: promptComponent?.roleDefinition || baseMode.roleDefinition,
		customInstructions: fullCustomInstructions,
	}
}

// Helper function to safely get role definition
export function getRoleDefinition(modeSlug: string, customModes?: ModeConfig[]): string {
	const mode = getModeBySlug(modeSlug, customModes)
	if (!mode) {
		console.warn(`No mode found for slug: ${modeSlug}`)
		return ""
	}
	return mode.roleDefinition
}

// Helper function to safely get custom instructions
export function getCustomInstructions(modeSlug: string, customModes?: ModeConfig[]): string {
	const mode = getModeBySlug(modeSlug, customModes)
	if (!mode) {
		console.warn(`No mode found for slug: ${modeSlug}`)
		return ""
	}
	return mode.customInstructions ?? ""
}
```

1.  **Edit the `src/shared/modes.ts` file.** This file contains the configuration for all the available modes.
2.  **Find the mode configuration you want to modify.** The `modes` array contains the configuration for each mode. Each mode object has properties like `slug`, `name`, `roleDefinition`, and `customInstructions`.
3.  **Update the `roleDefinition` and/or `customInstructions` property.** The `roleDefinition` property defines the role of the mode, and the `customInstructions` property provides custom instructions for the mode. These properties are used to generate the system prompt that is sent to the LLM.

    - **Example:**
        ```typescript
        {
            slug: "code",
            name: "Code",
            roleDefinition: "You are Roo, a highly skilled software engineer...",
            customInstructions: "Follow these instructions carefully...",
            groups: ["read", "edit", "command"],
        }
        ```

## Adding a New Chat UI Element

To add a new chat UI element, you need to modify the [`webview-ui/src/components/chat/ChatView.tsx`](../webview-ui/src/components/chat/ChatView.tsx) file. This file defines the chat interface.

1.  **Edit the [`webview-ui/src/components/chat/ChatView.tsx`](../webview-ui/src/components/chat/ChatView.tsx) file.** This file contains the React component that renders the chat interface.
2.  **Add the corresponding React component to the `ChatView` component.** You can add the component to the existing layout or create a new layout for the component. Consider using existing UI components from `webview-ui/src/components/ui` to maintain a consistent look and feel.
3.  **Update the state management logic to handle the new UI element.** You may need to add new state variables to the `ChatView` component and update the event handlers to handle the new UI element. Use React's `useState` hook to manage the state of the UI element.

## Adding Additional Settings Pages

To add additional settings pages, you need to modify the [`webview-ui/src/components/settings/SettingsView.tsx`](../webview-ui/src/components/settings/SettingsView.tsx) file. This file defines the settings interface.

1.  **Edit the [`webview-ui/src/components/settings/SettingsView.tsx`](../webview-ui/src/components/settings/SettingsView.tsx) file.** This file contains the React component that renders the settings interface.
2.  **Add a new tab to the settings interface.** You can use the existing tab component or create a new tab component. Use a UI library like `vscrui` or the VS Code Toolkit to create the tab.
3.  **Create a new React component for the settings page.** This component will display the settings for the new page.
4.  **Update the state management logic to handle the new settings.** You may need to add new state variables to the `SettingsView` component and update the event handlers to handle the new settings.

## Adding a New UI Panel

To add a new UI Panel, you need to modify the [`src/extension.ts`](../src/extension.ts) file. This file is the main entry point for the extension.

1.  **Edit the [`src/extension.ts`](../src/extension.ts) file.**
2.  **Register a new webview view provider in the `activate` function.** You can use the `vscode.window.registerWebviewViewProvider` function to register a new webview view provider.
3.  **Create a new React component for the UI panel.** This component will display the content of the UI panel. The component should be placed in the `webview-ui/src/components` directory.
4.  **Update the state management logic to handle the new UI panel.** You may need to add new state variables to the extension and update the event handlers to handle the new UI panel.

## Adding Extensions to ROO

To add extensions to ROO, you need to modify the [`package.json`](../package.json) file. This file contains the extension's metadata, dependencies, and build scripts.

1.  **Edit the [`package.json`](../package.json) file.**
2.  **Add the extension as a dependency in the `package.json` file.** You can use the `npm install` command to add the extension as a dependency.
3.  **Update the build scripts to include the extension in the build process.** You may need to modify the `esbuild.js` file to include the extension in the build process.

## How to Run Tests

To run tests, you can use the following command:

```
npm run test
```

This command will run all the tests in the project. The test files are located in the [`src/__tests__`](../src/__tests__) and [`webview-ui/src/__tests__`](../webview-ui/src/__tests__) directories.

## How to Modify the MCP Tool Calls

To modify the MCP tool calls, you need to modify the [`src/services/mcp/McpHub.ts`](../src/services/mcp/McpHub.ts) file. This file contains the code for calling the MCP tools.

1.  **Edit the [`src/services/mcp/McpHub.ts`](../src/services/mcp/McpHub.ts) file.**
2.  **Find the [`callTool` function](../src/services/mcp/McpHub.ts#callTool).** This function is responsible for calling the MCP tools.
3.  **Modify the `callTool` function to change the way the MCP tools are called.** You can modify the arguments that are passed to the tools or the way the results are handled.

## How to Launch Child Tasks

To launch child tasks, you can use the [`newTask` tool](../src/extension.ts). This tool allows you to create a new task with a specified mode and initial message.

1.  **Use the [`newTask` tool](../src/extension.ts) to create a new task.** You need to specify the mode and initial message for the new task.
2.  **The new task will be launched in a new Cline instance.**

## How to Chain Agents Together

To chain agents together, you can use the [`newTask` tool](../src/extension.ts) to launch a new task with a specific mode and initial message. The new task can then use the [`newTask` tool](../src/extension.ts) to launch another task, and so on. This allows you to create a chain of agents that can work together to accomplish a complex task.

1.  **Use the [`newTask` tool](../src/extension.ts) to launch the first agent in the chain.** You need to specify the mode and initial message for the first agent.
2.  **In the first agent, use the [`newTask` tool](../src/extension.ts) to launch the second agent in the chain.** You need to specify the mode and initial message for the second agent.
3.  **Repeat step 2 for each agent in the chain.**
4.  **The agents will be launched in a sequence, with each agent passing its results to the next agent in the chain.**

## How to Have a Chain with a Coordinator Agent

To have a chain with a coordinator agent, you can use the [`newTask` tool](../src/extension.ts) to launch a coordinator agent. The coordinator agent can then use the [`newTask` tool](../src/extension.ts) to launch the other agents in the chain. The coordinator agent can be responsible for coordinating the work of the other agents and for combining their results.

1.  **Use the [`newTask` tool](../src/extension.ts) to launch the coordinator agent.** You need to specify the mode and initial message for the coordinator agent. The initial message should describe the overall task and the roles of the other agents.
2.  **In the coordinator agent, use the [`newTask` tool](../src/extension.ts) to launch the other agents in the chain.** You need to specify the mode and initial message for each agent. The initial message should describe the specific task that each agent is responsible for.
3.  **The coordinator agent can then use the results from the other agents to accomplish the overall task.** The coordinator agent can use the `read_file` tool to read the results from the other agents and the `apply_diff` tool to combine the results.

## Does this codebase support sub sub tasks?

While there's no explicit code preventing the creation of sub-sub-tasks (a task launched from a child task), full support isn't guaranteed. The system is designed to launch child tasks, but the implications of deeply nested task chains haven't been fully explored. Use with caution.

For information on how to add a new setting to the extension, see the [Settings document](settings.md).

For information on how the extension determines if a tool is required, see the [Tool Selection document](tool-selection.md).
