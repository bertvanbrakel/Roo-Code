export type SecretKey =
	| "apiKey"
	| "glamaApiKey"
	| "openRouterApiKey"
	| "awsAccessKey"
	| "awsSecretKey"
	| "awsSessionToken"
	| "openAiApiKey"
	| "geminiApiKey"
	| "openAiNativeApiKey"
	| "deepSeekApiKey"
	| "mistralApiKey"
	| "unboundApiKey"
	| "requestyApiKey"

export const SECRET_KEYS: SecretKey[] = [
	"apiKey",
	"glamaApiKey",
	"openRouterApiKey",
	"awsAccessKey",
	"awsSecretKey",
	"awsSessionToken",
	"openAiApiKey",
	"geminiApiKey",
	"openAiNativeApiKey",
	"deepSeekApiKey",
	"mistralApiKey",
	"unboundApiKey",
	"requestyApiKey",
]

export type GlobalStateKey =
	| "apiProvider"
	| "apiModelId"
	| "glamaModelId"
	| "glamaModelInfo"
	| "awsRegion"
	| "awsUseCrossRegionInference"
	| "awsProfile"
	| "awsUseProfile"
	| "vertexProjectId"
	| "vertexRegion"
	| "lastShownAnnouncementId"
	| "customInstructions"
	| "alwaysAllowReadOnly"
	| "alwaysAllowWrite"
	| "alwaysAllowExecute"
	| "alwaysAllowBrowser"
	| "alwaysAllowMcp"
	| "alwaysAllowModeSwitch"
	| "taskHistory"
	| "openAiBaseUrl"
	| "openAiModelId"
	| "openAiCustomModelInfo"
	| "openAiUseAzure"
	| "ollamaModelId"
	| "ollamaBaseUrl"
	| "lmStudioModelId"
	| "lmStudioBaseUrl"
	| "lmStudioDraftModelId"
	| "lmStudioSpeculativeDecodingEnabled"
	| "anthropicBaseUrl"
	| "azureApiVersion"
	| "openAiStreamingEnabled"
	| "openRouterModelId"
	| "openRouterModelInfo"
	| "openRouterBaseUrl"
	| "openRouterUseMiddleOutTransform"
	| "allowedCommands"
	| "soundEnabled"
	| "soundVolume"
	| "diffEnabled"
	| "enableCheckpoints"
	| "checkpointStorage"
	| "browserViewportSize"
	| "screenshotQuality"
	| "fuzzyMatchThreshold"
	| "preferredLanguage" // Language setting for Cline's communication
	| "writeDelayMs"
	| "terminalOutputLineLimit"
	| "mcpEnabled"
	| "enableMcpServerCreation"
	| "alwaysApproveResubmit"
	| "requestDelaySeconds"
	| "rateLimitSeconds"
	| "currentApiConfigName"
	| "listApiConfigMeta"
	| "vsCodeLmModelSelector"
	| "mode"
	| "modeApiConfigs"
	| "customModePrompts"
	| "customSupportPrompts"
	| "enhancementApiConfigId"
	| "experiments" // Map of experiment IDs to their enabled state
	| "autoApprovalEnabled"
	| "customModes" // Array of custom modes
	| "unboundModelId"
	| "requestyModelId"
	| "requestyModelInfo"
	| "unboundModelInfo"
	| "modelTemperature"
	| "modelMaxTokens"
	| "modelMaxThinkingTokens"
	| "mistralCodestralUrl"
	| "maxOpenTabsContext"
	| "browserToolEnabled"
	| "lmStudioSpeculativeDecodingEnabled"
	| "lmStudioDraftModelId"

export const GLOBAL_STATE_KEYS: GlobalStateKey[] = [
	"apiProvider",
	"apiModelId",
	"glamaModelId",
	"glamaModelInfo",
	"awsRegion",
	"awsUseCrossRegionInference",
	"awsProfile",
	"awsUseProfile",
	"vertexProjectId",
	"vertexRegion",
	"lastShownAnnouncementId",
	"customInstructions",
	"alwaysAllowReadOnly",
	"alwaysAllowWrite",
	"alwaysAllowExecute",
	"alwaysAllowBrowser",
	"alwaysAllowMcp",
	"alwaysAllowModeSwitch",
	"taskHistory",
	"openAiBaseUrl",
	"openAiModelId",
	"openAiCustomModelInfo",
	"openAiUseAzure",
	"ollamaModelId",
	"ollamaBaseUrl",
	"lmStudioModelId",
	"lmStudioBaseUrl",
	"anthropicBaseUrl",
	"modelMaxThinkingTokens",
	"azureApiVersion",
	"openAiStreamingEnabled",
	"openRouterModelId",
	"openRouterModelInfo",
	"openRouterBaseUrl",
	"openRouterUseMiddleOutTransform",
	"allowedCommands",
	"soundEnabled",
	"soundVolume",
	"diffEnabled",
	"enableCheckpoints",
	"browserViewportSize",
	"screenshotQuality",
	"fuzzyMatchThreshold",
	"preferredLanguage", // Language setting for Cline's communication
	"writeDelayMs",
	"terminalOutputLineLimit",
	"mcpEnabled",
	"enableMcpServerCreation",
	"alwaysApproveResubmit",
	"requestDelaySeconds",
	"rateLimitSeconds",
	"currentApiConfigName",
	"listApiConfigMeta",
	"vsCodeLmModelSelector",
	"mode",
	"modeApiConfigs",
	"customModePrompts",
	"customSupportPrompts",
	"enhancementApiConfigId",
	"experiments", // Map of experiment IDs to their enabled state
	"autoApprovalEnabled",
	"customModes", // Array of custom modes
	"unboundModelId",
	"requestyModelId",
	"requestyModelInfo",
	"unboundModelInfo",
	"modelTemperature",
	"modelMaxTokens",
	"mistralCodestralUrl",
	"maxOpenTabsContext",
	"browserToolEnabled",
	"lmStudioSpeculativeDecodingEnabled",
	"lmStudioDraftModelId",
]
