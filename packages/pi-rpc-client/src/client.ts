import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { JsonlFramer } from "./jsonl";
import type { RpcCommand } from "./types/commands";
import type { PiEvent } from "./types/events";
import type { RpcResponse } from "./types/responses";
import type { ThinkingLevel } from "./types/model";
import type { ImageContent } from "./types/messages";
import { createLogger, type Logger } from "./logger";

export interface PiRpcOptions {
  /** Pi binary path (default: "pi") */
  piPath?: string;
  /** Working directory for pi process */
  cwd: string;
  /** Session directory for pi */
  sessionDir: string;
  /** Provider */
  provider?: string;
  /** Model pattern or ID */
  model?: string;
  /** Thinking level */
  thinkingLevel?: ThinkingLevel;
  /** Additional CLI args passed to pi */
  extraArgs?: string[];
  /** Specific session file to resume (omit for new session) */
  sessionFile?: string;
  /** Custom system prompt (replaces pi's default) */
  systemPrompt?: string;
  /** Text to append to the default system prompt */
  appendSystemPrompt?: string;
  /** Environment variables for the pi process.
   * Defaults to a minimal set (PATH, HOME, USER, TERM, SHELL, LANG)
   * plus any env vars matching PI_*, OPENAI_*, ANTHROPIC_*, etc.
   * Pass `{ ...process.env }` for the old full-inheritance behavior. */
  env?: Record<string, string>;
}

/** Essential env vars to pass through to pi, plus common API key patterns. */
function buildPiEnv(): Record<string, string> {
  const keepPrefixes = [
    // Essentials
    "PATH=", "HOME=", "USER=", "LOGNAME=",
    "TERM=", "SHELL=", "LANG=", "LC_",
    "TZ=", "COLORTERM=",
    // SSH
    "SSH_AUTH_SOCK=", "SSH_AGENT_PID=",
    // Git
    "GIT_",
    // Editor
    "EDITOR=", "VISUAL=",
    // OS / XDG
    "XDG_", "DBUS_", "WAYLAND_", "DISPLAY=",
    // Common API keys (pi needs these to call providers)
    "OPENAI_API_KEY=", "ANTHROPIC_API_KEY=",
    "GOOGLE_API_KEY=", "GOOGLE_GENAI_API_KEY=",
    "DEEPSEEK_API_KEY=", "OPENCODE_API_KEY=",
    "GROQ_API_KEY=", "MISTRAL_API_KEY=",
    "COHERE_API_KEY=", "TOGETHER_API_KEY=",
    "FIREWORKS_API_KEY=", "VERTEX_AI_",
    "AZURE_OPENAI_", "BEDROCK_",
    // Provider config env vars (provider-specific)
    "OPENAIR_MAX_TOKENS=", "OPENAI_ORG_ID=",
    // Bun / Node
    "NODE_ENV=",
    // Passthrough: any pi-specific env vars users might set
    // (but not PI_DISCORD_ which is bot-internal)
    "PI_THINKING=",
    "PI_PERMISSION_SYSTEM_",
  ];

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const entry = `${key}=`;
    if (keepPrefixes.some((prefix) => entry.startsWith(prefix))) {
      env[key] = value;
    }
  }
  return env;
}

export class PiRpcClient {
  private proc: ChildProcess | null = null;
  private framer = new JsonlFramer();
  private pendingResponses = new Map<string, (resp: RpcResponse) => void>();
  private eventHandlers = new Set<(event: PiEvent) => void>();
  private typedHandlers = new Map<string, Set<Function>>();
  private nextId = 0;
  private _isStreaming = false;
  private exited = false;
  private exitCode: number | null = null;
  private toolTimers = new Map<string, number>();

  private log: Logger;

  constructor(private options: PiRpcOptions) {
    this.log = createLogger("pi-rpc");
  }

  // === Process Lifecycle ===

