import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Prevent dotenv from loading .env file during tests
vi.mock('dotenv', () => ({ default: { config: vi.fn() }, config: vi.fn() }));

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {};
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

    const { loadConfig } = await import('../src/config.js');
    expect(() => loadConfig()).toThrow('TELEGRAM_BOT_TOKEN');
  });

  it('should throw if OWNER_USER_ID is missing', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';

    const { loadConfig } = await import('../src/config.js');
    expect(() => loadConfig()).toThrow('OWNER_USER_ID');
  });
});
