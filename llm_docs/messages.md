# Extension Messages

The [`src/shared/ExtensionMessage.ts`](../src/shared/ExtensionMessage.ts) file defines the messages that are sent between the extension and the webview. These messages are used to communicate information and events between the two parts of the extension. The `ExtensionMessage` interface has a `type` property that indicates the type of message.

## Message Types

The following message types are defined:

*   `action`: Indicates an action that should be performed in the webview. This message type is used to trigger actions in the webview, such as opening a settings page or displaying a dialog.
*   `state`: Indicates the state of the extension. This message type is used to send the current state of the extension to the webview.
*   `selectedImages`: Indicates the selected images. This message type is used to send the selected images to the extension.
*   `ollamaModels`: Indicates the available Ollama models. This message type is used to send the list of available Ollama models to the webview.
*   `lmStudioModels`: Indicates the available LM Studio models. This message type is used to send the list of available LM Studio models to the webview.
*   `theme`: Indicates the current theme. This message type is used to send the current theme to the webview.
*   `workspaceUpdated`: Indicates that the workspace has been updated. This message type is used to notify the webview that the workspace has been updated.
*   `invoke`: Indicates that a function should be invoked in the webview. This message type is used to call a function in the webview from the extension.
*   `partialMessage`: Indicates a partial message. This message type is used to send a partial message to the webview.
*   `openRouterModels`: Indicates the available OpenRouter models. This message type is used to send the list of available OpenRouter models to the webview.
*   `glamaModels`: Indicates the available Glama models. This message type is used to send the list of available Glama models to the webview.
*   `unboundModels`: Indicates the available Unbound models. This message type is used to send the list of available Unbound models to the webview.
*   `requestyModels`: Indicates the available Requesty models. This message type is used to send the list of available Requesty models to the webview.
*   `openAiModels`: Indicates the available OpenAI models. This message type is used to send the list of available OpenAI models to the webview.
*   `mcpServers`: Indicates the available MCP servers. This message type is used to send the list of available MCP servers to the webview.
*   `enhancedPrompt`: Indicates an enhanced prompt. This message type is used to send an enhanced prompt to the webview.
*   `commitSearchResults`: Indicates the commit search results. This message type is used to send the commit search results to the webview.
*   `listApiConfig`: Indicates the list of API configurations. This message type is used to send the list of API configurations to the webview.
*   `vsCodeLmModels`: Indicates the available VSCode Language Model models. This message type is used to send the list of available VSCode Language Model models to the webview.
*   `vsCodeLmApiAvailable`: Indicates whether the VSCode Language Model API is available. This message type is used to notify the webview whether the VSCode Language Model API is available.
*   `requestVsCodeLmModels`: Indicates a request for VSCode Language Model models. This message type is used to request the list of available VSCode Language Model models from the extension.
*   `updatePrompt`: Indicates an update to a prompt. This message type is used to send an updated prompt to the webview.
*   `systemPrompt`: Indicates the system prompt. This message type is used to send the system prompt to the webview.
*   `autoApprovalEnabled`: Indicates whether auto approval is enabled. This message type is used to send the auto approval setting to the webview.
*   `updateCustomMode`: Indicates an update to a custom mode. This message type is used to send an updated custom mode to the webview.
*   `deleteCustomMode`: Indicates a deletion of a custom mode. This message type is used to notify the webview that a custom mode has been deleted.
*   `currentCheckpointUpdated`: Indicates an update to the current checkpoint. This message type is used to send an update to the current checkpoint to the webview.
*   `showHumanRelayDialog`: Indicates that a human relay dialog should be shown. This message type is used to request the webview to show a human relay dialog.
*   `humanRelayResponse`: Indicates a response from the human relay dialog. This message type is used to send a response from the human relay dialog to the extension.
*   `humanRelayCancel`: Indicates that the human relay dialog has been cancelled. This message type is used to notify the extension that the human relay dialog has been cancelled.
*   `browserToolEnabled`: Indicates whether the browser tool is enabled. This message type is used to send the browser tool setting to the webview.
*   `browserConnectionResult`: Indicates the result of a browser connection. This message type is used to send the result of a browser connection to the webview.
*   `remoteBrowserEnabled`: Indicates whether the remote browser is enabled. This message type is used to send the remote browser setting to the webview.
