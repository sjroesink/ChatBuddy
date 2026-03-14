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
        tenorApiKey: config.tenorApiKey,
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
        tenorApiKey: config.tenorApiKey,
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
