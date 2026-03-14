# Telegram Agent Bot Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Telegram bot that connects chats to Claude Code headless sessions with per-chat configuration, admin management, media support, and GIF sending.

**Architecture:** Grammy bot receives Telegram messages, routes them through a per-chat FIFO queue, and forwards them to an LLM provider (Claude Code CLI via `-p` flag with `--resume`). Tools (telegram_history, admin_management, gif_search) are exposed via an MCP server. All state is persisted in SQLite via better-sqlite3.

**Tech Stack:** TypeScript, Node.js, grammy, better-sqlite3, @modelcontextprotocol/sdk, Claude Code CLI

**Spec:** `docs/superpowers/specs/2026-03-14-telegram-agent-design.md`

---

## File Structure

```
TelegramAgent/
├── src/
│   ├── index.ts                    # Entry point: loads config, initializes DB, starts bot
│   ├── config.ts                   # Environment variable loading and validation
│   ├── bot/
│   │   ├── bot.ts                  # Grammy bot setup, middleware registration
│   │   ├── router.ts               # Message routing logic (commands_only/all_messages/autonomous)
│   │   ├── queue.ts                # Per-chat FIFO message queue with timeout
│   │   └── media.ts                # Media download/upload, message splitting, voice transcription
│   ├── llm/
│   │   ├── provider.ts             # LLMProvider interface and shared types
│   │   ├── session.ts              # Session manager: create/resume/destroy, DB integration
│   │   └── providers/
│   │       └── claude-code.ts      # Claude Code CLI headless implementation
│   ├── admin/
│   │   └── admin.ts                # Admin permission checks and CRUD operations
│   ├── db/
│   │   └── database.ts             # SQLite connection, schema creation, query helpers
│   └── tools/
│       ├── mcp-server.ts           # MCP server entry point, registers all tools
│       ├── telegram-history.ts     # telegram_history tool implementation
│       ├── admin-management.ts     # admin_management tool implementation
│       └── gif-search.ts           # gif_search tool implementation
├── tests/
│   ├── config.test.ts
│   ├── db/
│   │   └── database.test.ts
│   ├── admin/
│   │   └── admin.test.ts
│   ├── bot/
│   │   ├── router.test.ts
│   │   ├── queue.test.ts
│   │   └── media.test.ts
│   ├── llm/
│   │   ├── provider.test.ts
│   │   └── session.test.ts
│   └── tools/
│       ├── telegram-history.test.ts
│       ├── admin-management.test.ts
│       └── gif-search.test.ts
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── .gitignore
```

---

## Chunk 1: Project Setup, Config, and Database

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Initialize package.json**

```bash
cd D:/Projects/TelegramAgent
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install grammy better-sqlite3 dotenv form-data
npm install -D typescript @types/node @types/better-sqlite3 vitest @modelcontextprotocol/sdk zod tsx
```

- [ ] **Step 3: Create tsconfig.json**

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: Create .gitignore**

Create `.gitignore`:
```
node_modules/
dist/
data/
.env
*.db
```

- [ ] **Step 6: Create .env.example**

Create `.env.example`:
```env
# Required
TELEGRAM_BOT_TOKEN=
OWNER_USER_ID=

# LLM Provider
LLM_PROVIDER=claude-code

# Claude Code specific
CLAUDE_MODEL=

# GIF
TENOR_API_KEY=

# Voice messages
OPENAI_API_KEY=

# Database
DATABASE_PATH=./data/bot.db
```

- [ ] **Step 7: Add scripts to package.json**

Update `package.json` scripts:
```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "npx tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "mcp-server": "npx tsx src/tools/mcp-server.ts"
  }
}
```

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore .env.example
git commit -m "feat: scaffold project with TypeScript, vitest, grammy, better-sqlite3"
```

---

### Task 2: Config module

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/config.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load required config from environment', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.OWNER_USER_ID = '148010228';

    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();

    expect(config.telegramBotToken).toBe('test-token');
    expect(config.ownerUserId).toBe(148010228);
    expect(config.llmProvider).toBe('claude-code');
    expect(config.databasePath).toBe('./data/bot.db');
  });

  it('should throw if TELEGRAM_BOT_TOKEN is missing', async () => {
    process.env.OWNER_USER_ID = '148010228';
    delete process.env.TELEGRAM_BOT_TOKEN;

    const { loadConfig } = await import('../src/config.js');
    expect(() => loadConfig()).toThrow('TELEGRAM_BOT_TOKEN');
  });

  it('should throw if OWNER_USER_ID is missing', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    delete process.env.OWNER_USER_ID;

    const { loadConfig } = await import('../src/config.js');
    expect(() => loadConfig()).toThrow('OWNER_USER_ID');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `src/config.ts`:
```typescript
import 'dotenv/config';

export interface Config {
  telegramBotToken: string;
  ownerUserId: number;
  llmProvider: 'claude-code' | 'openai' | 'ollama';
  claudeModel?: string;
  tenorApiKey?: string;
  openaiApiKey?: string;
  databasePath: string;
}

