import type { AgentMessage, AssistantMessage, ToolResultMessage } from "./messages";
import type { AssistantMessageEvent } from "./deltas";
import type {
  ToolResultContent,
  CompactionResult,
  ExtensionUiRequestEvent,
} from "./extension-ui";

// === Agent Lifecycle ===
export interface AgentStartEvent {
  type: "agent_start";
}

export interface AgentEndEvent {
  type: "agent_end";
  messages: AgentMessage[];
}

// === Turn Lifecycle ===
export interface TurnStartEvent {
  type: "turn_start";
}

export interface TurnEndEvent {
  type: "turn_end";
  message: AssistantMessage;
  toolResults: ToolResultMessage[];
}

// === Message Lifecycle ===
export interface MessageStartEvent {
  type: "message_start";
  message: AgentMessage;
}

export interface MessageUpdateEvent {
  type: "message_update";
  message: AgentMessage;
  assistantMessageEvent: AssistantMessageEvent;
}

export interface MessageEndEvent {
  type: "message_end";
  message: AgentMessage;
}

// === Tool Execution ===
export interface ToolExecutionStartEvent {
  type: "tool_execution_start";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolExecutionUpdateEvent {
  type: "tool_execution_update";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  partialResult: ToolResultContent;
}

export interface ToolExecutionEndEvent {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  result: ToolResultContent;
  isError: boolean;
}

// === Queue ===
export interface QueueUpdateEvent {
  type: "queue_update";
  steering: string[];
  followUp: string[];
}

// === Compaction ===
export interface CompactionStartEvent {
  type: "compaction_start";
  reason: "manual" | "threshold" | "overflow";
}

export interface CompactionEndEvent {
  type: "compaction_end";
  reason: "manual" | "threshold" | "overflow";
  result: CompactionResult | null;
  aborted: boolean;
  willRetry: boolean;
  errorMessage?: string;
}

// === Auto Retry ===
export interface AutoRetryStartEvent {
  type: "auto_retry_start";
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorMessage: string;
}

export interface AutoRetryEndEvent {
  type: "auto_retry_end";
  success: boolean;
  attempt: number;
  finalError?: string;
}

// === Extension Error ===
export interface ExtensionErrorEvent {
  type: "extension_error";
  extensionPath: string;
  event: string;
  error: string;
}

// === Union ===
export type PiEvent =
  | AgentStartEvent
  | AgentEndEvent
  | TurnStartEvent
  | TurnEndEvent
  | MessageStartEvent
  | MessageUpdateEvent
  | MessageEndEvent
  | ToolExecutionStartEvent
  | ToolExecutionUpdateEvent
  | ToolExecutionEndEvent
  | QueueUpdateEvent
  | CompactionStartEvent
  | CompactionEndEvent
  | AutoRetryStartEvent
  | AutoRetryEndEvent
  | ExtensionErrorEvent
  | ExtensionUiRequestEvent;
