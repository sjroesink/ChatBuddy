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
