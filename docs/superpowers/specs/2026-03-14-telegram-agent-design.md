# Telegram Agent Bot — Design Spec

## Overview

A Telegram bot that connects chats to Claude Code headless sessions, supporting both private and group conversations. Each chat is linked to a persistent LLM session. The bot supports media (images, documents, GIFs), per-chat personality configuration, and a flexible admin system managed through natural language.

An LLM Provider abstraction layer allows future support for OpenAI, Ollama, and other providers.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Telegram    │────▶│  Bot Core    │────▶│  LLM Provider   │
│  (grammy)   │◀────│              │◀────│  (interface)     │
└─────────────┘     │  - Router    │     └────────┬────────┘
                    │  - Queue     │              │
                    │  - Admin     │     ┌────────┴────────┐
                    │  - Config    │     │ Claude Code     │
                    └──────┬───────┘     │ Headless        │
                           │             └─────────────────┘
                    ┌──────┴───────┐
                    │   SQLite     │
                    │  (better-    │
                    │   sqlite3)   │
                    └──────────────┘
```

### Components

- **Telegram layer** — `grammy` for bot API, receives messages, sends responses (text, media, GIFs)
- **Bot Core** — routes messages, manages per-chat queues, admin system, configuration
- **LLM Provider interface** — abstraction for LLM interaction; first implementation: Claude Code headless via CLI
- **SQLite** — sessions, configuration, admin lists via `better-sqlite3`

## LLM Provider Interface

```typescript
interface LLMProvider {
  createSession(chatId: string, systemPrompt: string): Promise<Session>
  resumeSession(sessionId: string): Promise<Session>
  destroySession(sessionId: string): Promise<void>
  sendMessage(session: Session, message: MessageInput): Promise<MessageOutput>
  supportsTools(): boolean
  supportsMedia(): boolean
  supportsResume(): boolean
}

interface MessageInput {
  text?: string
  media?: MediaAttachment[]
  context?: string
}

interface MessageOutput {
  text?: string
  media?: MediaAttachment[]
  toolResults?: ToolResult[]  // results from tools like gif_search, admin_management
}
```

### Claude Code Headless Implementation

- `createSession` → spawns `claude --headless` with system prompt including chat-specific instructions
- `resumeSession` → spawns `claude --headless --resume <id>`. If resume fails (session expired, corrupted), automatically creates a new session and notifies the user in chat: "Vorige sessie kon niet hervat worden, nieuwe sessie gestart."
- `sendMessage` → sends JSON via stdin, reads JSON response from stdout
- Media is passed as base64 or file path to Claude
- Tools (`telegram_history`, `admin_management`, `gif_search`) are provided to Claude as an MCP server. The bot runs a lightweight MCP server (stdio transport) that exposes these tools, and passes the server config to Claude Code via the `--mcp-config` flag.

### Future Providers (OpenAI, Ollama)

- `supportsResume()` → `false` (manage context window manually)
- `supportsTools()` → depends on implementation
- Session management via own conversation history storage

## Message Routing and Queue

### Per-chat Queue

Each chatId gets its own FIFO queue. Messages are processed sequentially — only after the response to message 1 is sent does message 2 get forwarded to the LLM. This prevents race conditions in the session.

**Timeout**: If an LLM call takes longer than 120 seconds, it is cancelled, the user is notified ("Antwoord duurde te lang, probeer het opnieuw"), and the queue continues with the next message.

### Routing Modes (configurable per chat)

| Mode | Behavior | Default for |
|------|----------|-------------|
| `commands_only` | Responds only to `/commands` and direct mentions | Group chats |
| `all_messages` | Responds to every message | Private chats |
| `autonomous` | Reads everything, decides autonomously whether to respond | Only when explicitly set |

### Autonomous Mode

- Every incoming message is sent to the LLM with the chat-specific custom prompt
- The LLM receives a special instruction: respond with an empty response if it chooses not to react
- The LLM decides autonomously, guided by the custom prompt
- **Rate limiting**: In autonomous mode, a configurable cooldown period applies (default: 10 seconds). Messages arriving during cooldown are buffered and sent as a batch when the cooldown expires (max batch size: 20 messages). Batched messages are formatted as a conversation log with sender attribution:
  ```
  [14:23] @peter: Hey wat vinden jullie van...
  [14:23] @jan: Ik denk dat...
  [14:24] @peter: Maar dan...
  ```
  This prevents excessive LLM calls in busy group chats. The cooldown is configurable per chat via admin settings.

### Custom Prompt

Each chat/group can have a custom prompt that defines the bot's personality and behavior. This is a general-purpose instruction field — examples:

- "Je bent een sarcastische maar behulpzame assistent"
- "Als het over politiek gaat, meng je actief in het gesprek"
- "Reageer altijd in het Nederlands"

This prompt is included in every LLM interaction for that chat, regardless of routing mode.

### Other Behavior

- **Typing indicator**: The bot sends a "typing..." indicator while processing
- **Mentions in groups**: In `commands_only` mode, the bot also responds to `@botname` mentions

## Session Management

### Session Coupling

- Each chat (private or group) has at most one active LLM session
- Session ID is stored in SQLite linked to the chatId
- On the first message in a chat without a session, a new one is created automatically

### New Session Command (`/newsession`)

Configurable per chat:

| Setting | Behavior |
|---------|----------|
| `clean` | Clean slate, no context (default) |
| `recent_messages` | Pass last N Telegram messages to new session (N configurable) |
| `summary` | Old session creates a summary first, passed to the new session. The bot sends a final prompt ("Vat deze conversatie samen in maximaal 500 woorden") to the old session before destroying it. If the old session cannot be resumed, falls back to `recent_messages` mode. |

### Chat History Access for the LLM

The LLM session gets a `telegram_history` tool to query old messages. The system prompt tells the agent:

> "Je zit in een Telegram chat die mogelijk langer teruggaat dan je huidige sessie. Als je context nodig hebt van eerdere berichten, gebruik dan de `telegram_history` tool om gericht te zoeken in de chatgeschiedenis."

#### `telegram_history` Tool Interface

```typescript
// Parameters the LLM can pass
interface TelegramHistoryParams {
  chat_id: number
  query?: string        // text search within messages
  limit?: number        // max messages to return (default: 20, max: 100)
  offset_id?: number    // fetch messages before this message ID
  from_user?: string    // filter by username
}