export function loadConfig(): Config {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!telegramBotToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is required');
  }

  const ownerUserIdStr = process.env.OWNER_USER_ID;
  if (!ownerUserIdStr) {
    throw new Error('OWNER_USER_ID is required');
  }
  const ownerUserId = parseInt(ownerUserIdStr, 10);
  if (isNaN(ownerUserId)) {
    throw new Error('OWNER_USER_ID must be a number');
  }

  return {
    telegramBotToken,
    ownerUserId,
    llmProvider: (process.env.LLM_PROVIDER as Config['llmProvider']) || 'claude-code',
    claudeModel: process.env.CLAUDE_MODEL || undefined,
    tenorApiKey: process.env.TENOR_API_KEY || undefined,
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    databasePath: process.env.DATABASE_PATH || './data/bot.db',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add config module with env validation"
```

---

### Task 3: Database module

**Files:**
- Create: `src/db/database.ts`
- Create: `tests/db/database.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/database.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../src/db/database.js';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = './data/test.db';

describe('Database', () => {
  let db: Database;

  beforeEach(() => {
    fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
    db = new Database(TEST_DB_PATH);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  describe('chats', () => {
    it('should upsert and get a chat', () => {
      db.upsertChat(12345, 'private');
      const chat = db.getChat(12345);

      expect(chat).toBeDefined();
      expect(chat!.chat_id).toBe(12345);
      expect(chat!.chat_type).toBe('private');
      expect(chat!.routing_mode).toBe('all_messages');
    });

    it('should default group chats to commands_only', () => {
      db.upsertChat(12345, 'group');
      const chat = db.getChat(12345);

      expect(chat!.routing_mode).toBe('commands_only');
    });

    it('should update chat settings', () => {
      db.upsertChat(12345, 'private');
      db.updateChat(12345, { routing_mode: 'autonomous', custom_prompt: 'Be funny' });
      const chat = db.getChat(12345);

      expect(chat!.routing_mode).toBe('autonomous');
      expect(chat!.custom_prompt).toBe('Be funny');
    });
  });

  describe('sessions', () => {
    it('should create and get active session', () => {
      db.upsertChat(12345, 'private');
      db.createSession(12345, 'claude-code', 'session-abc');
      const session = db.getActiveSession(12345);

      expect(session).toBeDefined();
      expect(session!.session_id).toBe('session-abc');
      expect(session!.active).toBe(1);
    });

    it('should deactivate session', () => {
      db.upsertChat(12345, 'private');
      db.createSession(12345, 'claude-code', 'session-abc');
      db.deactivateSession(12345);
      const session = db.getActiveSession(12345);

      expect(session).toBeUndefined();
    });
  });

  describe('messages', () => {
    it('should store and query messages', () => {
      db.upsertChat(12345, 'private');
      db.storeMessage({
        message_id: 1,
        chat_id: 12345,
        user_id: 999,
        username: 'testuser',
        display_name: 'Test User',
        text: 'Hello world',
        has_media: false,
      });

      const messages = db.getMessages(12345, { limit: 10 });
      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe('Hello world');
    });

    it('should search messages by query', () => {
      db.upsertChat(12345, 'private');
      db.storeMessage({
        message_id: 1, chat_id: 12345, user_id: 999,
        username: 'testuser', display_name: 'Test', text: 'Hello world', has_media: false,
      });
      db.storeMessage({
        message_id: 2, chat_id: 12345, user_id: 999,
        username: 'testuser', display_name: 'Test', text: 'Goodbye world', has_media: false,
      });

      const results = db.getMessages(12345, { query: 'Goodbye', limit: 10 });
      expect(results).toHaveLength(1);
      expect(results[0].text).toBe('Goodbye world');
    });

    it('should filter messages by username', () => {
      db.upsertChat(12345, 'private');
      db.storeMessage({
        message_id: 1, chat_id: 12345, user_id: 999,
        username: 'alice', display_name: 'Alice', text: 'Hi', has_media: false,
      });
      db.storeMessage({
        message_id: 2, chat_id: 12345, user_id: 888,
        username: 'bob', display_name: 'Bob', text: 'Hey', has_media: false,
      });

      const results = db.getMessages(12345, { from_user: 'alice', limit: 10 });
      expect(results).toHaveLength(1);
      expect(results[0].username).toBe('alice');
    });
  });

  describe('admins', () => {
    it('should add and list admins', () => {
      db.upsertChat(12345, 'group');
      db.addAdmin(12345, 999, 148010228);
      const admins = db.getAdmins(12345);

      expect(admins).toHaveLength(1);
      expect(admins[0].user_id).toBe(999);
    });

    it('should remove an admin', () => {
      db.upsertChat(12345, 'group');
      db.addAdmin(12345, 999, 148010228);
      db.removeAdmin(12345, 999);
      const admins = db.getAdmins(12345);

      expect(admins).toHaveLength(0);
    });

    it('should resolve username to user_id', () => {
      db.upsertChat(12345, 'private');
      db.storeMessage({
        message_id: 1, chat_id: 12345, user_id: 999,
        username: 'peter', display_name: 'Peter', text: 'Hi', has_media: false,
      });

      const userId = db.resolveUsername(12345, 'peter');
      expect(userId).toBe(999);
    });

    it('should return undefined for unknown username', () => {
      db.upsertChat(12345, 'private');
      const userId = db.resolveUsername(12345, 'unknown');
      expect(userId).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/database.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `src/db/database.ts`:
```typescript
import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export interface ChatRow {
  chat_id: number;
  chat_type: string;
  routing_mode: string;
  custom_prompt: string | null;
  new_session_mode: string;
  recent_messages_count: number;
  autonomous_cooldown: number;
  created_at: string;
}

export interface SessionRow {
  id: number;
  chat_id: number;
  provider: string;
  session_id: string;
  active: number;
  created_at: string;
  ended_at: string | null;
}

export interface MessageRow {
  message_id: number;
  chat_id: number;
  user_id: number | null;
  username: string | null;
  display_name: string | null;
  text: string | null;
  has_media: number;
  media_type: string | null;
  reply_to: number | null;
  created_at: string;
}

export interface AdminRow {
  chat_id: number;
  user_id: number;
  added_by: number;
  added_at: string;
}

export interface StoreMessageInput {
  message_id: number;
  chat_id: number;
  user_id?: number | null;
  username?: string | null;
  display_name?: string | null;
  text?: string | null;
  has_media: boolean;
  media_type?: string | null;
  reply_to?: number | null;
}

export interface GetMessagesOptions {
  query?: string;
  limit: number;
  offset_id?: number;
  from_user?: string;
}

export class Database {
  private db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        chat_id              INTEGER PRIMARY KEY,
        chat_type            TEXT NOT NULL,
        routing_mode         TEXT NOT NULL,
        custom_prompt        TEXT,
        new_session_mode     TEXT NOT NULL DEFAULT 'clean',
        recent_messages_count INTEGER DEFAULT 20,
        autonomous_cooldown  INTEGER DEFAULT 10,
        created_at           TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id     INTEGER NOT NULL REFERENCES chats(chat_id),
        provider    TEXT NOT NULL,
        session_id  TEXT NOT NULL,
        active      INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at    TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_chat_active ON sessions(chat_id, active);

      CREATE TABLE IF NOT EXISTS messages (
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

      CREATE INDEX IF NOT EXISTS idx_messages_chat_date ON messages(chat_id, created_at);

      CREATE TABLE IF NOT EXISTS chat_admins (
        chat_id   INTEGER NOT NULL REFERENCES chats(chat_id),
        user_id   INTEGER NOT NULL,
        added_by  INTEGER NOT NULL,
        added_at  TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (chat_id, user_id)
      );
    `);
  }

  upsertChat(chatId: number, chatType: string): void {
    const defaultMode = chatType === 'private' ? 'all_messages' : 'commands_only';
    this.db.prepare(`
      INSERT INTO chats (chat_id, chat_type, routing_mode)
      VALUES (?, ?, ?)
      ON CONFLICT(chat_id) DO NOTHING
    `).run(chatId, chatType, defaultMode);
  }

  getChat(chatId: number): ChatRow | undefined {
    return this.db.prepare('SELECT * FROM chats WHERE chat_id = ?').get(chatId) as ChatRow | undefined;
  }

  updateChat(chatId: number, updates: Partial<Pick<ChatRow, 'routing_mode' | 'custom_prompt' | 'new_session_mode' | 'recent_messages_count' | 'autonomous_cooldown'>>): void {
    const ALLOWED_COLUMNS = new Set(['routing_mode', 'custom_prompt', 'new_session_mode', 'recent_messages_count', 'autonomous_cooldown']);
    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && ALLOWED_COLUMNS.has(key)) {
        setClauses.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (setClauses.length === 0) return;

    values.push(chatId);
    this.db.prepare(`UPDATE chats SET ${setClauses.join(', ')} WHERE chat_id = ?`).run(...values);
  }

  createSession(chatId: number, provider: string, sessionId: string): void {
    this.db.prepare(`
      INSERT INTO sessions (chat_id, provider, session_id) VALUES (?, ?, ?)
    `).run(chatId, provider, sessionId);
  }

  getActiveSession(chatId: number): SessionRow | undefined {
    return this.db.prepare(
      'SELECT * FROM sessions WHERE chat_id = ? AND active = 1 ORDER BY id DESC LIMIT 1'
    ).get(chatId) as SessionRow | undefined;
  }

  deactivateSession(chatId: number): void {
    this.db.prepare(
      "UPDATE sessions SET active = 0, ended_at = datetime('now') WHERE chat_id = ? AND active = 1"
    ).run(chatId);
  }

  storeMessage(msg: StoreMessageInput): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO messages (message_id, chat_id, user_id, username, display_name, text, has_media, media_type, reply_to)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      msg.message_id, msg.chat_id, msg.user_id ?? null, msg.username ?? null,
      msg.display_name ?? null, msg.text ?? null, msg.has_media ? 1 : 0,
      msg.media_type ?? null, msg.reply_to ?? null
    );
  }

  getMessages(chatId: number, options: GetMessagesOptions): MessageRow[] {
    const conditions = ['chat_id = ?'];
    const params: unknown[] = [chatId];

    if (options.query) {
      conditions.push('text LIKE ?');
      params.push(`%${options.query}%`);
    }
    if (options.offset_id) {
      conditions.push('message_id < ?');
      params.push(options.offset_id);
    }
    if (options.from_user) {
      conditions.push('username = ?');
      params.push(options.from_user);
    }

    const limit = Math.min(options.limit, 100);
    params.push(limit);

    return this.db.prepare(
      `SELECT * FROM messages WHERE ${conditions.join(' AND ')} ORDER BY message_id DESC LIMIT ?`
    ).all(...params) as MessageRow[];
  }

  getRecentMessages(chatId: number, count: number): MessageRow[] {
    return this.db.prepare(
      'SELECT * FROM messages WHERE chat_id = ? ORDER BY message_id DESC LIMIT ?'
    ).all(chatId, count) as MessageRow[];
  }

  addAdmin(chatId: number, userId: number, addedBy: number): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO chat_admins (chat_id, user_id, added_by) VALUES (?, ?, ?)
    `).run(chatId, userId, addedBy);
  }

  removeAdmin(chatId: number, userId: number): void {
    this.db.prepare('DELETE FROM chat_admins WHERE chat_id = ? AND user_id = ?').run(chatId, userId);
  }

  getAdmins(chatId: number): AdminRow[] {
    return this.db.prepare('SELECT * FROM chat_admins WHERE chat_id = ?').all(chatId) as AdminRow[];
  }

  resolveUsername(chatId: number, username: string): number | undefined {
    const row = this.db.prepare(
      'SELECT user_id FROM messages WHERE chat_id = ? AND username = ? ORDER BY message_id DESC LIMIT 1'
    ).get(chatId, username) as { user_id: number } | undefined;
    return row?.user_id;
  }

  resolveUsernameByUserId(chatId: number, userId: number): string | undefined {
    const row = this.db.prepare(
      'SELECT username FROM messages WHERE chat_id = ? AND user_id = ? AND username IS NOT NULL ORDER BY message_id DESC LIMIT 1'
    ).get(chatId, userId) as { username: string } | undefined;
    return row?.username;
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db/database.test.ts`
Expected: PASS (all 9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/database.ts tests/db/database.test.ts
git commit -m "feat: add database module with schema, CRUD operations, and tests"
```

---

## Chunk 2: LLM Provider Interface and Claude Code Implementation

### Task 4: LLM Provider interface and types

**Files:**
- Create: `src/llm/provider.ts`
- Create: `tests/llm/provider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/llm/provider.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import type { LLMProvider, Session, MessageInput, MessageOutput, MediaAttachment } from '../../src/llm/provider.js';

describe('LLMProvider types', () => {
  it('should allow creating a provider-conforming object', () => {
    const mockProvider: LLMProvider = {
      createSession: async () => ({ id: 'test', chatId: '123', provider: 'test' }),
      resumeSession: async () => ({ id: 'test', chatId: '123', provider: 'test' }),
      destroySession: async () => {},
      sendMessage: async () => ({ text: 'response' }),
      supportsTools: () => false,
      supportsMedia: () => false,
      supportsResume: () => false,
    };

    expect(mockProvider.supportsTools()).toBe(false);
    expect(mockProvider.supportsResume()).toBe(false);
  });

  it('Session type should have required fields', () => {
    const session: Session = { id: 'abc', chatId: '123', provider: 'claude-code' };
    expect(session.id).toBe('abc');
    expect(session.chatId).toBe('123');
    expect(session.provider).toBe('claude-code');
  });

  it('MediaAttachment type should support all media types', () => {
    const image: MediaAttachment = { type: 'image', data: Buffer.from(''), mimeType: 'image/png' };
    const gif: MediaAttachment = { type: 'gif', data: 'https://example.com/cat.gif', mimeType: 'image/gif' };
    expect(image.type).toBe('image');
    expect(gif.type).toBe('gif');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/llm/provider.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `src/llm/provider.ts`:
```typescript
export interface Session {
  id: string;
  chatId: string;
  provider: string;
}

export interface MediaAttachment {
  type: 'image' | 'document' | 'video' | 'audio' | 'gif';
  data: Buffer | string;
  mimeType: string;
  filename?: string;
}

export interface MessageInput {
  text?: string;
  media?: MediaAttachment[];
  context?: string;
}

export interface ToolResult {
  tool: string;
  result: unknown;
}

export interface MessageOutput {
  text?: string;
  media?: MediaAttachment[];
  toolResults?: ToolResult[];
}

export class LLMError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'LLMError';
  }
}

export interface LLMProvider {
  createSession(chatId: string, systemPrompt: string): Promise<Session>;
  resumeSession(sessionId: string): Promise<Session>;
  destroySession(sessionId: string): Promise<void>;
  sendMessage(session: Session, message: MessageInput): Promise<MessageOutput>;
  supportsTools(): boolean;
  supportsMedia(): boolean;
  supportsResume(): boolean;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/llm/provider.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/llm/provider.ts tests/llm/provider.test.ts
git commit -m "feat: add LLM provider interface and shared types"
```

---

### Task 5: Claude Code headless provider

**Files:**
- Create: `src/llm/providers/claude-code.ts`
- Create: `tests/llm/providers/claude-code.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/llm/providers/claude-code.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeCodeProvider } from '../../../src/llm/providers/claude-code.js';
import * as child_process from 'child_process';

vi.mock('child_process');

function mockSpawn(stdout: string, code: number = 0) {
  const proc = {
    stdout: { on: vi.fn((event: string, cb: Function) => { if (event === 'data') cb(Buffer.from(stdout)); }) },
    stderr: { on: vi.fn((event: string, cb: Function) => { if (event === 'data') cb(Buffer.from('')); }) },
    on: vi.fn((event: string, cb: Function) => { if (event === 'close') setTimeout(() => cb(code), 0); }),
  };
  vi.mocked(child_process.spawn).mockReturnValue(proc as any);
  return proc;
}

describe('ClaudeCodeProvider', () => {
  let provider: ClaudeCodeProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new ClaudeCodeProvider({ model: 'claude-sonnet-4-20250514' });
  });

  it('should create a session and return session_id', async () => {
    mockSpawn(JSON.stringify({ session_id: 'sess-123', result: 'ok' }));
    const session = await provider.createSession('chat-1', 'You are a bot');
    expect(session.id).toBe('sess-123');
    expect(session.provider).toBe('claude-code');

    const args = vi.mocked(child_process.spawn).mock.calls[0][1] as string[];
    expect(args).toContain('--system-prompt');
    expect(args).toContain('--model');
  });

  it('should pass --resume and --model on sendMessage', async () => {
    mockSpawn(JSON.stringify({ session_id: 'sess-123', result: 'hello' }));
    const session = { id: 'sess-123', chatId: 'chat-1', provider: 'claude-code' };
    await provider.sendMessage(session, { text: 'Hi' });

    const args = vi.mocked(child_process.spawn).mock.calls[0][1] as string[];
    expect(args).toContain('--resume');
    expect(args).toContain('sess-123');
    expect(args).toContain('--model');
    expect(args).toContain('claude-sonnet-4-20250514');
  });

  it('should throw LLMError on non-zero exit', async () => {
    mockSpawn('', 1);
    const session = { id: 'sess-123', chatId: 'chat-1', provider: 'claude-code' };
    await expect(provider.sendMessage(session, { text: 'Hi' })).rejects.toThrow('Claude Code failed');
  });

  it('should report capabilities correctly', () => {
    expect(provider.supportsTools()).toBe(true);
    expect(provider.supportsMedia()).toBe(true);
    expect(provider.supportsResume()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/llm/providers/claude-code.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `src/llm/providers/claude-code.ts`:
```typescript
import { spawn } from 'child_process';
import { LLMProvider, Session, MessageInput, MessageOutput, LLMError } from '../provider.js';

export interface ClaudeCodeConfig {
  model?: string;
  mcpConfigPath?: string;
  allowedTools?: string[];
}

export class ClaudeCodeProvider implements LLMProvider {
  private config: ClaudeCodeConfig;

  constructor(config: ClaudeCodeConfig = {}) {
    this.config = config;
  }

  async createSession(chatId: string, systemPrompt: string): Promise<Session> {
    // Send a minimal prompt to establish a session and capture session_id.
    // This is required because `claude -p` is stateless per invocation;
    // we need the session_id to use --resume on subsequent calls.
    const args = this.buildBaseArgs();
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }
    args.push('-p', 'Je bent verbonden met een Telegram chat. Klaar om te helpen.');
    args.push('--output-format', 'json');

    const result = await this.runClaude(args);
    const parsed = JSON.parse(result);

    return {
      id: parsed.session_id,
      chatId,
      provider: 'claude-code',
    };
  }

  async resumeSession(sessionId: string): Promise<Session> {
    // We don't verify the session eagerly — if resume fails,
    // sendMessage will throw and the SessionManager handles fallback.
    return {
      id: sessionId,
      chatId: '',
      provider: 'claude-code',
    };
  }

  async destroySession(_sessionId: string): Promise<void> {
    // Claude Code sessions are managed by the CLI; nothing to clean up
  }

  async sendMessage(session: Session, message: MessageInput): Promise<MessageOutput> {
    const prompt = this.buildPrompt(message);
    const args = this.buildBaseArgs();
    args.push('-p', prompt);
    args.push('--resume', session.id);
    args.push('--output-format', 'json');

    try {
      const result = await this.runClaude(args);
      const parsed = JSON.parse(result);
      return { text: parsed.result || '' };
    } catch (error) {
      throw new LLMError(
        `Claude Code failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  supportsTools(): boolean { return true; }
  supportsMedia(): boolean { return true; }
  supportsResume(): boolean { return true; }

  private buildBaseArgs(): string[] {
    const args: string[] = [];
    if (this.config.model) {
      args.push('--model', this.config.model);
    }
    if (this.config.mcpConfigPath) {
      args.push('--mcp-config', this.config.mcpConfigPath);
    }
    if (this.config.allowedTools?.length) {
      args.push('--allowedTools', this.config.allowedTools.join(','));
    }
    return args;
  }

  private buildPrompt(message: MessageInput): string {
    const parts: string[] = [];
    if (message.context) {
      parts.push(`[Context]\n${message.context}`);
    }
    if (message.text) {
      parts.push(message.text);
    }
    // Note: media (images, PDFs) are passed as file paths or URLs in the text.
    // Claude Code CLI accepts these natively when included in the prompt.
    if (message.media?.length) {
      for (const media of message.media) {
        if (typeof media.data === 'string') {
          // URL or file path — include directly
          parts.push(`[Attached ${media.type}: ${media.data}]`);
        } else {
          // Binary data — save to temp file (handled by caller in bot.ts)
          parts.push(`[Attached ${media.type}: ${media.filename || 'attachment'}]`);
        }
      }
    }
    return parts.join('\n\n');
  }

  private runClaude(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`claude exited with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn claude: ${err.message}`));
      });
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/llm/providers/claude-code.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/llm/providers/claude-code.ts tests/llm/providers/claude-code.test.ts
git commit -m "feat: add Claude Code headless provider using CLI -p flag with tests"
```

---

### Task 6: Session manager

**Files:**
- Create: `src/llm/session.ts`
- Create: `tests/llm/session.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/llm/session.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../../src/llm/session.js';
import type { LLMProvider, Session } from '../../src/llm/provider.js';
import type { Database } from '../../src/db/database.js';

function createMockProvider(): LLMProvider {
  return {
    createSession: vi.fn(async (chatId: string) => ({
      id: `session-${chatId}`,
      chatId,
      provider: 'mock',
    })),
    resumeSession: vi.fn(async (sessionId: string) => ({
      id: sessionId,
      chatId: '',
      provider: 'mock',
    })),
    destroySession: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => ({ text: 'response' })),
    supportsTools: () => true,
    supportsMedia: () => true,
    supportsResume: () => true,
  };
}

function createMockDb(): Partial<Database> {
  const sessions: Record<number, { session_id: string; active: number }> = {};
  return {
    getActiveSession: vi.fn((chatId: number) => {
      const s = sessions[chatId];
      return s?.active ? { id: 1, chat_id: chatId, provider: 'mock', session_id: s.session_id, active: 1, created_at: '', ended_at: null } : undefined;
    }),
    createSession: vi.fn((chatId: number, provider: string, sessionId: string) => {
      sessions[chatId] = { session_id: sessionId, active: 1 };
    }),
    deactivateSession: vi.fn((chatId: number) => {
      if (sessions[chatId]) sessions[chatId].active = 0;
    }),
    getChat: vi.fn(() => ({
      chat_id: 12345, chat_type: 'private', routing_mode: 'all_messages',
      custom_prompt: null, new_session_mode: 'clean', recent_messages_count: 20,
      autonomous_cooldown: 10, created_at: '',
    })),
    getRecentMessages: vi.fn(() => []),
  };
}

describe('SessionManager', () => {
  let provider: LLMProvider;
  let db: Partial<Database>;
  let manager: SessionManager;

  beforeEach(() => {
    provider = createMockProvider();
    db = createMockDb();
    manager = new SessionManager(provider, db as Database);
  });

  it('should create a new session when none exists', async () => {
    const session = await manager.getOrCreateSession(12345, 'You are a bot.');
    expect(session.id).toBe('session-12345');
    expect(db.createSession).toHaveBeenCalledWith(12345, 'mock', 'session-12345');
  });

  it('should resume existing session', async () => {
    // First create
    await manager.getOrCreateSession(12345, 'You are a bot.');
    // Then get again — should resume
    const session = await manager.getOrCreateSession(12345, 'You are a bot.');
    expect(provider.resumeSession).toHaveBeenCalled();
  });

  it('should create new session on /newsession', async () => {
    await manager.getOrCreateSession(12345, 'You are a bot.');
    await manager.newSession(12345, 'You are a bot.');
    expect(db.deactivateSession).toHaveBeenCalledWith(12345);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/llm/session.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `src/llm/session.ts`:
```typescript
import { LLMProvider, Session, LLMError } from './provider.js';
import { Database } from '../db/database.js';

export class SessionManager {
  private provider: LLMProvider;
  private db: Database;

  constructor(provider: LLMProvider, db: Database) {
    this.provider = provider;
    this.db = db;
  }

  async getOrCreateSession(chatId: number, systemPrompt: string): Promise<Session> {
    const existing = this.db.getActiveSession(chatId);

    if (existing && this.provider.supportsResume()) {
      try {
        const session = await this.provider.resumeSession(existing.session_id);
        session.chatId = String(chatId);
        return session;
      } catch {
        // Resume failed — fall through to create new
        this.db.deactivateSession(chatId);
      }
    }

    const session = await this.provider.createSession(String(chatId), systemPrompt);
    this.db.createSession(chatId, session.provider, session.id);
    return session;
  }

  async newSession(chatId: number, systemPrompt: string): Promise<{ session: Session; resumeFailed?: boolean }> {
    const chat = this.db.getChat(chatId);
    const mode = chat?.new_session_mode || 'clean';
    let context: string | undefined;

    if (mode === 'summary') {
      const existing = this.db.getActiveSession(chatId);
      if (existing && this.provider.supportsResume()) {
        try {
          const oldSession = await this.provider.resumeSession(existing.session_id);
          const summary = await this.provider.sendMessage(oldSession, {
            text: 'Vat deze conversatie samen in maximaal 500 woorden.',
          });
          context = summary.text || undefined;
        } catch {
          // Fall back to recent_messages
          const count = chat?.recent_messages_count || 20;
          const messages = this.db.getRecentMessages(chatId, count);
          context = this.formatMessagesAsContext(messages);
        }
      }
    } else if (mode === 'recent_messages') {
      const count = chat?.recent_messages_count || 20;
      const messages = this.db.getRecentMessages(chatId, count);
      context = this.formatMessagesAsContext(messages);
    }

    this.db.deactivateSession(chatId);
    const session = await this.provider.createSession(String(chatId), systemPrompt);
    this.db.createSession(chatId, session.provider, session.id);

    if (context) {
      await this.provider.sendMessage(session, {
        context: `Vorige conversatie context:\n${context}`,
        text: 'Nieuwe sessie gestart. Bovenstaande context is van de vorige sessie.',
      });
    }

    return { session };
  }

  private formatMessagesAsContext(messages: { display_name?: string | null; username?: string | null; text?: string | null; created_at: string }[]): string {
    return [...messages]
      .reverse()
      .map((m) => {
        const name = m.username ? `@${m.username}` : m.display_name || 'Unknown';
        const time = m.created_at.slice(11, 16);
        return `[${time}] ${name}: ${m.text || '[media]'}`;
      })
      .join('\n');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/llm/session.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/llm/session.ts tests/llm/session.test.ts
git commit -m "feat: add session manager with create/resume/newsession logic"
```

---

## Chunk 3: Admin System and MCP Tools

### Task 7: Admin module

**Files:**
- Create: `src/admin/admin.ts`
- Create: `tests/admin/admin.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/admin/admin.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AdminService } from '../../src/admin/admin.js';
import { Database } from '../../src/db/database.js';
import fs from 'fs';

const TEST_DB_PATH = './data/test-admin.db';
const OWNER_ID = 148010228;

describe('AdminService', () => {
  let db: Database;
  let admin: AdminService;

  beforeEach(() => {
    fs.mkdirSync('data', { recursive: true });
    db = new Database(TEST_DB_PATH);
    admin = new AdminService(db, OWNER_ID);
    db.upsertChat(12345, 'group');
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  it('should always consider owner as admin', () => {
    expect(admin.isAdmin(12345, OWNER_ID)).toBe(true);
  });

  it('should not consider random user as admin', () => {
    expect(admin.isAdmin(12345, 999)).toBe(false);
  });

  it('should allow owner to add admin', () => {
    const result = admin.addAdmin(12345, 999, OWNER_ID);
    expect(result.success).toBe(true);
    expect(admin.isAdmin(12345, 999)).toBe(true);
  });

  it('should not allow non-admin to add admin', () => {
    const result = admin.addAdmin(12345, 999, 777);
    expect(result.success).toBe(false);
  });

  it('should allow admin to add another admin', () => {
    admin.addAdmin(12345, 888, OWNER_ID);
    const result = admin.addAdmin(12345, 999, 888);
    expect(result.success).toBe(true);
  });

  it('should not allow removing owner', () => {
    const result = admin.removeAdmin(12345, OWNER_ID, 999);
    expect(result.success).toBe(false);
  });

  it('should list admins', () => {
    admin.addAdmin(12345, 999, OWNER_ID);
    const list = admin.listAdmins(12345);
    expect(list).toHaveLength(1);
    expect(list[0].user_id).toBe(999);
  });

  it('should resolve username and add admin', () => {
    db.storeMessage({
      message_id: 1, chat_id: 12345, user_id: 999,
      username: 'peter', display_name: 'Peter', text: 'Hi', has_media: false,
    });
    const result = admin.addAdminByUsername(12345, 'peter', OWNER_ID);
    expect(result.success).toBe(true);
    expect(admin.isAdmin(12345, 999)).toBe(true);
  });

  it('should fail to resolve unknown username', () => {
    const result = admin.addAdminByUsername(12345, 'unknown', OWNER_ID);
    expect(result.success).toBe(false);
    expect(result.message).toContain('niet gevonden');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/admin/admin.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `src/admin/admin.ts`:
```typescript
import { Database, AdminRow } from '../db/database.js';

export interface AdminResult {
  success: boolean;
  message: string;
  admins?: Array<{ user_id: number; username?: string }>;
}

export class AdminService {
  private db: Database;
  private ownerId: number;

  constructor(db: Database, ownerId: number) {
    this.db = db;
    this.ownerId = ownerId;
  }

  isAdmin(chatId: number, userId: number): boolean {
    if (userId === this.ownerId) return true;
    const admins = this.db.getAdmins(chatId);
    return admins.some((a) => a.user_id === userId);
  }

  addAdmin(chatId: number, targetUserId: number, requestingUserId: number): AdminResult {
    if (!this.isAdmin(chatId, requestingUserId)) {
      return { success: false, message: 'Je hebt geen rechten om admins toe te voegen.' };
    }
    this.db.addAdmin(chatId, targetUserId, requestingUserId);
    return { success: true, message: `Gebruiker ${targetUserId} is nu admin.` };
  }

  addAdminByUsername(chatId: number, username: string, requestingUserId: number): AdminResult {
    if (!this.isAdmin(chatId, requestingUserId)) {
      return { success: false, message: 'Je hebt geen rechten om admins toe te voegen.' };
    }
    const userId = this.db.resolveUsername(chatId, username);
    if (!userId) {
      return {
        success: false,
        message: `Gebruiker @${username} niet gevonden. Deze gebruiker moet eerst een bericht sturen in deze chat.`,
      };
    }
    this.db.addAdmin(chatId, userId, requestingUserId);
    return { success: true, message: `@${username} is nu admin.` };
  }

  removeAdmin(chatId: number, targetUserId: number, requestingUserId: number): AdminResult {
    if (targetUserId === this.ownerId) {
      return { success: false, message: 'De owner kan niet verwijderd worden als admin.' };
    }
    if (!this.isAdmin(chatId, requestingUserId)) {
      return { success: false, message: 'Je hebt geen rechten om admins te verwijderen.' };
    }
    this.db.removeAdmin(chatId, targetUserId);
    return { success: true, message: `Gebruiker ${targetUserId} is geen admin meer.` };
  }

  removeAdminByUsername(chatId: number, username: string, requestingUserId: number): AdminResult {
    const userId = this.db.resolveUsername(chatId, username);
    if (!userId) {
      return { success: false, message: `Gebruiker @${username} niet gevonden.` };
    }
    return this.removeAdmin(chatId, userId, requestingUserId);
  }

  listAdmins(chatId: number): AdminRow[] {
    return this.db.getAdmins(chatId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/admin/admin.test.ts`
Expected: PASS (all 9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/admin/admin.ts tests/admin/admin.test.ts
git commit -m "feat: add admin service with permission checks and username resolution"
```

---

### Task 8: MCP tools — telegram_history

**Files:**
- Create: `src/tools/telegram-history.ts`
- Create: `tests/tools/telegram-history.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tools/telegram-history.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleTelegramHistory } from '../../src/tools/telegram-history.js';
import { Database } from '../../src/db/database.js';
import fs from 'fs';

const TEST_DB_PATH = './data/test-history.db';

describe('telegram_history tool', () => {
  let db: Database;

  beforeEach(() => {
    fs.mkdirSync('data', { recursive: true });
    db = new Database(TEST_DB_PATH);
    db.upsertChat(12345, 'group');

    for (let i = 1; i <= 5; i++) {
      db.storeMessage({
        message_id: i, chat_id: 12345, user_id: 100 + i,
        username: `user${i}`, display_name: `User ${i}`,
        text: `Message number ${i}`, has_media: false,
      });
    }
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  it('should return messages for a chat', () => {
    const result = handleTelegramHistory(db, { chat_id: 12345, limit: 10 });
    expect(result.messages).toHaveLength(5);
  });

  it('should respect limit', () => {
    const result = handleTelegramHistory(db, { chat_id: 12345, limit: 2 });
    expect(result.messages).toHaveLength(2);
  });

  it('should filter by query', () => {
    const result = handleTelegramHistory(db, { chat_id: 12345, query: 'number 3', limit: 10 });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe('Message number 3');
  });

  it('should filter by username', () => {
    const result = handleTelegramHistory(db, { chat_id: 12345, from_user: 'user2', limit: 10 });
    expect(result.messages).toHaveLength(1);
  });

  it('should cap limit at 100', () => {
    const result = handleTelegramHistory(db, { chat_id: 12345, limit: 999 });
    // Only 5 messages exist, but the limit should be capped internally
    expect(result.messages.length).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/telegram-history.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `src/tools/telegram-history.ts`:
```typescript
import { Database, MessageRow } from '../db/database.js';

export interface TelegramHistoryParams {
  chat_id: number;
  query?: string;
  limit?: number;
  offset_id?: number;
  from_user?: string;
}

export interface TelegramHistoryMessage {
  id: number;
  from: string;
  username?: string;
  date: string;
  text: string;
  reply_to?: number;
  has_media: boolean;
  media_type?: string;
}

export interface TelegramHistoryResult {
  messages: TelegramHistoryMessage[];
}

export function handleTelegramHistory(db: Database, params: TelegramHistoryParams): TelegramHistoryResult {
  const limit = Math.min(params.limit || 20, 100);

  const rows = db.getMessages(params.chat_id, {
    query: params.query,
    limit,
    offset_id: params.offset_id,
    from_user: params.from_user,
  });

  const messages: TelegramHistoryMessage[] = rows.map((row: MessageRow) => ({
    id: row.message_id,
    from: row.display_name || 'Unknown',
    username: row.username || undefined,
    date: row.created_at,
    text: row.text || '',
    reply_to: row.reply_to || undefined,
    has_media: row.has_media === 1,
    media_type: row.media_type || undefined,
  }));

  return { messages };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools/telegram-history.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/telegram-history.ts tests/tools/telegram-history.test.ts
git commit -m "feat: add telegram_history tool with search and filtering"
```

---

### Task 9: MCP tools — admin_management

**Files:**
- Create: `src/tools/admin-management.ts`
- Create: `tests/tools/admin-management.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tools/admin-management.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleAdminManagement } from '../../src/tools/admin-management.js';
import { AdminService } from '../../src/admin/admin.js';
import { Database } from '../../src/db/database.js';
import fs from 'fs';

const TEST_DB_PATH = './data/test-admin-tool.db';
const OWNER_ID = 148010228;

describe('admin_management tool', () => {
  let db: Database;
  let adminService: AdminService;

  beforeEach(() => {
    fs.mkdirSync('data', { recursive: true });
    db = new Database(TEST_DB_PATH);
    adminService = new AdminService(db, OWNER_ID);
    db.upsertChat(12345, 'group');
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  it('should add admin by user_id', () => {
    const result = handleAdminManagement(adminService, {
      action: 'add', chat_id: 12345, requesting_user_id: OWNER_ID, target_user_id: 999,
    });
    expect(result.success).toBe(true);
  });

  it('should add admin by username', () => {
    db.storeMessage({
      message_id: 1, chat_id: 12345, user_id: 999,
      username: 'peter', display_name: 'Peter', text: 'Hi', has_media: false,
    });
    const result = handleAdminManagement(adminService, {
      action: 'add', chat_id: 12345, requesting_user_id: OWNER_ID, target_username: 'peter',
    });
    expect(result.success).toBe(true);
  });

  it('should list admins', () => {
    adminService.addAdmin(12345, 999, OWNER_ID);
    const result = handleAdminManagement(adminService, {
      action: 'list', chat_id: 12345, requesting_user_id: OWNER_ID,
    });
    expect(result.success).toBe(true);
    expect(result.admins).toHaveLength(1);
  });

  it('should remove admin', () => {
    adminService.addAdmin(12345, 999, OWNER_ID);
    const result = handleAdminManagement(adminService, {
      action: 'remove', chat_id: 12345, requesting_user_id: OWNER_ID, target_user_id: 999,
    });
    expect(result.success).toBe(true);
  });

  it('should reject unauthorized add', () => {
    const result = handleAdminManagement(adminService, {
      action: 'add', chat_id: 12345, requesting_user_id: 777, target_user_id: 999,
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/admin-management.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `src/tools/admin-management.ts`:
```typescript
import { AdminService, AdminResult } from '../admin/admin.js';
import { Database } from '../db/database.js';

export interface AdminManagementParams {
  action: 'add' | 'remove' | 'list';
  chat_id: number;
  requesting_user_id: number;
  target_user_id?: number;
  target_username?: string;
}

export interface AdminManagementResult {
  success: boolean;
  message: string;
  admins?: Array<{ user_id: number; username?: string }>;
}

export function handleAdminManagement(
  adminService: AdminService,
  db: Database,
  params: AdminManagementParams,
): AdminManagementResult {
  switch (params.action) {
    case 'add': {
      let result: AdminResult;
      if (params.target_username) {
        result = adminService.addAdminByUsername(params.chat_id, params.target_username, params.requesting_user_id);
      } else if (params.target_user_id) {
        result = adminService.addAdmin(params.chat_id, params.target_user_id, params.requesting_user_id);
      } else {
        return { success: false, message: 'target_user_id of target_username is vereist.' };
      }
      return result;
    }

    case 'remove': {
      let result: AdminResult;
      if (params.target_username) {
        result = adminService.removeAdminByUsername(params.chat_id, params.target_username, params.requesting_user_id);
      } else if (params.target_user_id) {
        result = adminService.removeAdmin(params.chat_id, params.target_user_id, params.requesting_user_id);
      } else {
        return { success: false, message: 'target_user_id of target_username is vereist.' };
      }
      return result;
    }

    case 'list': {
      const admins = adminService.listAdmins(params.chat_id);
      return {
        success: true,
        message: admins.length > 0 ? `${admins.length} admin(s) gevonden.` : 'Geen admins geconfigureerd (alleen de owner).',
        admins: admins.map((a) => ({ user_id: a.user_id, username: db.resolveUsernameByUserId(a.chat_id, a.user_id) })),
      };
    }

    default:
      return { success: false, message: `Onbekende actie: ${params.action}` };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools/admin-management.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/admin-management.ts tests/tools/admin-management.test.ts
git commit -m "feat: add admin_management tool with add/remove/list actions"
```

---

### Task 10: MCP tools — gif_search

**Files:**
- Create: `src/tools/gif-search.ts`
- Create: `tests/tools/gif-search.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tools/gif-search.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGifSearch, GifSearchParams } from '../../src/tools/gif-search.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('gif_search tool', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should return GIFs from Tenor API', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{
          media_formats: {
            gif: { url: 'https://tenor.com/cat.gif' },
            tinygif: { url: 'https://tenor.com/cat-small.gif' },
          },
          title: 'Funny cat',
        }],
      }),
    });

    const result = await handleGifSearch('test-api-key', { query: 'funny cat' });
    expect(result.gifs).toHaveLength(1);
    expect(result.gifs[0].url).toBe('https://tenor.com/cat.gif');
    expect(result.gifs[0].title).toBe('Funny cat');
  });

  it('should respect limit parameter', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { media_formats: { gif: { url: 'url1' }, tinygif: { url: 'prev1' } }, title: 'gif1' },
          { media_formats: { gif: { url: 'url2' }, tinygif: { url: 'prev2' } }, title: 'gif2' },
          { media_formats: { gif: { url: 'url3' }, tinygif: { url: 'prev3' } }, title: 'gif3' },
        ],
      }),
    });

    const result = await handleGifSearch('test-api-key', { query: 'cat', limit: 2 });
    expect(result.gifs).toHaveLength(2);
  });

  it('should return empty on API error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const result = await handleGifSearch('test-api-key', { query: 'cat' });
    expect(result.gifs).toHaveLength(0);
  });

  it('should return empty when no API key', async () => {
    const result = await handleGifSearch(undefined, { query: 'cat' });
    expect(result.gifs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/gif-search.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `src/tools/gif-search.ts`:
```typescript
export interface GifSearchParams {
  query: string;
  limit?: number;
}

export interface GifResult {
  url: string;
  preview_url: string;
  title: string;
}

export interface GifSearchResult {
  gifs: GifResult[];
}

export async function handleGifSearch(
  apiKey: string | undefined,
  params: GifSearchParams,
): Promise<GifSearchResult> {
  if (!apiKey) {
    return { gifs: [] };
  }

  const limit = Math.min(params.limit || 1, 5);
  const url = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(params.query)}&key=${apiKey}&limit=${limit}&media_filter=gif,tinygif`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { gifs: [] };
    }

    const data = await response.json();
    const gifs: GifResult[] = (data.results || []).slice(0, limit).map((r: any) => ({
      url: r.media_formats?.gif?.url || '',
      preview_url: r.media_formats?.tinygif?.url || '',
      title: r.title || '',
    }));

    return { gifs };
  } catch {
    return { gifs: [] };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools/gif-search.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/gif-search.ts tests/tools/gif-search.test.ts
git commit -m "feat: add gif_search tool using Tenor API"
```

---

### Task 11: MCP server entry point

**Files:**
- Create: `src/tools/mcp-server.ts`

- [ ] **Step 1: Write implementation**

Create `src/tools/mcp-server.ts`:
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Database } from '../db/database.js';
import { AdminService } from '../admin/admin.js';
import { handleTelegramHistory } from './telegram-history.js';
import { handleAdminManagement } from './admin-management.js';
import { handleGifSearch } from './gif-search.js';

const DB_PATH = process.env.DATABASE_PATH || './data/bot.db';
const OWNER_ID = parseInt(process.env.OWNER_USER_ID || '0', 10);
const TENOR_API_KEY = process.env.TENOR_API_KEY;

const db = new Database(DB_PATH);
const adminService = new AdminService(db, OWNER_ID);

const server = new McpServer({
  name: 'telegram-agent-tools',
  version: '1.0.0',
});

server.registerTool(
  'telegram_history',
  {
    title: 'Telegram Chat History',
    description: 'Search and retrieve messages from the Telegram chat history. Use this to find context from earlier in the conversation.',
    inputSchema: z.object({
      chat_id: z.number().describe('Telegram chat ID (auto-injected)'),
      query: z.string().optional().describe('Text search within messages'),
      limit: z.number().min(1).max(100).default(20).describe('Max messages to return'),
      offset_id: z.number().optional().describe('Fetch messages before this message ID'),
      from_user: z.string().optional().describe('Filter by username'),
    }),
  },
  async (params) => {
    const result = handleTelegramHistory(db, params);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

server.registerTool(
  'admin_management',
  {
    title: 'Admin Management',
    description: 'Manage chat administrators. Add, remove, or list admins for a chat.',
    inputSchema: z.object({
      action: z.enum(['add', 'remove', 'list']).describe('Action to perform'),
      chat_id: z.number().describe('Telegram chat ID (auto-injected)'),
      requesting_user_id: z.number().describe('User ID making the request (auto-injected)'),
      target_user_id: z.number().optional().describe('Target user ID for add/remove'),
      target_username: z.string().optional().describe('Target username for add/remove'),
    }),
  },
  async (params) => {
    const result = handleAdminManagement(adminService, params);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

server.registerTool(
  'gif_search',
  {
    title: 'GIF Search',
    description: 'Search for GIFs using Tenor. Use this when you want to send a GIF in the chat.',
    inputSchema: z.object({
      query: z.string().describe('Search term for GIFs'),
      limit: z.number().min(1).max(5).default(1).describe('Number of GIFs to return'),
    }),
  },
  async (params) => {
    const result = await handleGifSearch(TENOR_API_KEY, params);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Telegram Agent MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in MCP server:', error);
  process.exit(1);
});
```

- [ ] **Step 2: Verify MCP server compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/mcp-server.ts
git commit -m "feat: add MCP server exposing telegram_history, admin_management, gif_search"
```

---

## Chunk 4: Bot Core — Router, Queue, Media

### Task 12: Message queue

**Files:**
- Create: `src/bot/queue.ts`
- Create: `tests/bot/queue.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/bot/queue.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { MessageQueue } from '../../src/bot/queue.js';

describe('MessageQueue', () => {
  it('should process messages sequentially per chat', async () => {
    const queue = new MessageQueue();
    const order: number[] = [];

    const handler = async (n: number) => {
      await new Promise((r) => setTimeout(r, 10));
      order.push(n);
    };

    await Promise.all([
      queue.enqueue(12345, () => handler(1)),
      queue.enqueue(12345, () => handler(2)),
      queue.enqueue(12345, () => handler(3)),
    ]);

    expect(order).toEqual([1, 2, 3]);
  });

  it('should process different chats in parallel', async () => {
    const queue = new MessageQueue();
    const starts: Record<number, number> = {};

    const handler = async (chatId: number) => {
      starts[chatId] = Date.now();
      await new Promise((r) => setTimeout(r, 50));
    };

    await Promise.all([
      queue.enqueue(111, () => handler(111)),
      queue.enqueue(222, () => handler(222)),
    ]);

    const diff = Math.abs(starts[111] - starts[222]);
    expect(diff).toBeLessThan(30); // Started roughly at the same time
  });

  it('should handle errors without breaking the queue', async () => {
    const queue = new MessageQueue();
    const results: string[] = [];

    await queue.enqueue(12345, async () => { throw new Error('fail'); }).catch(() => {});
    await queue.enqueue(12345, async () => { results.push('ok'); });

    expect(results).toEqual(['ok']);
  });

  it('should timeout long-running tasks', async () => {
    const queue = new MessageQueue(100); // 100ms timeout

    await expect(
      queue.enqueue(12345, async () => {
        await new Promise((r) => setTimeout(r, 500));
      })
    ).rejects.toThrow('timeout');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bot/queue.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `src/bot/queue.ts`:
```typescript
export class MessageQueue {
  private queues: Map<number, Promise<void>> = new Map();
  private timeoutMs: number;

  constructor(timeoutMs: number = 120_000) {
    this.timeoutMs = timeoutMs;
  }

  async enqueue<T>(chatId: number, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(chatId) || Promise.resolve();

    const current = previous.then(async () => {
      const result = await Promise.race([
        task(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('LLM timeout: antwoord duurde te lang')), this.timeoutMs)
        ),
      ]);
      return result;
    });

    // Store a void version that never rejects (so the queue continues)
    this.queues.set(
      chatId,
      current.then(() => {}, () => {}),
    );

    return current;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bot/queue.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bot/queue.ts tests/bot/queue.test.ts
git commit -m "feat: add per-chat FIFO message queue with timeout"
```

---

### Task 13: Message router

**Files:**
- Create: `src/bot/router.ts`
- Create: `tests/bot/router.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/bot/router.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { shouldProcessMessage } from '../../src/bot/router.js';

describe('shouldProcessMessage', () => {
  const botUsername = 'testbot';

  it('should always process in all_messages mode', () => {
    expect(shouldProcessMessage('all_messages', 'Hello', botUsername, false)).toBe(true);
  });

  it('should process commands in commands_only mode', () => {
    expect(shouldProcessMessage('commands_only', '/newsession', botUsername, false)).toBe(true);
  });

  it('should process mentions in commands_only mode', () => {
    expect(shouldProcessMessage('commands_only', 'Hey @testbot help me', botUsername, false)).toBe(true);
  });

  it('should not process regular messages in commands_only mode', () => {
    expect(shouldProcessMessage('commands_only', 'just chatting', botUsername, false)).toBe(false);
  });

  it('should always process private chats regardless of mode', () => {
    expect(shouldProcessMessage('commands_only', 'hello', botUsername, true)).toBe(true);
  });

  it('should always process in autonomous mode', () => {
    expect(shouldProcessMessage('autonomous', 'random message', botUsername, false)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bot/router.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `src/bot/router.ts`:
```typescript
export function shouldProcessMessage(
  routingMode: string,
  messageText: string | undefined,
  botUsername: string,
  isPrivateChat: boolean,
): boolean {
  // Private chats always process
  if (isPrivateChat) return true;

  switch (routingMode) {
    case 'all_messages':
    case 'autonomous':
      return true;

    case 'commands_only': {
      if (!messageText) return false;
      // Check for slash commands
      if (messageText.startsWith('/')) return true;
      // Check for @mention
      if (messageText.toLowerCase().includes(`@${botUsername.toLowerCase()}`)) return true;
      return false;
    }

    default:
      return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bot/router.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bot/router.ts tests/bot/router.test.ts
git commit -m "feat: add message router with routing mode logic"
```

---

### Task 14: Media helpers and message splitting

**Files:**
- Create: `src/bot/media.ts`
- Create: `tests/bot/media.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/bot/media.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { splitMessage, classifyDocument } from '../../src/bot/media.js';

describe('splitMessage', () => {
  it('should not split short messages', () => {
    const parts = splitMessage('Hello world');
    expect(parts).toEqual(['Hello world']);
  });

  it('should split at newline boundaries', () => {
    const long = 'A'.repeat(4000) + '\n' + 'B'.repeat(100);
    const parts = splitMessage(long);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe('A'.repeat(4000));
    expect(parts[1]).toBe('B'.repeat(100));
  });

  it('should not split inside code blocks', () => {
    const code = '```\n' + 'x\n'.repeat(2000) + '```';
    const before = 'Some text\n';
    const message = before + code;
    // Even if > 4096, the split should happen before the code block
    const parts = splitMessage(message);
    expect(parts.length).toBeGreaterThanOrEqual(1);
    // Verify no part starts/ends mid-code-block
    for (const part of parts) {
      const opens = (part.match(/```/g) || []).length;
      expect(opens % 2).toBe(0); // Even number of ``` means balanced
    }
  });

  it('should handle messages with no good split points', () => {
    const long = 'A'.repeat(5000);
    const parts = splitMessage(long);
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBe(4096);
  });
});

describe('classifyDocument', () => {
  it('should classify PDF as pdf', () => {
    expect(classifyDocument('report.pdf')).toBe('pdf');
  });

  it('should classify text files as text', () => {
    expect(classifyDocument('data.csv')).toBe('text');
    expect(classifyDocument('notes.md')).toBe('text');
    expect(classifyDocument('config.json')).toBe('text');
    expect(classifyDocument('readme.txt')).toBe('text');
  });

  it('should classify unknown types as unsupported', () => {
    expect(classifyDocument('image.psd')).toBe('unsupported');
    expect(classifyDocument('archive.zip')).toBe('unsupported');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bot/media.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `src/bot/media.ts`:
```typescript
import FormData from 'form-data';

const MAX_MESSAGE_LENGTH = 4096;

export async function transcribeVoice(voiceUrl: string, openaiApiKey: string): Promise<string> {
  // Download voice file
  const voiceResponse = await fetch(voiceUrl);
  if (!voiceResponse.ok) throw new Error('Failed to download voice file');
  const voiceBuffer = Buffer.from(await voiceResponse.arrayBuffer());

  // Send to Whisper API
  const formData = new FormData();
  formData.append('file', voiceBuffer, { filename: 'voice.ogg', contentType: 'audio/ogg' });
  formData.append('model', 'whisper-1');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
      ...formData.getHeaders(),
    },
    body: formData as any,
  });

  if (!response.ok) {
    throw new Error(`Whisper API error: ${response.status}`);
  }

  const result = await response.json() as { text: string };
  return result.text;
}

const TEXT_EXTENSIONS = new Set([
  'txt', 'csv', 'json', 'md', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg',
  'log', 'html', 'css', 'js', 'ts', 'py', 'rb', 'go', 'rs', 'java', 'c',
  'cpp', 'h', 'hpp', 'sh', 'bash', 'sql', 'env', 'gitignore',
]);

export function classifyDocument(filename: string): 'pdf' | 'text' | 'unsupported' {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'pdf';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  return 'unsupported';
}

export function splitMessage(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) {
    return [text];
  }

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > MAX_MESSAGE_LENGTH) {
    let splitIndex = -1;

    // Try to find a newline before the limit that's not inside a code block
    const searchArea = remaining.slice(0, MAX_MESSAGE_LENGTH);

    // Check if we're inside a code block
    const codeBlockPositions: Array<{ start: number; end: number }> = [];
    let searchStart = 0;
    while (true) {
      const open = searchArea.indexOf('```', searchStart);
      if (open === -1) break;
      const close = searchArea.indexOf('```', open + 3);
      if (close === -1) {
        // Unclosed code block — don't split within it
        // Find the last newline before the code block
        splitIndex = remaining.lastIndexOf('\n', open);
        break;
      }
      codeBlockPositions.push({ start: open, end: close + 3 });
      searchStart = close + 3;
    }

    if (splitIndex === -1) {
      // Find last newline that's not inside a code block
      for (let i = MAX_MESSAGE_LENGTH - 1; i >= 0; i--) {
        if (remaining[i] === '\n') {
          const insideCodeBlock = codeBlockPositions.some(
            (block) => i > block.start && i < block.end,
          );
          if (!insideCodeBlock) {
            splitIndex = i;
            break;
          }
        }
      }
    }

    if (splitIndex <= 0) {
      // No good split point — hard split
      splitIndex = MAX_MESSAGE_LENGTH;
    }

    parts.push(remaining.slice(0, splitIndex).trimEnd());
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining.length > 0) {
    parts.push(remaining);
  }

  return parts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bot/media.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bot/media.ts tests/bot/media.test.ts
git commit -m "feat: add media helpers with message splitting and document classification"
```

---

## Chunk 5: Bot Assembly and Entry Point

### Task 15: Grammy bot setup and main handler

**Files:**
- Create: `src/bot/bot.ts`

- [ ] **Step 1: Write implementation**

Create `src/bot/bot.ts`:
```typescript
import { Bot, Context, InputFile } from 'grammy';
import { Config } from '../config.js';
import { Database } from '../db/database.js';
import { SessionManager } from '../llm/session.js';
import { LLMProvider, LLMError, MessageInput } from '../llm/provider.js';
import { MessageQueue } from './queue.js';
import { shouldProcessMessage } from './router.js';
import { splitMessage, classifyDocument, transcribeVoice } from './media.js';
import { AdminService } from '../admin/admin.js';

interface AutonomousBuffer {
  messages: Array<{ username: string; text: string; time: string }>;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createBot(
  config: Config,
  db: Database,
  provider: LLMProvider,
  sessionManager: SessionManager,
  adminService: AdminService,
): Bot {
  const bot = new Bot(config.telegramBotToken);
  const queue = new MessageQueue();
  const autonomousBuffers = new Map<number, AutonomousBuffer>();

  // Store all messages middleware
  bot.use(async (ctx, next) => {
    if (ctx.message) {
      const chatId = ctx.chat?.id;
      const chatType = ctx.chat?.type || 'private';
      if (chatId) {
        db.upsertChat(chatId, chatType);
        db.storeMessage({
          message_id: ctx.message.message_id,
          chat_id: chatId,
          user_id: ctx.from?.id ?? null,
          username: ctx.from?.username ?? null,
          display_name: ctx.from?.first_name ?? null,
          text: ctx.message.text ?? ctx.message.caption ?? null,
          has_media: !!(ctx.message.photo || ctx.message.document || ctx.message.voice || ctx.message.video),
          media_type: ctx.message.photo ? 'photo' : ctx.message.document ? 'document' : ctx.message.voice ? 'voice' : ctx.message.video ? 'video' : null,
          reply_to: ctx.message.reply_to_message?.message_id ?? null,
        });
      }
    }
    await next();
  });

  // /newsession command
  bot.command('newsession', async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id;
    if (!userId || !adminService.isAdmin(chatId, userId)) {
      await ctx.reply('Je hebt geen rechten voor dit commando.');
      return;
    }

    await queue.enqueue(chatId, async () => {
      const systemPrompt = buildSystemPrompt(db, chatId, bot.botInfo.username);
      const { session } = await sessionManager.newSession(chatId, systemPrompt);
      await ctx.reply('Nieuwe sessie gestart.');
    });
  });

  // Main message handler
  bot.on('message', async (ctx) => {
    const chatId = ctx.chat.id;
    const chatType = ctx.chat.type;
    const userId = ctx.from?.id;
    const botUsername = bot.botInfo.username;
    const chat = db.getChat(chatId);
    const routingMode = chat?.routing_mode || (chatType === 'private' ? 'all_messages' : 'commands_only');
    const isPrivate = chatType === 'private';
    const messageText = ctx.message.text ?? ctx.message.caption ?? '';

    if (!shouldProcessMessage(routingMode, messageText, botUsername, isPrivate)) {
      return;
    }

    // Autonomous mode: buffer messages
    if (routingMode === 'autonomous' && !isPrivate) {
      const cooldown = (chat?.autonomous_cooldown || 10) * 1000;
      let buffer = autonomousBuffers.get(chatId);
      if (!buffer) {
        buffer = { messages: [], timer: null };
        autonomousBuffers.set(chatId, buffer);
      }

      const time = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
      const username = ctx.from?.username || ctx.from?.first_name || 'Unknown';
      buffer.messages.push({ username, text: messageText, time });

      // Drop oldest if > 20
      if (buffer.messages.length > 20) {
        buffer.messages = buffer.messages.slice(-20);
      }

      if (buffer.timer) clearTimeout(buffer.timer);
      buffer.timer = setTimeout(async () => {
        const msgs = buffer!.messages.splice(0);
        autonomousBuffers.delete(chatId);

        if (msgs.length === 0) return;

        const batchText = msgs.map((m) => `[${m.time}] @${m.username}: ${m.text}`).join('\n');
        await processMessage(ctx, chatId, batchText, true);
      }, cooldown);

      return;
    }

    await processMessage(ctx, chatId, messageText, routingMode === 'autonomous');
  });

  async function processMessage(ctx: Context, chatId: number, text: string, isAutonomous: boolean): Promise<void> {
    await queue.enqueue(chatId, async () => {
      try {
        await ctx.replyWithChatAction('typing');

        const systemPrompt = buildSystemPrompt(db, chatId, bot.botInfo.username);
        const session = await sessionManager.getOrCreateSession(chatId, systemPrompt);

        const messageInput: MessageInput = { text };

        // Handle photo attachments
        if (ctx.message && 'photo' in ctx.message && ctx.message.photo?.length) {
          const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Highest resolution
          const file = await ctx.api.getFile(photo.file_id);
          if (file.file_path) {
            const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
            messageInput.media = [{ type: 'image', data: url, mimeType: 'image/jpeg' }];
          }
        }

        // Handle documents
        if (ctx.message && 'document' in ctx.message && ctx.message.document) {
          const doc = ctx.message.document;
          const docType = classifyDocument(doc.file_name || '');
          if (docType === 'unsupported') {
            messageInput.text = (messageInput.text || '') + `\n[Unsupported document: ${doc.file_name}]`;
          } else {
            const file = await ctx.api.getFile(doc.file_id);
            if (file.file_path) {
              const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
              messageInput.media = [{
                type: 'document',
                data: url,
                mimeType: doc.mime_type || 'application/octet-stream',
                filename: doc.file_name || undefined,
              }];
            }
          }
        }

        // Handle voice messages
        if (ctx.message && 'voice' in ctx.message && ctx.message.voice) {
          if (!config.openaiApiKey) {
            await ctx.reply('Voice berichten worden niet ondersteund (Whisper API niet geconfigureerd)');
            return;
          }
          const voice = ctx.message.voice;
          const file = await ctx.api.getFile(voice.file_id);
          if (file.file_path) {
            const voiceUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
            const transcription = await transcribeVoice(voiceUrl, config.openaiApiKey);
            messageInput.text = (messageInput.text || '') + `\n[Voice bericht]: "${transcription}"`;
          }
        }

        const response = await provider.sendMessage(session, messageInput);

        // Handle empty response in autonomous mode (LLM chose not to respond)
        if (isAutonomous && (!response.text || response.text.trim() === '')) {
          return;
        }

        // Send text response
        if (response.text) {
          const parts = splitMessage(response.text);
          for (const part of parts) {
            await ctx.reply(part, { parse_mode: 'Markdown' }).catch(async () => {
              // If Markdown parsing fails, send as plain text
              await ctx.reply(part);
            });
          }
        }

        // Send media
        if (response.media?.length) {
          for (const media of response.media) {
            if (media.type === 'image' && typeof media.data === 'string') {
              await ctx.replyWithPhoto(new InputFile(new URL(media.data)));
            } else if (media.type === 'gif' && typeof media.data === 'string') {
              await ctx.replyWithAnimation(new InputFile(new URL(media.data)));
            }
          }
        }
      } catch (error) {
        console.error(`Error processing message for chat ${chatId}:`, error);
        if (error instanceof Error && error.message.includes('timeout')) {
          await ctx.reply('Antwoord duurde te lang, probeer het opnieuw.');
        } else {
          await ctx.reply('Er ging iets mis, probeer het opnieuw.');
        }
      }
    });
  }

  return bot;
}

function buildSystemPrompt(db: Database, chatId: number, botUsername: string): string {
  const chat = db.getChat(chatId);
  const parts: string[] = [];

  parts.push(`Je bent een AI assistent in een Telegram chat. Je botnaam is @${botUsername}.`);
  parts.push('Je zit in een Telegram chat die mogelijk langer teruggaat dan je huidige sessie. Als je context nodig hebt van eerdere berichten, gebruik dan de telegram_history tool om gericht te zoeken in de chatgeschiedenis.');

  if (chat?.routing_mode === 'autonomous') {
    parts.push('Je bent in autonome modus. Je ontvangt alle berichten uit de chat. Reageer ALLEEN als je iets waardevols bij te dragen hebt. Als je niet wilt reageren, antwoord dan met een leeg bericht (geen tekst).');
  }

  if (chat?.custom_prompt) {
    parts.push(`\nAanvullende instructies voor deze chat:\n${chat.custom_prompt}`);
  }

  parts.push('\nAls iemand je vraagt om een admin toe te voegen, te verwijderen, of de adminlijst te tonen, gebruik dan de admin_management tool.');
  parts.push('Als je een GIF wilt sturen, gebruik dan de gif_search tool.');

  return parts.join('\n\n');
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors (or minor fixable issues)

- [ ] **Step 3: Commit**

```bash
git add src/bot/bot.ts
git commit -m "feat: add Grammy bot setup with message handling, routing, media, and autonomous mode"
```

---

### Task 16: Entry point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write implementation**

Create `src/index.ts`:
```typescript
import { loadConfig } from './config.js';
import { Database } from './db/database.js';
import { ClaudeCodeProvider } from './llm/providers/claude-code.js';
import { SessionManager } from './llm/session.js';
import { AdminService } from './admin/admin.js';
import { createBot } from './bot/bot.js';
import path from 'path';
import fs from 'fs';

async function main() {
  const config = loadConfig();

  console.log('Starting Telegram Agent Bot...');
  console.log(`Owner: ${config.ownerUserId}`);
  console.log(`LLM Provider: ${config.llmProvider}`);
  console.log(`Database: ${config.databasePath}`);

  const db = new Database(config.databasePath);

  // Generate MCP config with resolved environment variables
  const mcpConfig = {
    mcpServers: {
      'telegram-tools': {
        command: 'npx',
        args: ['tsx', path.resolve('src/tools/mcp-server.ts')],
        env: {
          DATABASE_PATH: config.databasePath,
          OWNER_USER_ID: String(config.ownerUserId),
          TENOR_API_KEY: config.tenorApiKey || '',
        },
      },
    },
  };
  const mcpConfigPath = path.resolve('data/mcp-config.json');
  fs.mkdirSync(path.dirname(mcpConfigPath), { recursive: true });
  fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

  const provider = new ClaudeCodeProvider({
    model: config.claudeModel,
    mcpConfigPath,
  });

  const sessionManager = new SessionManager(provider, db);
  const adminService = new AdminService(db, config.ownerUserId);
  const bot = createBot(config, db, provider, sessionManager, adminService);

  // Graceful shutdown
  const shutdown = () => {
    console.log('Shutting down...');
    bot.stop();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await bot.start({
    onStart: (botInfo) => {
      console.log(`Bot started as @${botInfo.username}`);
    },
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
```

- [ ] **Step 2: Generate MCP config dynamically in entry point**

The MCP config is generated at runtime in `src/index.ts` (already in Step 1) to avoid `${VAR}` in JSON which doesn't support variable interpolation. Add the following to `src/index.ts` before creating the provider:

```typescript
import fs from 'fs';

// Generate MCP config with resolved environment variables
const mcpConfig = {
  mcpServers: {
    'telegram-tools': {
      command: 'npx',
      args: ['tsx', path.resolve('src/tools/mcp-server.ts')],
      env: {
        DATABASE_PATH: config.databasePath,
        OWNER_USER_ID: String(config.ownerUserId),
        TENOR_API_KEY: config.tenorApiKey || '',
      },
    },
  },
};
const mcpConfigPath = path.resolve('data/mcp-config.json');
fs.mkdirSync(path.dirname(mcpConfigPath), { recursive: true });
fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/index.ts mcp-config.json
git commit -m "feat: add entry point with graceful shutdown and MCP config"
```

---

### Task 17: Docker setup

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`

- [ ] **Step 1: Create Dockerfile**

Create `Dockerfile`:
```dockerfile
FROM node:20-slim

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

RUN mkdir -p /app/data

ENV DATABASE_PATH=/app/data/bot.db

# Note: MCP config is generated dynamically at runtime by index.ts
# tsx is kept as a dependency for running the MCP server from TypeScript source

CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Create docker-compose.yml**

Create `docker-compose.yml`:
```yaml
services:
  bot:
    build: .
    restart: unless-stopped
    env_file: .env
    volumes:
      - bot-data:/app/data
    environment:
      - DATABASE_PATH=/app/data/bot.db

volumes:
  bot-data:
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "feat: add Docker and docker-compose configuration"
```

---

### Task 18: Run all tests

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Fix any failures**

If any tests fail, fix them and re-run.

- [ ] **Step 3: Commit if fixes were needed**

Only if Step 2 required changes:
```bash
git add <changed-files>
git commit -m "fix: resolve remaining test issues"
```
