import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleAdminManagement } from '../../src/tools/admin-management.js';
import { AdminService } from '../../src/admin/admin.js';
import { Database } from '../../src/db/database.js';
import fs from 'fs';

const TEST_DB_PATH = './data/test-admin-tool.db';
const OWNER_ID = 148010228;

describe('admin_management tool', () => {
  let db: Database;
  let adminService: AdminService;

  beforeEach(() => {
    fs.mkdirSync('data', { recursive: true });
    db = new Database(TEST_DB_PATH);
    adminService = new AdminService(db, OWNER_ID);
    db.upsertChat(12345, 'group');
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  it('should add admin by user_id', () => {
    const result = handleAdminManagement(adminService, {
      action: 'add', chat_id: 12345, requesting_user_id: OWNER_ID, target_user_id: 999,
    });
    expect(result.success).toBe(true);
  });

  it('should add admin by username', () => {
    db.storeMessage({
      message_id: 1, chat_id: 12345, user_id: 999,
      username: 'peter', display_name: 'Peter', text: 'Hi', has_media: false,
    });
    const result = handleAdminManagement(adminService, {
      action: 'add', chat_id: 12345, requesting_user_id: OWNER_ID, target_username: 'peter',
    });
    expect(result.success).toBe(true);
  });

  it('should list admins', () => {
    adminService.addAdmin(12345, 999, OWNER_ID);
    const result = handleAdminManagement(adminService, {
      action: 'list', chat_id: 12345, requesting_user_id: OWNER_ID,
    });
    expect(result.success).toBe(true);
    expect(result.admins).toHaveLength(1);
  });

  it('should remove admin', () => {
    adminService.addAdmin(12345, 999, OWNER_ID);
    const result = handleAdminManagement(adminService, {
      action: 'remove', chat_id: 12345, requesting_user_id: OWNER_ID, target_user_id: 999,
    });
    expect(result.success).toBe(true);
  });

  it('should reject unauthorized add', () => {
    const result = handleAdminManagement(adminService, {
      action: 'add', chat_id: 12345, requesting_user_id: 777, target_user_id: 999,
    });
    expect(result.success).toBe(false);
  });
});
