import { describe, it, expect } from 'vitest';
import { shouldProcessMessage } from '../../src/bot/router.js';

describe('shouldProcessMessage', () => {
  const BOT = 'MyBot';

  describe('all_messages mode', () => {
    it('always returns true for regular messages', () => {
      expect(shouldProcessMessage('all_messages', 'hello world', BOT, false)).toBe(true);
    });

    it('always returns true for commands', () => {
      expect(shouldProcessMessage('all_messages', '/start', BOT, false)).toBe(true);
    });

    it('always returns true for empty string', () => {
      expect(shouldProcessMessage('all_messages', '', BOT, false)).toBe(true);
    });
  });

  describe('autonomous mode', () => {
    it('always returns true for regular messages', () => {
      expect(shouldProcessMessage('autonomous', 'hello world', BOT, false)).toBe(true);
    });

    it('always returns true for commands', () => {
      expect(shouldProcessMessage('autonomous', '/start', BOT, false)).toBe(true);
    });
  });

  describe('commands_only mode', () => {
    it('processes command messages (starting with /)', () => {
      expect(shouldProcessMessage('commands_only', '/start', BOT, false)).toBe(true);
      expect(shouldProcessMessage('commands_only', '/help me', BOT, false)).toBe(true);
    });

    it('processes mentions (case-insensitive)', () => {
      expect(shouldProcessMessage('commands_only', 'hey @MyBot can you help?', BOT, false)).toBe(true);
      expect(shouldProcessMessage('commands_only', 'hey @mybot can you help?', BOT, false)).toBe(true);
      expect(shouldProcessMessage('commands_only', '@MYBOT hello', BOT, false)).toBe(true);
    });

    it('rejects regular messages', () => {
      expect(shouldProcessMessage('commands_only', 'hello world', BOT, false)).toBe(false);
      expect(shouldProcessMessage('commands_only', 'how are you?', BOT, false)).toBe(false);
    });

    it('rejects messages mentioning a different bot', () => {
      expect(shouldProcessMessage('commands_only', '@OtherBot hello', BOT, false)).toBe(false);
    });
  });

  describe('private chats', () => {
    it('always processes messages in private chats regardless of mode', () => {
      expect(shouldProcessMessage('commands_only', 'hello', BOT, true)).toBe(true);
      expect(shouldProcessMessage('commands_only', 'no command here', BOT, true)).toBe(true);
      expect(shouldProcessMessage('all_messages', 'hello', BOT, true)).toBe(true);
      expect(shouldProcessMessage('autonomous', 'hello', BOT, true)).toBe(true);
    });
  });
});
