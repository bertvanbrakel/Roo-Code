# Cost Calculation

The [`src/utils/cost.ts`](../src/utils/cost.ts) file defines functions for calculating the cost of using the LLMs. Understanding cost calculation is crucial for managing the extension's resource consumption and providing users with transparent pricing information.

## Functions

The following functions are defined:

*   `calculateApiCostInternal(modelInfo, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens)`: Calculates the cost based on the model info, input tokens, output tokens, cache creation input tokens, and cache read input tokens. This function serves as a central point for cost calculation, taking into account various factors that influence the overall cost.
*   `calculateApiCostAnthropic(modelInfo, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens)`: Calculates the cost specifically for Anthropic compliant usage. This function applies Anthropic's pricing model to the token counts.
*   `calculateApiCostOpenAI(modelInfo, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens)`: Calculates the cost specifically for OpenAI compliant usage. This function applies OpenAI's pricing model to the token counts.
*   `parseApiPrice(price)`: Parses the API price. This function is used to extract the price from the model info.

## Cost Calculation Factors

The cost is calculated based on the following factors:

*   **Model info:** This includes the model's input price, output price, context window size, and other relevant information. The model info is used to determine the cost per token.
*   **Input tokens:** The number of tokens in the input prompt. The input tokens contribute to the overall cost based on the model's input price.
*   **Output tokens:** The number of tokens in the LLM's response. The output tokens contribute to the overall cost based on the model's output price.
*   **Cache creation input tokens:** The number of input tokens used to create the cache. Cache creation contributes to the overall cost.
*   **Cache read input tokens:** The number of input tokens used to read from the cache. Cache reads contribute to the overall cost, but typically at a lower rate than cache creation.

## Example

Here's an example of how the cost is calculated:

```typescript
const modelInfo = {
  inputPrice: 0.0001, // $0.0001 per 1000 tokens
  outputPrice: 0.0002, // $0.0002 per 1000 tokens
  contextWindow: 4096,
  supportsImages: false,
  supportsPromptCache: false,
};

const inputTokens = 1000;
const outputTokens = 500;

const cost = calculateApiCostInternal(modelInfo, inputTokens, outputTokens, 0, 0);

console.log(\`Cost: \${cost}\`); // Output: Cost: 0.0002
```

In this example, the cost is calculated as follows:

*   Input cost: 1000 tokens * $0.0001/1000 tokens = $0.0001
*   Output cost: 500 tokens * $0.0002/1000 tokens = $0.0001
*   Total cost: $0.0001 + $0.0001 = $0.0002
