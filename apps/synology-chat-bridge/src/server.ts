import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { PiRpcClient, createLogger, type PiEvent, type ThinkingLevel } from "pi-rpc-client";

type ModelTarget = {
  provider: string;
  model: string;
  label: string;
};

type Config = {
  host: string;
  port: number;
  token?: string;
  tokens: Set<string>;
  incomingUrl?: string;
  incomingUrls: Record<string, string>;
  ignoredUsers: Set<string>;
  dataDir: string;
  publicDir: string;
  fileBaseUrl: string;
  workspaceDir: string;
  piPath: string;
  provider?: string;
  model?: string;
  thinking: ThinkingLevel;
  modelTargets: Record<string, ModelTarget>;
  modelAliases: Record<string, string>;
};

type ChatSession = {
  key: string;
  client: PiRpcClient;
  output: string;
  incomingUrl?: string;
  model?: ModelTarget;
  traceEnabled: boolean;
  trace: TraceState;
};

type TraceState = {
  tools: Record<string, number>;
  skillFiles: string[];
  filePaths: string[];
  statuses: string[];
};

type TraceDelta = {
  skillFiles: string[];
  filePaths: string[];
};

type ChatAttachment = {
  url?: string;
  fileUrl?: string;
  name?: string;
  type?: string;
  localPath?: string;
};

const log = createLogger("synology-chat:bridge");
const sessions = new Map<string, ChatSession>();
let synologySendChain = Promise.resolve();
let lastSynologySendAt = 0;
const synologySendIntervalMs = 1300;
const synologyTextChunkChars = 1500;

function resolveHomePath(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

function parseIncomingUrls(value: string | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const urls: Record<string, string> = {};
    for (const [key, url] of Object.entries(parsed)) {
      if (typeof url === "string" && url) urls[key] = url;
    }
    return urls;
  } catch (err) {
    log.warn({ err: String(err) }, "failed to parse SYNOLOGY_CHAT_INCOMING_URLS_JSON");
    return {};
  }
}

function parseIgnoredUsers(value: string | undefined): Set<string> {
  return new Set((value ?? "Pi Bot")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean));
}

function parseTokens(...values: Array<string | undefined>): Set<string> {
  const tokens = new Set<string>();
  for (const value of values) {
    for (const token of (value ?? "").split(",")) {
      const trimmed = token.trim();
      if (trimmed) tokens.add(trimmed);
    }
  }
  return tokens;
}

function parseModelTargets(value: string | undefined): Record<string, ModelTarget> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const targets: Record<string, ModelTarget> = {};
    for (const [key, raw] of Object.entries(parsed)) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      if (typeof item.provider !== "string" || typeof item.model !== "string") continue;
      targets[key] = {
        provider: item.provider,
        model: item.model,
        label: typeof item.label === "string" ? item.label : `${item.provider}/${item.model}`,
      };
    }
    return targets;
  } catch (err) {
    log.warn({ err: String(err) }, "failed to parse PI_MODEL_TARGETS_JSON");
    return {};
  }
}

function parseModelAliases(value: string | undefined, targets: Record<string, ModelTarget>): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const key of Object.keys(targets)) aliases[key] = key;
  if (!value) return aliases;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    for (const [alias, targetKey] of Object.entries(parsed)) {
      if (typeof targetKey === "string" && targets[targetKey]) aliases[alias] = targetKey;
    }
  } catch (err) {
    log.warn({ err: String(err) }, "failed to parse PI_MODEL_ALIASES_JSON");
  }
  return aliases;
}

