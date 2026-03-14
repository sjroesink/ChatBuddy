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
