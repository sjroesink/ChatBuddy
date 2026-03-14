import { Bot, Context, InputFile } from 'grammy';
import { Config } from '../config.js';
import { Database } from '../db/database.js';
import { SessionManager } from '../llm/session.js';
import { LLMProvider, LLMError, MessageInput } from '../llm/provider.js';
import { MessageQueue } from './queue.js';
import { shouldProcessMessage, RoutingMode } from './router.js';
import { splitMessage, classifyDocument, transcribeVoice } from './media.js';
import { AdminService } from '../admin/admin.js';

interface AutonomousBuffer {
  messages: Array<{ username: string; text: string; time: string }>;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createBot(
  config: Config,
  db: Database,
  provider: LLMProvider,
  sessionManager: SessionManager,
  adminService: AdminService,
): Bot {
  const bot = new Bot(config.telegramBotToken);
  const queue = new MessageQueue();
  const autonomousBuffers = new Map<number, AutonomousBuffer>();

  // Store all messages middleware
  bot.use(async (ctx, next) => {
    if (ctx.message) {
      const chatId = ctx.chat?.id;
      const chatType = ctx.chat?.type || 'private';
      if (chatId) {
        db.upsertChat(chatId, chatType);
        db.storeMessage({
          message_id: ctx.message.message_id,
          chat_id: chatId,
          user_id: ctx.from?.id ?? null,
          username: ctx.from?.username ?? null,
          display_name: ctx.from?.first_name ?? null,
          text: ctx.message.text ?? ctx.message.caption ?? null,
          has_media: !!(ctx.message.photo || ctx.message.document || ctx.message.voice || ctx.message.video),
          media_type: ctx.message.photo ? 'photo' : ctx.message.document ? 'document' : ctx.message.voice ? 'voice' : ctx.message.video ? 'video' : null,
          reply_to: ctx.message.reply_to_message?.message_id ?? null,
        });
      }
    }
    await next();
  });

  // /newsession command
  bot.command('newsession', async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id;
    if (!userId || !adminService.isAdmin(chatId, userId)) {
      await ctx.reply('Je hebt geen rechten voor dit commando.');
      return;
    }

    await queue.enqueue(chatId, async () => {
      const systemPrompt = buildSystemPrompt(db, chatId, bot.botInfo.username);
      const { session } = await sessionManager.newSession(chatId, systemPrompt);
      await ctx.reply('Nieuwe sessie gestart.');
    });
  });

  // Main message handler
  bot.on('message', async (ctx) => {
    const chatId = ctx.chat.id;
    const chatType = ctx.chat.type;
    const userId = ctx.from?.id;
    const botUsername = bot.botInfo.username;
    const chat = db.getChat(chatId);
    const routingMode = (chat?.routing_mode || (chatType === 'private' ? 'all_messages' : 'commands_only')) as RoutingMode;
    const isPrivate = chatType === 'private';
    const messageText = ctx.message.text ?? ctx.message.caption ?? '';

    if (!shouldProcessMessage(routingMode, messageText, botUsername, isPrivate)) {
      return;
    }

    // Autonomous mode: buffer messages
    if (routingMode === 'autonomous' && !isPrivate) {
      const cooldown = (chat?.autonomous_cooldown || 10) * 1000;
      let buffer = autonomousBuffers.get(chatId);
      if (!buffer) {
        buffer = { messages: [], timer: null };
        autonomousBuffers.set(chatId, buffer);
      }

      const time = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
      const username = ctx.from?.username || ctx.from?.first_name || 'Unknown';
      buffer.messages.push({ username, text: messageText, time });

      // Drop oldest if > 20
      if (buffer.messages.length > 20) {
        buffer.messages = buffer.messages.slice(-20);
      }

      if (buffer.timer) clearTimeout(buffer.timer);
      buffer.timer = setTimeout(async () => {
        const msgs = buffer!.messages.splice(0);
        autonomousBuffers.delete(chatId);

        if (msgs.length === 0) return;

        const batchText = msgs.map((m) => `[${m.time}] @${m.username}: ${m.text}`).join('\n');
        await processMessage(ctx, chatId, batchText, true);
      }, cooldown);

      return;
    }

    await processMessage(ctx, chatId, messageText, routingMode === 'autonomous');
  });

