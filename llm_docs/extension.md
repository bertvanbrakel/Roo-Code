# Extension Activation

The [`src/extension.ts`](../src/extension.ts) file is the main entry point for the Roo Code extension. The `activate` function is called when the extension is activated. This function is responsible for initializing the extension and registering its various components.

## Activation Process

The `activate` function performs the following tasks:

1.  **Load Environment Variables:** The extension loads environment variables from the `.env` file using the `dotenvx` library. This allows the extension to access sensitive information, such as API keys, without hardcoding them in the code.
2.  **Initialize Output Channel:** The extension creates an output channel named "Roo-Code" for logging messages. This channel is used to display information about the extension's status and any errors that occur.
3.  **Initialize Telemetry Service:** The extension initializes the telemetry service for collecting usage data. This data is used to track the usage of the extension and identify areas for improvement.
4.  **Initialize Terminal Registry:** The extension initializes the terminal registry for managing terminal-related commands and actions. This allows the extension to interact with the VS Code terminal.
5.  **Register Webview View Provider:** The extension registers a webview view provider for the sidebar, which is used to display the user interface. The webview is a web-based view that is embedded in the VS Code editor.
6.  **Register Commands:** The extension registers various commands, such as those for interacting with the LLMs and managing the extension's settings. These commands are exposed to the user through the VS Code command palette.
7.  **Register Text Document Content Provider:** The extension registers a text document content provider for displaying diff views. This allows the extension to display the differences between two versions of a file.
8.  **Register URI Handler:** The extension registers a URI handler for handling custom URIs. This allows the extension to handle custom URIs that are used to communicate with the webview.
9.  **Register Code Actions Provider:** The extension registers a code actions provider for providing suggestions and actions to the user based on the current code context. This allows the extension to provide context-aware assistance to the user.
10. **Create Roo Code API:** The extension creates the Roo Code API, which is used by other extensions to interact with the Roo Code extension. This allows other extensions to leverage the functionality of the Roo Code extension.

## Deactivation Process

The `deactivate` function is called when the extension is deactivated. It performs the following tasks:

1.  **Log Deactivation Message:** The extension logs a message to the output channel indicating that the extension has been deactivated.
2.  **Clean Up MCP Server Manager:** The extension cleans up the MCP server manager, which is responsible for managing the MCP servers. This ensures that the MCP servers are properly shut down when the extension is deactivated.
3.  **Shutdown Telemetry Service:** The extension shuts down the telemetry service. This ensures that no more telemetry data is collected when the extension is deactivated.
4.  **Clean Up Terminal Handlers:** The extension cleans up the terminal handlers. This ensures that the terminal handlers are properly disposed of when the extension is deactivated.

## Key Concepts

*   **Activation Events:** Activation events are events that trigger the activation of the extension. The Roo Code extension uses several activation events, such as `onView:roo-code-sidebar` and `onCommand:roo-code.chat`.
*   **Contribution Points:** Contribution points are static declarations in the `package.json` file that extend VS Code. The Roo Code extension uses contribution points to register commands, settings, and other features.
*   **VS Code API:** The VS Code API is a set of JavaScript APIs that you can invoke in your extension code. The Roo Code extension uses the VS Code API to interact with the VS Code editor, manage the webview, and register commands and settings.
