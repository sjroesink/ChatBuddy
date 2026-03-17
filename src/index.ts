import { loadConfig } from './config.js';
import { Database } from './db/database.js';
import { LLMProvider } from './llm/provider.js';
import { ClaudeCodeProvider } from './llm/providers/claude-code.js';
import { OpenAIProvider } from './llm/providers/openai.js';
import { ClaudeAPIProvider } from './llm/providers/claude-api.js';
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
          TAVILY_API_KEY: config.tavilyApiKey || '',
          TELEGRAM_BOT_TOKEN: config.telegramBotToken,
        },
      },
    },
  };
  const mcpConfigPath = path.resolve('data/mcp-config.json');
  fs.mkdirSync(path.dirname(mcpConfigPath), { recursive: true });
  fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

  const adminService = new AdminService(db, config.ownerUserId);

  let provider: LLMProvider;
  switch (config.llmProvider) {
    case 'openai': {
      if (!config.openaiApiKey) {
        throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER=openai');
      }
      provider = new OpenAIProvider({
        apiKey: config.openaiApiKey,
        model: config.openaiModel,
        db,
        adminService,
        ownerUserId: config.ownerUserId,
        tenorApiKey: config.tenorApiKey,
        tavilyApiKey: config.tavilyApiKey,
      });
      console.log(`OpenAI model: ${config.openaiModel}`);
      break;
    }
    case 'claude-api': {
      if (!config.anthropicApiKey) {
        throw new Error('ANTHROPIC_API_KEY is required when LLM_PROVIDER=claude-api');
      }
      provider = new ClaudeAPIProvider({
        apiKey: config.anthropicApiKey,
        model: config.claudeApiModel,
        db,
        adminService,
        ownerUserId: config.ownerUserId,
        tenorApiKey: config.tenorApiKey,
        tavilyApiKey: config.tavilyApiKey,
      });
      console.log(`Claude API model: ${config.claudeApiModel}`);
      break;
    }
    default: {
      provider = new ClaudeCodeProvider({
        model: config.claudeModel,
        mcpConfigPath,
      });
      break;
    }
  }

  const sessionManager = new SessionManager(provider, db);
  const bot = createBot(config, db, provider, sessionManager, adminService);

  // Graceful shutdown — handle tsx watch restarts
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Shutting down...');
    bot.stop();
    db.close();
    // Give Telegram API time to release the polling connection
    await new Promise((r) => setTimeout(r, 500));
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);

  await bot.api.setMyCommands([
    { command: 'help', description: 'Toon beschikbare commando\'s' },
    { command: 'newsession', description: 'Start een nieuwe sessie' },
    { command: 'setmode', description: 'Stel de routing modus in' },
    { command: 'setprompt', description: 'Stel de custom prompt in' },
    { command: 'setprovider', description: 'Bekijk/wissel LLM provider' },
    { command: 'settings', description: 'Toon huidige instellingen' },
  ]);

  await bot.start({
    drop_pending_updates: true,
    onStart: async (botInfo) => {
      console.log(`Bot started as @${botInfo.username}`);

      // Send startup notification to chats with notify_on_start enabled
      const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf-8'));
      const version = pkg.version || '?.?.?';
      const chats = db.getAllChats().filter(c => c.notify_on_start);
      for (const chat of chats) {
        try {
          await bot.api.sendMessage(chat.chat_id, `🤖 Online — v${version}`, { parse_mode: 'HTML' });
        } catch (err) {
          console.error(`Failed to send startup message to chat ${chat.chat_id}:`, err instanceof Error ? err.message : err);
        }
      }
    },
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
