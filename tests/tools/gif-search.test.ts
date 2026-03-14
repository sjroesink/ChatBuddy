import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGifSearch, GifSearchParams } from '../../src/tools/gif-search.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('gif_search tool', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should return GIFs from Tenor API', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{
          media_formats: {
            gif: { url: 'https://tenor.com/cat.gif' },
            tinygif: { url: 'https://tenor.com/cat-small.gif' },
          },
          title: 'Funny cat',
        }],
      }),
    });

    const result = await handleGifSearch('test-api-key', { query: 'funny cat' });
    expect(result.gifs).toHaveLength(1);
    expect(result.gifs[0].url).toBe('https://tenor.com/cat.gif');
    expect(result.gifs[0].title).toBe('Funny cat');
  });

  it('should respect limit parameter', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { media_formats: { gif: { url: 'url1' }, tinygif: { url: 'prev1' } }, title: 'gif1' },
          { media_formats: { gif: { url: 'url2' }, tinygif: { url: 'prev2' } }, title: 'gif2' },
          { media_formats: { gif: { url: 'url3' }, tinygif: { url: 'prev3' } }, title: 'gif3' },
        ],
      }),
    });

    const result = await handleGifSearch('test-api-key', { query: 'cat', limit: 2 });
    expect(result.gifs).toHaveLength(2);
  });

  it('should return empty on API error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const result = await handleGifSearch('test-api-key', { query: 'cat' });
    expect(result.gifs).toHaveLength(0);
  });

  it('should return empty when no API key', async () => {
    const result = await handleGifSearch(undefined, { query: 'cat' });
    expect(result.gifs).toHaveLength(0);
  });
});