// Returns
interface TelegramHistoryResult {
  messages: Array<{
    id: number
    from: string         // display name
    username?: string
    date: string         // ISO timestamp
    text: string
    reply_to?: number    // message ID this replies to
    has_media: boolean
    media_type?: string
  }>
}
```

The bot stores all incoming messages in a local SQLite `messages` table as they arrive. The `telegram_history` tool queries this local store — no MTProto or Bot API history calls needed. The chat_id is automatically injected by the bot — the LLM cannot query chats it's not part of. Note: history is only available from the moment the bot joined the chat.

## Admin System

### Default Admin (Owner)

- Configured via `OWNER_USER_ID` environment variable
- Owner is always admin in all chats and cannot be removed

### Per-group Admins

Managed via natural language in the chat:

- `@Bot maak @Peter admin` → adds Peter as admin
- `@Bot verwijder @Peter als admin` → removes Peter
- `@Bot wie zijn de admins?` → shows list

The LLM recognizes these intents and executes them via an `admin_management` tool. Only existing admins (and the owner) can add/remove admins.

#### `admin_management` Tool Interface

```typescript
// Parameters the LLM can pass
interface AdminManagementParams {
  action: 'add' | 'remove' | 'list'
  chat_id: number          // auto-injected
  requesting_user_id: number  // auto-injected, used for permission check
  target_user_id?: number  // required for add/remove
  target_username?: string // resolved to user_id from stored messages (only works for users the bot has seen)
}

// Returns
interface AdminManagementResult {
  success: boolean
  message: string          // human-readable result
  admins?: Array<{ user_id: number; username?: string }>  // for 'list' action
}
```

The tool checks permissions before executing: only the owner or existing admins can modify the admin list. The owner cannot be removed. If `target_username` cannot be resolved to a `user_id` (user never seen by the bot), the tool returns `{ success: false, message: "Gebruiker @username niet gevonden. Deze gebruiker moet eerst een bericht sturen in deze chat." }`.

### Admin Permissions

Admins can:

- Change routing mode
- Set custom prompt
- Change new-session settings
- Add/remove other admins (except the owner)

## Media Support

### Receiving

- Photos, documents, videos, voice messages → downloaded via Telegram API
- Images are passed as base64 to the LLM (Claude supports vision)
- Documents: PDF files are passed directly to Claude (which supports PDF input). Plain text files (.txt, .csv, .json, .md, etc.) are read as UTF-8 text. Other document types are noted as "[Unsupported document: filename.ext]" in the message to the LLM.
- Voice messages → transcribed using OpenAI Whisper API (requires `OPENAI_API_KEY` in config). The transcribed text is sent to the LLM as a quoted message with a note that it was a voice message. If `OPENAI_API_KEY` is not configured, the bot replies with "Voice berichten worden niet ondersteund (Whisper API niet geconfigureerd)" and the message is still stored in the messages table (with `has_media=1, media_type='voice'`, no text).

### Sending

- Text → regular Telegram messages (with markdown formatting)
- Images → if the LLM returns a `MediaAttachment` with type `image` in its output, it's sent as a photo in Telegram
- GIFs → the LLM gets a `gif_search` tool that searches Tenor API and returns the URL. The bot core sends the result as animation in Telegram. The `gifSearch` field on `MessageOutput` is removed in favor of this tool-based approach. The LLM decides when a GIF is appropriate based on the custom prompt/personality of the chat.

#### `gif_search` Tool Interface

```typescript
interface GifSearchParams {
  query: string         // search term chosen by the LLM
  limit?: number        // max results (default: 1, max: 5)
}

