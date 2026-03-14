import dotenv from 'dotenv';
dotenv.config();

export interface Config {
  telegramBotToken: string;
  ownerUserId: number;
  llmProvider: 'claude-code' | 'claude-api' | 'openai' | 'ollama';
  claudeModel?: string;
  claudeApiModel?: string;
  anthropicApiKey?: string;
  openaiModel?: string;
  tenorApiKey?: string;
  tavilyApiKey?: string;
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
    claudeApiModel: process.env.CLAUDE_API_MODEL || 'claude-sonnet-4-20250514',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4o',
    tenorApiKey: process.env.TENOR_API_KEY || undefined,
    tavilyApiKey: process.env.TAVILY_API_KEY || undefined,
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    databasePath: process.env.DATABASE_PATH || './data/bot.db',
  };
}
