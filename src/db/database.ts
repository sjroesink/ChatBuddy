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

      CREATE TABLE IF NOT EXISTS conversation_messages (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id   TEXT NOT NULL,
        role         TEXT NOT NULL,
        content      TEXT,
        tool_calls   TEXT,
        tool_call_id TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_conv_session ON conversation_messages(session_id);

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

  // Conversation history for non-Claude providers (OpenAI, Ollama)
  addConversationMessage(sessionId: string, role: string, content: string | null, toolCalls?: string, toolCallId?: string): void {
    this.db.prepare(`
      INSERT INTO conversation_messages (session_id, role, content, tool_calls, tool_call_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, role, content, toolCalls ?? null, toolCallId ?? null);
  }

  getConversationHistory(sessionId: string): Array<{ role: string; content: string | null; tool_calls: string | null; tool_call_id: string | null }> {
    return this.db.prepare(
      'SELECT role, content, tool_calls, tool_call_id FROM conversation_messages WHERE session_id = ? ORDER BY id ASC'
    ).all(sessionId) as Array<{ role: string; content: string | null; tool_calls: string | null; tool_call_id: string | null }>;
  }

  clearConversationHistory(sessionId: string): void {
    this.db.prepare('DELETE FROM conversation_messages WHERE session_id = ?').run(sessionId);
  }

  sanitizeConversationUrls(sessionId: string): void {
    const rows = this.db.prepare(
      'SELECT rowid, content FROM conversation_messages WHERE session_id = ? AND content IS NOT NULL'
    ).all(sessionId) as Array<{ rowid: number; content: string }>;
    for (const row of rows) {
      if (/https?:\/\//.test(row.content)) {
        const sanitized = row.content.replace(/https?:\/\/[^\s"'<>\]\\]+/g, '[link verwijderd]');
        this.db.prepare('UPDATE conversation_messages SET content = ? WHERE rowid = ?').run(sanitized, row.rowid);
      }
    }
  }

  close(): void {
    this.db.close();
  }
}
