import { spawn } from 'child_process';
import { LLMProvider, Session, MessageInput, MessageOutput, LLMError } from '../provider.js';

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

  async createSession(chatId: string, systemPrompt: string): Promise<Session> {
    // Send a minimal prompt to establish a session and capture session_id.
    // This is required because `claude -p` is stateless per invocation;
    // we need the session_id to use --resume on subsequent calls.
    const args = this.buildBaseArgs();
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }
    args.push('-p', 'Je bent verbonden met een Telegram chat. Klaar om te helpen.');
    args.push('--output-format', 'json');

    const result = await this.runClaude(args);
    const parsed = JSON.parse(result);

    return {
      id: parsed.session_id,
      chatId,
      provider: 'claude-code',
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

  async sendMessage(session: Session, message: MessageInput): Promise<MessageOutput> {
    const prompt = this.buildPrompt(message);
    const args = this.buildBaseArgs();
    args.push('-p', prompt);
    args.push('--resume', session.id);
    args.push('--output-format', 'json');

    try {
      const result = await this.runClaude(args);
      const parsed = JSON.parse(result);
      return { text: parsed.result || '' };
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

  private buildPrompt(message: MessageInput): string {
    const parts: string[] = [];
    if (message.context) {
      parts.push(`[Context]\n${message.context}`);
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

  private runClaude(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`claude exited with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn claude: ${err.message}`));
      });
    });
  }
}
