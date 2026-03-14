import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AdminService } from '../../src/admin/admin.js';
import { Database } from '../../src/db/database.js';
import fs from 'fs';

const TEST_DB_PATH = './data/test-admin.db';
const OWNER_ID = 148010228;

describe('AdminService', () => {
  let db: Database;
  let admin: AdminService;

  beforeEach(() => {
    fs.mkdirSync('data', { recursive: true });
    db = new Database(TEST_DB_PATH);
    admin = new AdminService(db, OWNER_ID);
    db.upsertChat(12345, 'group');
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  it('should always consider owner as admin', () => {
    expect(admin.isAdmin(12345, OWNER_ID)).toBe(true);
  });

  it('should not consider random user as admin', () => {
    expect(admin.isAdmin(12345, 999)).toBe(false);
  });

  it('should allow owner to add admin', () => {
    const result = admin.addAdmin(12345, 999, OWNER_ID);
    expect(result.success).toBe(true);
    expect(admin.isAdmin(12345, 999)).toBe(true);
  });

  it('should not allow non-admin to add admin', () => {
    const result = admin.addAdmin(12345, 999, 777);
    expect(result.success).toBe(false);
  });

  it('should allow admin to add another admin', () => {
    admin.addAdmin(12345, 888, OWNER_ID);
    const result = admin.addAdmin(12345, 999, 888);
    expect(result.success).toBe(true);
  });

  it('should not allow removing owner', () => {
    const result = admin.removeAdmin(12345, OWNER_ID, 999);
    expect(result.success).toBe(false);
  });

  it('should list admins', () => {
    admin.addAdmin(12345, 999, OWNER_ID);
    const list = admin.listAdmins(12345);
    expect(list).toHaveLength(1);
    expect(list[0].user_id).toBe(999);
  });

  it('should resolve username and add admin', () => {
    db.storeMessage({
      message_id: 1, chat_id: 12345, user_id: 999,
      username: 'peter', display_name: 'Peter', text: 'Hi', has_media: false,
    });
    const result = admin.addAdminByUsername(12345, 'peter', OWNER_ID);
    expect(result.success).toBe(true);
    expect(admin.isAdmin(12345, 999)).toBe(true);
  });

  it('should fail to resolve unknown username', () => {
    const result = admin.addAdminByUsername(12345, 'unknown', OWNER_ID);
    expect(result.success).toBe(false);
    expect(result.message).toContain('niet gevonden');
  });
});
