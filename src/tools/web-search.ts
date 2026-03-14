export interface WebSearchParams {
  query: string;
  max_results?: number;
}

export interface WebSearchResult {
  results: Array<{
    title: string;
    url: string;
    content: string;
  }>;
}

export async function handleWebSearch(
  apiKey: string | undefined,
  params: WebSearchParams,
): Promise<WebSearchResult> {
  if (!apiKey) {
    return { results: [{ title: 'Error', url: '', content: 'Web search is niet geconfigureerd (TAVILY_API_KEY ontbreekt).' }] };
  }

  const maxResults = Math.min(params.max_results || 5, 10);

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: params.query,
        max_results: maxResults,
      }),
    });

    if (!response.ok) {
      return { results: [{ title: 'Error', url: '', content: `Tavily API error: ${response.status}` }] };
    }

    const data = await response.json() as { results?: Array<{ title?: string; url?: string; content?: string }> };

    return {
      results: (data.results || []).map((r) => ({
        title: r.title || '',
        url: r.url || '',
        content: r.content || '',
      })),
    };
  } catch (error) {
    return {
      results: [{ title: 'Error', url: '', content: `Search failed: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }
}
