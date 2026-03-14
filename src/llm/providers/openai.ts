import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import { LLMProvider, Session, MessageInput, MessageOutput, CreateSessionResult, LLMError } from '../provider.js';
import { Database } from '../../db/database.js';
import { handleTelegramHistory } from '../../tools/telegram-history.js';
import { handleAdminManagement } from '../../tools/admin-management.js';
import { handleGifSearch } from '../../tools/gif-search.js';
import { handleWebSearch } from '../../tools/web-search.js';
import { handleChatSettings } from '../../tools/chat-settings.js';
import { AdminService } from '../../admin/admin.js';

export interface OpenAIProviderConfig {
  apiKey: string;
  model?: string;
  db: Database;
  adminService: AdminService;
  ownerUserId: number;
  tenorApiKey?: string;
  tavilyApiKey?: string;
}

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const TOOL_DEFINITIONS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'telegram_history',
      description: 'Search and retrieve messages from the Telegram chat history. Use this to find context from earlier in the conversation.',
      parameters: {
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
  },
  {
    type: 'function',
    function: {
      name: 'admin_management',
      description: 'Manage chat administrators. Add, remove, or list admins for a chat.',
      parameters: {
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
  },
  {
    type: 'function',
    function: {
      name: 'gif_search',
      description: 'Search for GIFs using Tenor. Use this when you want to send a GIF in the chat.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term for GIFs' },
          limit: { type: 'number', description: 'Number of GIFs to return (default 1, max 5)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_keyboard',
      description: 'Send a message with an inline keyboard to let the user choose from options. The user\'s choice will be sent back to you as a message.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'The message text to display above the keyboard' },
          options: { type: 'array', items: { type: 'string' }, description: 'Array of option labels for the keyboard buttons' },
          columns: { type: 'number', description: 'Number of buttons per row (default 2, max 4)' },
        },
        required: ['message', 'options'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'chat_settings',
      description: 'View or change chat settings like routing mode, custom prompt, new session mode, or autonomous cooldown. Only admins can change settings.',
      parameters: {
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
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for current information. Use this when you need up-to-date information, news, or facts that may not be in your training data.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          max_results: { type: 'number', description: 'Maximum number of results (default 5, max 10)' },
        },
        required: ['query'],
      },
    },
  },
];

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;
  private db: Database;
  private adminService: AdminService;
  private ownerUserId: number;
  private tenorApiKey?: string;
  private tavilyApiKey?: string;

  constructor(config: OpenAIProviderConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model || 'gpt-4o';
    this.db = config.db;
    this.adminService = config.adminService;
    this.ownerUserId = config.ownerUserId;
    this.tenorApiKey = config.tenorApiKey;
    this.tavilyApiKey = config.tavilyApiKey;
  }

  async createSession(chatId: string, systemPrompt: string, firstMessage?: MessageInput): Promise<CreateSessionResult> {
    const sessionId = randomUUID();

    // Store system prompt as first message
    this.db.addConversationMessage(sessionId, 'system', systemPrompt);

    const session: Session = {
      id: sessionId,
      chatId,
      provider: 'openai',
    };

    // If a first message is provided, send it immediately to avoid a separate round-trip
    if (firstMessage) {
      const response = await this.sendMessage(session, firstMessage);
      return { session, response };
    }

    return { session };
  }

  async resumeSession(sessionId: string): Promise<Session> {
    // Verify history exists
    const history = this.db.getConversationHistory(sessionId);
    if (history.length === 0) {
      throw new LLMError(`Session ${sessionId} not found`);
    }
    return {
      id: sessionId,
      chatId: '',
      provider: 'openai',
    };
  }

  async destroySession(sessionId: string): Promise<void> {
    this.db.clearConversationHistory(sessionId);
  }

  async sendMessage(session: Session, message: MessageInput): Promise<MessageOutput> {
    try {
      // Build user message content
      const userContent = this.buildUserContent(message);

      // Store user message
      this.db.addConversationMessage(session.id, 'user', typeof userContent === 'string' ? userContent : JSON.stringify(userContent));

      // Load full history
      const history = this.db.getConversationHistory(session.id);
      const messages = this.historyToMessages(history);

      // Call OpenAI
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools: TOOL_DEFINITIONS,
      });

      let choice = response.choices[0];
      let assistantMessage = choice.message;

      // Track media and keyboards from tool results
      const mediaAttachments: import('../provider.js').MediaAttachment[] = [];
      const toolResults: import('../provider.js').ToolResult[] = [];

      // Handle tool calls loop
      while (assistantMessage.tool_calls?.length) {
        // Store assistant message with tool calls
        this.db.addConversationMessage(
          session.id,
          'assistant',
          assistantMessage.content,
          JSON.stringify(assistantMessage.tool_calls),
        );

        // Execute each tool call
        for (const toolCall of assistantMessage.tool_calls) {
          if (toolCall.type !== 'function') continue;
          const result = await this.executeTool(toolCall.function.name, toolCall.function.arguments);

          // Extract GIF URLs from gif_search results
          if (toolCall.function.name === 'gif_search') {
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
          if (toolCall.function.name === 'send_keyboard') {
            const kbArgs = JSON.parse(toolCall.function.arguments);
            toolResults.push({ tool: 'send_keyboard', result: { _type: 'inline_keyboard', ...kbArgs } });
          }

          this.db.addConversationMessage(
            session.id,
            'tool',
            JSON.stringify(result),
            undefined,
            toolCall.id,
          );
        }

        // Re-fetch with tool results
        const updatedHistory = this.db.getConversationHistory(session.id);
        const updatedMessages = this.historyToMessages(updatedHistory);

        const followUp = await this.client.chat.completions.create({
          model: this.model,
          messages: updatedMessages,
          tools: TOOL_DEFINITIONS,
        });

        choice = followUp.choices[0];
        assistantMessage = choice.message;
      }

      // Store final assistant response
      const text = assistantMessage.content || '';
      this.db.addConversationMessage(session.id, 'assistant', text);

      return {
        text,
        media: mediaAttachments.length > 0 ? mediaAttachments : undefined,
        toolResults: toolResults.length > 0 ? toolResults : undefined,
      };
    } catch (error) {
      throw new LLMError(
        `OpenAI failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  supportsTools(): boolean { return true; }
  supportsMedia(): boolean { return true; }
  supportsResume(): boolean { return true; }

  private buildUserContent(message: MessageInput): string | Array<OpenAI.Chat.Completions.ChatCompletionContentPart> {
    const parts: Array<OpenAI.Chat.Completions.ChatCompletionContentPart> = [];

    if (message.context) {
      parts.push({ type: 'text', text: `[Context] ${message.context}` });
    }
    if (message.text) {
      parts.push({ type: 'text', text: message.text });
    }

    // Add image URLs for vision
    if (message.media?.length) {
      for (const media of message.media) {
        if (media.type === 'image' && typeof media.data === 'string') {
          parts.push({
            type: 'image_url',
            image_url: { url: media.data },
          });
        } else if (typeof media.data === 'string') {
          parts.push({ type: 'text', text: `[Attached ${media.type}: ${media.filename || media.data}]` });
        }
      }
    }

    // If only text parts, return as simple string
    if (parts.length === 1 && parts[0].type === 'text') {
      return parts[0].text;
    }
    return parts.length > 0 ? parts : '';
  }

  private historyToMessages(history: Array<{ role: string; content: string | null; tool_calls: string | null; tool_call_id: string | null }>): ChatMessage[] {
    return history.map((row): ChatMessage => {
      if (row.role === 'tool') {
        return {
          role: 'tool',
          content: row.content || '',
          tool_call_id: row.tool_call_id || '',
        };
      }
      if (row.role === 'assistant' && row.tool_calls) {
        return {
          role: 'assistant',
          content: row.content || null,
          tool_calls: JSON.parse(row.tool_calls),
        };
      }
      if (row.role === 'system') {
        return { role: 'system', content: row.content || '' };
      }
      // user message — could be multipart JSON or plain string
      if (row.role === 'user' && row.content?.startsWith('[')) {
        try {
          return { role: 'user', content: JSON.parse(row.content) };
        } catch {
          // Not JSON, treat as plain text
        }
      }
      return { role: 'user', content: row.content || '' };
    });
  }

  private async executeTool(name: string, argsJson: string): Promise<unknown> {
    const args = JSON.parse(argsJson);
    switch (name) {
      case 'telegram_history':
        return handleTelegramHistory(this.db, args);
      case 'admin_management':
        return handleAdminManagement(this.adminService, args);
      case 'gif_search':
        return handleGifSearch(this.tenorApiKey, args);
      case 'send_keyboard':
        return { success: true, message: 'Keyboard will be sent to user.' };
      case 'chat_settings':
        return handleChatSettings(this.db, this.ownerUserId, (c, u) => this.adminService.isAdmin(c, u), args);
      case 'web_search':
        return handleWebSearch(this.tavilyApiKey, args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }
}
