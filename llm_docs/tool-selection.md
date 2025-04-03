# Tool Selection

This document describes how the Roo Code extension determines whether a tool is required for a given user message.

The extension relies on the LLM to determine which tool is most appropriate for the current task. The extension provides the LLM with a list of available tools and a description of each tool. The LLM then uses this information to decide which tool to use, if any.

The extension uses a combination of techniques to guide the LLM's tool selection process:

- **System Prompt:** The system prompt provides the LLM with a high-level overview of the available tools and their intended use cases. This helps the LLM understand the purpose of each tool and when it should be used.
- **Tool Descriptions:** Each tool has a detailed description that explains its functionality and parameters. The LLM uses these descriptions to understand how to use the tool correctly.
- **Validation:** The extension validates the LLM's tool selection to ensure that it is allowed for the current mode and that the required parameters are provided. This helps prevent the LLM from using tools that are not appropriate for the current task or from making mistakes in the tool usage.

The tool selection process is primarily handled in the `recursivelyMakeClineRequests` function in the [`src/core/Cline.ts`](../src/core/Cline.ts) file. This function calls the `validateToolUse` function to determine if a tool is allowed for the current mode. However, the actual selection of which tool to use is determined by the LLM itself.

The `formatResponse.noToolsUsed()` function is called when the LLM doesn't use any tools. This function generates a message that prompts the LLM to either use a tool or attempt completion.

In summary, the tool selection process is a collaborative effort between the extension and the LLM. The extension provides the LLM with the necessary information and constraints, and the LLM uses this information to make the best decision about which tool to use.
