import { Database, AdminRow } from '../db/database.js';

export interface AdminResult {
  success: boolean;
  message: string;
  admins?: Array<{ user_id: number; username?: string }>;
}

export class AdminService {
  private db: Database;
  private ownerId: number;

  constructor(db: Database, ownerId: number) {
    this.db = db;
    this.ownerId = ownerId;
  }

  isAdmin(chatId: number, userId: number): boolean {
    if (userId === this.ownerId) return true;
    const admins = this.db.getAdmins(chatId);
    return admins.some((a) => a.user_id === userId);
  }

  addAdmin(chatId: number, targetUserId: number, requestingUserId: number): AdminResult {
    if (!this.isAdmin(chatId, requestingUserId)) {
      return { success: false, message: 'Je hebt geen rechten om admins toe te voegen.' };
    }
    this.db.addAdmin(chatId, targetUserId, requestingUserId);
    return { success: true, message: `Gebruiker ${targetUserId} is nu admin.` };
  }

  addAdminByUsername(chatId: number, username: string, requestingUserId: number): AdminResult {
    if (!this.isAdmin(chatId, requestingUserId)) {
      return { success: false, message: 'Je hebt geen rechten om admins toe te voegen.' };
    }
    const userId = this.db.resolveUsername(chatId, username);
    if (!userId) {
      return {
        success: false,
        message: `Gebruiker @${username} niet gevonden. Deze gebruiker moet eerst een bericht sturen in deze chat.`,
      };
    }
    this.db.addAdmin(chatId, userId, requestingUserId);
    return { success: true, message: `@${username} is nu admin.` };
  }

  removeAdmin(chatId: number, targetUserId: number, requestingUserId: number): AdminResult {
    if (targetUserId === this.ownerId) {
      return { success: false, message: 'De owner kan niet verwijderd worden als admin.' };
    }
    if (!this.isAdmin(chatId, requestingUserId)) {
      return { success: false, message: 'Je hebt geen rechten om admins te verwijderen.' };
    }
    this.db.removeAdmin(chatId, targetUserId);
    return { success: true, message: `Gebruiker ${targetUserId} is geen admin meer.` };
  }

  removeAdminByUsername(chatId: number, username: string, requestingUserId: number): AdminResult {
    const userId = this.db.resolveUsername(chatId, username);
    if (!userId) {
      return { success: false, message: `Gebruiker @${username} niet gevonden.` };
    }
    return this.removeAdmin(chatId, userId, requestingUserId);
  }

  listAdmins(chatId: number): AdminRow[] {
    return this.db.getAdmins(chatId);
  }

  resolveUsernameByUserId(chatId: number, userId: number): string | undefined {
    return this.db.resolveUsernameByUserId(chatId, userId);
  }
}
