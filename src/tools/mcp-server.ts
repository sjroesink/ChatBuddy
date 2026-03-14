import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Database } from '../db/database.js';
import { AdminService } from '../admin/admin.js';
import { handleTelegramHistory } from './telegram-history.js';
import { handleAdminManagement } from './admin-management.js';
import { handleGifSearch } from './gif-search.js';
import { handleWebSearch } from './web-search.js';

const DB_PATH = process.env.DATABASE_PATH || './data/bot.db';
const OWNER_ID = parseInt(process.env.OWNER_USER_ID || '0', 10);
const TENOR_API_KEY = process.env.TENOR_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

const db = new Database(DB_PATH);
const adminService = new AdminService(db, OWNER_ID);

const server = new McpServer({
  name: 'telegram-agent-tools',
  version: '1.0.0',
});

server.registerTool(
  'telegram_history',
  {
    title: 'Telegram Chat History',
    description: 'Search and retrieve messages from the Telegram chat history. Use this to find context from earlier in the conversation.',
    inputSchema: z.object({
      chat_id: z.number().describe('Telegram chat ID (auto-injected)'),
      query: z.string().optional().describe('Text search within messages'),
      limit: z.number().min(1).max(100).default(20).describe('Max messages to return'),
      offset_id: z.number().optional().describe('Fetch messages before this message ID'),
      from_user: z.string().optional().describe('Filter by username'),
    }),
  },
  async (params) => {
    const result = handleTelegramHistory(db, params);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

server.registerTool(
  'admin_management',
  {
    title: 'Admin Management',
    description: 'Manage chat administrators. Add, remove, or list admins for a chat.',
    inputSchema: z.object({
      action: z.enum(['add', 'remove', 'list']).describe('Action to perform'),
      chat_id: z.number().describe('Telegram chat ID (auto-injected)'),
      requesting_user_id: z.number().describe('User ID making the request (auto-injected)'),
      target_user_id: z.number().optional().describe('Target user ID for add/remove'),
      target_username: z.string().optional().describe('Target username for add/remove'),
    }),
  },
  async (params) => {
    const result = handleAdminManagement(adminService, params);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

server.registerTool(
  'gif_search',
  {
    title: 'GIF Search',
    description: 'Search for GIFs using Tenor. Use this when you want to send a GIF in the chat.',
    inputSchema: z.object({
      query: z.string().describe('Search term for GIFs'),
      limit: z.number().min(1).max(5).default(1).describe('Number of GIFs to return'),
    }),
  },
  async (params) => {
    const result = await handleGifSearch(TENOR_API_KEY, params);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

server.registerTool(
  'web_search',
  {
    title: 'Web Search',
    description: 'Search the web for current information. Use this when you need up-to-date information, news, or facts that may not be in your training data.',
    inputSchema: z.object({
      query: z.string().describe('Search query'),
      max_results: z.number().min(1).max(10).default(5).describe('Maximum number of results'),
    }),
  },
  async (params) => {
    const result = await handleWebSearch(TAVILY_API_KEY, params);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

server.registerTool(
  'send_keyboard',
  {
    title: 'Send Inline Keyboard',
    description: 'Send a message with an inline keyboard to let the user choose from options. The user\'s choice will be sent back to you as a message.',
    inputSchema: z.object({
      message: z.string().describe('The message text to display above the keyboard'),
      options: z.array(z.string()).min(1).max(20).describe('Array of option labels for the keyboard buttons'),
      columns: z.number().min(1).max(4).default(2).describe('Number of buttons per row'),
    }),
  },
  async (params) => {
    // Return the keyboard data — Claude Code will include this in its response
    // and the bot will parse it to create an actual Telegram inline keyboard
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        _type: 'inline_keyboard',
        message: params.message,
        options: params.options,
        columns: params.columns || 2,
      }) }],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Telegram Agent MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in MCP server:', error);
  process.exit(1);
});
