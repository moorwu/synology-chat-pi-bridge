import type { ImageContent } from "./messages";
import type { ThinkingLevel } from "./model";

// === Base ===
export interface RpcCommandBase {
  id?: string;
}

// === Core ===
export interface PromptCommand extends RpcCommandBase {
  type: "prompt";
  message: string;
  images?: ImageContent[];
  streamingBehavior?: "steer" | "followUp";
}

export interface SteerCommand extends RpcCommandBase {
  type: "steer";
  message: string;
  images?: ImageContent[];
}

export interface FollowUpCommand extends RpcCommandBase {
  type: "follow_up";
  message: string;
  images?: ImageContent[];
}

export interface AbortCommand extends RpcCommandBase {
  type: "abort";
}

// === Session ===
export interface NewSessionCommand extends RpcCommandBase {
  type: "new_session";
  parentSession?: string;
}

export interface GetStateCommand extends RpcCommandBase {
  type: "get_state";
}

export interface GetMessagesCommand extends RpcCommandBase {
  type: "get_messages";
}

export interface GetSessionStatsCommand extends RpcCommandBase {
  type: "get_session_stats";
}

export interface ExportHtmlCommand extends RpcCommandBase {
  type: "export_html";
  outputPath?: string;
}

export interface SwitchSessionCommand extends RpcCommandBase {
  type: "switch_session";
  sessionPath: string;
}

export interface ForkCommand extends RpcCommandBase {
  type: "fork";
  entryId: string;
}

export interface CloneCommand extends RpcCommandBase {
  type: "clone";
}

export interface GetForkMessagesCommand extends RpcCommandBase {
  type: "get_fork_messages";
}

export interface GetLastAssistantTextCommand extends RpcCommandBase {
  type: "get_last_assistant_text";
}

export interface SetSessionNameCommand extends RpcCommandBase {
  type: "set_session_name";
  name: string;
}

// === Model ===
export interface SetModelCommand extends RpcCommandBase {
  type: "set_model";
  provider: string;
  modelId: string;
}

export interface CycleModelCommand extends RpcCommandBase {
  type: "cycle_model";
}

export interface GetAvailableModelsCommand extends RpcCommandBase {
  type: "get_available_models";
}

// === Thinking ===
export interface SetThinkingLevelCommand extends RpcCommandBase {
  type: "set_thinking_level";
  level: ThinkingLevel;
}

export interface CycleThinkingLevelCommand extends RpcCommandBase {
  type: "cycle_thinking_level";
}

// === Queue Modes ===
export interface SetSteeringModeCommand extends RpcCommandBase {
  type: "set_steering_mode";
  mode: "all" | "one-at-a-time";
}

export interface SetFollowUpModeCommand extends RpcCommandBase {
  type: "set_follow_up_mode";
  mode: "all" | "one-at-a-time";
}

// === Compaction ===
export interface CompactCommand extends RpcCommandBase {
  type: "compact";
  customInstructions?: string;
}

export interface SetAutoCompactionCommand extends RpcCommandBase {
  type: "set_auto_compaction";
  enabled: boolean;
}

// === Retry ===
export interface SetAutoRetryCommand extends RpcCommandBase {
  type: "set_auto_retry";
  enabled: boolean;
}

export interface AbortRetryCommand extends RpcCommandBase {
  type: "abort_retry";
}

// === Bash ===
export interface BashCommand extends RpcCommandBase {
  type: "bash";
  command: string;
}

export interface AbortBashCommand extends RpcCommandBase {
  type: "abort_bash";
}

// === Commands ===
export interface GetCommandsCommand extends RpcCommandBase {
  type: "get_commands";
}

// === Extension UI ===
export interface ExtensionUiResponseCommand extends RpcCommandBase {
  type: "extension_ui_response";
  id: string;
  value?: string;
  confirmed?: boolean;
  cancelled?: true;
}

// === Union ===
export type RpcCommand =
  | PromptCommand
  | SteerCommand
  | FollowUpCommand
  | AbortCommand
  | NewSessionCommand
  | GetStateCommand
  | GetMessagesCommand
  | GetSessionStatsCommand
  | ExportHtmlCommand
  | SwitchSessionCommand
  | ForkCommand
  | CloneCommand
  | GetForkMessagesCommand
  | GetLastAssistantTextCommand
  | SetSessionNameCommand
  | SetModelCommand
  | CycleModelCommand
  | GetAvailableModelsCommand
  | SetThinkingLevelCommand
  | CycleThinkingLevelCommand
  | SetSteeringModeCommand
  | SetFollowUpModeCommand
  | CompactCommand
  | SetAutoCompactionCommand
  | SetAutoRetryCommand
  | AbortRetryCommand
  | BashCommand
  | AbortBashCommand
  | GetCommandsCommand
  | ExtensionUiResponseCommand;