function loadConfig(): Config {
  const token = process.env.SYNOLOGY_CHAT_OUTGOING_TOKEN;
  const dataDir = resolveHomePath(process.env.PI_SYNOLOGY_DATA_DIR ?? "~/.local/share/pi-synology-chat");
  const port = Number(process.env.SYNOLOGY_CHAT_PORT) || 8789;
  const modelTargets = parseModelTargets(process.env.PI_MODEL_TARGETS_JSON);
  return {
    host: process.env.SYNOLOGY_CHAT_LISTEN_HOST ?? "0.0.0.0",
    port,
    token,
    tokens: parseTokens(token, process.env.SYNOLOGY_CHAT_OUTGOING_TOKENS),
    incomingUrl: process.env.SYNOLOGY_CHAT_INCOMING_URL,
    incomingUrls: parseIncomingUrls(process.env.SYNOLOGY_CHAT_INCOMING_URLS_JSON),
    ignoredUsers: parseIgnoredUsers(process.env.SYNOLOGY_CHAT_IGNORE_USERS),
    dataDir,
    publicDir: join(dataDir, "public"),
    fileBaseUrl: (process.env.SYNOLOGY_CHAT_FILE_BASE_URL ?? `http://127.0.0.1:${port}`).replace(/\/+$/, ""),
    workspaceDir: resolveHomePath(process.env.PI_WORKSPACE_DIR ?? process.cwd()),
    piPath: process.env.PI_PATH ?? "pi",
    provider: process.env.PI_DEFAULT_PROVIDER,
    model: process.env.PI_DEFAULT_MODEL,
    thinking: (process.env.PI_THINKING_LEVEL as ThinkingLevel | undefined) ?? "medium",
    modelTargets,
    modelAliases: parseModelAliases(process.env.PI_MODEL_ALIASES_JSON, modelTargets),
  };
}

function incomingUrlForChannel(config: Config, ...channels: string[]): string | undefined {
  for (const channel of channels) {
    if (channel && config.incomingUrls[channel]) return config.incomingUrls[channel];
  }
  return config.incomingUrl;
}

function defaultModel(config: Config): ModelTarget | undefined {
  if (!config.provider || !config.model) return undefined;
  return { provider: config.provider, model: config.model, label: `${config.provider}/${config.model}` };
}

function persistedModelPath(config: Config): string {
  return join(config.dataDir, "model-selection.json");
}

function loadPersistedModel(config: Config): void {
  try {
    const saved = JSON.parse(readFileSync(persistedModelPath(config), "utf8")) as Partial<ModelTarget>;
    if (typeof saved.provider === "string" && typeof saved.model === "string") {
      config.provider = saved.provider;
      config.model = saved.model;
    }
  } catch {
    // No persisted selection yet.
  }
}

function persistDefaultModel(config: Config, target: ModelTarget): void {
  mkdirSync(config.dataDir, { recursive: true });
  const tempPath = persistedModelPath(config) + ".tmp";
  writeFileSync(tempPath, JSON.stringify({
    provider: target.provider,
    model: target.model,
    label: target.label,
    updatedAt: new Date().toISOString(),
  }, null, 2) + "\n", { mode: 0o600 });
  renameSync(tempPath, persistedModelPath(config));
}

async function getOrCreateSession(config: Config, key: string, incomingUrl?: string): Promise<ChatSession> {
  const existing = sessions.get(key);
  if (existing) {
    if (incomingUrl) existing.incomingUrl = incomingUrl;
    return existing;
  }

  const sessionDir = join(config.dataDir, "sessions", key.replace(/[^A-Za-z0-9._-]/g, "_"));
  mkdirSync(sessionDir, { recursive: true });
  const model = defaultModel(config);
  const client = new PiRpcClient({
    cwd: config.workspaceDir,
    sessionDir,
    piPath: config.piPath,
    provider: model?.provider,
    model: model?.model,
    thinkingLevel: config.thinking,
  });

  const session: ChatSession = { key, client, output: "", incomingUrl, model, traceEnabled: false, trace: createTraceState() };
  client.onEvent((event) => handlePiEvent(config, session, event).catch((err) => {
    log.warn({ err: String(err) }, "failed to handle pi event");
  }));
  await client.start();
  sessions.set(key, session);
  return session;
}

async function handlePiEvent(config: Config, session: ChatSession, event: PiEvent): Promise<void> {
  if (event.type === "agent_start") {
    session.output = "";
    session.trace = createTraceState();
    await sendSynologyText(config, "Thinking...", session.incomingUrl);
    return;
  }
  if (session.traceEnabled) await emitLiveTrace(config, session, event);
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    session.output += event.assistantMessageEvent.delta;
    return;
  }
  if (event.type === "compaction_start") {
    await sendSynologyText(config, `Compacting context: ${event.reason}`, session.incomingUrl);
    return;
  }
  if (event.type === "compaction_end" && event.errorMessage) {
    await sendSynologyText(config, `Compaction failed: ${event.errorMessage}`, session.incomingUrl);
    return;
  }
  if (event.type === "agent_end") {
    await sendSynologyAgentOutput(config, session, assistantTextFromAgentEnd(event) || session.output || "OK");
    if (session.traceEnabled) {
      await sendSynologyText(config, formatTraceSummary(session.trace), session.incomingUrl);
    }
  }
}

