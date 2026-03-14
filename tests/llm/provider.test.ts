import { describe, it, expect } from 'vitest';
import type { LLMProvider, Session, MessageInput, MessageOutput, MediaAttachment } from '../../src/llm/provider.js';

describe('LLMProvider types', () => {
  it('should allow creating a provider-conforming object', () => {
    const mockProvider: LLMProvider = {
      createSession: async () => ({ id: 'test', chatId: '123', provider: 'test' }),
      resumeSession: async () => ({ id: 'test', chatId: '123', provider: 'test' }),
      destroySession: async () => {},
      sendMessage: async () => ({ text: 'response' }),
      supportsTools: () => false,
      supportsMedia: () => false,
      supportsResume: () => false,
    };

    expect(mockProvider.supportsTools()).toBe(false);
    expect(mockProvider.supportsResume()).toBe(false);
  });

  it('Session type should have required fields', () => {
    const session: Session = { id: 'abc', chatId: '123', provider: 'claude-code' };
    expect(session.id).toBe('abc');
    expect(session.chatId).toBe('123');
    expect(session.provider).toBe('claude-code');
  });

  it('MediaAttachment type should support all media types', () => {
    const image: MediaAttachment = { type: 'image', data: Buffer.from(''), mimeType: 'image/png' };
    const gif: MediaAttachment = { type: 'gif', data: 'https://example.com/cat.gif', mimeType: 'image/gif' };
    expect(image.type).toBe('image');
    expect(gif.type).toBe('gif');
  });
});
