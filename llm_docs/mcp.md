# MCP Integration

The `src/services/mcp` directory contains the code for integrating with the Model Context Protocol (MCP), which is used to communicate with external tools and services. MCP allows the Roo Code extension to leverage the capabilities of other applications and services, such as code linters, formatters, and documentation generators.

## Key Components

*   [`McpServerManager.ts`](../src/services/mcp/McpServerManager.ts): This file manages the MCP server instances. It ensures that only one set of MCP servers runs across all webviews. The `McpServerManager` is responsible for starting, stopping, and restarting the MCP servers.
*   [`McpHub.ts`](../src/services/mcp/McpHub.ts): This file is the main class for managing the MCP connections. It is responsible for connecting to the MCP servers, fetching the tools and resources, and handling the communication between the extension and the MCP servers.

## MCP Server Management

The `McpServerManager` class is a singleton that manages the MCP server instances. It provides the following functionalities:

*   `getInstance()`: Returns the singleton instance of the `McpHub` class. This ensures that only one instance of the `McpHub` class is created.
*   `cleanup()`: Cleans up the singleton instance and all its resources. This is called when the extension is deactivated to ensure that all resources are properly released.

## MCP Connection Management

The `McpHub` class manages the MCP connections. It provides the following functionalities:

*   `getServers()`: Returns the list of enabled MCP servers. This allows the extension to discover the available MCP servers.
*   `getAllServers()`: Returns the list of all MCP servers, regardless of their state. This is useful for debugging and troubleshooting.
*   `connectToServer()`: Connects to an MCP server. This establishes a connection with the MCP server and allows the extension to access its tools and resources.
*   `deleteConnection()`: Deletes an MCP connection. This removes the connection from the list of available MCP servers.
*   `updateServerConnections()`: Updates the MCP server connections based on the settings file. This is called when the settings file is changed to ensure that the MCP connections are up-to-date.
*   `readResource()`: Reads a resource from an MCP server. This allows the extension to access data from the MCP server.
*   `callTool()`: Calls a tool on an MCP server. This allows the extension to execute a function on the MCP server.
*   `toggleToolAlwaysAllow()`: Toggles the always allow setting for a tool on an MCP server. This allows the user to control which tools are allowed to be executed automatically.

## MCP Settings

The MCP settings are stored in a JSON file named `mcp_settings.json`. The file contains a list of MCP servers, each with its own configuration. The configuration includes the command to run the server, the arguments to pass to the server, and the environment variables to set for the server.

## File Watching

The `McpHub` class uses `chokidar` to watch for changes in the MCP server files. When a change is detected, the `McpHub` class restarts the connection to the server. This ensures that the extension is always using the latest version of the MCP server.

## Security Considerations

It's important to be aware of the security implications of using MCP. Since MCP allows external tools and services to interact with the extension, it's important to carefully vet the MCP servers that you connect to. Only connect to MCP servers that you trust.