interface GifSearchResult {
  gifs: Array<{
    url: string         // direct GIF/MP4 URL
    preview_url: string
    title: string
  }>
}
```
- **Response ordering**: When the LLM produces both text and tool results (e.g., a text reply + a GIF), the text is sent first, then media/GIFs. Each is a separate Telegram message.
- Long messages → automatically split at markdown-safe boundaries (outside code blocks, not mid-paragraph) if they exceed the Telegram limit (4096 chars). Falls back to splitting at the last newline before the limit.

## Database Schema

```sql
CREATE TABLE chats (
  chat_id              INTEGER PRIMARY KEY,
  chat_type            TEXT NOT NULL,        -- 'private' | 'group' | 'supergroup'
  routing_mode         TEXT NOT NULL,        -- 'commands_only' | 'all_messages' | 'autonomous'
  custom_prompt        TEXT,
  new_session_mode     TEXT NOT NULL DEFAULT 'clean',
  recent_messages_count INTEGER DEFAULT 20,
  autonomous_cooldown  INTEGER DEFAULT 10,   -- seconds, for autonomous mode rate limiting
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id     INTEGER NOT NULL REFERENCES chats(chat_id),
  provider    TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at    TEXT
);

CREATE INDEX idx_sessions_chat_active ON sessions(chat_id, active);

-- Stored messages for telegram_history tool
CREATE TABLE messages (
  message_id   INTEGER NOT NULL,
  chat_id      INTEGER NOT NULL,
  user_id      INTEGER,
  username     TEXT,
  display_name TEXT,
  text         TEXT,
  has_media    INTEGER NOT NULL DEFAULT 0,
  media_type   TEXT,
  reply_to     INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (chat_id, message_id)
);

CREATE INDEX idx_messages_chat_date ON messages(chat_id, created_at);

CREATE TABLE chat_admins (
  chat_id   INTEGER NOT NULL REFERENCES chats(chat_id),
  user_id   INTEGER NOT NULL,
  added_by  INTEGER NOT NULL,
  added_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (chat_id, user_id)
);
```

## Project Structure

```
TelegramAgent/
├── src/
│   ├── index.ts
│   ├── bot/
│   │   ├── bot.ts
│   │   ├── router.ts
│   │   ├── queue.ts
│   │   └── media.ts
│   ├── llm/
│   │   ├── provider.ts
│   │   ├── session.ts
│   │   └── providers/
│   │       └── claude-code.ts
│   ├── admin/
│   │   └── admin.ts
│   ├── db/
│   │   ├── database.ts
│   │   └── migrations/
│   ├── tools/
│   │   ├── telegram-history.ts
│   │   └── gif-search.ts
│   └── config.ts
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── .env.example
```

## Configuration

```env
# Required
TELEGRAM_BOT_TOKEN=           # from @BotFather
OWNER_USER_ID=                # your Telegram user ID (always admin)

# LLM Provider
LLM_PROVIDER=claude-code      # 'claude-code' | later: 'openai' | 'ollama'

# Claude Code specific
CLAUDE_MODEL=                 # optional, e.g., 'claude-sonnet-4-20250514'

# GIF
TENOR_API_KEY=                # for GIF search

# Voice messages
OPENAI_API_KEY=               # for Whisper speech-to-text (optional, voice messages ignored without it)

# Database
DATABASE_PATH=./data/bot.db   # SQLite file location
```

Only `TELEGRAM_BOT_TOKEN` and `OWNER_USER_ID` are required to start. Everything else has sane defaults.

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Telegram**: grammy
- **Database**: better-sqlite3
- **LLM**: Claude Code CLI (headless mode)
- **GIFs**: Tenor API
- **Containerization**: Docker + docker-compose
