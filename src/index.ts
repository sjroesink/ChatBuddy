import { loadConfig } from './config.js';
import { Database } from './db/database.js';
import { ClaudeCodeProvider } from './llm/providers/claude-code.js';
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

  const provider = new ClaudeCodeProvider({
    model: config.claudeModel,
    mcpConfigPath,
  });

  const sessionManager = new SessionManager(provider, db);
  const adminService = new AdminService(db, config.ownerUserId);
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
