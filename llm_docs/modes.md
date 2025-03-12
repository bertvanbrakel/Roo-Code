# Modes

The [`src/shared/modes.ts`](../src/shared/modes.ts) file defines the different modes of the extension. Each mode represents a different persona or role that the extension can adopt. The mode determines the system prompt, available tools, and other settings that are used to guide the LLM's behavior.

## Modes

The following modes are defined:

*   `code`: This mode is for general code editing and development. It provides access to a wide range of tools and is suitable for most coding tasks.
*   `architect`: This mode is for planning and designing the architecture of the codebase. It provides access to tools that are useful for analyzing and understanding the codebase.
*   `ask`: This mode is for asking questions about the codebase and getting information about software development. It provides access to tools that are useful for searching and retrieving information.
*   `debug`: This mode is for debugging the codebase. It provides access to tools that are useful for debugging, such as the debugger and the terminal.

## Mode Configuration

Each mode has the following configuration properties:

*   `slug`: A unique identifier for the mode. This is used to identify the mode in the code and in the settings.
*   `name`: The display name for the mode. This is the name that is displayed to the user in the UI.
*   `roleDefinition`: A description of the role of the mode. This is used to generate the system prompt that is sent to the LLM. The role definition should be a clear and concise description of the mode's responsibilities and capabilities.
*   `customInstructions`: Custom instructions for the mode. These instructions are appended to the role definition to further customize the behavior of the mode.
*   `groups`: The tool groups that are allowed for the mode. This property specifies which tools are available to the mode.

## Tool Groups

The `groups` property specifies the tool groups that are allowed for the mode. The tool groups are defined in the [`src/shared/tool-groups.ts`](../src/shared/tool-groups.ts) file. Tool groups are used to organize the available tools and to control which tools are available to each mode. This allows you to create specialized modes that are tailored to specific tasks.

## Adding a New Mode

To add a new mode, you need to:

1.  Define a new mode object in the `src/shared/modes.ts` file.
2.  Specify the `slug`, `name`, `roleDefinition`, `customInstructions`, and `groups` properties for the new mode.
3.  Register the new mode in the extension's settings.
