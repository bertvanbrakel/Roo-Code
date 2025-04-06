# NATS Integration Plan for Roo Code

**Status:** Design Phase - Complete

This document outlines the plan for integrating NATS.io messaging into the Roo Code VS Code extension for remote monitoring, control, and inter-instance communication.

## 1. Goals & Requirements (Defined)

*   **Monitoring:** Capture and publish key events from a Roo instance to NATS subjects for external observation (user input, LLM interactions, tool usage, commands, status, logs).
*   **Control:** Allow external systems to send commands (e.g., switch mode, run tool, send message), update rules, and inject facts via NATS subjects, including initial setup commands on startup. Provide mechanisms to manage potential conflicts with local user actions.
*   **Inter-Instance Communication:** Establish the foundation for future Roo-to-Roo communication patterns.
*   **Resilience:** NATS integration should be optional and robust. Failure in NATS connectivity or operations should not prevent Roo Code from functioning normally for the local user.
*   **Ease of Setup (Optional):** Provide an option to automatically start a local NATS server using Docker for simplified setup.

## 2. NATS Subject Structure (Defined)

A hierarchical structure `roo.{instanceId}.{type}.{subtype}` will be used. Payloads conform to interfaces defined in `src/shared/natsCommands.ts`. Event payloads may include `natsCorrelationId` if triggered by a correlated NATS command.

**Publishing (Events from Roo):**

*   `roo.{instanceId}.events.startup`: `{ timestamp, ide, hostname, cwd, gitRepo?, gitBranch?, instanceId }` - Published once on successful NATS connection.
*   `roo.{instanceId}.events.user_message`: `{ timestamp, message, taskId, natsCorrelationId? }`
*   `roo.{instanceId}.events.llm_request`: `{ timestamp, provider, mode, requestPayload, taskId, natsCorrelationId? }`
*   `roo.{instanceId}.events.llm_response`: `{ timestamp, provider, mode, responsePayload, taskId, natsCorrelationId? }`
*   `roo.{instanceId}.events.tool_call`: `{ timestamp, toolName, arguments, taskId, natsCorrelationId? }`
*   `roo.{instanceId}.events.tool_result`: `{ timestamp, toolName, success, result, error?, taskId, natsCorrelationId? }`
*   `roo.{instanceId}.events.command_execution`: `{ timestamp, command, workingDir?, taskId?, natsCorrelationId? }` (For `execute_command` tool)
*   `roo.{instanceId}.events.command_result`: `{ timestamp, command, exitCode, output, error?, taskId?, natsCorrelationId? }` (For `execute_command` tool)
*   `roo.{instanceId}.events.mode_switch`: `{ timestamp, oldMode, newMode, taskId, natsCorrelationId? }`
*   `roo.{instanceId}.events.status_update`: `{ timestamp, status, currentTask?, mode, taskId?, natsCorrelationId?, finalMessage?, error? }` (Used for general status and task completion signal)
*   `roo.{instanceId}.events.log`: `{ timestamp, level, message }`
*   `roo.{instanceId}.control.command_response`: Payload conforms to `NatsCommandResponse`. (Optional immediate response to incoming commands)

**Subscribing (Commands to Roo):**

*   `roo.{instanceId}.control.initial_command`: Payload conforms to `NatsInitializeRooCommand`. Temporary subscription on startup.
*   `roo.{instanceId}.control.command`: Payload conforms to a command/query interface in `NatsControlMessage` union type (e.g., `NatsSwitchModeCommand`, `NatsGetStatusCommand`). For ongoing control. (No explicit lock commands needed).
*   `roo.{instanceId}.control.set_rule`: Payload conforms to `NatsSetRuleCommand`.
*   `roo.{instanceId}.control.delete_rule`: Payload conforms to `NatsDeleteRuleCommand`.
*   `roo.{instanceId}.control.set_fact`: Payload conforms to `NatsSetFactCommand`.
*   `roo.{instanceId}.control.delete_fact`: Payload conforms to `NatsDeleteFactCommand`.

