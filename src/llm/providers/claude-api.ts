import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import { LLMProvider, Session, MessageInput, MessageOutput, CreateSessionResult, LLMError } from '../provider.js';
import { Database } from '../../db/database.js';
import { handleTelegramHistory } from '../../tools/telegram-history.js';
import { handleAdminManagement } from '../../tools/admin-management.js';
import { handleGifSearch } from '../../tools/gif-search.js';
import { handleWebSearch } from '../../tools/web-search.js';
import { handleChatSettings } from '../../tools/chat-settings.js';
import { AdminService } from '../../admin/admin.js';

export interface ClaudeAPIProviderConfig {
  apiKey: string;
  model?: string;
  db: Database;
  adminService: AdminService;
  ownerUserId: number;
  tenorApiKey?: string;
  tavilyApiKey?: string;
}

const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'telegram_history',
    description: 'Search and retrieve messages from the Telegram chat history. Use this to find context from earlier in the conversation.',
    input_schema: {
      type: 'object',
      properties: {
        chat_id: { type: 'number', description: 'Telegram chat ID (auto-injected)' },
        query: { type: 'string', description: 'Text search within messages' },
        limit: { type: 'number', description: 'Max messages to return (default 20, max 100)' },
        offset_id: { type: 'number', description: 'Fetch messages before this message ID' },
        from_user: { type: 'string', description: 'Filter by username' },
      },
      required: ['chat_id'],
    },
  },
  {
    name: 'admin_management',
    description: 'Manage chat administrators. Add, remove, or list admins for a chat.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'remove', 'list'], description: 'Action to perform' },
        chat_id: { type: 'number', description: 'Telegram chat ID (auto-injected)' },
        requesting_user_id: { type: 'number', description: 'User ID making the request (auto-injected)' },
        target_user_id: { type: 'number', description: 'Target user ID for add/remove' },
        target_username: { type: 'string', description: 'Target username for add/remove' },
      },
      required: ['action', 'chat_id', 'requesting_user_id'],
    },
  },
  {
    name: 'gif_search',
    description: 'Search for GIFs using Tenor. Use this when you want to send a GIF in the chat.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term for GIFs' },
        limit: { type: 'number', description: 'Number of GIFs to return (default 1, max 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'send_keyboard',
    description: 'Send a message with an inline keyboard to let the user choose from options. The user\'s choice will be sent back to you as a message.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The message text to display above the keyboard' },
        options: { type: 'array', items: { type: 'string' }, description: 'Array of option labels for the keyboard buttons' },
        columns: { type: 'number', description: 'Number of buttons per row (default 2, max 4)' },
      },
      required: ['message', 'options'],
    },
  },
  {
    name: 'chat_settings',
    description: 'View or change chat settings like routing mode, custom prompt, new session mode, or autonomous cooldown. Only admins can change settings.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'set_mode', 'set_prompt', 'clear_prompt', 'set_newsession_mode', 'set_cooldown'], description: 'Action to perform' },
        chat_id: { type: 'number', description: 'Telegram chat ID (auto-injected)' },
        requesting_user_id: { type: 'number', description: 'User ID making the request (auto-injected)' },
        value: { type: 'string', description: 'New value. For set_mode: commands_only|all_messages|autonomous. For set_newsession_mode: clean|recent_messages|summary. For set_cooldown: seconds (1-300).' },
      },
      required: ['action', 'chat_id', 'requesting_user_id'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web for current information. Use this when you need up-to-date information, news, or facts that may not be in your training data.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        max_results: { type: 'number', description: 'Maximum number of results (default 5, max 10)' },
      },
      required: ['query'],
    },
  },
];

