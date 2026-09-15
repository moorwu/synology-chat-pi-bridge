// === Content Blocks ===
export interface TextContent {
  type: "text";
  text: string;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
}

export interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export type ContentBlock = TextContent | ThinkingContent | ToolCallContent;

// === Attachment ===
export interface Attachment {
  id: string;
  type: "image";
  fileName: string;
  mimeType: string;
  size: number;
  content: string; // base64
  extractedText: string | null;
  preview: string | null;
}

// === Token Usage ===
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total?: number;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

// === Message Types ===
export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
  attachments: Attachment[];
}

export interface AssistantMessage {
  role: "assistant";
  content: ContentBlock[];
  api: string;
  provider: string;
  model: string;
  usage: TokenUsage;
  stopReason: StopReason;
  timestamp: number;
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: TextContent[];
  isError: boolean;
  timestamp: number;
}

export interface BashExecutionMessage {
  role: "bashExecution";
  command: string;
  output: string;
  exitCode: number;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath: string | null;
  timestamp: number;
}

export type AgentMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | BashExecutionMessage;
