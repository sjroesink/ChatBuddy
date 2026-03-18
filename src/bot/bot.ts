import { Bot, Context, InputFile, InlineKeyboard } from 'grammy';
import { Config } from '../config.js';
import { Database } from '../db/database.js';
import { SessionManager } from '../llm/session.js';
import { LLMProvider, LLMError, MessageInput, ToolCallbacks } from '../llm/provider.js';
import { MessageQueue } from './queue.js';
import { shouldProcessMessage, RoutingMode } from './router.js';
import { splitMessage, classifyDocument, transcribeVoice } from './media.js';
import { AdminService } from '../admin/admin.js';

interface BufferedMessage {
  username: string;
  text: string;
  time: string;
  photoFileId?: string;  // Store file_id so we can download it later during batch processing
}

interface AutonomousBuffer {
  messages: BufferedMessage[];
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
          has_media: !!(ctx.message.photo || ctx.message.document || ctx.message.voice || ctx.message.video || ctx.message.animation || ctx.message.sticker),
          media_type: ctx.message.photo ? 'photo' : ctx.message.document ? 'document' : ctx.message.voice ? 'voice' : ctx.message.video ? 'video' : ctx.message.animation ? 'animation' : ctx.message.sticker ? 'sticker' : null,
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
      `<b>Opstartmelding:</b> ${(chat?.notify_on_start ?? 1) ? 'aan' : 'uit'}`,
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
      // Format: llm:<index>:<label>
      const rest = data.slice('llm:'.length);
      const colonIdx = rest.indexOf(':');
      const selectedOption = colonIdx >= 0 ? rest.slice(colonIdx + 1) : rest;
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

