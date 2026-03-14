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
        message_id: 1, chat_id: 12345, user_id: 999,
        username: 'testuser', display_name: 'Test User',
        text: 'Hello world', has_media: false,
      });
      const messages = db.getMessages(12345, { limit: 10 });
      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe('Hello world');
    });

    it('should search messages by query', () => {
      db.upsertChat(12345, 'private');
      db.storeMessage({ message_id: 1, chat_id: 12345, user_id: 999, username: 'testuser', display_name: 'Test', text: 'Hello world', has_media: false });
      db.storeMessage({ message_id: 2, chat_id: 12345, user_id: 999, username: 'testuser', display_name: 'Test', text: 'Goodbye world', has_media: false });
      const results = db.getMessages(12345, { query: 'Goodbye', limit: 10 });
      expect(results).toHaveLength(1);
      expect(results[0].text).toBe('Goodbye world');
    });

    it('should filter messages by username', () => {
      db.upsertChat(12345, 'private');
      db.storeMessage({ message_id: 1, chat_id: 12345, user_id: 999, username: 'alice', display_name: 'Alice', text: 'Hi', has_media: false });
      db.storeMessage({ message_id: 2, chat_id: 12345, user_id: 888, username: 'bob', display_name: 'Bob', text: 'Hey', has_media: false });
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
      expect(db.getAdmins(12345)).toHaveLength(0);
    });

    it('should resolve username to user_id', () => {
      db.upsertChat(12345, 'private');
      db.storeMessage({ message_id: 1, chat_id: 12345, user_id: 999, username: 'peter', display_name: 'Peter', text: 'Hi', has_media: false });
      expect(db.resolveUsername(12345, 'peter')).toBe(999);
    });

    it('should return undefined for unknown username', () => {
      db.upsertChat(12345, 'private');
      expect(db.resolveUsername(12345, 'unknown')).toBeUndefined();
    });
  });
});
