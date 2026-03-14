import { LLMProvider, Session, LLMError } from './provider.js';
import { Database } from '../db/database.js';

export class SessionManager {
  private provider: LLMProvider;
  private db: Database;

  constructor(provider: LLMProvider, db: Database) {
    this.provider = provider;
    this.db = db;
  }

  async getOrCreateSession(chatId: number, systemPrompt: string): Promise<Session> {
    const existing = this.db.getActiveSession(chatId);

    if (existing && this.provider.supportsResume()) {
      try {
        const session = await this.provider.resumeSession(existing.session_id);
        session.chatId = String(chatId);
        return session;
      } catch {
        // Resume failed — fall through to create new
        this.db.deactivateSession(chatId);
      }
    }

    const session = await this.provider.createSession(String(chatId), systemPrompt);
    this.db.createSession(chatId, session.provider, session.id);
    return session;
  }

  async newSession(chatId: number, systemPrompt: string): Promise<{ session: Session; resumeFailed?: boolean }> {
    const chat = this.db.getChat(chatId);
    const mode = chat?.new_session_mode || 'clean';
    let context: string | undefined;

    if (mode === 'summary') {
      const existing = this.db.getActiveSession(chatId);
      if (existing && this.provider.supportsResume()) {
        try {
          const oldSession = await this.provider.resumeSession(existing.session_id);
          const summary = await this.provider.sendMessage(oldSession, {
            text: 'Vat deze conversatie samen in maximaal 500 woorden.',
          });
          context = summary.text || undefined;
        } catch {
          // Fall back to recent_messages
          const count = chat?.recent_messages_count || 20;
          const messages = this.db.getRecentMessages(chatId, count);
          context = this.formatMessagesAsContext(messages);
        }
      }
    } else if (mode === 'recent_messages') {
      const count = chat?.recent_messages_count || 20;
      const messages = this.db.getRecentMessages(chatId, count);
      context = this.formatMessagesAsContext(messages);
    }

    this.db.deactivateSession(chatId);
    const session = await this.provider.createSession(String(chatId), systemPrompt);
    this.db.createSession(chatId, session.provider, session.id);

    if (context) {
      await this.provider.sendMessage(session, {
        context: `Vorige conversatie context:\n${context}`,
        text: 'Nieuwe sessie gestart. Bovenstaande context is van de vorige sessie.',
      });
    }

    return { session };
  }

  private formatMessagesAsContext(messages: { display_name?: string | null; username?: string | null; text?: string | null; created_at: string }[]): string {
    return [...messages]
      .reverse()
      .map((m) => {
        const name = m.username ? `@${m.username}` : m.display_name || 'Unknown';
        const time = m.created_at.slice(11, 16);
        return `[${time}] ${name}: ${m.text || '[media]'}`;
      })
      .join('\n');
  }
}