  async start(): Promise<void> {
    if (this.proc) {
      this.log.debug("start called but process already running");
      return;
    }

    this.log.info({
      piPath: this.options.piPath ?? "pi",
      cwd: this.options.cwd,
      sessionDir: this.options.sessionDir,
      model: this.options.model,
    }, "starting pi rpc process");

    const args = this.buildArgs();
    const spawnOptions: SpawnOptions = {
      cwd: this.options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: this.options.env ?? buildPiEnv(),
    };

    this.proc = spawn(this.options.piPath ?? "pi", args, spawnOptions);
    this.log.debug({
      pid: this.proc.pid,
      args: args.slice(0, 10), // limit args logged
    }, "pi process spawned");
    this.exited = false;
    this.exitCode = null;

    // Attach JSONL framer to stdout
    const onStdout = (chunk: string | Buffer) => {
      const lines = this.framer.push(chunk);
      for (const line of lines) {
        this.handleLine(line);
      }
    };

    this.proc.stdout!.on("data", onStdout);

    // Capture stderr for diagnostics
    this.proc.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text) this.log.debug({ text: text.slice(0, 500) }, "pi stderr");
    });

    // Handle process exit
    const pid = this.proc.pid;
    this.proc.on("exit", (code, signal) => {
      this.log.info({ pid, code, signal }, "pi process exited");
      this.exited = true;
      this.exitCode = code;

      // Flush any remaining partial lines
      const lines = this.framer.flush();
      for (const line of lines) {
        this.handleLine(line);
      }

      // Reject all pending responses
      for (const [id, resolve] of this.pendingResponses) {
        resolve({
          type: "response",
          command: "unknown",
          success: false,
          error: `Pi process exited with code ${code} (signal: ${signal})`,
        });
      }
      this.pendingResponses.clear();

      this._isStreaming = false;
    });
  }

  async stop(): Promise<void> {
    if (!this.proc) {
      this.log.debug("stop called but no process running");
      return;
    }

    const pid = this.proc.pid;
    this.log.info({ pid }, "stopping pi process");

    // Try abort first
    try {
      await this.abort();
    } catch {
      // ignore
    }

    // SIGTERM
    if (!this.exited) {
      this.proc.kill("SIGTERM");
    }

    // Wait for exit (max 5 seconds)
    await new Promise<void>((resolve) => {
      if (this.exited) return resolve();
      const timeout = setTimeout(() => {
        if (!this.exited && this.proc) {
          this.proc.kill("SIGKILL");
        }
        resolve();
      }, 5000);
      this.proc!.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.proc = null;
  }

  get isRunning(): boolean {
    return this.proc !== null && !this.exited;
  }

  get isStreaming(): boolean {
    return this._isStreaming;
  }

  // === Event System ===

  /** Subscribe to all events. Returns unsubscribe function. */
  onEvent(handler: (event: PiEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /** Subscribe to a specific event type. Returns unsubscribe function. */
  on<T extends PiEvent["type"]>(
    eventType: T,
    handler: (event: Extract<PiEvent, { type: T }>) => void,
  ): () => void {
    if (!this.typedHandlers.has(eventType)) {
      this.typedHandlers.set(eventType, new Set());
    }
    const handlers = this.typedHandlers.get(eventType)!;
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  // === Command Methods ===

  /** Send a JSON command to pi's stdin. Returns response promise. */
  private sendCommand(command: RpcCommand): Promise<RpcResponse> {
    const cmdType = command.type;
    this.log.debug({ id: command.id, type: cmdType }, `sending command: ${cmdType}`);

    if (!this.proc || this.exited) {
      this.log.warn({ command: cmdType }, "command sent while process not running");
      return Promise.resolve({
        type: "response",
        command: command.type,
        success: false,
        error: "Pi process is not running",
      });
    }

    const id = command.id ?? `rpc-${++this.nextId}`;
    const cmd = { ...command, id };

    return new Promise<RpcResponse>((resolve) => {
      this.pendingResponses.set(id, resolve);
      this.proc!.stdin!.write(JSON.stringify(cmd) + "\n");
    });
  }

  /** Send a command that doesn't need a response (fire-and-forget). */
  private sendCommandNoWait(command: RpcCommand): void {
    if (!this.proc || this.exited) return;
    const id = command.id ?? `rpc-${++this.nextId}`;
    const cmd = { ...command, id };
    this.proc.stdin!.write(JSON.stringify(cmd) + "\n");
  }

  // === Core Commands ===

  /** Send a user prompt to the agent. */
  async prompt(
    message: string,
    opts?: { images?: ImageContent[]; streamingBehavior?: "steer" | "followUp" },
  ): Promise<RpcResponse> {
    return this.sendCommand({
      type: "prompt",
      message,
      images: opts?.images,
      streamingBehavior: opts?.streamingBehavior,
    });
  }

  /** Queue a steering message for delivery after the current turn. */
  async steer(message: string, opts?: { images?: ImageContent[] }): Promise<RpcResponse> {
    return this.sendCommand({
      type: "steer",
      message,
      images: opts?.images,
    });
  }

  /** Queue a follow-up message for delivery after agent finishes. */
  async followUp(message: string, opts?: { images?: ImageContent[] }): Promise<RpcResponse> {
    return this.sendCommand({
      type: "follow_up",
      message,
      images: opts?.images,
    });
  }

  /** Abort the current agent operation. */
  async abort(): Promise<RpcResponse> {
    return this.sendCommand({ type: "abort" });
  }

  // === Session Commands ===

  /** Start a fresh session. */
  async newSession(parentSession?: string): Promise<RpcResponse> {
    return this.sendCommand({
      type: "new_session",
      parentSession,
    });
  }

  /** Get current session state. */
  async getState(): Promise<RpcResponse> {
    return this.sendCommand({ type: "get_state" });
  }

  /** Get all messages in the conversation. */
  async getMessages(): Promise<RpcResponse> {
    return this.sendCommand({ type: "get_messages" });
  }

  /** Get token usage and cost statistics. */
  async getSessionStats(): Promise<RpcResponse> {
    return this.sendCommand({ type: "get_session_stats" });
  }

  /** Export session to an HTML file. */
  async exportHtml(outputPath?: string): Promise<RpcResponse> {
    return this.sendCommand({
      type: "export_html",
      outputPath,
    });
  }

  /** Load a different session file. */
  async switchSession(sessionPath: string): Promise<RpcResponse> {
    return this.sendCommand({
      type: "switch_session",
      sessionPath,
    });
  }

  /** Fork from a previous user message. */
  async fork(entryId: string): Promise<RpcResponse> {
    return this.sendCommand({
      type: "fork",
      entryId,
    });
  }

  /** Duplicate the current active branch into a new session. */
  async clone(): Promise<RpcResponse> {
    return this.sendCommand({ type: "clone" });
  }

  /** Get user messages available for forking. */
  async getForkMessages(): Promise<RpcResponse> {
    return this.sendCommand({ type: "get_fork_messages" });
  }

  /** Get text of the last assistant message. */
  async getLastAssistantText(): Promise<RpcResponse> {
    return this.sendCommand({ type: "get_last_assistant_text" });
  }

  /** Set display name for the current session. */
  async setSessionName(name: string): Promise<RpcResponse> {
    return this.sendCommand({
      type: "set_session_name",
      name,
    });
  }

  // === Model Commands ===

  /** Switch to a specific model. */
  async setModel(provider: string, modelId: string): Promise<RpcResponse> {
    return this.sendCommand({
      type: "set_model",
      provider,
      modelId,
    });
  }

  /** Cycle to the next available model. */
  async cycleModel(): Promise<RpcResponse> {
    return this.sendCommand({ type: "cycle_model" });
  }

  /** List all configured models. */
  async getAvailableModels(): Promise<RpcResponse> {
    return this.sendCommand({ type: "get_available_models" });
  }

  // === Thinking Commands ===

  /** Set the reasoning/thinking level. */
  async setThinkingLevel(level: ThinkingLevel): Promise<RpcResponse> {
    return this.sendCommand({
      type: "set_thinking_level",
      level,
    });
  }

  /** Cycle through available thinking levels. */
  async cycleThinkingLevel(): Promise<RpcResponse> {
    return this.sendCommand({ type: "cycle_thinking_level" });
  }

  // === Queue Mode Commands ===

  /** Control how steering messages are delivered. */
  async setSteeringMode(mode: "all" | "one-at-a-time"): Promise<RpcResponse> {
    return this.sendCommand({
      type: "set_steering_mode",
      mode,
    });
  }

  /** Control how follow-up messages are delivered. */
  async setFollowUpMode(mode: "all" | "one-at-a-time"): Promise<RpcResponse> {
    return this.sendCommand({
      type: "set_follow_up_mode",
      mode,
    });
  }

  // === Compaction Commands ===

  /** Manually compact conversation context. */
  async compact(customInstructions?: string): Promise<RpcResponse> {
    return this.sendCommand({
      type: "compact",
      customInstructions,
    });
  }

  /** Enable or disable automatic compaction. */
  async setAutoCompaction(enabled: boolean): Promise<RpcResponse> {
    return this.sendCommand({
      type: "set_auto_compaction",
      enabled,
    });
  }

  // === Retry Commands ===

  /** Enable or disable automatic retry on transient errors. */
  async setAutoRetry(enabled: boolean): Promise<RpcResponse> {
    return this.sendCommand({
      type: "set_auto_retry",
      enabled,
    });
  }

  /** Abort an in-progress retry. */
  async abortRetry(): Promise<RpcResponse> {
    return this.sendCommand({ type: "abort_retry" });
  }

  // === Bash Commands ===

  /** Execute a shell command and add output to conversation context. */
  async bash(command: string): Promise<RpcResponse> {
    return this.sendCommand({
      type: "bash",
      command,
    });
  }

  /** Abort a running bash command. */
  async abortBash(): Promise<RpcResponse> {
    return this.sendCommand({ type: "abort_bash" });
  }

  // === Commands ===

  /** Get available extension commands, prompt templates, and skills. */
  async getCommands(): Promise<RpcResponse> {
    return this.sendCommand({ type: "get_commands" });
  }

  // === Extension UI ===

  /** Send a response to an extension UI dialog request. */
  async sendUiResponse(
    id: string,
    response: { value?: string; confirmed?: boolean; cancelled?: boolean },
  ): Promise<void> {
    this.sendCommandNoWait({
      type: "extension_ui_response",
      id,
      ...response,
    } as RpcCommand);
  }

  // === Event Parsing ===

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Skip non-JSON lines (diagnostic output, etc.)
      return;
    }

    if (typeof parsed !== "object" || parsed === null) return;

    const obj = parsed as Record<string, unknown>;

    // Response objects: { type: "response", ... }
    if (obj.type === "response") {
      const resp = obj as unknown as RpcResponse;
      if (!resp.success) {
        this.log.warn({ command: resp.command, error: resp.error }, `command failed: ${resp.command ?? "unknown"}`);
      }
      this.handleResponse(resp);
      return;
    }

    // PiEvent objects: { type: "agent_start", "tool_execution_start", etc. }
    // Extension UI requests also come through here as PiEvents
    const event = obj as unknown as PiEvent;

    // Track streaming state
    if (event.type === "agent_start") {
      this.log.info("agent turn started");
      this._isStreaming = true;
    } else if (event.type === "agent_end") {
      this.log.info("agent turn ended");
      this._isStreaming = false;
    }

    // Tool call logging
    if (event.type === "tool_execution_start") {
      this.toolTimers.set(event.toolCallId, Date.now());
      this.log.info({ tool: event.toolName, callId: event.toolCallId, args: Object.keys(event.args) }, "tool start");
    } else if (event.type === "tool_execution_update") {
      this.log.debug({ tool: event.toolName, callId: event.toolCallId }, "tool update");
    } else if (event.type === "tool_execution_end") {
      const started = this.toolTimers.get(event.toolCallId);
      const durationMs = started ? Date.now() - started : undefined;
      this.toolTimers.delete(event.toolCallId);
      const output = event.result.content.map((c) => c.text).join("");
      this.log.info(
        {
          tool: event.toolName,
          callId: event.toolCallId,
          durationMs,
          isError: event.isError,
          outputLen: output.length,
        },
        "tool end",
      );
    } else if (event.type === "extension_ui_request") {
      this.log.info({ method: (event as any).method, id: event.id }, "extension ui request received");
    }

    // Dispatch to generic handlers
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (err) {
        // Don't let one handler crash others
      }
    }

    // Dispatch to typed handlers
    const typed = this.typedHandlers.get(event.type);
    if (typed) {
      for (const handler of typed) {
        try {
          handler(event);
        } catch (err) {
          // Don't let one handler crash others
        }
      }
    }
  }

  private handleResponse(resp: RpcResponse): void {
    // Match to pending command by id
    if (resp.id) {
      const resolve = this.pendingResponses.get(resp.id);
      if (resolve) {
        this.pendingResponses.delete(resp.id);
        resolve(resp);
        return;
      }
    }

    // Response with no matching id — could be from a fire-and-forget
    // or an async response. Dispatch as an event if no pending match.
  }

  // === CLI Args ===

  private buildArgs(): string[] {
    const args: string[] = ["--mode", "rpc"];

    if (this.options.provider) {
      args.push("--provider", this.options.provider);
    }
    if (this.options.model) {
      args.push("--model", this.options.model);
    }
    if (this.options.thinkingLevel) {
      args.push("--thinking", this.options.thinkingLevel);
    }
    if (this.options.sessionDir) {
      args.push("--session-dir", this.options.sessionDir);
    }
    if (this.options.sessionFile) {
      args.push("--session", this.options.sessionFile);
    }
    if (this.options.systemPrompt) {
      args.push("--system-prompt", this.options.systemPrompt);
    }
    if (this.options.appendSystemPrompt) {
      args.push("--append-system-prompt", this.options.appendSystemPrompt);
    }
    if (this.options.extraArgs) {
      args.push(...this.options.extraArgs);
    }

    return args;
  }
}