## 3. `instanceId` Strategy (Defined - v3)

The `instanceId` uniquely identifies a Roo instance for a specific project on a specific machine and persists across restarts.

*   **Determination Priority:**
    1.  `ROO_INSTANCE_ID` env var (used directly).
    2.  `ROO_MACHINE_ID` + `ROO_PROJECT_ID` env vars (combined).
    3.  File-based `machineId` (`<GlobalStorage>/roo/machine.id`) + File-based `projectId` (`<process.cwd()>/.roo/instance.id`).
        *   Files are read if they exist.
        *   If a file doesn't exist, a UUID (`uuidv4`) is generated and written to the file.
        *   File operations use `vscode.workspace.fs`.
    4.  Combination: If not set directly, combine machineId and projectId as `{machineId}-{projectId}`.
    5.  Failure: If ID cannot be established, NATS is disabled.
*   **Persistence:** IDs are stored in files as described. `.roo/` should be added to `.gitignore` (see Section 9).
*   **`taskId`:** The `taskId` from `Cline` must be included in relevant event payloads for correlation.

## 4. Incoming Control Command Handling (Defined - v2 CQRS)

*   **Payloads:** Adhere to specific TypeScript interfaces (e.g., `NatsSwitchModeCommand`) defined in `src/shared/natsCommands.ts`, using a union type `NatsControlMessage`. Include optional `correlationId`.
*   **`InitializeRoo` Command:** Defined interface `NatsInitializeRooCommand`. Processed during activation via `NatsService.initialize()`. Calls `Cline.applyInitialConfiguration(payload)`.
*   **Regular Commands (`control.command` subject):**
    *   **Mechanism (Defined - EventEmitter):**
        1.  `NatsService` receives, parses, validates against known `NatsControlMessage` interfaces.
        2.  Fires internal `vscode.EventEmitter<NatsControlMessage>` with the strongly-typed command object.
        3.  `Cline` handler (`handleNatsCommand(payload: NatsControlMessage)`) uses type guards based on `payload.command`. Stores `correlationId` mapped to `taskId` if present and applicable.
        4.  Accesses arguments via `payload.payload.*` (type-safe).
        5.  Executes corresponding internal `Cline` logic (see Section 8 for synchronization).
        6.  Sends typed `NatsCommandResponse` if `correlationId` was present (for immediate acknowledgement).

## 5. Error Handling & Resilience Strategy (Defined - Initial)

*   **Goal:** Isolate NATS operations; failures must be logged but never crash or block core Roo functionality.
*   **Initialization:** Handle failures establishing `instanceId` or connecting to NATS (log error, set `natsDisabled = true`). Handle Docker auto-start failures gracefully.
*   **Connection Management:** Leverage `nats.js` reconnection. Listen for NATS client events (`disconnect`, `reconnecting`, `reconnect`, `error`), log, update state, handle fatal errors.
*   **Publishing:** Check flags, wrap `publish()` in `try...catch`, log errors, don't throw.
*   **Subscription Handling:** Wrap parsing and internal dispatching (`EventEmitter.fire`) in `try...catch`, log errors.
*   **Command Execution (in `Cline`/Handler):** Wrap execution in `try...catch`, log errors, publish failure `NatsCommandResponse` if correlated.
*   **Configuration:** Consider exposing NATS client settings (reconnect time, attempts).

## 6. Security Model (Defined - v2)

*   **Authentication (Client -> Server):**
    *   **Priority Order:**
        1.  Credentials File (`.creds`) via `roo.nats.credentialsFile` setting.
        2.  Auth Token via `roo.nats.authToken` setting OR `NATS_TOKEN` env var.
        3.  NKey Seed via `NATS_NKEY` env var.
        4.  User JWT via `NATS_JWT` env var.
        5.  Username/Password via `roo.nats.authUser`/`authPassword` settings OR `NATS_USER`/`NATS_PW` env vars.
        6.  Anonymous connection.
    *   `NatsService` checks settings/env vars in order and configures `nats.connect()` options (`authenticator`, `token`, `nkey`, `user`, `pass`).
    *   Authentication errors during connection are logged, NATS disabled for the session.
