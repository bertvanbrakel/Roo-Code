# API Architecture

The `api` directory defines the API for interacting with different language models (LLMs) and providers.

## Key Components

- [`index.ts`](../src/api/index.ts): This file defines the main API entry point and provides functions for accessing the different LLM providers. It also includes functions for combining multiple API requests and handling errors.
- [`providers/`](../src/api/providers/): This directory contains the implementations for the different LLM providers, such as OpenAI, Anthropic, and others. Each provider implements the `BaseProvider` interface and handles the specific API calls and data transformations required for each LLM service.
- [`providers/base-provider.ts`](../src/api/providers/base-provider.ts): This file defines the `BaseProvider` interface, which outlines the common methods that all LLM providers must implement. This ensures a consistent API for interacting with different LLMs.
- [`providers/openai.ts`](../src/api/providers/openai.ts): This file implements the OpenAI provider, which uses the OpenAI API to interact with the OpenAI models. It includes functions for making API calls, handling authentication (including Azure OpenAI), and transforming the data.
- [`transform/`](../src/api/transform/): This directory contains the code for transforming the input and output of the LLM providers. This is necessary because different LLMs may have different input and output formats. The transformations ensure that the data is in the correct format for each LLM.

## ApiProvider Type

The `ApiProvider` type is a union of string literals that represent the different LLM providers supported by the extension. It is defined as follows:

```typescript
export type ApiProvider =
	| "anthropic"
	| "glama"
	| "openrouter"
	| "bedrock" // AwsBedrockHandler
	| "vertex"
	| "openai"
	| "ollama"
	| "lmstudio"
	| "gemini"
	| "openai-native"
	| "deepseek"
	| "vscode-lm"
	| "mistral"
	| "unbound"
	| "requesty"
	| "human-relay"
```

This type is used to select the appropriate provider implementation based on the user's configuration.

## Relationships

The API components interact with each other to provide a consistent interface for accessing the different LLMs. The `index.ts` file uses the `providers/` to access the different LLMs, and the `transform/` to transform the input and output of the LLMs.

## External APIs

This area interacts with external APIs such as OpenAI, Anthropic, etc. Each provider implements the specific API calls and data transformations required for each LLM service.

## Example Usage

Here's an example of how to use the API to interact with an OpenAI model:

```typescript
import { getCompletion } from "../api";

async function generateText(prompt: string, apiConfig: ApiConfiguration) {
  try {
    const result = await getCompletion(prompt, apiConfig);
    return result.text;
  } catch (error: any) {
    console.error("Error generating text:", error);
    throw new Error(\`Failed to generate text: \${error.message}\`);
  }
}
```

This example shows how to use the `getCompletion` function to generate text from an LLM. The `apiConfig` parameter specifies the API provider and model to use.

## Error Handling

The API includes error handling to deal with issues such as API rate limits, authentication errors, and network connectivity problems. When an error occurs, the API will throw an exception with a descriptive error message. It is important to catch these exceptions and handle them appropriately.

## Data Transformations

The `transform/` directory contains code for transforming the input and output of the LLM providers. For example, the `transform/openai-format.ts` file contains code for converting Anthropic messages into the format expected by the OpenAI API.
