import { spawn } from 'child_process';
import { LLMProvider, Session, MessageInput, MessageOutput, MediaAttachment, CreateSessionResult, LLMError, ToolCallbacks } from '../provider.js';

export interface ClaudeCodeConfig {
  model?: string;
  mcpConfigPath?: string;
  allowedTools?: string[];
}

export class ClaudeCodeProvider implements LLMProvider {
  private config: ClaudeCodeConfig;

  constructor(config: ClaudeCodeConfig = {}) {
    this.config = config;
  }

  async createSession(chatId: string, systemPrompt: string, firstMessage?: MessageInput, callbacks?: ToolCallbacks): Promise<CreateSessionResult> {
    const args = this.buildBaseArgs();
    if (systemPrompt) {
      // Replace newlines with spaces — cmd.exe on Windows breaks on multiline args
      args.push('--system-prompt', systemPrompt.replace(/\n+/g, ' '));
    }

    // If a first message is provided, send it during session creation
    // to avoid a second CLI invocation (saves ~2-3 min on cold start).
    const prompt = firstMessage
      ? this.buildPrompt(firstMessage, callbacks)
      : 'Je bent verbonden met een Telegram chat. Klaar om te helpen.';
    args.push('-p', prompt);
    args.push('--output-format', 'json');

    const result = await this.runClaude(args);
    const parsed = JSON.parse(result);

    const session: Session = {
      id: parsed.session_id,
      chatId,
      provider: 'claude-code',
    };

    const responseText = parsed.result || '';
    return {
      session,
      response: firstMessage ? this.extractMediaFromText(responseText) : undefined,
    };
  }

  async resumeSession(sessionId: string): Promise<Session> {
    // We don't verify the session eagerly — if resume fails,
    // sendMessage will throw and the SessionManager handles fallback.
    return {
      id: sessionId,
      chatId: '',
      provider: 'claude-code',
    };
  }

  async destroySession(_sessionId: string): Promise<void> {
    // Claude Code sessions are managed by the CLI; nothing to clean up
  }

  async sendMessage(session: Session, message: MessageInput, callbacks?: ToolCallbacks): Promise<MessageOutput> {
    const prompt = this.buildPrompt(message, callbacks);
    const args = this.buildBaseArgs();
    args.push('-p', prompt);
    args.push('--resume', session.id);
    args.push('--output-format', 'json');

    try {
      const result = await this.runClaude(args);
      const parsed = JSON.parse(result);
      return this.extractMediaFromText(parsed.result || '');
    } catch (error) {
      throw new LLMError(
        `Claude Code failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  supportsTools(): boolean { return true; }
  supportsMedia(): boolean { return true; }
  supportsResume(): boolean { return true; }

  private buildBaseArgs(): string[] {
    const args: string[] = [];
    if (this.config.model) {
      args.push('--model', this.config.model);
    }
    if (this.config.mcpConfigPath) {
      args.push('--mcp-config', this.config.mcpConfigPath);
    }
    if (this.config.allowedTools?.length) {
      args.push('--allowedTools', this.config.allowedTools.join(','));
    }
    return args;
  }

  private buildPrompt(message: MessageInput, callbacks?: ToolCallbacks): string {
    const parts: string[] = [];
    // Inject server-side metadata so MCP tools get the correct chat_id and user_id
    if (callbacks) {
      parts.push(`[chat_id=${callbacks.chatId} user_id=${callbacks.userId}]`);
    }
    if (message.context) {
      parts.push(`[Context] ${message.context}`);
    }
    if (message.text) {
      parts.push(message.text);
    }
    // Note: media (images, PDFs) are passed as file paths or URLs in the text.
    // Claude Code CLI accepts these natively when included in the prompt.
    if (message.media?.length) {
      for (const media of message.media) {
        if (typeof media.data === 'string') {
          // URL or file path — include directly
          parts.push(`[Attached ${media.type}: ${media.data}]`);
        } else {
          // Binary data — save to temp file (handled by caller in bot.ts)
          parts.push(`[Attached ${media.type}: ${media.filename || 'attachment'}]`);
        }
      }
    }
    return parts.join('\n\n');
  }

  /**
   * Extract Tenor GIF URLs from response text and return them as media attachments.
   * Claude Code handles gif_search via MCP internally, so GIF URLs appear in the text.
   */
  private extractMediaFromText(text: string): MessageOutput {
    const gifUrlPattern = /https?:\/\/media1?\.tenor\.com\/[^\s)"\]]+\.gif/g;
    const urls = [...new Set(text.match(gifUrlPattern) || [])];
    const media: MediaAttachment[] = urls.map((url) => ({ type: 'gif', data: url, mimeType: 'image/gif' }));
    // Remove the GIF URLs from the text to avoid showing raw URLs alongside the animation
    let cleanText = text;
    for (const url of urls) {
      cleanText = cleanText.replace(url, '').replace(/\n{3,}/g, '\n\n');
    }
    cleanText = cleanText.trim();
    return {
      text: cleanText || undefined,
      media: media.length > 0 ? media : undefined,
    };
  }

  private runClaude(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      console.error(`[claude-code] Running: claude ${args.map(a => a.length > 100 ? a.slice(0, 100) + '...' : a).join(' ')}`);
      const startTime = Date.now();

      const proc = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true, // Required on Windows — claude is a .cmd file
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.error(`[claude-code] Exited with code ${code} after ${elapsed}s`);
        if (stderr.trim()) {
          console.error(`[claude-code] stderr: ${stderr.slice(0, 500)}`);
        }
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`claude exited with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        console.error(`[claude-code] Failed to spawn: ${err.message}`);
        reject(new Error(`Failed to spawn claude: ${err.message}`));
      });
    });
  }
}
