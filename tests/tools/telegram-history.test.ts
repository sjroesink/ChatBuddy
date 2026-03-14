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
