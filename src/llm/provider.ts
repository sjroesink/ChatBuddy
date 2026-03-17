export interface Session {
  id: string;
  chatId: string;
  provider: string;
}

export interface MediaAttachment {
  type: 'image' | 'document' | 'video' | 'audio' | 'gif';
  data: Buffer | string;
  mimeType: string;
  filename?: string;
}

export interface MessageInput {
  text?: string;
  media?: MediaAttachment[];
  context?: string;
}

export interface ToolResult {
  tool: string;
  result: unknown;
}

export interface MessageOutput {
  text?: string;
  media?: MediaAttachment[];
  toolResults?: ToolResult[];
}

export type SendMessageCallback = (text: string) => Promise<void>;

export interface ToolCallbacks {
  onSendMessage?: SendMessageCallback;
}

export class LLMError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'LLMError';
  }
}

export interface CreateSessionResult {
  session: Session;
  response?: MessageOutput;
}

export interface LLMProvider {
  createSession(chatId: string, systemPrompt: string, firstMessage?: MessageInput, callbacks?: ToolCallbacks): Promise<CreateSessionResult>;
  resumeSession(sessionId: string): Promise<Session>;
  destroySession(sessionId: string): Promise<void>;
  sendMessage(session: Session, message: MessageInput, callbacks?: ToolCallbacks): Promise<MessageOutput>;
  supportsTools(): boolean;
  supportsMedia(): boolean;
  supportsResume(): boolean;
}