    // In autonomous mode: buffer ALL messages (including mentions) and process as batch
    if (routingMode === 'autonomous' && !isPrivate) {
      const cooldown = (chat?.autonomous_cooldown || 10) * 1000;
      let buffer = autonomousBuffers.get(chatId);
      if (!buffer) {
        buffer = { messages: [], timer: null };
        autonomousBuffers.set(chatId, buffer);
      }

      const time = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
      const displayName = ctx.from?.first_name || 'Unknown';
      const username = ctx.from?.username || displayName;
      let msgText = messageText || `[${ctx.message.sticker ? 'sticker' : ctx.message.photo ? 'foto' : ctx.message.animation ? 'GIF' : 'media'}]`;

      // Include reply context
      const replyContext = formatReplyContext(ctx);
      if (replyContext) {
        msgText = `${replyContext}\n${msgText}`;
      }

      // Store photo file_id for later processing
      let photoFileId: string | undefined;
      if (ctx.message.photo?.length) {
        photoFileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        if (!messageText) msgText = `${msgText} [foto bijgevoegd]`;
      }

      buffer.messages.push({ username, text: msgText, time, photoFileId });

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

        // Collect photo file_ids from buffered messages
        const photoFileIds = msgs.filter((m) => m.photoFileId).map((m) => m.photoFileId!);

        await processMessage(ctx, chatId, batchText, true, photoFileIds);
      }, cooldown);

      return;
    }

    // Non-autonomous modes: check if we should process
    if (!shouldProcessMessage(routingMode, messageText, botUsername, isPrivate)) {
      return;
    }

    // Include reply context so the LLM knows what message is being replied to
    const replyContext = formatReplyContext(ctx);
    const fullText = replyContext ? `${replyContext}\n${messageText}` : messageText;

    // Detect if this is a mention (vs a /command) in commands_only mode
    const isMention = routingMode === 'commands_only' && !isPrivate
      && !messageText.startsWith('/')
      && messageText.toLowerCase().includes(`@${botUsername.toLowerCase()}`);

    await processMessage(ctx, chatId, fullText, false, undefined, isMention);
  });

  async function processMessage(ctx: Context, chatId: number, text: string, isAutonomous: boolean, extraPhotoFileIds?: string[], isMention?: boolean): Promise<void> {
    try {
      await queue.enqueue(chatId, async () => {
        await ctx.replyWithChatAction('typing');
        const typingInterval = setInterval(() => {
          ctx.replyWithChatAction('typing').catch(() => {});
        }, 5000);

        try {

        // When triggered by a mention in commands_only mode, prepend recent conversation context
        if (isMention) {
          const recentMessages = db.getRecentMessages(chatId, 20);
          const contextLines = recentMessages.reverse().map(m => {
            const name = m.username ? `@${m.username}` : m.display_name || 'Unknown';
            return `${name}: ${m.text || '[media]'}`;
          });
          if (contextLines.length > 0) {
            const contextBlock = `[Recente berichten in dit gesprek voor context:]\n${contextLines.join('\n')}\n\n[Bericht gericht aan jou:]`;
            text = `${contextBlock}\n${text}`;
          }
        }

        const userId = ctx.from?.id ?? 0;
        const systemPrompt = buildSystemPrompt(db, chatId, bot.botInfo.username);
        const callbacks: ToolCallbacks = {
          chatId,
          userId,
          onSendMessage: async (msgText: string) => {
            const cleanedText = msgText.replace(/<br\s*\/?>/gi, '\n');
            const parts = splitMessage(cleanedText);
            for (const part of parts) {
              await ctx.reply(part, { parse_mode: 'HTML' }).catch(async () => {
                await ctx.reply(part);
              });
            }
          },
        };
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

        // Handle extra photos from autonomous buffer (photos from other messages in the batch)
        if (extraPhotoFileIds?.length) {
          const media = messageInput.media || [];
          for (const fileId of extraPhotoFileIds) {
            try {
              const file = await ctx.api.getFile(fileId);
              if (file.file_path) {
                const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
                media.push({ type: 'image', data: url, mimeType: 'image/jpeg' });
              }
            } catch {
              // File might have expired, skip it
            }
          }
          if (media.length > 0) messageInput.media = media;
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

        // Handle animations (GIFs)
        if (ctx.message && 'animation' in ctx.message && ctx.message.animation) {
          const anim = ctx.message.animation;
          const file = await ctx.api.getFile(anim.file_id);
          if (file.file_path) {
            const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
            messageInput.media = [{ type: 'image', data: url, mimeType: anim.mime_type || 'video/mp4', filename: anim.file_name || 'animation.mp4' }];
            if (!messageInput.text || messageInput.text === text) {
              messageInput.text = (messageInput.text || '') + `\n[Gebruiker stuurde een GIF: ${anim.file_name || 'animation'}]`;
            }
          }
        }

        // Handle video
        if (ctx.message && 'video' in ctx.message && ctx.message.video) {
          const video = ctx.message.video;
          const file = await ctx.api.getFile(video.file_id);
          if (file.file_path) {
            const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
            messageInput.text = (messageInput.text || '') + `\n[Gebruiker stuurde een video: ${video.file_name || 'video'}, ${video.duration}s]`;
          }
        }

        // Handle stickers
        if (ctx.message && 'sticker' in ctx.message && ctx.message.sticker) {
          const sticker = ctx.message.sticker;
          messageInput.text = (messageInput.text || '') + `\n[Gebruiker stuurde een sticker: ${sticker.emoji || ''} "${sticker.set_name || 'unknown set'}"]`;
          // If sticker has a thumbnail, send it as image for vision
          if (sticker.thumbnail) {
            const file = await ctx.api.getFile(sticker.thumbnail.file_id);
            if (file.file_path) {
              const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
              messageInput.media = [{ type: 'image', data: url, mimeType: 'image/webp' }];
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
        const { session, response: createResponse } = await sessionManager.getOrCreateSession(chatId, systemPrompt, messageInput, callbacks);
        const response = createResponse || await provider.sendMessage(session, messageInput, callbacks);

        // Handle empty response in autonomous mode (LLM chose not to respond)
        if (isAutonomous && (!response.text || response.text.trim() === '')) {
          return;
        }

        // Send text response
        if (response.text) {
          // Replace <br> tags with newlines — Telegram doesn't support <br>
          const cleanedText = response.text.replace(/<br\s*\/?>/gi, '\n');
          const parts = splitMessage(cleanedText);
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
                  // Telegram callback data max 64 bytes — use index as callback, label as display
                  keyboard.text(opt.slice(0, 40), `llm:${i}:${opt.slice(0, 50)}`);
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
      // In autonomous mode: fail silently — don't spam the group with error messages
      if (!isAutonomous) {
        if (error instanceof Error && error.message.includes('timeout')) {
          await ctx.reply('Antwoord duurde te lang, probeer het opnieuw.').catch(() => {});
        } else {
          await ctx.reply('Er ging iets mis, probeer het opnieuw.').catch(() => {});
        }
      }
    }
  }

  return bot;
}

function buildSystemPrompt(db: Database, chatId: number, botUsername: string): string {
  const chat = db.getChat(chatId);
  const parts: string[] = [];

  parts.push(`Je bent een AI assistent in een Telegram chat. Je botnaam is @${botUsername}.`);

  // Add known group members from message history
  const knownUsers = getKnownUsers(db, chatId);
  if (knownUsers.length > 0) {
    parts.push(`Bekende deelnemers in deze chat: ${knownUsers.map(u => u.username ? `@${u.username} (${u.displayName})` : u.displayName).join(', ')}`);
  }

  parts.push('Je zit in een Telegram chat die mogelijk langer teruggaat dan je huidige sessie. Als je context nodig hebt van eerdere berichten, gebruik dan de telegram_history tool om gericht te zoeken in de chatgeschiedenis.');

  parts.push(`FORMATTING: Je berichten worden weergegeven in Telegram met HTML parse_mode. Gebruik HTML-tags voor opmaak:
- <b>vet</b>, <i>cursief</i>, <u>onderstreept</u>, <s>doorgestreept</s>
- <code>inline code</code> voor korte code
- <pre>codeblok</pre> voor meerregelige code (met optioneel <pre><code class="language-python">...</code></pre> voor syntax highlighting)
- <a href="url">linktekst</a> voor links
- <blockquote>citaat</blockquote> voor citaten
- <tg-spoiler>spoiler</tg-spoiler> voor spoilers
BELANGRIJK: Gebruik GEEN <br> tags — gebruik gewoon newlines voor regelovergangen. Telegram ondersteunt geen <br>.
Gebruik GEEN Markdown-opmaak (geen *, **, \`, \`\`\`, #, -, etc.). Gebruik altijd de HTML-tags hierboven. Tekst zonder tags wordt gewoon als platte tekst weergegeven. Zorg dat je HTML correct is — open tags moeten altijd gesloten worden. Escape speciale tekens in gewone tekst: gebruik &amp; voor &, &lt; voor <, &gt; voor >.`);

  if (chat?.routing_mode === 'commands_only') {
    parts.push(`Je bent in commands_only modus. Je wordt alleen aangesproken via /commands of @mentions.

Als je getagt wordt via @mention:
1. Je ontvangt automatisch de laatste berichten als context. Lees deze EERST om te begrijpen waarom je getagt bent.
2. Als de context niet genoeg is om de situatie te begrijpen (bijv. het gesprek verwijst naar iets dat verder terug ligt), gebruik dan PROACTIEF de telegram_history tool om meer berichten op te halen. Blijf teruglezen tot je voldoende context hebt.
3. Beantwoord dan pas de vraag/het verzoek vanuit het perspectief van het lopende gesprek.

Je doel is om je te gedragen als een groepslid dat even terugscrolt om te snappen wat er besproken werd voordat het reageert.`);
  }

  if (chat?.routing_mode === 'autonomous') {
    parts.push(`Je bent in autonome modus in een groepschat. Je ontvangt ALLE berichten tussen de deelnemers.

WANNEER WEL REAGEREN:
- Als je direct wordt aangesproken of gevraagd
- Als je een relevante, waardevolle bijdrage hebt aan het gesprek
- Als iemand een vraag stelt die je kunt beantwoorden
- Als de custom prompt aangeeft dat je je moet mengen

WANNEER NIET REAGEREN (antwoord met leeg bericht):
- Begroetingen tussen andere deelnemers ("Hey!", "Hoi", "Goedemorgen")
- Sociale gesprekken waar jij niet bij betrokken bent
- Als mensen tegen elkaar praten, niet tegen jou
- Korte reacties of bevestigingen ("ok", "top", "haha")
- Als je niets toe te voegen hebt

Het is BETER om te vaak stil te zijn dan te vaak te reageren. Je bent een deelnemer, geen moderator. Gedraag je als een groepslid dat alleen praat als het iets te zeggen heeft.`);
  }

  if (chat?.custom_prompt) {
    parts.push(`\nAanvullende instructies voor deze chat:\n${chat.custom_prompt}`);
  }

  parts.push('\nAls iemand je vraagt om een admin toe te voegen, te verwijderen, of de adminlijst te tonen, gebruik dan de admin_management tool.');
  parts.push('Als iemand vraagt om instellingen te wijzigen (routing modus, custom prompt, provider, cooldown, sessie-modus, opstartmelding), gebruik dan de chat_settings tool. Je kunt hiermee de modus wijzigen (commands_only/all_messages/autonomous), een custom prompt instellen, de cooldown aanpassen, de opstartmelding aan/uit zetten (set_notify_on_start), etc. Alleen admins mogen dit.');
  parts.push('Als je een GIF wilt sturen, gebruik dan de gif_search tool.');
  parts.push(`INTERNET TOEGANG: Je hebt twee tools om informatie van het internet op te halen:
- web_fetch: Haal de inhoud van een specifieke URL op. Gebruik dit ALTIJD EERST wanneer iemand een link deelt (Reddit, nieuws, YouTube, etc.). Als web_fetch faalt, val dan terug op web_search.
- web_search: Zoek op het internet naar informatie. Gebruik dit voor vragen over actueel nieuws, recente feiten, of als web_fetch faalt.
Zeg NOOIT dat je geen toegang hebt tot het internet.`);
  parts.push(`Je hebt een send_message tool waarmee je berichten direct naar de chat kunt sturen, nog voordat je klaar bent met je volledige antwoord. Gebruik dit om:
- Tussentijdse updates te geven als iets even duurt (bijv. "Even opzoeken...")
- Lange antwoorden op te splitsen in meerdere berichten, net als een echt persoon
- Te communiceren terwijl je andere tools gebruikt

Let op: je gewone antwoordtekst wordt ook nog verstuurd na afloop. Als je alles al via send_message hebt gestuurd, laat je antwoord dan leeg.`);

  parts.push('Je hebt een send_keyboard tool, maar gebruik deze ZEER SPAARZAAM. Gebruik het ALLEEN wanneer er een echte, concrete keuze is die je niet in tekst kunt oplossen (bijv. een poll of een configuratiekeuze). Gebruik het NOOIT voor: vervolgvragen, conversatie-opties, "wil je meer weten over X of Y", of om het gesprek te sturen. Gewoon antwoorden in tekst is bijna altijd beter.');

  return parts.join('\n\n');
}

function formatReplyContext(ctx: Context): string | null {
  const reply = ctx.message && 'reply_to_message' in ctx.message ? ctx.message.reply_to_message : null;
  if (!reply) return null;

  const replyFrom = reply.from?.username ? `@${reply.from.username}` : reply.from?.first_name || 'Iemand';
  const parts: string[] = [];

  // Text content
  const replyText = ('text' in reply ? reply.text : null) ?? ('caption' in reply ? reply.caption : null);
  if (replyText) {
    parts.push(replyText.length > 200 ? replyText.slice(0, 200) + '...' : replyText);
  }

  // Media indicators
  if ('photo' in reply && reply.photo?.length) parts.push('[foto]');
  if ('animation' in reply && reply.animation) parts.push('[GIF]');
  if ('video' in reply && reply.video) parts.push('[video]');
  if ('document' in reply && reply.document) parts.push(`[document: ${reply.document.file_name || 'bestand'}]`);
  if ('sticker' in reply && reply.sticker) parts.push(`[sticker: ${reply.sticker.emoji || ''}]`);
  if ('voice' in reply && reply.voice) parts.push('[voice bericht]');

  if (parts.length === 0) parts.push('[bericht]');

  return `[Reply op ${replyFrom}: ${parts.join(' ')}]`;
}

function getKnownUsers(db: Database, chatId: number): Array<{ username: string | null; displayName: string }> {
  // Get distinct users from stored messages
  const rows = db.getRecentMessages(chatId, 200);
  const seen = new Map<number, { username: string | null; displayName: string }>();
  for (const row of rows) {
    if (row.user_id && !seen.has(row.user_id)) {
      seen.set(row.user_id, {
        username: row.username,
        displayName: row.display_name || row.username || 'Unknown',
      });
    }
  }
  return Array.from(seen.values());
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
