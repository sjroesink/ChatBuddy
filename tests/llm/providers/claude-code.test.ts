import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeCodeProvider } from '../../../src/llm/providers/claude-code.js';
import * as child_process from 'child_process';

vi.mock('child_process');

function mockSpawn(stdout: string, code: number = 0) {
  const proc = {
    stdout: { on: vi.fn((event: string, cb: Function) => { if (event === 'data') cb(Buffer.from(stdout)); }) },
    stderr: { on: vi.fn((event: string, cb: Function) => { if (event === 'data') cb(Buffer.from('')); }) },
    on: vi.fn((event: string, cb: Function) => { if (event === 'close') setTimeout(() => cb(code), 0); }),
  };
  vi.mocked(child_process.spawn).mockReturnValue(proc as any);
  return proc;
}

describe('ClaudeCodeProvider', () => {
  let provider: ClaudeCodeProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new ClaudeCodeProvider({ model: 'claude-sonnet-4-20250514' });
  });

  it('should create a session and return session_id', async () => {
    mockSpawn(JSON.stringify({ session_id: 'sess-123', result: 'ok' }));
    const result = await provider.createSession('chat-1', 'You are a bot');
    expect(result.session.id).toBe('sess-123');
    expect(result.session.provider).toBe('claude-code');

    const args = vi.mocked(child_process.spawn).mock.calls[0][1] as string[];
    expect(args).toContain('--system-prompt');
    expect(args).toContain('--model');
  });

  it('should pass --resume and --model on sendMessage', async () => {
    mockSpawn(JSON.stringify({ session_id: 'sess-123', result: 'hello' }));
    const session = { id: 'sess-123', chatId: 'chat-1', provider: 'claude-code' };
    await provider.sendMessage(session, { text: 'Hi' });

    const args = vi.mocked(child_process.spawn).mock.calls[0][1] as string[];
    expect(args).toContain('--resume');
    expect(args).toContain('sess-123');
    expect(args).toContain('--model');
    expect(args).toContain('claude-sonnet-4-20250514');
  });

  it('should throw LLMError on non-zero exit', async () => {
    mockSpawn('', 1);
    const session = { id: 'sess-123', chatId: 'chat-1', provider: 'claude-code' };
    await expect(provider.sendMessage(session, { text: 'Hi' })).rejects.toThrow('Claude Code failed');
  });

  it('should report capabilities correctly', () => {
    expect(provider.supportsTools()).toBe(true);
    expect(provider.supportsMedia()).toBe(true);
    expect(provider.supportsResume()).toBe(true);
  });
});