  async function processMessage(ctx: Context, chatId: number, text: string, isAutonomous: boolean): Promise<void> {
    await queue.enqueue(chatId, async () => {
      try {
        await ctx.replyWithChatAction('typing');

        const systemPrompt = buildSystemPrompt(db, chatId, bot.botInfo.username);
        const session = await sessionManager.getOrCreateSession(chatId, systemPrompt);

        const messageInput: MessageInput = { text };

        // Handle photo attachments
        if (ctx.message && 'photo' in ctx.message && ctx.message.photo?.length) {
          const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Highest resolution
          const file = await ctx.api.getFile(photo.file_id);
          if (file.file_path) {
            const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
            messageInput.media = [{ type: 'image', data: url, mimeType: 'image/jpeg' }];
          }
        }

        // Handle documents
        if (ctx.message && 'document' in ctx.message && ctx.message.document) {
          const doc = ctx.message.document;
          const docType = classifyDocument(doc.file_name || '');
          if (docType === 'unsupported') {
            messageInput.text = (messageInput.text || '') + `\n[Unsupported document: ${doc.file_name}]`;
          } else {
            const file = await ctx.api.getFile(doc.file_id);
            if (file.file_path) {
              const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
              messageInput.media = [{
                type: 'document',
                data: url,
                mimeType: doc.mime_type || 'application/octet-stream',
                filename: doc.file_name || undefined,
              }];
            }
          }
        }

        // Handle voice messages
        if (ctx.message && 'voice' in ctx.message && ctx.message.voice) {
          if (!config.openaiApiKey) {
            await ctx.reply('Voice berichten worden niet ondersteund (Whisper API niet geconfigureerd)');
            return;
          }
          const voice = ctx.message.voice;
          const file = await ctx.api.getFile(voice.file_id);
          if (file.file_path) {
            const voiceUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
            const transcription = await transcribeVoice(voiceUrl, config.openaiApiKey);
            messageInput.text = (messageInput.text || '') + `\n[Voice bericht]: "${transcription}"`;
          }
        }

        const response = await provider.sendMessage(session, messageInput);

        // Handle empty response in autonomous mode (LLM chose not to respond)
        if (isAutonomous && (!response.text || response.text.trim() === '')) {
          return;
        }

        // Send text response
        if (response.text) {
          const parts = splitMessage(response.text);
          for (const part of parts) {
            await ctx.reply(part, { parse_mode: 'Markdown' }).catch(async () => {
              // If Markdown parsing fails, send as plain text
              await ctx.reply(part);
            });
          }
        }

        // Send media
        if (response.media?.length) {
          for (const media of response.media) {
            if (media.type === 'image' && typeof media.data === 'string') {
              await ctx.replyWithPhoto(new InputFile(new URL(media.data)));
            } else if (media.type === 'gif' && typeof media.data === 'string') {
              await ctx.replyWithAnimation(new InputFile(new URL(media.data)));
            }
          }
        }
      } catch (error) {
        console.error(`Error processing message for chat ${chatId}:`, error);
        if (error instanceof Error && error.message.includes('timeout')) {
          await ctx.reply('Antwoord duurde te lang, probeer het opnieuw.');
        } else {
          await ctx.reply('Er ging iets mis, probeer het opnieuw.');
        }
      }
    });
  }

  return bot;
}

function buildSystemPrompt(db: Database, chatId: number, botUsername: string): string {
  const chat = db.getChat(chatId);
  const parts: string[] = [];

  parts.push(`Je bent een AI assistent in een Telegram chat. Je botnaam is @${botUsername}.`);
  parts.push('Je zit in een Telegram chat die mogelijk langer teruggaat dan je huidige sessie. Als je context nodig hebt van eerdere berichten, gebruik dan de telegram_history tool om gericht te zoeken in de chatgeschiedenis.');

  if (chat?.routing_mode === 'autonomous') {
    parts.push('Je bent in autonome modus. Je ontvangt alle berichten uit de chat. Reageer ALLEEN als je iets waardevols bij te dragen hebt. Als je niet wilt reageren, antwoord dan met een leeg bericht (geen tekst).');
  }

  if (chat?.custom_prompt) {
    parts.push(`\nAanvullende instructies voor deze chat:\n${chat.custom_prompt}`);
  }

  parts.push('\nAls iemand je vraagt om een admin toe te voegen, te verwijderen, of de adminlijst te tonen, gebruik dan de admin_management tool.');
  parts.push('Als je een GIF wilt sturen, gebruik dan de gif_search tool.');

  return parts.join('\n\n');
}
