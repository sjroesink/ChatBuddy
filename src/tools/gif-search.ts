export interface GifSearchParams {
  query: string;
  limit?: number;
}

export interface GifResult {
  url: string;
  preview_url: string;
  title: string;
}

export interface GifSearchResult {
  gifs: GifResult[];
}

export async function handleGifSearch(
  apiKey: string | undefined,
  params: GifSearchParams,
): Promise<GifSearchResult> {
  if (!apiKey) {
    return { gifs: [] };
  }

  const limit = Math.min(params.limit || 1, 5);
  const url = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(params.query)}&key=${apiKey}&limit=${limit}&media_filter=gif,tinygif`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { gifs: [] };
    }

    const data = await response.json() as { results?: Array<{ media_formats?: { gif?: { url: string }; tinygif?: { url: string } }; title?: string }> };
    const gifs: GifResult[] = (data.results || []).slice(0, limit).map((r) => ({
      url: r.media_formats?.gif?.url || '',
      preview_url: r.media_formats?.tinygif?.url || '',
      title: r.title || '',
    }));

    return { gifs };
  } catch {
    return { gifs: [] };
  }
}
