import { Database, MessageRow } from '../db/database.js';

export interface TelegramHistoryParams {
  chat_id: number;
  query?: string;
  limit?: number;
  offset_id?: number;
  from_user?: string;
}

export interface TelegramHistoryMessage {
  id: number;
  from: string;
  username?: string;
  date: string;
  text: string;
  reply_to?: number;
  has_media: boolean;
  media_type?: string;
}

export interface TelegramHistoryResult {
  messages: TelegramHistoryMessage[];
}

export function handleTelegramHistory(db: Database, params: TelegramHistoryParams): TelegramHistoryResult {
  const limit = Math.min(params.limit || 20, 100);

  const rows = db.getMessages(params.chat_id, {
    query: params.query,
    limit,
    offset_id: params.offset_id,
    from_user: params.from_user,
  });

  const messages: TelegramHistoryMessage[] = rows.map((row: MessageRow) => ({
    id: row.message_id,
    from: row.display_name || 'Unknown',
    username: row.username || undefined,
    date: row.created_at,
    text: row.text || '',
    reply_to: row.reply_to || undefined,
    has_media: row.has_media === 1,
    media_type: row.media_type || undefined,
  }));

  return { messages };
}
