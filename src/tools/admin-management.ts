import { AdminService, AdminResult } from '../admin/admin.js';

export interface AdminManagementParams {
  action: 'add' | 'remove' | 'list';
  chat_id: number;
  requesting_user_id: number;
  target_user_id?: number;
  target_username?: string;
}

export interface AdminManagementResult {
  success: boolean;
  message: string;
  admins?: Array<{ user_id: number; username?: string }>;
}

export function handleAdminManagement(
  adminService: AdminService,
  params: AdminManagementParams,
): AdminManagementResult {
  switch (params.action) {
    case 'add': {
      let result: AdminResult;
      if (params.target_username) {
        result = adminService.addAdminByUsername(params.chat_id, params.target_username, params.requesting_user_id);
      } else if (params.target_user_id) {
        result = adminService.addAdmin(params.chat_id, params.target_user_id, params.requesting_user_id);
      } else {
        return { success: false, message: 'target_user_id of target_username is vereist.' };
      }
      return result;
    }

    case 'remove': {
      let result: AdminResult;
      if (params.target_username) {
        result = adminService.removeAdminByUsername(params.chat_id, params.target_username, params.requesting_user_id);
      } else if (params.target_user_id) {
        result = adminService.removeAdmin(params.chat_id, params.target_user_id, params.requesting_user_id);
      } else {
        return { success: false, message: 'target_user_id of target_username is vereist.' };
      }
      return result;
    }

    case 'list': {
      const admins = adminService.listAdmins(params.chat_id);
      return {
        success: true,
        message: admins.length > 0 ? `${admins.length} admin(s) gevonden.` : 'Geen admins geconfigureerd (alleen de owner).',
        admins: admins.map((a) => ({
          user_id: a.user_id,
          username: adminService.resolveUsernameByUserId(a.chat_id, a.user_id),
        })),
      };
    }

    default:
      return { success: false, message: `Onbekende actie: ${(params as AdminManagementParams).action}` };
  }
}
