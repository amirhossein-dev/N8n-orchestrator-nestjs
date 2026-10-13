import { GoogleGenAI } from '@google/genai';
import type {
  GenerateContentParameters,
  GenerateContentResponse,
} from '@google/genai';
import { GEMINI_ORIGIN } from './chat.config';
import type { ChatConfig } from './chat.config';
import type { ChatRequest, ChatUsage } from './chat.contract';
import { ChatError } from './chat.error';
import { TextModelProvider } from './text-model.provider';
import type { TextModelResult } from './text-model.provider';

type Generate = (
  request: GenerateContentParameters,
) => Promise<GenerateContentResponse>;
type ModelFactory = (config: ChatConfig) => Generate;

const createGemini: ModelFactory = (config) => {
  const sdk = new GoogleGenAI({
    apiKey: config.apiKey!,
    vertexai: false,
    httpOptions: {
      baseUrl: GEMINI_ORIGIN,
      timeout: config.timeoutMs,
      retryOptions: { attempts: 1 },
    },
  });
  return (request) => sdk.models.generateContent(request);
};

function mappedError(error: unknown, timedOut: boolean): ChatError {
  if (error instanceof ChatError) return error;
  const e = error as { status?: unknown; name?: unknown } | null;
  if (
    timedOut ||
    e?.name === 'AbortError' ||
    e?.name === 'TimeoutError' ||
    e?.status === 408 ||
    e?.status === 504
  ) {
    return new ChatError('AI_PROVIDER_TIMEOUT');
  }
  if (e?.status === 429) return new ChatError('AI_PROVIDER_RATE_LIMITED');
  // Provider key/model/region/account failures are intentionally not confused
  // with an application user's identity error, and never forward provider text.
  return new ChatError('AI_PROVIDER_UNAVAILABLE');
}

function readResult(response: GenerateContentResponse): TextModelResult {
  if (
    !response ||
    response.promptFeedback?.blockReason ||
    !Array.isArray(response.candidates) ||
    response.candidates.length !== 1
  )
    throw new ChatError('AI_INVALID_RESPONSE');
  const candidate = response.candidates[0];
  if (
    !candidate ||
    candidate.finishReason !== 'STOP' ||
    candidate.content?.role !== 'model' ||
    !Array.isArray(candidate.content.parts) ||
    !candidate.content.parts.length
  ) {
    throw new ChatError('AI_INVALID_RESPONSE');
  }
  const chunks: string[] = [];
  for (const part of candidate.content.parts) {
    if (!part || typeof part !== 'object')
      throw new ChatError('AI_INVALID_RESPONSE');
    // Do not use the SDK's text getter: it can warn about unsupported parts.
    if (
      Object.keys(part).some(
        (key) => !['text', 'thought', 'thoughtSignature'].includes(key),
      )
    )
      throw new ChatError('AI_INVALID_RESPONSE');
    if (part.thought) continue;
    if (typeof part.text !== 'string')
      throw new ChatError('AI_INVALID_RESPONSE');
    chunks.push(part.text);
  }
  const replyText = chunks.join('').trim();
  if (!replyText || replyText.length > 16_000)
    throw new ChatError('AI_INVALID_RESPONSE');
  const usage: ChatUsage = {};
  const metadata = response.usageMetadata;
  for (const [name, value] of [
    ['inputTokens', metadata?.promptTokenCount],
    ['outputTokens', metadata?.candidatesTokenCount],
    ['totalTokens', metadata?.totalTokenCount],
  ] as const) {
    if (Number.isSafeInteger(value) && value! >= 0) usage[name] = value;
  }
  return { replyText, ...(Object.keys(usage).length ? { usage } : {}) };
}

export class GeminiTextProvider extends TextModelProvider {
  private generate: Generate | undefined;

  constructor(
    private readonly config: ChatConfig,
    private readonly factory: ModelFactory = createGemini,
  ) {
    super();
  }

  async reply(input: ChatRequest): Promise<TextModelResult> {
    if (!this.config.enabled || !this.config.apiKey)
      throw new ChatError('AI_PROVIDER_NOT_CONFIGURED');
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new ChatError('AI_PROVIDER_TIMEOUT'));
      }, this.config.timeoutMs);
    });
    try {
      this.generate ??= this.factory(this.config);
      const response = await Promise.race([
        this.generate({
          model: this.config.model,
          contents: [
            ...input.history.map((entry) => ({
              role: entry.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: entry.text }],
            })),
            { role: 'user', parts: [{ text: input.message }] },
          ],
          config: {
            systemInstruction: this.config.systemInstruction,
            maxOutputTokens: this.config.maxOutputTokens,
            candidateCount: 1,
            responseMimeType: 'text/plain',
            abortSignal: abort.signal,
            httpOptions: {
              timeout: this.config.timeoutMs,
              retryOptions: { attempts: 1 },
            },
          },
        }),
        deadline,
      ]);
      return readResult(response);
    } catch (error) {
      throw mappedError(error, abort.signal.aborted);
    } finally {
      clearTimeout(timer);
    }
  }
}
