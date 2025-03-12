# How VS Code Extensions Work

VS Code extensions extend the functionality of VS Code by using a combination of contribution points and VS Code APIs.

## Key Concepts

*   **Activation Events:** Events upon which your extension becomes active. See [`src/extension.ts`](../src/extension.ts) for how Roo Code uses activation events.
*   **Contribution Points:** Static declarations that you make in the `package.json` file to extend VS Code. See the [`contributes` section in `package.json`](../package.json) for how Roo Code uses contribution points.
*   **VS Code API:** A set of JavaScript APIs that you can invoke in your extension code. See [`src/extension.ts`](../src/extension.ts) for how Roo Code uses the VS Code API.

## Extension File Structure

```
.
├── .vscode
│   ├── launch.json     // Config for launching and debugging the extension
│   └── tasks.json      // Config for build task that compiles TypeScript
├── .gitignore          // Ignore build output and node_modules
├── README.md           // Readable description of your extension's functionality
├── src
│   └── extension.ts    // Extension source code
├── package.json        // Extension manifest
├── tsconfig.json       // TypeScript configuration

```

## Extension Manifest

Each VS Code extension must have a `package.json` file. The `package.json` contains a mix of Node.js fields such as `scripts` and `devDependencies` and VS Code specific fields such as `publisher`, `activationEvents` and `contributes`. Here are some most important fields:

*   `name` and `publisher`: VS Code uses `<publisher>.<name>` as a unique ID for the extension.
*   `main`: The extension entry point.
*   `activationEvents` and `contributes`: Activation Events and Contribution Points.
*   `engines.vscode`: This specifies the minimum version of VS Code API that the extension depends on.

## Extension Entry File

The extension entry file exports two functions, `activate` and `deactivate`. `activate` is executed when your registered Activation Event happens. See [`src/extension.ts`](../src/extension.ts) for Roo Code's implementation. `deactivate` gives you a chance to clean up before your extension becomes deactivated.