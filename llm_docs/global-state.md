

# Global State

The [`src/shared/globalState.ts`](../src/shared/globalState.ts) file defines the keys that are used to store the global state of the extension. The `GLOBAL_STATE_KEYS` array contains a list of string literals, each representing a key in the global state.

# Global State Keys

This document describes the global state keys used in the Roo Code extension.

## Secret Keys

These keys are used to store sensitive information, such as API keys.

-   `apiKey`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the Anthropic API key.
-   `glamaApiKey`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the Glama API key.
-   `openRouterApiKey`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the OpenRouter API key.
-   `awsAccessKey`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the AWS Access Key.
-   `awsSecretKey`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the AWS Secret Key.
-   `awsSessionToken`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the AWS Session Token.
-   `openAiApiKey`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the OpenAI API key.
-   `geminiApiKey`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the Gemini API key.
-   `openAiNativeApiKey`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the OpenAI Native API key.
-   `deepSeekApiKey`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the DeepSeek API key.
-   `mistralApiKey`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the Mistral API key.
-   `unboundApiKey`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the Unbound API key.
-   `requestyApiKey`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the Requesty API key.

## Global State Keys

These keys are used to store various global state values. They are defined in [../src/shared/globalState.ts](../src/shared/globalState.ts).

-   `apiProvider`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the API provider.
-   `apiModelId`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the API model ID.
-   `glamaModelId`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the Glama model ID.
-   `glamaModelInfo`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the Glama model info.
-   `awsRegion`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the AWS region.
-   `awsUseCrossRegionInference`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store whether to use cross-region inference for AWS.
-   `awsProfile`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the AWS profile name.
-   `awsUseProfile`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store whether to use an AWS profile.
-   `awsCustomArn`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the AWS custom ARN.
-   `vertexKeyFile`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the Vertex key file.
-   `vertexJsonCredentials`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the Vertex JSON credentials.
-   `vertexProjectId`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the Vertex project ID.
-   `vertexRegion`: Used in [webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the Vertex region.
-   `lastShownAnnouncementId`: Used in [../src/extension.ts](../src/extension.ts) to store the last shown announcement ID.
-   `customInstructions`: Used in [../src/core/Cline.ts](../src/core/Cline.ts) to store custom instructions.
-   `alwaysAllowReadOnly`: Used in [../src/core/prompts/tools/index.ts](../src/core/prompts/tools/index.ts) to store always allow read only.
-   `alwaysAllowWrite`: Used in [../src/core/prompts/tools/index.ts](../src/core/prompts/tools/index.ts) to store always allow write.
-   `alwaysAllowExecute`: Used in [../src/core/prompts/tools/index.ts](../src/core/prompts/tools/index.ts) to store always allow execute.
-   `alwaysAllowBrowser`: Used in [../src/core/prompts/tools/index.ts](../src/core/prompts/tools/index.ts) to store always allow browser.
-   `alwaysAllowMcp`: Used in [../src/core/prompts/tools/index.ts](../src/core/prompts/tools/index.ts) to store always allow MCP.
-   `alwaysAllowModeSwitch`: Used in [../src/core/prompts/tools/index.ts](../src/core/prompts/tools/index.ts) to store always allow mode switch.
-   `alwaysAllowSubtasks`: Used in [../src/core/prompts/tools/index.ts](../src/core/prompts/tools/index.ts) to store always allow subtasks.
-   `taskHistory`: Used in [../src/core/Cline.ts](../src/core/Cline.ts) to store the task history.
-   `openAiBaseUrl`: Used in [../webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the OpenAI base URL.
-   `openAiModelId`: Used in [../webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the OpenAI model ID.
-   `openAiCustomModelInfo`: Used in [../webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the OpenAI custom model info.
-   `openAiUseAzure`: Used in [../webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store whether to use Azure for OpenAI.
-   `ollamaModelId`: Used in [../webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the Ollama model ID.
-   `ollamaBaseUrl`: Used in [../webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the Ollama base URL.
-   `lmStudioModelId`: Used in [../webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the LM Studio model ID.
-   `lmStudioBaseUrl`: Used in [../webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the LM Studio base URL.
-   `anthropicBaseUrl`: Used in [../webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the Anthropic base URL.
-   `modelMaxThinkingTokens`: Used in [../src/core/Cline.ts](../src/core/Cline.ts) to store the model max thinking tokens.
-   `azureApiVersion`: Used in [../webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the Azure API version.
-   `openAiStreamingEnabled`: Used in [../webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store whether OpenAI streaming is enabled.
-   `openRouterModelId`: Used in [../webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the OpenRouter model ID.
-   `openRouterModelInfo`: Used in [../webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the OpenRouter model info.
-   `openRouterBaseUrl`: Used in [../webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store the OpenRouter base URL.
-   `openRouterUseMiddleOutTransform`: Used in [../webview-ui/src/components/settings/ApiOptions.tsx](../webview-ui/src/components/settings/ApiOptions.tsx) to store whether to use the OpenRouter middle out transform.
-   `allowedCommands`: Used in [../src/core/prompts/tools/execute-command.ts](../src/core/prompts/tools/execute-command.ts) to store the allowed commands.
-   `soundEnabled`: Used in [../src/utils/sound.ts](../src/utils/sound.ts) to store whether sound is enabled.
-   `soundVolume`: Used in [../src/utils/sound.ts](../src/utils/sound.ts) to store the sound volume.
-   `diffEnabled`: Used in [../src/core/diff/index.ts](../src/core/diff/index.ts) to store whether diff is enabled.
-   `enableCheckpoints`: Used in [../src/services/checkpoints/index.ts](../src/services/checkpoints/index.ts) to store whether checkpoints are enabled.
-   `checkpointStorage`: Used in [../src/services/checkpoints/index.ts](../src/services/checkpoints/index.ts) to store the checkpoint storage location.
-   `browserViewportSize`: Used in [../src/services/browser/index.ts](../src/services/browser/index.ts) to store the browser viewport size.
-   `screenshotQuality`: Used in [../src/services/browser/index.ts](../src/services/browser/index.ts) to store the screenshot quality.
-   `remoteBrowserHost`: Used in [../src/services/browser/index.ts](../src/services/browser/index.ts) to store the remote browser host.

