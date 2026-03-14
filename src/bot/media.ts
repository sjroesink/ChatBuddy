import FormData from 'form-data';

const MAX_MESSAGE_LENGTH = 4096;

const TEXT_EXTENSIONS = new Set([
  '.txt', '.csv', '.json', '.md', '.xml', '.yaml', '.yml', '.toml',
  '.ini', '.cfg', '.log', '.html', '.css', '.js', '.ts', '.py', '.rb',
  '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.sh', '.bash',
  '.sql', '.env', '.gitignore',
]);

export async function transcribeVoice(voiceUrl: string, openaiApiKey: string): Promise<string> {
  // Download the voice file
  const downloadResponse = await fetch(voiceUrl);
  if (!downloadResponse.ok) {
    throw new Error(`Failed to download voice file: ${downloadResponse.statusText}`);
  }
  const audioBuffer = Buffer.from(await downloadResponse.arrayBuffer());

  // Build multipart form data
  const form = new FormData();
  form.append('file', audioBuffer, { filename: 'voice.ogg', contentType: 'audio/ogg' });
  form.append('model', 'whisper-1');

  // Send to OpenAI Whisper API
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      ...form.getHeaders(),
    },
    body: form.getBuffer(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Whisper API error: ${error}`);
  }

  const data = await response.json() as { text: string };
  return data.text;
}

export function classifyDocument(filename: string): 'pdf' | 'text' | 'unsupported' {
  const lower = filename.toLowerCase();
  const dotIndex = lower.lastIndexOf('.');
  if (dotIndex === -1) {
    // No extension — check for dotfiles like .gitignore
    return 'unsupported';
  }
  const ext = lower.slice(dotIndex);

  if (ext === '.pdf') {
    return 'pdf';
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    return 'text';
  }
  return 'unsupported';
}

export function splitMessage(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) {
    return [text];
  }

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > MAX_MESSAGE_LENGTH) {
    const chunk = remaining.slice(0, MAX_MESSAGE_LENGTH);

    // Count backtick fences up to each position to determine if we're inside a code block
    // We try to find the last newline that is NOT inside a code block
    let bestSplit = -1;

    // Walk backwards from MAX_MESSAGE_LENGTH - 1 to find a newline outside a code block
    let fenceCount = 0;
    let i = 0;
    let lastSafeNewline = -1;

    while (i < chunk.length) {
      if (chunk[i] === '`' && chunk.slice(i, i + 3) === '```') {
        fenceCount++;
        i += 3;
        continue;
      }
      if (chunk[i] === '\n' && fenceCount % 2 === 0) {
        lastSafeNewline = i;
      }
      i++;
    }

    if (lastSafeNewline > 0) {
      bestSplit = lastSafeNewline;
    }

    if (bestSplit > 0) {
      parts.push(remaining.slice(0, bestSplit));
      remaining = remaining.slice(bestSplit + 1); // skip the newline character
    } else {
      // Fall back to last newline before limit
      const lastNewline = chunk.lastIndexOf('\n');
      if (lastNewline > 0) {
        parts.push(remaining.slice(0, lastNewline));
        remaining = remaining.slice(lastNewline + 1);
      } else {
        // Hard split at MAX_MESSAGE_LENGTH
        parts.push(remaining.slice(0, MAX_MESSAGE_LENGTH));
        remaining = remaining.slice(MAX_MESSAGE_LENGTH);
      }
    }
  }

  if (remaining.length > 0) {
    parts.push(remaining);
  }

  return parts;
}
