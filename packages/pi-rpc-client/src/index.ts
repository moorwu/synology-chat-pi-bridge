export { PiRpcClient } from "./client";
export type { PiRpcOptions } from "./client";
export { JsonlFramer } from "./jsonl";
export { createLogger, refreshLogConfig } from "./logger";
export type { Logger } from "./logger";

// Command types
export type {
  RpcCommand,
  RpcCommandBase,
  PromptCommand,
  SteerCommand,
  FollowUpCommand,
  AbortCommand,
  NewSessionCommand,
  GetStateCommand,
  GetMessagesCommand,
  GetSessionStatsCommand,
  ExportHtmlCommand,
  SwitchSessionCommand,
  ForkCommand,
  CloneCommand,
  GetForkMessagesCommand,
  GetLastAssistantTextCommand,
  SetSessionNameCommand,
  SetModelCommand,
  CycleModelCommand,
  GetAvailableModelsCommand,
  SetThinkingLevelCommand,
  CycleThinkingLevelCommand,
  SetSteeringModeCommand,
  SetFollowUpModeCommand,
  CompactCommand,
  SetAutoCompactionCommand,
  SetAutoRetryCommand,
  AbortRetryCommand,
  BashCommand,
  AbortBashCommand,
  GetCommandsCommand,
  ExtensionUiResponseCommand,
} from "./types/commands";

// Event types
export type {
  PiEvent,
  AgentStartEvent,
  AgentEndEvent,
  TurnStartEvent,
  TurnEndEvent,
  MessageStartEvent,
  MessageUpdateEvent,
  MessageEndEvent,
  ToolExecutionStartEvent,
  ToolExecutionUpdateEvent,
  ToolExecutionEndEvent,
  QueueUpdateEvent,
  CompactionStartEvent,
  CompactionEndEvent,
  AutoRetryStartEvent,
  AutoRetryEndEvent,
  ExtensionErrorEvent,
} from "./types/events";

// Delta types
export type {
  AssistantMessageEvent,
  AssistantMessageStart,
  TextStart,
  TextDelta,
  TextEnd,
  ThinkingStart,
  ThinkingDelta,
  ThinkingEnd,
  ToolCallStart,
  ToolCallDelta,
  ToolCallEnd,
  Done,
  ErrorDelta,
} from "./types/deltas";

// Message types
export type {
  AgentMessage,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  BashExecutionMessage,
  ContentBlock,
  TextContent,
  ThinkingContent,
  ToolCallContent,
  ImageContent,
  Attachment,
  TokenUsage,
  StopReason,
} from "./types/messages";

// Response types
export type {
  RpcResponse,
  GetStateData,
  GetMessagesData,
  BashResponseData,
  CompactResponseData,
  ContextUsage,
  GetSessionStatsData,
  ExportHtmlData,
  ForkData,
  SessionSwitchData,
  GetForkMessagesData,
  GetLastAssistantTextData,
  GetCommandsData,
  GetAvailableModelsData,
  ModelCycleData,
} from "./types/responses";

// Extension UI types
export type {
  ToolResultContent,
  CompactionResult,
  ExtensionUiRequestEvent,
  SelectRequest,
  ConfirmRequest,
  InputRequest,
  EditorRequest,
  NotifyRequest,
  SetStatusRequest,
  SetWidgetRequest,
  SetTitleRequest,
  SetEditorTextRequest,
  ExtensionUiRequest,
} from "./types/extension-ui";

// Model types
export type { Model, ModelCost, ThinkingLevel } from "./types/model";