function createTraceState(): TraceState {
  return { tools: {}, skillFiles: [], filePaths: [], statuses: [] };
}

async function emitLiveTrace(config: Config, session: ChatSession, event: PiEvent): Promise<void> {
  const delta = recordTraceEvent(session, event);
  if (event.type === "tool_execution_start") {
    await sendSynologyText(config, `TRACE start: ${event.toolName}`, session.incomingUrl);
  }
  if (event.type === "tool_execution_end") {
    await sendSynologyText(config, `TRACE end: ${event.toolName} ${event.isError ? "ERROR" : "OK"}`, session.incomingUrl);
  }
  if (delta.skillFiles.length) {
    await sendSynologyText(config, `TRACE skill:\n${delta.skillFiles.map((path) => `- ${path}`).join("\n")}`, session.incomingUrl);
  }
}

function recordTraceEvent(session: ChatSession, event: PiEvent): TraceDelta {
  if (event.type === "tool_execution_start") {
    session.trace.tools[event.toolName] = (session.trace.tools[event.toolName] ?? 0) + 1;
    return recordTraceStrings(session.trace, event.args);
  }
  if (event.type === "tool_execution_end") {
    return recordTraceStrings(session.trace, event.result);
  }
  if (event.type === "extension_ui_request") {
    recordUnique(session.trace.statuses, compactForTrace(event.method, 120), 12);
    return recordTraceStrings(session.trace, event);
  }
  return { skillFiles: [], filePaths: [] };
}

function recordTraceStrings(trace: TraceState, value: unknown): TraceDelta {
  const delta: TraceDelta = { skillFiles: [], filePaths: [] };
  for (const text of collectStrings(value)) {
    if (isSkillPath(text) && recordUnique(trace.skillFiles, text, 16)) recordUnique(delta.skillFiles, text, 16);
    if (isInterestingPath(text) && recordUnique(trace.filePaths, text, 24)) recordUnique(delta.filePaths, text, 24);
  }
  return delta;
}

function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 5 || value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectStrings(item, depth + 1));
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((item) => collectStrings(item, depth + 1));
  }
  return [];
}

function isSkillPath(value: string): boolean {
  return value.includes("/skills/") && value.endsWith("SKILL.md");
}

function isInterestingPath(value: string): boolean {
  if (!value.includes("/")) return false;
  if (value.length > 500) return false;
  return value.startsWith("/") || value.startsWith("~/") || value.includes("/CODEWORDS.md") || value.includes("/skills/");
}

function recordUnique(values: string[], value: string, max: number): boolean {
  const compacted = compactForTrace(value, 260);
  if (!compacted || values.includes(compacted)) return false;
  values.push(compacted);
  if (values.length > max) values.splice(0, values.length - max);
  return true;
}

