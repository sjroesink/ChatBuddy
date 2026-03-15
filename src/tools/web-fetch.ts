export interface WebFetchParams {
  url: string;
  max_length?: number;
}

export interface WebFetchResult {
  success: boolean;
  title: string;
  content: string;
  source: string;
}

export async function handleWebFetch(params: WebFetchParams): Promise<WebFetchResult> {
  const maxLength = Math.min(params.max_length || 3000, 5000);

  try {
    const response = await fetch(params.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ChatBuddy/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { success: false, title: '', content: `HTTP ${response.status}`, source: new URL(params.url).hostname };
    }

    const html = await response.text();
    const source = new URL(params.url).hostname;

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Extract main text content — strip HTML tags, scripts, styles
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    if (text.length > maxLength) {
      text = text.slice(0, maxLength) + '...';
    }

    if (!text || text.length < 50) {
      return { success: false, title, content: 'Kon geen bruikbare tekst uit de pagina halen.', source };
    }

    return { success: true, title, content: text, source };
  } catch (error) {
    const source = (() => { try { return new URL(params.url).hostname; } catch { return params.url; } })();
    return {
      success: false,
      title: '',
      content: `Fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      source,
    };
  }
}
