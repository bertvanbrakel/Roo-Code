# LLM Debugging Learnings (Roo-Code Project)

Keywords: typescript, jest, testing, mocking, vscode api, intl api, debugging, type errors, runtime errors, stream handling, anthropic sdk

## TypeScript & SDK Integration

*   **Type Mismatches:** Verify compatibility between internal types and external SDK types (e.g., `Anthropic.Messages.ContentBlock`). Check required vs. optional properties (`citations` in `TextBlock`). Explicitly set required properties (e.g., `citations: null`).
*   **Stream Handling:** Avoid direct `yield*` for SDK streams if types differ. Use `for await...of` loop with explicit casting (`as unknown as TargetType`) or mapping to handle structural differences (e.g., missing `index` property).

## Jest Testing & Mocking

*   **`instanceof` Unreliability:** Avoid `instanceof` for mocked classes. Use property checks (`'prop' in obj`) with type assertions (`obj as MockedType`) for safer type checking in tests.
*   **VSCode API Mocks:** Ensure comprehensive mocks for all used `vscode` API components (e.g., `TabInputText`, `TabInputCustom`, `TabInputNotebook`). Missing mocks cause `TypeError: Right-hand side of 'instanceof' is not an object`. Add mocks to `src/__mocks__/vscode.js`.
*   **`Intl` API Mocks:** Mock `Intl.DateTimeFormat` constructor carefully. Simulate instance behavior, override `resolvedOptions`, and mock `format` for specific options (`timeZoneName: 'shortOffset'`). Store/restore original global object (`beforeEach`/`afterEach`).
*   **Provider State Mocks:** Mock `provider.getState()` explicitly in tests. Ensure the returned mock state includes all properties accessed by the code under test (e.g., `customModePrompts`). Missing properties cause downstream errors (e.g., `TypeError: customModes?.find is not a function`).
*   **Test Logic Errors:**
    *   Avoid test setups that prevent code execution (e.g., setting `cline.abandoned = true` prematurely).
    *   Align assertions with actual output under mocked conditions (e.g., timezone calculations).
    *   Investigate upstream errors/setup issues if spies (`jest.fn()`) are not called.

## Implementation Bugs Found Via Tests

*   **Conditional Logic:** Ensure conditional logic correctly uses available properties (e.g., `ModelInfo.supportsImages` for image handling, not `acceptsImages`).
*   **Scope of Processing:** Verify processing logic applies only to the intended scope (e.g., `parseMentions` should only run on text within specific tags like `<task>`, `<feedback>`, not all text blocks).