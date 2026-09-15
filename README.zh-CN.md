# Synology Chat Pi Bridge

[English README](README.md)

这是一个自托管桥接服务，用来把群晖 Synology Chat 的 webhook 接到本地 `pi` agent。它适合在局域网里使用，让 Chat 频道可以直接和本地 agent 对话，并支持多频道会话、文件附件、图片预览和生成文件回传。

## 功能

- 接收 Synology Chat 的发出 webhook。
- 通过 Synology Chat 的传入 webhook 回复。
- 支持多个 outgoing token。
- 支持按频道名称或频道 ID 映射不同的 incoming webhook。
- 按「频道 + 用户」隔离 Pi 会话。
- 支持文本命令：`/status`、`/new`、`/abort`、`/compact`、`/model`、`/trace`。
- 当 Synology outgoing payload 里包含附件 URL 时，自动下载到本机。
- 当 agent 回复里出现本地文件路径时，自动通过 `/files/...` 暴露成内网 URL，再用 Synology `file_url` 发回 Chat。
- 全局域网运行，不依赖 Discord 或 Telegram。

## 依赖

- [Bun](https://bun.sh/)
- 可用的 `pi` CLI，并支持 JSON-RPC
- 已安装并可访问的 Synology Chat
- 群晖 NAS 必须能访问 `SYNOLOGY_CHAT_FILE_BASE_URL`

## 快速开始

```bash
git clone https://github.com/YOUR_NAME/synology-chat-pi-bridge.git
cd synology-chat-pi-bridge
bun install
cp .env.example ~/.config/synology-chat-pi-bridge.env
vim ~/.config/synology-chat-pi-bridge.env
bun run synology
```

访问：

```text
http://桥接机器IP:8789/health
```

如果返回 `OK`，说明服务已启动。

## Synology Chat 配置

在 Synology Chat 中打开 **整合**。

### 传入的 Webhook

为机器人要回复的频道创建一个「传入的 Webhook」。

把生成的 URL 写入：

```env
SYNOLOGY_CHAT_INCOMING_URL=...
```

如果你希望不同频道回复到各自频道，需要每个频道创建一个 incoming webhook，并配置：

```env
SYNOLOGY_CHAT_INCOMING_URLS_JSON={"常规":"...","1":"...","随机":"...","2":"..."}
```

Synology 有时会发送频道名，有时只发送频道 ID。为了稳妥，建议频道名和频道 ID 都映射。

### 发出的 Webhook

创建「发出的 Webhook」：

- 频道：可以选择一个频道，也可以选择任何公共频道
- 触发字：如果想用艾特式调用，可填 `@pi`
- URL：`http://桥接机器IP:8789/synology-chat/webhook`
- 令牌：复制到 `SYNOLOGY_CHAT_OUTGOING_TOKEN`

如果你想做一个「专属频道免艾特」的机器人，可以为该频道创建 outgoing webhook，并把触发字留空。为了避免机器人回复触发自己，请把机器人显示名写入：

```env
SYNOLOGY_CHAT_IGNORE_USERS=Pi Bot
```

## 附件和生成文件

Synology incoming webhook 支持 `file_url`。本桥接服务会把生成文件暴露在：

```text
http://桥接机器IP:8789/files/<file>
```

请设置：

```env
SYNOLOGY_CHAT_FILE_BASE_URL=http://桥接机器IP:8789
```

当 agent 回复里出现类似这样的本地文件路径：

```text
/home/user/project/output/image.png
```

bridge 会把文件复制到公开目录，然后通过 Synology Chat 作为附件发回去。图片通常会显示预览；视频、音频和普通文件则按 Synology Chat 客户端能力展示。

支持常见图片、视频、音频、压缩包、文本、PDF、JSON、CSV 等扩展名。

## 命令

可以在 Synology Chat 中发送：

```text
/status
/new
/abort
/compact 可选原因
/model local
/trace on
/trace off
/trace status
traceon
traceoff
```

`/trace on` 或 `traceon` 会实时输出简短的 `TRACE start/end` 工具调用消息，并在每轮 agent 回复后追加诊断摘要；如果本轮读取过 `SKILL.md`，也会显示出来。这是当前桥接层能看到的最接近「Skill 命中情况」的信号。

`/model` 是可选功能，需要配置：

```env
PI_MODEL_TARGETS_JSON={"local":{"provider":"example-provider","model":"example-model","label":"Local model"}}
PI_MODEL_ALIASES_JSON={"fast":"local","local":"local"}
```

## systemd 用户服务

```bash
mkdir -p ~/.config/systemd/user
cp systemd-user.service.example ~/.config/systemd/user/synology-chat-pi-bridge.service
systemctl --user daemon-reload
systemctl --user enable --now synology-chat-pi-bridge.service
journalctl --user -u synology-chat-pi-bridge.service -f
```

## 安全说明

- 不建议把 bridge 直接暴露到公网。
- webhook token 必须保密。
- 如果跨公网访问，建议使用防火墙、反代鉴权或 IP allowlist。
- `/files/...` 会暴露 bridge 公开目录中的文件，请把它视为局域网可访问资源。
- 如果频繁生成文件，建议定期清理 `PI_SYNOLOGY_DATA_DIR/public` 和 `uploads`。

## 状态

Alpha。当前已经可用，但 Synology Chat 不同版本/客户端的 outgoing 附件 payload 可能有差异。bridge 会把原始 payload 写入 `payloads.jsonl`，方便排查和适配。
