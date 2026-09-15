import type { AssistantMessage, ToolCallContent } from "./messages";

// === Streaming Delta Event Types ===
export type AssistantMessageEvent =
  | AssistantMessageStart
  | TextStart
  | TextDelta
  | TextEnd
  | ThinkingStart
  | ThinkingDelta
  | ThinkingEnd
  | ToolCallStart
  | ToolCallDelta
  | ToolCallEnd
  | Done
  | ErrorDelta;

export interface AssistantMessageStart {
  type: "start";
  partial: Partial<AssistantMessage>;
}

export interface TextStart {
  type: "text_start";
  contentIndex: number;
  partial: Partial<AssistantMessage>;
}

export interface TextDelta {
  type: "text_delta";
  contentIndex: number;
  delta: string;
  partial: Partial<AssistantMessage>;
}

export interface TextEnd {
  type: "text_end";
  contentIndex: number;
  content: string;
  partial: Partial<AssistantMessage>;
}

export interface ThinkingStart {
  type: "thinking_start";
  contentIndex: number;
  partial: Partial<AssistantMessage>;
}

export interface ThinkingDelta {
  type: "thinking_delta";
  contentIndex: number;
  delta: string;
  partial: Partial<AssistantMessage>;
}

export interface ThinkingEnd {
  type: "thinking_end";
  contentIndex: number;
  thinking: string;
  partial: Partial<AssistantMessage>;
}

export interface ToolCallStart {
  type: "toolcall_start";
  contentIndex: number;
  partial: Partial<AssistantMessage>;
}

export interface ToolCallDelta {
  type: "toolcall_delta";
  contentIndex: number;
  delta: string;
  partial: Partial<AssistantMessage>;
}

export interface ToolCallEnd {
  type: "toolcall_end";
  contentIndex: number;
  toolCall: ToolCallContent;
  partial: Partial<AssistantMessage>;
}

export interface Done {
  type: "done";
  reason: "stop" | "length" | "toolUse";
}

export interface ErrorDelta {
  type: "error";
  reason: "aborted" | "error";
}
