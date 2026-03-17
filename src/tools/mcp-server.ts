import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Database } from '../db/database.js';
import { AdminService } from '../admin/admin.js';
import { handleTelegramHistory } from './telegram-history.js';
import { handleAdminManagement } from './admin-management.js';
import { handleGifSearch } from './gif-search.js';
import { handleWebSearch } from './web-search.js';
import { handleChatSettings } from './chat-settings.js';
import { handleWebFetch } from './web-fetch.js';

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
  'chat_settings',
  {
    title: 'Chat Settings',
    description: 'View or change chat settings like routing mode, custom prompt, new session mode, or autonomous cooldown. Only admins can change settings.',
    inputSchema: z.object({
      action: z.enum(['get', 'set_mode', 'set_prompt', 'clear_prompt', 'set_newsession_mode', 'set_cooldown']).describe('Action to perform'),
      chat_id: z.number().describe('Telegram chat ID (auto-injected)'),
      requesting_user_id: z.number().describe('User ID making the request (auto-injected)'),
      value: z.string().optional().describe('New value'),
    }),
  },
  async (params) => {
    const result = handleChatSettings(db, OWNER_ID, (c, u) => adminService.isAdmin(c, u), params);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

server.registerTool(
  'web_fetch',
  {
    title: 'Fetch Web Page',
    description: 'Fetch and extract text content from a URL. Use this FIRST when someone shares a link. Falls back to web_search if the page cannot be fetched.',
    inputSchema: z.object({
      url: z.string().describe('The URL to fetch'),
      max_length: z.number().default(3000).describe('Max characters to return'),
    }),
  },
  async (params) => {
    const result = await handleWebFetch(params);
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

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MAX_TG_LENGTH = 4096;

function splitText(text: string): string[] {
  if (text.length <= MAX_TG_LENGTH) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > MAX_TG_LENGTH) {
    let splitAt = remaining.lastIndexOf('\n', MAX_TG_LENGTH);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf(' ', MAX_TG_LENGTH);
    if (splitAt <= 0) splitAt = MAX_TG_LENGTH;
    parts.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not configured');
  const parts = splitText(text.replace(/<br\s*\/?>/gi, '\n'));
  for (const part of parts) {
    const body: Record<string, unknown> = { chat_id: chatId, text: part, parse_mode: 'HTML' };
    let res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // Fallback: retry without parse_mode if HTML fails
    if (!res.ok) {
      delete body.parse_mode;
      res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Telegram sendMessage failed: ${err}`);
    }
  }
}

server.registerTool(
  'send_message',
  {
    title: 'Send Message',
    description: 'Send a message to the Telegram chat immediately. Use this to send progress updates, break long responses into multiple messages, or communicate with the user while performing other tasks.',
    inputSchema: z.object({
      chat_id: z.number().describe('Telegram chat ID'),
      text: z.string().describe('The message text (HTML formatted)'),
    }),
  },
  async (params) => {
    await sendTelegramMessage(params.chat_id, params.text);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ success: true }) }],
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
