# Language Models (LLMs)

The Roo Code extension supports various language models (LLMs) through the API providers in the [`src/api/providers`](../src/api/providers) directory. These LLMs are used to power the extension's code generation, code completion, and other AI-powered features.

## Supported LLMs

The following LLMs are currently supported:

*   **OpenAI:** The OpenAI provider uses the OpenAI API to interact with the OpenAI models, such as GPT-3, GPT-4, and GPT-4o. OpenAI models are known for their strong performance on a wide range of tasks.
*   **Anthropic:** The Anthropic provider uses the Anthropic API to interact with the Anthropic models, such as Claude. Claude models are known for their strong reasoning and natural language capabilities.
*   **Bedrock:** The Bedrock provider uses the AWS Bedrock API to interact with various LLMs available on AWS Bedrock. This allows the extension to support a wide range of models from different providers.
*   **Gemini:** The Gemini provider uses the Google Gemini API to interact with the Gemini models. Gemini models are known for their multimodal capabilities and strong performance on various tasks.
*   **Mistral:** The Mistral provider uses the Mistral API to interact with the Mistral models. Mistral models are known for their efficiency and performance.
*   **Ollama:** The Ollama provider uses the Ollama API to interact with the Ollama models. Ollama allows you to run models locally on your computer.
*   **LM Studio:** The LM Studio provider uses the LM Studio API to interact with the LM Studio models. LM Studio allows you to run models locally on your computer.
*   **Vertex:** The Vertex provider uses the Google Vertex AI API to interact with the Vertex AI models. Vertex AI provides a platform for training and deploying machine learning models.
*   **Deepseek:** The Deepseek provider uses the Deepseek API to interact with the Deepseek models. Deepseek models are known for their strong coding capabilities.
*   **OpenRouter:** The OpenRouter provider uses the OpenRouter API to interact with various LLMs available on OpenRouter. OpenRouter provides a unified API for accessing multiple LLMs.
*   **VSCode-LM:** The VSCode-LM provider uses the VSCode Language Model API to interact with local language models. This allows the extension to leverage local language models for code completion and other tasks.
*   **Unbound:** The Unbound provider uses the Unbound API to interact with various LLMs available on Unbound.
*   **Human Relay:** The Human Relay provider allows the user to manually provide input for the LLMs. This can be useful for debugging or for tasks that require human intervention.

## API Providers

Each LLM has its own API provider in the [`src/api/providers`](../src/api/providers) directory. The API providers implement the specific API calls and data transformations required for each LLM service. The [`base-provider.ts`](../src/api/providers/base-provider.ts) file defines the base class or interface for all LLM providers.

## Adding a New LLM Provider

To add a new LLM provider, you need to:

1.  Create a new file in the `src/api/providers` directory.
2.  Implement the `BaseProvider` interface in the new file.
3.  Add the new provider to the `ApiProvider` type in the `src/shared/api.ts` file.
4.  Update the `getCompletion` function in the `src/api/index.ts` file to handle the new provider.
