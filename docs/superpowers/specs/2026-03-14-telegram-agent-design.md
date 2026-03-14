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
  gifSearch?: string
}
```

### Claude Code Headless Implementation

- `createSession` → spawns `claude --headless` with system prompt including chat-specific instructions
- `resumeSession` → spawns `claude --headless --resume <id>`
- `sendMessage` → sends JSON via stdin, reads JSON response from stdout
- Media is passed as base64 or file path to Claude
- GIF search is made available as a tool to Claude (via Tenor API)

### Future Providers (OpenAI, Ollama)

- `supportsResume()` → `false` (manage context window manually)
- `supportsTools()` → depends on implementation
- Session management via own conversation history storage

## Message Routing and Queue

### Per-chat Queue

Each chatId gets its own FIFO queue. Messages are processed sequentially — only after the response to message 1 is sent does message 2 get forwarded to the LLM. This prevents race conditions in the session.

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
| `summary` | Old session creates a summary first, passed to the new session |

### Chat History Access for the LLM

The LLM session gets a tool to query the Telegram API for old messages. The system prompt tells the agent:

> "Je zit in een Telegram chat die mogelijk langer teruggaat dan je huidige sessie. Als je context nodig hebt van eerdere berichten, gebruik dan de `telegram_search` tool om gericht te zoeken in de chatgeschiedenis."

This lets the agent decide when to look back.

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
- Documents are extracted as text where possible, otherwise passed as file path
- Voice messages → speech-to-text via external service (e.g., Whisper) or passed as file

### Sending

- Text → regular Telegram messages (with markdown formatting)
- Images → if the LLM generates an image (via tools), it's sent as a photo
- GIFs → the LLM gets a `send_gif` tool that searches via Tenor/Giphy API and sends the result as animation in Telegram
- Long messages → automatically split if they exceed the Telegram limit (4096 chars)

### GIF Behavior

The LLM decides when a GIF is appropriate, based on the custom prompt/personality of the chat. The tool searches on a search term chosen by the LLM and sends the best result.

## Database Schema

```sql
CREATE TABLE chats (
  chat_id              INTEGER PRIMARY KEY,
  chat_type            TEXT NOT NULL,        -- 'private' | 'group' | 'supergroup'
  routing_mode         TEXT NOT NULL,        -- 'commands_only' | 'all_messages' | 'autonomous'
  custom_prompt        TEXT,
  new_session_mode     TEXT NOT NULL DEFAULT 'clean',
  recent_messages_count INTEGER DEFAULT 20,
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