*   **Authorization (Permissions):**
    *   Configured on the NATS server based on the authenticated user/account.
    *   Roo relies on the server to enforce publish/subscribe permissions on `roo.{instanceId}.*` subjects.
    *   Permission errors from the NATS client (on publish/subscribe) are logged. Fatal permission errors may disable NATS for the session.
*   **Control Command Security:**
    *   Primary defense: NATS server authorization rules for `PUBLISH` on `roo.{instanceId}.control.*`.
    *   Secondary defense: Rigorous input validation of command name and arguments within the `Cline` command handler.

## 7. Long-Running Task Feedback (Defined - Correlation ID)

*   **Goal:** Allow external systems to track progress and completion of tasks initiated via NATS commands.
*   **Mechanism:**
    1.  `Cline` stores a mapping `Map<taskId, correlationId>` when a correlated command starts a task.
    2.  Before publishing task-related events (those with `taskId`), look up the `correlationId`.
    3.  If found, add `natsCorrelationId: correlationId` to the event payload.
    4.  When a task completes, publish a final `status_update` event including `taskId`, `status: 'completed' | 'failed'`, and the `natsCorrelationId`.
    5.  Remove the entry from the map after publishing the final status.
    6.  External systems filter the `roo.{instanceId}.events.*` stream using `natsCorrelationId`.

## 8. State Synchronization (Defined - v3 Implicit UI Locking)

*   **Goal:** Manage conflicts between local UI actions and remote NATS commands modifying the same state.
*   **Principle:** Use implicit, short-lived UI locks during NATS command processing. "Last write wins" applies if actions are interleaved between commands. Ensure atomicity of individual changes.
*   **Mechanism:**
    1.  When `Cline.handleNatsCommand` receives a state-modifying NATS command:
    2.  Determine affected UI component(s).
    3.  Send `ExtensionMessage` to UI to *disable* component(s) (provide visual feedback). Set internal lock flag.
    4.  Execute the state change logic in `Cline`.
    5.  Send `ExtensionMessage` to UI to update its state display.
    6.  Send `ExtensionMessage` to UI to *re-enable* component(s). Clear internal lock flag.
    7.  Send `NatsCommandResponse` if correlated.
*   **Conflict Handling:**
    *   **UI Action:** If user tries to change state via UI, `Cline` checks internal implicit lock flag. If locked, reject UI action. If unlocked, proceed.
    *   **NATS Action:** Applies the change ("last write wins") and publishes events.
*   **UI:** Needs to handle disable/enable/update messages from `Cline`.
*   **TODO:** Consider lock timeouts or manual override mechanism for stale implicit locks (Low priority - locks should be very short-lived).

## 9. Automatic `.gitignore` Update (Defined - v2)

*   **Goal:** Prevent committing the project-specific `.roo/instance.id` file.
*   **Trigger:** Runs *only* when `.roo/instance.id` is first created in `NatsService.getProjectIdComponent()`.
*   **Logic:**
    1.  Read `.gitignore` at `process.cwd()`.
    2.  If exists and `'.roo/'` entry is missing, append `\n.roo/\n` and write back.
    3.  If not exists, create `.gitignore` with `.roo/\n`.
    4.  Use `vscode.workspace.fs` for file operations.
*   **Error Handling:** Wrap fs ops in `try...catch`. Log warnings on failure (e.g., permissions), do not block NATS init.
*   **Notification:** Show one-time info message on successful update.

## 10. Optional: Docker-based NATS Server Auto-Start (Defined)

