import { ChatError } from './chat.error';

export const CHAT_CONFIG = Symbol('CHAT_CONFIG');
export const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com';

export interface ChatConfig {
  enabled: boolean;
  apiKey: string | null;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  maxHistoryMessages: number;
  maxMessageChars: number;
  systemInstruction: string;
}

export function loadChatConfig(
  env: NodeJS.ProcessEnv = process.env,
): ChatConfig {
  const bad = (): never => {
    throw new ChatError('AI_PROVIDER_NOT_CONFIGURED');
  };
  const integer = (
    name: string,
    fallback: number,
    min: number,
    max: number,
  ) => {
    const raw = env[name];
    if (raw !== undefined && !/^\d+$/.test(raw)) return bad();
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max)
      return bad();
    return value;
  };
  if (
    env.GEMINI_ENABLED !== undefined &&
    !['true', 'false'].includes(env.GEMINI_ENABLED)
  )
    bad();
  const model = env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite';
  if (!/^gemini-[a-z0-9][a-z0-9.-]{0,99}$/.test(model)) bad();
  // This slice has one direct Developer API route. Never silently accept a proxy
  // or switch to Vertex because of inherited SDK environment settings.
  if (
    env.GOOGLE_GEMINI_BASE_URL &&
    env.GOOGLE_GEMINI_BASE_URL !== GEMINI_ORIGIN
  )
    bad();
  if (
    env.GOOGLE_GENAI_USE_VERTEXAI &&
    env.GOOGLE_GENAI_USE_VERTEXAI !== 'false'
  )
    bad();
  const apiKey = env.GEMINI_API_KEY?.trim() || null;
  if (apiKey && /[\s\x00-\x1f\x7f]/.test(apiKey)) bad();
  return {
    enabled: env.GEMINI_ENABLED === 'true',
    apiKey,
    model,
    timeoutMs: integer('GEMINI_TIMEOUT_MS', 12_000, 1_000, 12_000),
    maxOutputTokens: integer('GEMINI_MAX_OUTPUT_TOKENS', 1_024, 1, 2_048),
    maxHistoryMessages: integer('CHAT_MAX_HISTORY_MESSAGES', 12, 0, 12),
    maxMessageChars: integer('CHAT_MAX_MESSAGE_CHARS', 4_000, 1, 4_000),
    systemInstruction:
      "You are the basic, non-authoritative DARA-GPT integration-test assistant. Reply concisely using this request's text conversation only. You have no tools, file access, private or persistent memory, or execution capability. Do not claim otherwise.",
  };
}
