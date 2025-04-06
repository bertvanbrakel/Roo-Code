/**
 * Defines the structure for messages sent to and responses received from Roo via NATS control subjects.
 */

// Base interface for all NATS control messages directed *to* Roo
interface NatsCommandBase {
  type: "command" | "query"; // Differentiates actions from requests for information
  command: string; // Specific command/query name
  payload?: Record<string, any>; // Command-specific arguments/data
  correlationId?: string; // Optional ID for tracking requests and responses
}

// Base interface for responses *from* Roo to NATS commands/queries
export interface NatsCommandResponse {
  correlationId: string; // Matches the correlationId from the request
  success: boolean; // Indicates if the command execution was successful
  result?: any; // Optional result data on success
  error?: string; // Optional error message on failure
}

// --- Specific Command Interfaces ---

// Command sent on initial connection to configure Roo state
export interface NatsInitializeRooCommand extends NatsCommandBase {
  type: "command";
  command: "initialize_roo";
  payload: {
    mode_slug?: string;
    api_config_id?: string;
    system_prompt_override?: string;
    initial_user_message?: string;
    // Add other relevant configuration flags here as needed
  };
}

// Command to switch the active mode
export interface NatsSwitchModeCommand extends NatsCommandBase {
  type: "command";
  command: "switch_mode";
  payload: {
    mode_slug: string; // Required
  };
}

// Command to send a message as if from the user
export interface NatsSendUserMessageCommand extends NatsCommandBase {
  type: "command";
  command: "send_user_message";
  payload: {
    message: string; // Required
  };
}

// Command to directly run a tool (use with caution)
export interface NatsRunToolCommand extends NatsCommandBase {
  type: "command";
  command: "run_tool";
  payload: {
    tool_name: string; // Required
    tool_args: Record<string, any>; // Required
  };
}

// Command to update a specific configuration setting
export interface NatsSetConfigCommand extends NatsCommandBase {
  type: "command";
  command: "set_config";
  payload: {
    setting_key: string; // Required - Needs validation on the receiving end
    setting_value: any; // Required
  };
}

// Command (Query) to request current status
export interface NatsGetStatusCommand extends NatsCommandBase {
  type: "query"; // This is a request for information
  command: "get_status";
  payload?: {}; // No arguments needed
}

// Command to set/update a rule
export interface NatsSetRuleCommand extends NatsCommandBase {
    type: "command";
    command: "set_rule";
    payload: {
        ruleId: string; // Required
        ruleContent: string; // Required
    };
}

// Command to delete a rule
export interface NatsDeleteRuleCommand extends NatsCommandBase {
    type: "command";
    command: "delete_rule";
    payload: {
        ruleId: string; // Required
    };
}

// Command to set/update a fact
export interface NatsSetFactCommand extends NatsCommandBase {
    type: "command";
    command: "set_fact";
    payload: {
        factId: string; // Required
        factContent: string; // Required
    };
}

// Command to delete a fact
export interface NatsDeleteFactCommand extends NatsCommandBase {
    type: "command";
    command: "delete_fact";
    payload: {
        factId: string; // Required
    };
}


// --- Union Type for Dispatching ---

// Union type representing all possible valid control messages received by Roo
export type NatsControlMessage =
  | NatsInitializeRooCommand // Note: Handled specially during init
  | NatsSwitchModeCommand
  | NatsSendUserMessageCommand
  | NatsRunToolCommand
  | NatsSetConfigCommand
  | NatsGetStatusCommand
  | NatsSetRuleCommand
  | NatsDeleteRuleCommand
  | NatsSetFactCommand
  | NatsDeleteFactCommand;