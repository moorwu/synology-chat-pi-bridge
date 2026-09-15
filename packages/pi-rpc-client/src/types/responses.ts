import type { Model, ThinkingLevel } from "./model";
import type { AgentMessage, TokenUsage } from "./messages";

// === Generic Response ===
export interface RpcResponse {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  error?: string;
  data?: unknown;
}

// === Response Data Shapes ===
export interface GetStateData {
  model: Model | null;
  thinkingLevel: ThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
  steeringMode: "all" | "one-at-a-time";
  followUpMode: "all" | "one-at-a-time";
  sessionFile: string;
  sessionId: string;
  sessionName?: string;
  autoCompactionEnabled: boolean;
  messageCount: number;
  pendingMessageCount: number;
}

export interface GetMessagesData {
  messages: AgentMessage[];
}

export interface BashResponseData {
  output: string;
  exitCode: number;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
}

export interface CompactResponseData {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details: Record<string, unknown>;
}

export interface ContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface GetSessionStatsData {
  sessionFile: string;
  sessionId: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: TokenUsage;
  cost: number;
  contextUsage?: ContextUsage;
}

export interface ExportHtmlData {
  path: string;
}

export interface ForkData {
  text: string;
  cancelled: boolean;
}

export interface SessionSwitchData {
  cancelled: boolean;
}

export interface GetForkMessagesData {
  messages: { entryId: string; text: string }[];
}

export interface GetLastAssistantTextData {
  text: string | null;
}

export interface GetCommandsData {
  commands: {
    name: string;
    description?: string;
    source: "extension" | "prompt" | "skill";
    location?: "user" | "project" | "path";
    path?: string;
  }[];
}

export interface GetAvailableModelsData {
  models: Model[];
}

export interface ModelCycleData {
  model: Model;
  thinkingLevel: ThinkingLevel;
  isScoped: boolean;
}
