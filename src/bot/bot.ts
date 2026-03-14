import { Bot, Context, InputFile, InlineKeyboard } from 'grammy';
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
  const queue = new MessageQueue(300_000); // 5 min timeout — Claude Code session init can be slow

  // Global error handler to prevent crashes
  bot.catch((err) => {
    console.error('Unhandled bot error:', err.message);
  });
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

  // --- Slash Commands ---

  bot.command('help', async (ctx) => {
    const text = [
      '<b>Beschikbare commando\'s:</b>',
      '',
      '/help — Dit overzicht',
      '/newsession — Start een nieuwe sessie',
      '/setmode — Stel de routing modus in',
      '/setprompt — Stel de custom prompt in',
      '/setprovider — Wissel van LLM provider',
      '/settings — Toon huidige instellingen',
      '',
      '<i>Admin commando\'s zijn alleen beschikbaar voor admins.</i>',
    ].join('\n');
    await ctx.reply(text, { parse_mode: 'HTML' });
  });

  bot.command('newsession', async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id;
    if (!userId || !adminService.isAdmin(chatId, userId)) {
      await ctx.reply('Je hebt geen rechten voor dit commando.');
      return;
    }

    await queue.enqueue(chatId, async () => {
      const systemPrompt = buildSystemPrompt(db, chatId, bot.botInfo.username);
      await sessionManager.newSession(chatId, systemPrompt);
      await ctx.reply('Nieuwe sessie gestart.');
    });
  });

  bot.command('setmode', async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id;
    if (!userId || !adminService.isAdmin(chatId, userId)) {
      await ctx.reply('Je hebt geen rechten voor dit commando.');
      return;
    }

    const chat = db.getChat(chatId);
    const current = chat?.routing_mode || 'commands_only';

    const keyboard = new InlineKeyboard()
      .text(`${current === 'commands_only' ? '✓ ' : ''}Commands only`, 'setmode:commands_only')
      .text(`${current === 'all_messages' ? '✓ ' : ''}Alle berichten`, 'setmode:all_messages')
      .text(`${current === 'autonomous' ? '✓ ' : ''}Autonoom`, 'setmode:autonomous');

    await ctx.reply('Kies de routing modus:', { reply_markup: keyboard });
  });

  bot.command('setprompt', async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id;
    if (!userId || !adminService.isAdmin(chatId, userId)) {
      await ctx.reply('Je hebt geen rechten voor dit commando.');
      return;
    }

    const rest = ctx.match?.trim();
    if (!rest) {
      const chat = db.getChat(chatId);
      const current = chat?.custom_prompt || '(geen)';
      const keyboard = new InlineKeyboard()
        .text('Verwijder prompt', 'setprompt:clear');
      await ctx.reply(`Huidige prompt: <i>${escapeHtml(current)}</i>\n\nGebruik: <code>/setprompt Je bent een sarcastische assistent</code>`, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      return;
    }

    db.updateChat(chatId, { custom_prompt: rest });
    await ctx.reply(`Custom prompt ingesteld: <i>${escapeHtml(rest)}</i>`, { parse_mode: 'HTML' });
  });

  bot.command('setprovider', async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id;
    if (!userId || !adminService.isAdmin(chatId, userId)) {
      await ctx.reply('Je hebt geen rechten voor dit commando.');
      return;
    }

    const keyboard = new InlineKeyboard()
      .text(`${config.llmProvider === 'claude-code' ? '✓ ' : ''}Claude Code`, 'setprovider:claude-code')
      .row()
      .text(`${config.llmProvider === 'claude-api' ? '✓ ' : ''}Claude API`, 'setprovider:claude-api')
      .row()
      .text(`${config.llmProvider === 'openai' ? '✓ ' : ''}OpenAI`, 'setprovider:openai');

    await ctx.reply('⚠️ Provider wisselen vereist een herstart van de bot.\nHuidige provider: <b>' + config.llmProvider + '</b>', {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  });

  bot.command('settings', async (ctx) => {
    const chatId = ctx.chat.id;
    const chat = db.getChat(chatId);
    const admins = adminService.listAdmins(chatId);

    const lines = [
      '<b>Instellingen voor deze chat:</b>',
      '',
      `<b>Provider:</b> ${config.llmProvider}`,
      `<b>Routing modus:</b> ${chat?.routing_mode || 'commands_only'}`,
      `<b>Custom prompt:</b> ${chat?.custom_prompt ? escapeHtml(chat.custom_prompt.slice(0, 100)) + (chat.custom_prompt.length > 100 ? '...' : '') : '(geen)'}`,
      `<b>Nieuwe sessie modus:</b> ${chat?.new_session_mode || 'clean'}`,
      `<b>Autonome cooldown:</b> ${chat?.autonomous_cooldown || 10}s`,
      `<b>Admins:</b> ${admins.length > 0 ? admins.map(a => {
        const username = db.resolveUsernameByUserId(chatId, a.user_id);
        return username ? `@${username}` : `${a.user_id}`;
      }).join(', ') : '(alleen owner)'}`,
    ];

    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

  // --- Callback Query Handler (inline keyboard responses) ---

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;

    if (!chatId || !userId) {
      await ctx.answerCallbackQuery('Fout: geen chat gevonden.');
      return;
    }

    // Handle setmode callbacks
    if (data.startsWith('setmode:')) {
      if (!adminService.isAdmin(chatId, userId)) {
        await ctx.answerCallbackQuery('Je hebt geen rechten hiervoor.');
        return;
      }
      const mode = data.slice('setmode:'.length);
      db.updateChat(chatId, { routing_mode: mode });
      await ctx.answerCallbackQuery(`Modus ingesteld op: ${mode}`);
      await ctx.editMessageText(`Routing modus ingesteld op: <b>${mode}</b>`, { parse_mode: 'HTML' });
      return;
    }

    // Handle setprompt:clear callback
    if (data === 'setprompt:clear') {
      if (!adminService.isAdmin(chatId, userId)) {
        await ctx.answerCallbackQuery('Je hebt geen rechten hiervoor.');
        return;
      }
      db.updateChat(chatId, { custom_prompt: '' });
      await ctx.answerCallbackQuery('Custom prompt verwijderd.');
      await ctx.editMessageText('Custom prompt verwijderd.');
      return;
    }

    // Handle setprovider callbacks (informational only — requires restart)
    if (data.startsWith('setprovider:')) {
      await ctx.answerCallbackQuery('Wijzig LLM_PROVIDER in je .env en herstart de bot.');
      return;
    }

    // Handle LLM-generated keyboard callbacks (prefixed with 'llm:')
    if (data.startsWith('llm:')) {
      const selectedOption = data.slice('llm:'.length);
      await ctx.answerCallbackQuery();

      // Update the message to show the selection
      const originalText = ctx.callbackQuery.message?.text || '';
      await ctx.editMessageText(`${originalText}\n\n<b>Gekozen:</b> ${escapeHtml(selectedOption)}`, { parse_mode: 'HTML' }).catch(() => {});

      // Send the selection as a message to the LLM
      await processMessage(ctx, chatId, `[Gebruiker koos optie: ${selectedOption}]`, false);
      return;
    }

    await ctx.answerCallbackQuery();
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
    try {
      await queue.enqueue(chatId, async () => {
        await ctx.replyWithChatAction('typing');
        const typingInterval = setInterval(() => {
          ctx.replyWithChatAction('typing').catch(() => {});
        }, 5000);

        try {

        const systemPrompt = buildSystemPrompt(db, chatId, bot.botInfo.username);
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

        // Pass messageInput to getOrCreateSession — if a new session is needed,
        // the provider can handle the first message in the same invocation
        // (avoids double CLI spawn for Claude Code, saving ~2-3 min).
        const { session, response: createResponse } = await sessionManager.getOrCreateSession(chatId, systemPrompt, messageInput);
        const response = createResponse || await provider.sendMessage(session, messageInput);

        // Handle empty response in autonomous mode (LLM chose not to respond)
        if (isAutonomous && (!response.text || response.text.trim() === '')) {
          return;
        }

        // Send text response
        if (response.text) {
          const parts = splitMessage(response.text);
          for (const part of parts) {
            await ctx.reply(part, { parse_mode: 'HTML' }).catch(async () => {
              // If HTML parsing fails, send as plain text
              await ctx.reply(part);
            });
          }
        }

        // Send inline keyboards from tool results
        if (response.toolResults?.length) {
          for (const tr of response.toolResults) {
            if (tr.tool === 'send_keyboard') {
              const kb = tr.result as { _type: string; message: string; options: string[]; columns?: number };
              if (kb._type === 'inline_keyboard' && kb.options?.length) {
                const keyboard = new InlineKeyboard();
                const cols = Math.min(kb.columns || 2, 4);
                kb.options.forEach((opt, i) => {
                  keyboard.text(opt, `llm:${opt}`);
                  if ((i + 1) % cols === 0 && i < kb.options.length - 1) {
                    keyboard.row();
                  }
                });
                await ctx.reply(kb.message, { reply_markup: keyboard, parse_mode: 'HTML' }).catch(async () => {
                  await ctx.reply(kb.message, { reply_markup: keyboard });
                });
              }
            }
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

        } finally {
          clearInterval(typingInterval);
        }
      });
    } catch (error) {
      console.error(`Error processing message for chat ${chatId}:`, error);
      if (error instanceof Error && error.message.includes('timeout')) {
        await ctx.reply('Antwoord duurde te lang, probeer het opnieuw.').catch(() => {});
      } else {
        await ctx.reply('Er ging iets mis, probeer het opnieuw.').catch(() => {});
      }
    }
  }

  return bot;
}

function buildSystemPrompt(db: Database, chatId: number, botUsername: string): string {
  const chat = db.getChat(chatId);
  const parts: string[] = [];

  parts.push(`Je bent een AI assistent in een Telegram chat. Je botnaam is @${botUsername}.`);
  parts.push('Je zit in een Telegram chat die mogelijk langer teruggaat dan je huidige sessie. Als je context nodig hebt van eerdere berichten, gebruik dan de telegram_history tool om gericht te zoeken in de chatgeschiedenis.');

  parts.push(`FORMATTING: Je berichten worden weergegeven in Telegram met HTML parse_mode. Gebruik HTML-tags voor opmaak:
- <b>vet</b>, <i>cursief</i>, <u>onderstreept</u>, <s>doorgestreept</s>
- <code>inline code</code> voor korte code
- <pre>codeblok</pre> voor meerregelige code (met optioneel <pre><code class="language-python">...</code></pre> voor syntax highlighting)
- <a href="url">linktekst</a> voor links
- <blockquote>citaat</blockquote> voor citaten
- <tg-spoiler>spoiler</tg-spoiler> voor spoilers
Gebruik GEEN Markdown-opmaak (geen *, **, \`, \`\`\`, #, -, etc.). Gebruik altijd de HTML-tags hierboven. Tekst zonder tags wordt gewoon als platte tekst weergegeven. Zorg dat je HTML correct is — open tags moeten altijd gesloten worden. Escape speciale tekens in gewone tekst: gebruik &amp; voor &, &lt; voor <, &gt; voor >.`);

  if (chat?.routing_mode === 'autonomous') {
    parts.push('Je bent in autonome modus. Je ontvangt alle berichten uit de chat. Reageer ALLEEN als je iets waardevols bij te dragen hebt. Als je niet wilt reageren, antwoord dan met een leeg bericht (geen tekst).');
  }

  if (chat?.custom_prompt) {
    parts.push(`\nAanvullende instructies voor deze chat:\n${chat.custom_prompt}`);
  }

  parts.push('\nAls iemand je vraagt om een admin toe te voegen, te verwijderen, of de adminlijst te tonen, gebruik dan de admin_management tool.');
  parts.push('Als je een GIF wilt sturen, gebruik dan de gif_search tool.');
  parts.push('Als je actuele informatie nodig hebt (nieuws, feiten, recente gebeurtenissen), gebruik dan de web_search tool. Gebruik dit altijd wanneer de gebruiker vraagt naar recent nieuws of informatie die na je trainingsdata kan zijn veranderd.');
  parts.push('Als je de gebruiker een keuze wilt aanbieden, gebruik dan de send_keyboard tool om een inline keyboard te sturen met opties. De gebruiker klikt op een optie en het resultaat wordt als bericht naar je teruggestuurd.');

  return parts.join('\n\n');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