export class ClaudeAPIProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;
  private db: Database;
  private adminService: AdminService;
  private ownerUserId: number;
  private tenorApiKey?: string;
  private tavilyApiKey?: string;

  constructor(config: ClaudeAPIProviderConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model || 'claude-sonnet-4-20250514';
    this.db = config.db;
    this.adminService = config.adminService;
    this.ownerUserId = config.ownerUserId;
    this.tenorApiKey = config.tenorApiKey;
    this.tavilyApiKey = config.tavilyApiKey;
  }

  async createSession(chatId: string, systemPrompt: string, firstMessage?: MessageInput): Promise<CreateSessionResult> {
    const sessionId = randomUUID();
    this.db.addConversationMessage(sessionId, 'system', systemPrompt);
    const session: Session = { id: sessionId, chatId, provider: 'claude-api' };

    if (firstMessage) {
      const response = await this.sendMessage(session, firstMessage);
      return { session, response };
    }
    return { session };
  }

  async resumeSession(sessionId: string): Promise<Session> {
    const history = this.db.getConversationHistory(sessionId);
    if (history.length === 0) {
      throw new LLMError(`Session ${sessionId} not found`);
    }
    return { id: sessionId, chatId: '', provider: 'claude-api' };
  }

  async destroySession(sessionId: string): Promise<void> {
    this.db.clearConversationHistory(sessionId);
  }

  async sendMessage(session: Session, message: MessageInput): Promise<MessageOutput> {
    try {
      // Build and store user message
      const userContent = this.buildUserContent(message);
      this.db.addConversationMessage(session.id, 'user', JSON.stringify(userContent));

      // Load history
      const history = this.db.getConversationHistory(session.id);
      const { system, messages } = this.historyToMessages(history);

      // Call Claude API
      let response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system,
        messages,
        tools: TOOL_DEFINITIONS,
      });

      // Track media and keyboards from tool results
      const mediaAttachments: import('../provider.js').MediaAttachment[] = [];
      const outputToolResults: import('../provider.js').ToolResult[] = [];

      // Handle tool use loop
      while (response.stop_reason === 'tool_use') {
        // Store assistant response with tool calls
        this.db.addConversationMessage(
          session.id,
          'assistant',
          JSON.stringify(response.content),
        );

        // Execute tool calls and build tool results
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            const result = await this.executeTool(block.name, block.input);

            // Extract GIF URLs from gif_search results
            if (block.name === 'gif_search') {
              const gifResult = result as { gifs?: Array<{ url: string }> };
              if (gifResult.gifs?.length) {
                for (const gif of gifResult.gifs) {
                  if (gif.url) {
                    mediaAttachments.push({ type: 'gif', data: gif.url, mimeType: 'image/gif' });
                  }
                }
              }
            }

            // Track keyboard tool results
            if (block.name === 'send_keyboard') {
              outputToolResults.push({ tool: 'send_keyboard', result: { _type: 'inline_keyboard', ...(block.input as Record<string, unknown>) } });
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }
        }

        // Store tool results as a single user message (Anthropic format)
        this.db.addConversationMessage(session.id, 'user', JSON.stringify(toolResults));

        // Re-fetch with full history
        const updatedHistory = this.db.getConversationHistory(session.id);
        const updated = this.historyToMessages(updatedHistory);

        response = await this.client.messages.create({
          model: this.model,
          max_tokens: 4096,
          system: updated.system,
          messages: updated.messages,
          tools: TOOL_DEFINITIONS,
        });
      }

      // Extract text from response
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      // Store final response
      this.db.addConversationMessage(session.id, 'assistant', text);

      return {
        text,
        media: mediaAttachments.length > 0 ? mediaAttachments : undefined,
        toolResults: outputToolResults.length > 0 ? outputToolResults : undefined,
      };
    } catch (error) {
      throw new LLMError(
        `Claude API failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  supportsTools(): boolean { return true; }
  supportsMedia(): boolean { return true; }
  supportsResume(): boolean { return true; }

  private buildUserContent(message: MessageInput): Anthropic.ContentBlockParam[] {
    const parts: Anthropic.ContentBlockParam[] = [];

    if (message.context) {
      parts.push({ type: 'text', text: `[Context] ${message.context}` });
    }
    if (message.text) {
      parts.push({ type: 'text', text: message.text });
    }

    if (message.media?.length) {
      for (const media of message.media) {
        if (media.type === 'image' && typeof media.data === 'string') {
          parts.push({
            type: 'image',
            source: { type: 'url', url: media.data },
          });
        } else if (typeof media.data === 'string') {
          parts.push({ type: 'text', text: `[Attached ${media.type}: ${media.filename || media.data}]` });
        }
      }
    }

    if (parts.length === 0) {
      parts.push({ type: 'text', text: '(empty message)' });
    }

    return parts;
  }

  private historyToMessages(history: Array<{ role: string; content: string | null; tool_calls: string | null; tool_call_id: string | null }>): {
    system: string;
    messages: Anthropic.MessageParam[];
  } {
    let system = '';
    const messages: Anthropic.MessageParam[] = [];

    for (const row of history) {
      if (row.role === 'system') {
        system = row.content || '';
        continue;
      }
      if (row.role === 'assistant') {
        // Could be plain text or JSON content blocks (from tool use)
        let content: string | Anthropic.ContentBlockParam[];
        try {
          const parsed = JSON.parse(row.content || '""');
          if (Array.isArray(parsed)) {
            content = parsed;
          } else {
            content = row.content || '';
          }
        } catch {
          content = row.content || '';
        }
        messages.push({ role: 'assistant', content });
      } else if (row.role === 'user') {
        // Could be plain text, JSON content blocks, or tool results
        let content: string | Anthropic.ContentBlockParam[];
        try {
          const parsed = JSON.parse(row.content || '""');
          if (Array.isArray(parsed)) {
            content = parsed;
          } else {
            content = row.content || '';
          }
        } catch {
          content = row.content || '';
        }
        messages.push({ role: 'user', content });
      }
    }

    return { system, messages };
  }

  private async executeTool(name: string, input: unknown): Promise<unknown> {
    const args = input as Record<string, unknown>;
    switch (name) {
      case 'telegram_history':
        return handleTelegramHistory(this.db, args as any);
      case 'admin_management':
        return handleAdminManagement(this.adminService, args as any);
      case 'gif_search':
        return handleGifSearch(this.tenorApiKey, args as any);
      case 'send_keyboard':
        return { success: true, message: 'Keyboard will be sent to user.' };
      case 'chat_settings':
        return handleChatSettings(this.db, this.ownerUserId, (c, u) => this.adminService.isAdmin(c, u), args as any);
      case 'web_search':
        return handleWebSearch(this.tavilyApiKey, args as any);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }
}
