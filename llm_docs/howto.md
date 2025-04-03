# How-To Guide

This document provides guidance on how to perform common tasks in the Roo Code codebase. It serves as a practical guide for developers who want to contribute to the project or customize its functionality.

For a general overview of how VS Code extensions work, see the [VS Code Extensions document](vscode-extensions.md).

- [How to Create an IntelliJ Plugin](intellij-plugin.md)
- [How to Make Roo Code Run as a Standalone Cross-Platform App](cross-platform-app.md)

## Changing System Prompts

To change the way system prompts work, you need to modify the [`src/shared/modes.ts`](../src/shared/modes.ts) file. This file defines the different modes of the extension, and each mode has a `roleDefinition` and `customInstructions` property that define the system prompt for that mode.

1.  **Edit the [`src/shared/modes.ts`](../src/shared/modes.ts) file.** This file contains the configuration for all the available modes.
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
