

# Webview UI Structure

The [`webview-ui/src/App.tsx`](../webview-ui/src/App.tsx) file is the main component for the webview UI. It defines the structure and layout of the UI.

## Key Components

*   `ChatView`: This component displays the chat interface, where the user can interact with the LLMs.
*   `HistoryView`: This component displays the chat history.
*   `SettingsView`: This component displays the settings for the extension.
*   `McpView`: This component displays the MCP server management interface.
*   `PromptsView`: This component displays the prompts management interface.
*   `WelcomeView`: This component displays the welcome screen.
*   `HumanRelayDialog`: This component displays a dialog for human relay, allowing the user to manually provide input for the LLMs.

## State Management

The `App` component uses the `ExtensionStateContext` to manage the state of the UI. The `ExtensionStateContext` provides access to the following state variables:

*   `didHydrateState`
*   `showWelcome`
*   `shouldShowAnnouncement`
*   `telemetrySetting`
*   `telemetryKey`
*   `machineId`

## Tab Navigation

The `App` component uses a tab-based navigation system to switch between the different views. The `tab` state variable determines which view is currently displayed. The `switchTab` function is used to switch between the different views.

## Message Handling

The `App` component uses the `useEvent` hook to listen for messages from the extension. When a message is received, the `onMessage` function is called. The `onMessage` function processes the message and updates the state of the UI accordingly.

