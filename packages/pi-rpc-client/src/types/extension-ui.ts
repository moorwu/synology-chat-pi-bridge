import type { AgentMessage, TextContent } from "./messages";

// === Tool Result Content (for tool execution events) ===
export interface ToolResultContent {
  content: TextContent[];
  details: {
    truncation?: unknown;
    fullOutputPath?: string | null;
    [key: string]: unknown;
  };
}

// === Extension UI Request Types ===
export interface SelectRequest {
  method: "select";
  title: string;
  options: string[];
  timeout?: number;
}

export interface ConfirmRequest {
  method: "confirm";
  title: string;
  message: string;
  timeout?: number;
}

export interface InputRequest {
  method: "input";
  title: string;
  placeholder?: string;
}

export interface EditorRequest {
  method: "editor";
  title: string;
  prefill?: string;
}

export interface NotifyRequest {
  method: "notify";
  message: string;
  notifyType?: "info" | "warning" | "error";
}

export interface SetStatusRequest {
  method: "setStatus";
  statusKey: string;
  statusText?: string;
}

export interface SetWidgetRequest {
  method: "setWidget";
  widgetKey: string;
  widgetLines?: string[];
  widgetPlacement?: "aboveEditor" | "belowEditor";
}

export interface SetTitleRequest {
  method: "setTitle";
  title: string;
}

export interface SetEditorTextRequest {
  method: "set_editor_text";
  text: string;
}

export interface AskUserQuestionRequest {
  method: "ask_user_question";
  id: string;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{
      label: string;
      description: string;
      preview?: string;
    }>;
    multiSelect?: boolean;
  }>;
  timeout?: number;
}

export type ExtensionUiRequest =
  | SelectRequest
  | ConfirmRequest
  | InputRequest
  | EditorRequest
  | AskUserQuestionRequest
  | NotifyRequest
  | SetStatusRequest
  | SetWidgetRequest
  | SetTitleRequest
  | SetEditorTextRequest;

// === Extension UI Request Event ===
export interface ExtensionUiRequestEvent {
  type: "extension_ui_request";
  id: string;
  method: string;
  // Merged with specific request fields at runtime
  title?: string;
  options?: string[];
  message?: string;
  timeout?: number;
  placeholder?: string;
  prefill?: string;
  notifyType?: "info" | "warning" | "error";
  statusKey?: string;
  statusText?: string;
  widgetKey?: string;
  widgetLines?: string[];
  widgetPlacement?: "aboveEditor" | "belowEditor";
  text?: string;
  /** ask_user_question fields */
  questions?: Array<{
    question: string;
    header: string;
    options: Array<{
      label: string;
      description: string;
      preview?: string;
    }>;
    multiSelect?: boolean;
  }>;
}

// === Compaction Result ===
export interface CompactionResult {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details: Record<string, unknown>;
}