*   **Goal:** Simplify setup for local use cases.
*   **Setting:** `roo.nats.autoStartLocalServer` (boolean, default: false). Requires Docker installed and running.
*   **Mechanism (`NatsService.initialize`):**
    1.  If setting is true and `serverUrl` is localhost.
    2.  Attempt quick connection test.
    3.  If fails: Check Docker status (`docker info`). If Docker ok, execute `docker run --rm -d -p 4222:4222 --name roo-nats-server nats:latest`. Handle errors. Wait briefly.
    4.  Proceed with regular connection attempt.
*   **Shutdown (`NatsService.shutdown`):** If auto-started, attempt `docker stop roo-nats-server`.

## 11. High-Level Implementation Steps (Defined)

1.  **Dependencies:** Add `nats.js`, `uuid`.
2.  **Configuration:** Add/Update settings (`roo.nats.enabled`, `serverUrl`, `credentialsFile`, `authToken`, `authUser`, `authPassword`, `instanceIdPrefix`, `initialCommandTimeoutMs`, `autoStartLocalServer`). Update `settings.md`. Mark password as sensitive.
3.  **Shared Types:** Create `src/shared/natsCommands.ts` (incl. `InitializeRoo`) and update `src/shared/ExtensionMessage.ts` (for UI disable/enable).
4.  **`NatsService.ts`:** Implement singleton, `instanceId` (incl. `.gitignore` logic), connection (with updated auth logic, optional Docker start), init, publish, subscribe/dispatch, shutdown.
5.  **Integration Points:**
    *   `src/extension.ts`: Initialize/shutdown `NatsService`, handle `InitializeRoo`.
    *   `src/core/Cline.ts`: Add `applyInitialConfiguration`, `handleNatsCommand` dispatcher (incl. correlation map, implicit UI locking logic), integrate publishing (incl. `natsCorrelationId`), manage internal lock state, communicate lock state to UI.
    *   `webview-ui`: Handle disable/enable/update messages.
    *   API Providers, Tools, Logging: Add publishing calls.
6.  **Documentation:** Create/update `nats.md`, `overview.md`, etc.
7.  **Context Tracking:** Use `context.llm.md`.

## 12. Implementation Tasks & Status

*   [X] Define Goals & Requirements
*   [X] Define NATS Subject Structure
*   [X] Define `instanceId` Strategy (v3)
*   [X] Define Incoming Control Command Handling (v2 CQRS, EventEmitter)
*   [X] Define Error Handling & Resilience Strategy (Initial)
*   [X] Define Security Model (v2 - Added Token/UserPass Auth)
*   [X] Define Long-Running Task Feedback (Correlation ID)
*   [X] Define State Synchronization (v3 Implicit UI Locking)
*   [X] Define Automatic `.gitignore` Update (v2)
*   [X] Define Optional Docker Auto-Start
*   [X] Define High-Level Implementation Steps
*   [ ] **Implement:** Dependencies & Configuration (Step 1 & 2)
*   [ ] **Implement:** Shared NATS Command & ExtensionMessage Types (Step 3)
*   [ ] **Implement:** `NatsService.ts` Core Structure & `instanceId` (Step 4a, 4b)
*   [ ] **Implement:** `NatsService.ts` Connection & Error Handling (Step 4c, 4h)
*   [ ] **Implement:** `NatsService.ts` Initialization & Startup Event (incl. Docker start) (Step 4d)
*   [ ] **Implement:** `NatsService.ts` Publishing Logic (Step 4e)
*   [ ] **Implement:** `NatsService.ts` Subscription & Command Dispatch (Step 4f)
*   [ ] **Implement:** `NatsService.ts` Shutdown (incl. Docker stop) (Step 4g)
*   [ ] **Implement:** Integration Point - `extension.ts` (Step 5a)
*   [ ] **Implement:** Integration Point - `Cline.ts` (Publishing & Command/Lock Handling) (Step 5b)
*   [ ] **Implement:** Integration Point - `webview-ui` (Locking UI) (Step 5c)
*   [ ] **Implement:** Integration Point - API Providers, Tools, Logging (Step 5d)
*   [ ] **Implement:** Documentation (Step 6)
*   [ ] **Implement:** Context Tracking (Step 7)