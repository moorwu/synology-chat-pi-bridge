# Synology Chat Pi Bridge

[English](README.md) | [中文](README.zh-CN.md)

Synology Chat の webhook とローカルの `pi` agent を接続するセルフホスト型ブリッジです。LAN 内で動作する agent と Synology Chat のチャンネルをつなぎ、チャンネル別セッション、返信、ファイル添付、生成メディアのプレビューを扱えます。

## 機能

- Synology Chat の outgoing webhook を受信します。
- Synology Chat の incoming webhook で返信します。
- 複数の outgoing token に対応します。
- チャンネル名またはチャンネル ID ごとに incoming webhook を割り当てられます。
- 「チャンネル + ユーザー」単位で Pi セッションを分離します。
- テキストコマンド `/status`、`/new`、`/abort`、`/compact`、`/model`、`/trace` に対応します。
- Synology の outgoing payload に添付 URL が含まれる場合、ローカルへ自動ダウンロードします。
- agent が返したローカルファイルを内部の `/files/...` エンドポイントで公開し、Synology Chat へ `file_url` として返します。
- LAN 内で完結して動作します。

## 要件

- [Bun](https://bun.sh/)
- JSON-RPC に対応した `pi` CLI
- bridge ホストから到達できる Synology Chat
- NAS が `SYNOLOGY_CHAT_FILE_BASE_URL` を取得できること

## クイックスタート

```bash
git clone https://github.com/YOUR_NAME/synology-chat-pi-bridge.git
cd synology-chat-pi-bridge
bun install
cp .env.example ~/.config/synology-chat-pi-bridge.env
vim ~/.config/synology-chat-pi-bridge.env
bun run synology
```

`http://BRIDGE_HOST:8789/health` を開き、`OK` が返れば起動しています。

## 設定項目一覧

起動時に読み込む環境ファイルへ以下の変数を設定します。サンプルの systemd user unit を使う場合、通常は `~/.config/synology-chat-pi-bridge.env` です。

| 変数 | 必須 | デフォルト | 用途 |
| --- | --- | --- | --- |
| `SYNOLOGY_CHAT_LISTEN_HOST` | いいえ | `0.0.0.0` | bridge の HTTP bind address です。NAS から LAN 経由で到達できるよう、通常は `0.0.0.0` にします。 |
| `SYNOLOGY_CHAT_PORT` | いいえ | `8789` | `/synology-chat/webhook`、`/health`、`/files/...` の HTTP ポートです。 |
| `SYNOLOGY_CHAT_OUTGOING_TOKEN` | 推奨 | なし | Synology Chat outgoing webhook の token です。受信リクエストの検証に使います。 |
| `SYNOLOGY_CHAT_OUTGOING_TOKENS` | いいえ | なし | 追加の outgoing token をカンマ区切りで指定します。複数の outgoing webhook を同じ bridge に向ける場合に使います。 |
| `SYNOLOGY_CHAT_INCOMING_URL` | 返信する場合は必須 | なし | bot の返信に使うデフォルトの Synology incoming webhook URL です。 |
| `SYNOLOGY_CHAT_INCOMING_URLS_JSON` | いいえ | `{}` | チャンネルごとの incoming webhook map です。キーにはチャンネル名またはチャンネル ID を使えます。 |
| `SYNOLOGY_CHAT_IGNORE_USERS` | いいえ | `Pi Bot` | 無視する Synology ユーザー名をカンマ区切りで指定します。bot の自己トリガーループを防ぎます。 |
| `SYNOLOGY_CHAT_FILE_BASE_URL` | メディアプレビューには必須 | `http://127.0.0.1:<port>` | 生成ファイルの公開ベース URL です。`localhost` ではなく、bridge ホストの LAN アドレスを指定してください。例: `http://192.168.50.103:8789` |
| `PI_PATH` | いいえ | `pi` | `pi` 実行ファイルのパスです。 |
| `PI_WORKSPACE_DIR` | いいえ | 現在の作業ディレクトリ | Pi agent の作業ディレクトリです。 |
| `PI_DEFAULT_PROVIDER` | いいえ | Pi のデフォルト | Pi に渡す初期 provider です。 |
| `PI_DEFAULT_MODEL` | いいえ | Pi のデフォルト | Pi に渡す初期 model です。 |
| `PI_THINKING_LEVEL` | いいえ | `medium` | Pi の thinking level です。例: `low`、`medium`、`high`。利用できる値は provider に依存します。 |
| `PI_SYNOLOGY_DATA_DIR` | いいえ | `~/.local/share/pi-synology-chat` | セッション、payload ログ、アップロード、公開ファイルを保存する bridge データディレクトリです。 |
| `PI_MODEL_TARGETS_JSON` | いいえ | `{}` | `/model` コマンドで切り替えるモデル target です。target 名をキーにします。 |
| `PI_MODEL_ALIASES_JSON` | いいえ | targets から生成 | `/model` 用の alias です。例: `local` や `grok` を設定済み target に割り当てます。 |

## Synology Chat の設定

Synology Chat で **Integration** を開きます。

### Incoming webhook

bot が返信するチャンネルに incoming webhook を作成します。

生成された webhook URL を以下に設定します。

```env
SYNOLOGY_CHAT_INCOMING_URL=...
```

複数チャンネルへそれぞれ返信したい場合は、チャンネルごとに incoming webhook を作成し、以下のように設定します。

```env
SYNOLOGY_CHAT_INCOMING_URLS_JSON={"general":"...","1":"...","random":"...","2":"..."}
```

Synology はチャンネル名を送ることも、チャンネル ID だけを送ることもあります。迷う場合は両方を map してください。

### Outgoing webhook

outgoing webhook を作成します。

- Channel: 特定チャンネル、または任意の公開チャンネル
- Trigger word: mention 風に使うなら `@pi` など
- URL: `http://BRIDGE_HOST:8789/synology-chat/webhook`
- Token: `SYNOLOGY_CHAT_OUTGOING_TOKEN` にコピー

専用チャンネルですべてのメッセージを bot に渡したい場合、そのチャンネル用に outgoing webhook を作成し、trigger word を空にします。自己トリガーループを防ぐため、bot の incoming webhook 表示名を `SYNOLOGY_CHAT_IGNORE_USERS` に追加してください。

## 添付ファイルと生成ファイル

Synology incoming webhook は `file_url` に対応しています。この bridge は生成ファイルを以下で公開します。

```text
http://BRIDGE_HOST:8789/files/<file>
```

以下を設定してください。

```env
SYNOLOGY_CHAT_FILE_BASE_URL=http://BRIDGE_HOST:8789
```

agent が次のようなローカルパスを返した場合:

```text
/home/user/project/output/image.png
```

bridge はそのファイルを public ディレクトリへコピーし、Synology Chat にファイル添付として送信します。

一般的な画像、動画、音声、アーカイブ、テキスト、PDF、JSON、CSV の拡張子を認識します。

## コマンド

Synology Chat から以下を送信できます。

```text
/status
/new
/abort
/compact optional reason
/model local
/trace on
/trace off
/trace status
```

`/trace on` はツール呼び出しごとに短い `TRACE start/end` メッセージをリアルタイムに流し、agent の各ターン後に診断サマリーを追加します。そのターンで読み込まれた `SKILL.md` も表示されます。bridge から見える skill 利用状況として最も近いシグナルです。

`/model` コマンドは任意機能です。使う場合は target を設定します。

```env
PI_MODEL_TARGETS_JSON={"local":{"provider":"example-provider","model":"example-model","label":"Local model"}}
PI_MODEL_ALIASES_JSON={"fast":"local","local":"local"}
```

## systemd User Service

```bash
mkdir -p ~/.config/systemd/user
cp systemd-user.service.example ~/.config/systemd/user/synology-chat-pi-bridge.service
systemctl --user daemon-reload
systemctl --user enable --now synology-chat-pi-bridge.service
journalctl --user -u synology-chat-pi-bridge.service -f
```

## セキュリティメモ

- この bridge を直接インターネットへ公開しないでください。
- Synology webhook token は秘密として扱ってください。
- LAN 外から到達させる場合は、ファイアウォールまたは reverse proxy の allowlist を使ってください。
- `/files/...` は bridge の public ディレクトリへコピーされたファイルを配信します。LAN 内に公開されるものとして扱ってください。
- 多数のファイルを生成する場合、`PI_SYNOLOGY_DATA_DIR/public` と `uploads` の古いファイルを定期的に削除する cleanup job を用意してください。

## ステータス

Alpha。bridge は実用可能ですが、Synology のバージョンやクライアントによって outgoing attachment payload が異なる場合があります。デバッグしやすいよう、raw payload は `payloads.jsonl` に記録されます。
