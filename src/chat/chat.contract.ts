import type { ChatConfig } from './chat.config';
import { ChatError } from './chat.error';

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  text: string;
}
export interface ChatRequest {
  message: string;
  history: ChatHistoryMessage[];
}
export interface ChatUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}
export interface ChatReply {
  version: '1.0';
  requestId: string;
  replyText: string;
  provider: 'gemini';
  model: string;
  latencyMs: number;
  usage?: ChatUsage;
}

function invalid(): never {
  throw new ChatError('INVALID_CHAT_REQUEST');
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  if (Object.keys(value).some((key) => !keys.includes(key))) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit)
    return invalid();
  return value;
}

export function parseChatRequest(
  body: unknown,
  config: Pick<ChatConfig, 'maxMessageChars' | 'maxHistoryMessages'>,
): ChatRequest {
  const input = object(body, ['message', 'history']);
  const message = text(input.message, config.maxMessageChars);
  if (
    !Array.isArray(input.history) ||
    input.history.length > config.maxHistoryMessages
  )
    return invalid();
  let total = 0;
  const history = input.history.map((item) => {
    const entry = object(item, ['role', 'text']);
    if (entry.role !== 'user' && entry.role !== 'assistant') return invalid();
    const content = text(entry.text, config.maxMessageChars);
    total += content.length;
    if (total > 16_000) return invalid();
    return { role: entry.role, text: content } as ChatHistoryMessage;
  });
  return { message, history };
}