function compactForTrace(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, Math.max(0, max - 3))}...`;
}

function formatTraceSummary(trace: TraceState): string {
  const lines = ["Trace"];
  const tools = Object.entries(trace.tools)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => `${name} x${count}`);
  lines.push(`tools: ${tools.length ? tools.join(", ") : "none"}`);
  if (trace.skillFiles.length) lines.push(`skill files:\n${trace.skillFiles.map((path) => `- ${path}`).join("\n")}`);
  if (trace.filePaths.length) lines.push(`paths:\n${trace.filePaths.slice(0, 12).map((path) => `- ${path}`).join("\n")}`);
  if (trace.statuses.length) lines.push(`ui events: ${trace.statuses.join(", ")}`);
  return lines.join("\n");
}

function assistantTextFromAgentEnd(event: Extract<PiEvent, { type: "agent_end" }>): string {
  const messages = [...event.messages].reverse();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    return message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
      .trim();
  }
  return "";
}

function classifyFile(value: string): string {
  const ext = extname(value.split("?")[0]).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".avif"].includes(ext)) return "image";
  if ([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"].includes(ext)) return "video";
  if ([".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac", ".opus"].includes(ext)) return "audio";
  return "file";
}

function safeFileName(value: string, fallback = "file"): string {
  const decoded = decodeURIComponent(value.split("?")[0]).split("/").filter(Boolean).pop() ?? fallback;
  const cleaned = decoded.replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

function publicUrlForName(config: Config, name: string): string {
  return `${config.fileBaseUrl}/files/${encodeURIComponent(name)}`;
}

function publishedFileName(filePath: string): string {
  const original = safeFileName(basename(filePath), "file");
  const ext = extname(original);
  const stem = ext ? original.slice(0, -ext.length) : original;
  const compactStem = stem.slice(0, 120).replace(/^_+|_+$/g, "") || "file";
  const cleanExt = ext.replace(/[^A-Za-z0-9.]/g, "").slice(0, 12).toLowerCase() || ".bin";
  return `${Date.now()}-${compactStem}${cleanExt}`;
}

function publishLocalFile(config: Config, filePath: string): string | undefined {
  try {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return undefined;
    mkdirSync(config.publicDir, { recursive: true });
    const name = publishedFileName(filePath);
    copyFileSync(filePath, join(config.publicDir, name));
    return publicUrlForName(config, name);
  } catch (err) {
    log.warn({ err: String(err), filePath }, "failed to publish local file");
    return undefined;
  }
}

function extractLocalFilePaths(text: string): string[] {
  const paths = new Set<string>();
  const patterns = [
    /file:\/\/(\/[^\s"'<>)[\]]+)/g,
    /(^|[\s"'(])((?:\/home|\/mnt|\/tmp|\/var\/tmp)\/[^\s"'<>)[\]]+\.[A-Za-z0-9]{1,8})/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      paths.add((match[2] ?? match[1]).trim());
    }
  }
  return [...paths];
}

function extractFileUrls(text: string): string[] {
  const urls = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
    const url = match[0].replace(/[).,;]+$/g, "");
    if (/\.(?:jpg|jpeg|png|webp|gif|bmp|heic|avif|mp4|mov|mkv|webm|avi|m4v|mp3|wav|m4a|flac|ogg|aac|opus|zip|7z|rar|pdf|txt|md|json|csv)(?:[?#].*)?$/i.test(url)) {
      urls.add(url);
    }
  }
  return [...urls];
}

async function sendSynologyAgentOutput(config: Config, session: ChatSession, text: string): Promise<void> {
  const localUrls = extractLocalFilePaths(text)
    .map((filePath) => publishLocalFile(config, filePath))
    .filter((url): url is string => Boolean(url));
  const remoteUrls = extractFileUrls(text);
  const fileUrls = [...new Set([...localUrls, ...remoteUrls])];

  if (fileUrls.length === 0) {
    await sendSynologyText(config, text, session.incomingUrl);
    return;
  }

  await sendSynologyText(config, text || "已生成文件：", session.incomingUrl);
  for (const fileUrl of fileUrls) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await sendSynologyMessage(config, { text: `附件：${safeFileName(fileUrl)}`, fileUrl }, session.incomingUrl);
  }
}

async function sendSynologyText(config: Config, text: string, incomingUrl = config.incomingUrl): Promise<void> {
  const chunks = splitSynologyText(text || "OK", synologyTextChunkChars);
  if (chunks.length === 1) {
    await sendSynologyMessage(config, { text: chunks[0] }, incomingUrl);
    return;
  }
  for (let index = 0; index < chunks.length; index += 1) {
    await sendSynologyMessage(config, { text: `[${index + 1}/${chunks.length}]\n${chunks[index]}` }, incomingUrl);
  }
}

function splitSynologyText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > maxChars) {
    let cut = remaining.lastIndexOf("\n\n", maxChars);
    if (cut < Math.floor(maxChars * 0.45)) cut = remaining.lastIndexOf("\n", maxChars);
    if (cut < Math.floor(maxChars * 0.45)) cut = remaining.lastIndexOf("。", maxChars);
    if (cut < Math.floor(maxChars * 0.45)) cut = remaining.lastIndexOf(". ", maxChars);
    if (cut < Math.floor(maxChars * 0.45)) cut = maxChars;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

async function sendSynologyMessage(
  config: Config,
  message: { text: string; fileUrl?: string },
  incomingUrl = config.incomingUrl,
): Promise<void> {
  const run = synologySendChain.then(() => sendSynologyMessageNow(config, message, incomingUrl));
  synologySendChain = run.catch(() => undefined);
  return run;
}

async function sendSynologyMessageNow(
  config: Config,
  message: { text: string; fileUrl?: string },
  incomingUrl = config.incomingUrl,
): Promise<void> {
  if (!incomingUrl) {
    log.warn({ text: message.text.slice(0, 160) }, "SYNOLOGY_CHAT_INCOMING_URL not configured; response not sent");
    return;
  }

  const payload: Record<string, string> = { text: message.text.slice(0, 2200) || "OK" };
  if (message.fileUrl) payload.file_url = message.fileUrl;

  const body = new URLSearchParams();
  body.set("payload", JSON.stringify(payload));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const waitMs = Math.max(0, synologySendIntervalMs - (Date.now() - lastSynologySendAt));
    if (waitMs > 0) await delay(waitMs);

    const resp = await fetch(incomingUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    lastSynologySendAt = Date.now();
    const respText = await resp.text().catch(() => "");
    if (!resp.ok) {
      throw new Error(`Synology incoming webhook failed: HTTP ${resp.status} ${respText.slice(0, 200)}`);
    }
    if (respText) {
      try {
        const parsed = JSON.parse(respText) as { success?: boolean; error?: unknown };
        if (parsed.success === false) {
          const errorText = JSON.stringify(parsed.error ?? parsed).slice(0, 300);
          if (errorText.includes("\"code\":411") && attempt < 2) {
            await delay(2200);
            continue;
          }
          throw new Error(`Synology incoming webhook failed: ${errorText}`);
        }
      } catch (err) {
        if (String(err).includes("Synology incoming webhook failed")) throw err;
      }
    }
    if (message.fileUrl) {
      log.info({ fileUrl: message.fileUrl, response: respText.slice(0, 160) }, "synology file_url sent");
    }
    return;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await request.json() as Record<string, unknown>;
  }
  const raw = await request.text();
  const form = new URLSearchParams(raw);
  const payload = form.get("payload");
  const parsed: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) parsed[key] = value;
  if (payload) {
    try {
      parsed.payload = JSON.parse(payload);
    } catch {
      parsed.payload = payload;
    }
  }
  return parsed;
}

function deepGetText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const obj = value as Record<string, unknown>;
  for (const key of ["text", "message", "trigger_word"]) {
    if (typeof obj[key] === "string" && obj[key]) return obj[key] as string;
  }
  for (const child of Object.values(obj)) {
    const found = deepGetText(child);
    if (found) return found;
  }
  return "";
}

function deepGetString(value: unknown, keys: string[]): string {
  if (!value || typeof value !== "object") return "";
  const obj = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof obj[key] === "string" && obj[key]) return obj[key] as string;
    if (typeof obj[key] === "number") return String(obj[key]);
  }
  for (const child of Object.values(obj)) {
    const found = deepGetString(child, keys);
    if (found) return found;
  }
  return "";
}

function extractAttachmentCandidates(value: unknown): ChatAttachment[] {
  const attachments: ChatAttachment[] = [];

  function visit(node: unknown, parentKey = ""): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, parentKey);
      return;
    }

    const obj = node as Record<string, unknown>;
    const urlKeys = ["file_url", "fileUrl", "download_url", "downloadUrl", "url", "href", "link"];
    let url = "";
    for (const key of urlKeys) {
      if (typeof obj[key] === "string" && /^https?:\/\//.test(obj[key] as string)) {
        url = obj[key] as string;
        break;
      }
    }

    if (url && /file|attach|upload|image|photo|video|audio|media|url|link/i.test(parentKey + " " + Object.keys(obj).join(" "))) {
      attachments.push({
        url,
        fileUrl: url,
        name: deepGetString(obj, ["filename", "file_name", "name", "title"]) || safeFileName(url),
        type: deepGetString(obj, ["mimetype", "mime_type", "mime", "type"]) || classifyFile(url),
      });
    }

    for (const [key, child] of Object.entries(obj)) visit(child, key);
  }

  visit(value);
  return [...new Map(attachments.map((item) => [item.url, item])).values()];
}

async function downloadAttachment(config: Config, attachment: ChatAttachment): Promise<ChatAttachment> {
  if (!attachment.url) return attachment;
  try {
    mkdirSync(join(config.dataDir, "uploads"), { recursive: true });
    const resp = await fetch(attachment.url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const contentType = resp.headers.get("content-type") ?? attachment.type ?? "application/octet-stream";
    const fallbackExt = contentType.split(";")[0].split("/")[1]?.replace(/[^A-Za-z0-9]/g, "") || "bin";
    const name = safeFileName(attachment.name || attachment.url, `attachment.${fallbackExt}`);
    const ext = extname(name) ? "" : `.${fallbackExt}`;
    const localPath = join(config.dataDir, "uploads", `${Date.now()}-${name}${ext}`);
    writeFileSync(localPath, Buffer.from(await resp.arrayBuffer()), { mode: 0o600 });
    return { ...attachment, localPath, type: contentType };
  } catch (err) {
    log.warn({ err: String(err), url: attachment.url }, "failed to download synology attachment");
    return attachment;
  }
}

async function attachmentPromptSuffix(config: Config, payload: unknown): Promise<string> {
  const attachments = extractAttachmentCandidates(payload);
  if (attachments.length === 0) return "";

  const downloaded = await Promise.all(attachments.map((item) => downloadAttachment(config, item)));
  const lines = downloaded.map((item, index) => {
    const location = item.localPath ?? item.url ?? "";
    return `${index + 1}. ${item.type ?? classifyFile(location)} ${item.name ?? safeFileName(location)}: ${location}`;
  });
  return [
    "",
    "[Synology Chat attachments]",
    "The user attached the following files. Use the local path when present; otherwise use the URL.",
    ...lines,
  ].join("\n");
}

function tokenFromRequest(request: Request, body: Record<string, unknown>): string {
  const url = new URL(request.url);
  const auth = request.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  for (const key of ["x-synology-token", "x-webhook-token", "x-openclaw-token"]) {
    const value = request.headers.get(key);
    if (value) return value;
  }
  for (const key of ["token", "outgoing_token"]) {
    const value = body[key];
    if (typeof value === "string") return value;
  }
  return url.searchParams.get("token") ?? "";
}

async function handleCommand(config: Config, session: ChatSession, text: string): Promise<boolean> {
  const trimmed = text.trim();
  const [command, ...restParts] = trimmed.split(/\s+/);
  const rest = restParts.join(" ");
  if (command === "/trace") {
    const mode = rest.trim().toLowerCase();
    if (["on", "1", "true", "enable", "enabled"].includes(mode)) {
      session.traceEnabled = true;
      session.trace = createTraceState();
      await sendSynologyText(config, "Trace enabled. I will append tool and skill-read summaries after each turn.", session.incomingUrl);
      return true;
    }
    if (["off", "0", "false", "disable", "disabled"].includes(mode)) {
      session.traceEnabled = false;
      session.trace = createTraceState();
      await sendSynologyText(config, "Trace disabled.", session.incomingUrl);
      return true;
    }
    await sendSynologyText(config, `trace: ${session.traceEnabled ? "on" : "off"}\nuse: /trace on, /trace off`, session.incomingUrl);
    return true;
  }
  if (command === "/status") {
    const state = await session.client.getState();
    await sendSynologyText(config, [
      `workspace: ${config.workspaceDir}`,
      `model: ${session.model?.label ?? `${config.provider ?? "default"}/${config.model ?? "default"}`}`,
      `thinking: ${config.thinking}`,
      `state: ${state.success ? "OK" : state.error ?? "failed"}`,
    ].join("\n"), session.incomingUrl);
    return true;
  }
  if (command === "/new") {
    await session.client.abort().catch(() => undefined);
    const resp = await session.client.newSession();
    await sendSynologyText(config, resp.success ? "Started a fresh session." : `Failed: ${resp.error}`, session.incomingUrl);
    return true;
  }
  if (command === "/abort") {
    const resp = await session.client.abort();
    await sendSynologyText(config, resp.success ? "Aborted." : `Failed: ${resp.error}`, session.incomingUrl);
    return true;
  }
  if (command === "/compact") {
    const resp = await session.client.compact(rest || undefined);
    await sendSynologyText(config, resp.success ? "Compaction requested." : `Failed: ${resp.error}`, session.incomingUrl);
    return true;
  }
  if (command === "/model") {
    const key = config.modelAliases[rest.trim().toLowerCase()];
    if (!key) {
      const available = Object.keys(config.modelTargets);
      await sendSynologyText(config, available.length ? `available: ${available.join(", ")}` : "No model targets configured.", session.incomingUrl);
      return true;
    }
    const target = config.modelTargets[key];
    const resp = await session.client.setModel(target.provider, target.model);
    if (resp.success) {
      config.provider = target.provider;
      config.model = target.model;
      session.model = target;
      persistDefaultModel(config, target);
    }
    await sendSynologyText(config, resp.success ? `model: ${target.label}` : `Failed: ${resp.error}`, session.incomingUrl);
    return true;
  }
  return false;
}

async function handleWebhook(config: Config, request: Request): Promise<Response> {
  const body = await parseBody(request);
  mkdirSync(config.dataDir, { recursive: true });
  appendFileSync(join(config.dataDir, "payloads.jsonl"), JSON.stringify({
    at: new Date().toISOString(),
    headers: Object.fromEntries(request.headers.entries()),
    body,
  }) + "\n", { mode: 0o600 });

  if (config.tokens.size > 0) {
    const supplied = tokenFromRequest(request, body);
    if (!config.tokens.has(supplied)) return new Response("forbidden\n", { status: 403 });
  }

  const payload = body.payload ?? body;
  const rawText = deepGetText(payload).trim();
  let text = rawText;
  const trigger = deepGetString(payload, ["trigger_word"]).trim();
  const channelName = deepGetString(payload, ["channel_name", "channel"]);
  const channel = deepGetString(payload, ["channel_id", "thread_id"]) || channelName || "default";
  const user = deepGetString(payload, ["user_id", "username", "user_name"]) || "unknown";
  if (config.ignoredUsers.has(user)) return new Response("ignored\n", { status: 202 });

  const session = await getOrCreateSession(
    config,
    `${channel}-${user}`,
    incomingUrlForChannel(config, channelName, channel),
  );

  const rawCommandHandled = await handleCommand(config, session, rawText);
  if (rawCommandHandled) return new Response("ok\n");

  if (trigger && /^[#@/!]/.test(trigger) && text.startsWith(trigger)) {
    text = text.slice(trigger.length).trim();
  }
  const strippedCommandHandled = await handleCommand(config, session, text);
  if (strippedCommandHandled) return new Response("ok\n");

  const attachmentSuffix = await attachmentPromptSuffix(config, payload);
  if (!text && !attachmentSuffix) return new Response("no text\n", { status: 202 });
  if (!text) text = "请处理这些附件。";
  if (attachmentSuffix) text = `${text}\n${attachmentSuffix}`;

  if (session.client.isStreaming) {
    await session.client.followUp(text);
  } else {
    const resp = await session.client.prompt(text);
    if (!resp.success) await sendSynologyText(config, `Failed: ${resp.error}`, session.incomingUrl);
  }
  return new Response("ok\n");
}

async function shutdown(): Promise<void> {
  log.info({ count: sessions.size }, "shutting down synology chat bridge");
  for (const session of sessions.values()) await session.client.stop().catch(() => undefined);
  process.exit(0);
}

const config = loadConfig();
loadPersistedModel(config);
mkdirSync(config.dataDir, { recursive: true });
mkdirSync(config.publicDir, { recursive: true });

process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

Bun.serve({
  hostname: config.host,
  port: config.port,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("OK\n");
    if (url.pathname.startsWith("/files/") && request.method === "GET") {
      const name = decodeURIComponent(url.pathname.slice("/files/".length));
      if (!name || name.includes("/") || name.includes("..")) return new Response("bad path\n", { status: 400 });
      const filePath = join(config.publicDir, name);
      if (!existsSync(filePath) || !statSync(filePath).isFile()) return new Response("not found\n", { status: 404 });
      return new Response(Bun.file(filePath));
    }
    if (url.pathname === "/synology-chat/webhook" && request.method === "POST") {
      return handleWebhook(config, request).catch((err) => {
        log.warn({ err: String(err) }, "webhook failed");
        return new Response(`error: ${String(err)}\n`, { status: 500 });
      });
    }
    return new Response("not found\n", { status: 404 });
  },
});

log.info({
  host: config.host,
  port: config.port,
  workspaceDir: config.workspaceDir,
  model: config.model,
  provider: config.provider,
  hasIncomingUrl: Boolean(config.incomingUrl),
  incomingUrlChannels: Object.keys(config.incomingUrls),
  fileBaseUrl: config.fileBaseUrl,
  hasOutgoingToken: config.tokens.size > 0,
}, "starting synology chat bridge");
