# How to Make Roo Code Run as a Standalone Cross-Platform App

This document provides instructions on how to make the Roo Code codebase run as a standalone cross-platform app. This can be useful for users who want to use Roo Code without having to install VS Code.

## Technologies

*   **Electron:** A framework for building cross-platform desktop applications with JavaScript, HTML, and CSS. Electron allows you to package web applications as native desktop applications.
*   **Node.js:** A JavaScript runtime environment that executes JavaScript code outside of a web browser. Electron uses Node.js to run the main process.
*   **React:** A JavaScript library for building user interfaces. Roo Code's webview UI is built using React.
*   **TypeScript:** A superset of JavaScript that adds static typing. Roo Code is written in TypeScript, which provides better code organization and maintainability.

## Steps

1.  **Create a new Electron project.** Use the Electron Forge or Electron Builder to create a new Electron project. These tools provide a streamlined way to set up an Electron project with all the necessary dependencies and configurations.
2.  **Copy the Roo Code codebase to the Electron project.** Copy the `src` directory and the `webview-ui` directory to the Electron project. These directories contain the core logic and the user interface of the Roo Code extension.
3.  **Create a new `main.js` file.** This file will be the entry point for the Electron application. It is responsible for creating the browser window and managing the application lifecycle.
4.  **Implement the Electron main process.** The Electron main process is responsible for:
    *   Creating the browser window.
    *   Loading the webview UI.
    *   Managing the application lifecycle (e.g., handling window close events).
    *   Communicating with the renderer process.
5.  **Implement the Electron renderer process.** The Electron renderer process is responsible for rendering the user interface. You can reuse the existing React components in the `webview-ui` directory. The renderer process communicates with the main process using Electron's inter-process communication (IPC) mechanism.
6.  **Adapt the VS Code API calls to the Electron API.** The VS Code API calls need to be replaced with the corresponding Electron API calls. This will require significant effort, as the two APIs are very different. You will need to consult the IntelliJ Platform SDK documentation to find the appropriate API calls.
7.  **Build and test the application.** Use the Electron Forge or Electron Builder to build and test the application. These tools provide commands for packaging the application for different platforms (e.g., Windows, macOS, Linux).

## Reusing Code

The following code can be reused from the Roo Code codebase:

*   **LLM Interaction Code:** The code in the `src/api` directory can be reused to interact with the LLMs. This code handles the communication with the different LLM providers and provides a consistent interface for accessing the LLMs.
*   **MCP Integration Code:** The code in the `src/services/mcp` directory can be reused to integrate with the Model Context Protocol (MCP). This code handles the communication with the MCP servers and provides access to the MCP tools and resources.
*   **Core Utilities:** The code in the `src/utils` directory can be reused for various utility functions. These functions provide common functionalities such as file system operations, string manipulation, and data transformations.
*   **React Components:** The React components in the `webview-ui` directory can be reused to implement the user interface. These components provide a modular and reusable way to build the UI.

## Adapting VS Code API Calls

The following VS Code API calls need to be replaced with the corresponding Electron API calls:

*   `vscode.commands.registerCommand`: Use `electron.ipcMain` to register a new action.
*   `vscode.window.createWebviewPanel`: Use `electron.BrowserWindow` to create a new browser window.
*   `vscode.ExtensionContext`: You will need to manage the application state manually, as there is no direct equivalent to `ExtensionContext` in Electron. You can use Node.js modules like `fs` and `path` to manage the application state.

## Building and Testing the Application

Use the Electron Forge or Electron Builder to build and test the application. These tools provide commands for packaging the application for different platforms (e.g., Windows, macOS, Linux).

## Security Considerations

When building a cross-platform application with Electron, it's important to consider security implications. Here are some security best practices:

*   **Enable Context Isolation:** Context isolation ensures that the renderer process has its own dedicated JavaScript context, preventing access to the main process's context.
*   **Disable Node.js Integration in the Renderer Process:** Disabling Node.js integration in the renderer process prevents the renderer process from directly accessing Node.js APIs, reducing the attack surface.
*   **Validate and Sanitize User Input:** Always validate and sanitize user input to prevent code injection attacks.
*   **Use a Secure Content Security Policy (CSP):** A CSP helps prevent cross-site scripting (XSS) attacks by restricting the sources from which the renderer process can load resources.

Note: Due to the significant differences between the VS Code and Electron architectures, it may not be possible to reuse a large portion of the codebase. However, the core logic, utilities, and React components can be reused to reduce the amount of code that needs to be rewritten.