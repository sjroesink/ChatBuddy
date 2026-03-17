import { Database } from '../db/database.js';

export interface ChatSettingsParams {
  action: 'get' | 'set_mode' | 'set_prompt' | 'clear_prompt' | 'set_newsession_mode' | 'set_cooldown' | 'set_notify_on_start';
  chat_id: number;
  requesting_user_id: number;
  value?: string;
}

export interface ChatSettingsResult {
  success: boolean;
  message: string;
  settings?: Record<string, unknown>;
}

export function handleChatSettings(
  db: Database,
  ownerUserId: number,
  isAdmin: (chatId: number, userId: number) => boolean,
  params: ChatSettingsParams,
): ChatSettingsResult {
  if (!isAdmin(params.chat_id, params.requesting_user_id)) {
    return { success: false, message: 'Je hebt geen rechten om instellingen te wijzigen.' };
  }

  switch (params.action) {
    case 'get': {
      const chat = db.getChat(params.chat_id);
      return {
        success: true,
        message: 'Huidige instellingen opgehaald.',
        settings: {
          routing_mode: chat?.routing_mode || 'commands_only',
          custom_prompt: chat?.custom_prompt || null,
          new_session_mode: chat?.new_session_mode || 'clean',
          recent_messages_count: chat?.recent_messages_count || 20,
          autonomous_cooldown: chat?.autonomous_cooldown || 10,
          notify_on_start: chat?.notify_on_start ?? 1 ? true : false,
        },
      };
    }

    case 'set_mode': {
      const valid = ['commands_only', 'all_messages', 'autonomous'];
      if (!params.value || !valid.includes(params.value)) {
        return { success: false, message: `Ongeldige modus. Kies uit: ${valid.join(', ')}` };
      }
      db.updateChat(params.chat_id, { routing_mode: params.value });
      return { success: true, message: `Routing modus ingesteld op: ${params.value}` };
    }

    case 'set_prompt': {
      if (!params.value) {
        return { success: false, message: 'Geef een prompt op.' };
      }
      db.updateChat(params.chat_id, { custom_prompt: params.value });
      return { success: true, message: `Custom prompt ingesteld.` };
    }

    case 'clear_prompt': {
      db.updateChat(params.chat_id, { custom_prompt: '' });
      return { success: true, message: 'Custom prompt verwijderd.' };
    }

    case 'set_newsession_mode': {
      const valid = ['clean', 'recent_messages', 'summary'];
      if (!params.value || !valid.includes(params.value)) {
        return { success: false, message: `Ongeldige modus. Kies uit: ${valid.join(', ')}` };
      }
      db.updateChat(params.chat_id, { new_session_mode: params.value });
      return { success: true, message: `Nieuwe sessie modus ingesteld op: ${params.value}` };
    }

    case 'set_cooldown': {
      const seconds = parseInt(params.value || '', 10);
      if (isNaN(seconds) || seconds < 1 || seconds > 300) {
        return { success: false, message: 'Cooldown moet een getal zijn tussen 1 en 300 seconden.' };
      }
      db.updateChat(params.chat_id, { autonomous_cooldown: seconds });
      return { success: true, message: `Autonome cooldown ingesteld op ${seconds} seconden.` };
    }

    case 'set_notify_on_start': {
      const val = params.value?.toLowerCase();
      if (val !== 'true' && val !== 'false' && val !== '1' && val !== '0' && val !== 'aan' && val !== 'uit') {
        return { success: false, message: 'Waarde moet aan/uit, true/false, of 1/0 zijn.' };
      }
      const enabled = val === 'true' || val === '1' || val === 'aan' ? 1 : 0;
      db.updateChat(params.chat_id, { notify_on_start: enabled });
      return { success: true, message: `Opstartmelding ${enabled ? 'ingeschakeld' : 'uitgeschakeld'}.` };
    }

    default:
      return { success: false, message: `Onbekende actie: ${params.action}` };
  }
}
