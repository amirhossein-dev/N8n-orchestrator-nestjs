import type {
  GenerateContentParameters,
  GenerateContentResponse,
} from '@google/genai';
import { GeminiTextProvider } from './gemini-text.provider';
import { GEMINI_ORIGIN, loadChatConfig } from './chat.config';
import { parseChatRequest } from './chat.contract';

// An unusable label, never a real API key. Every test injects generation or fetch;
// no test reads the private environment or sends an external request.
const config = () =>
  loadChatConfig({
    GEMINI_ENABLED: 'true',
    GEMINI_API_KEY: 'offline-placeholder',
  });
const input = {
  message: 'Synthetic latest',
  history: [{ role: 'assistant' as const, text: 'Synthetic earlier' }],
};
const response = (text = 'Synthetic reply') =>
  ({
    candidates: [
      { finishReason: 'STOP', content: { role: 'model', parts: [{ text }] } },
    ],
  }) as GenerateContentResponse;
const rejected = (value: unknown) =>
  new GeminiTextProvider(config(), () => async () => {
    throw value;
  });

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('defaults off and refuses missing keys without constructing the SDK', async () => {
  const factory = jest.fn();
  await expect(
    new GeminiTextProvider(loadChatConfig({}), factory).reply(input),
  ).rejects.toMatchObject({ code: 'AI_PROVIDER_NOT_CONFIGURED' });
  await expect(
    new GeminiTextProvider(
      loadChatConfig({ GEMINI_ENABLED: 'true' }),
      factory,
    ).reply(input),
  ).rejects.toMatchObject({ code: 'AI_PROVIDER_NOT_CONFIGURED' });
  expect(factory).not.toHaveBeenCalled();
});

it.each([
  { GEMINI_ENABLED: 'yes' },
  { GEMINI_TIMEOUT_MS: '12001' },
  { GEMINI_TIMEOUT_MS: '0' },
  { GEMINI_MAX_OUTPUT_TOKENS: '2049' },
  { CHAT_MAX_HISTORY_MESSAGES: '13' },
  { CHAT_MAX_MESSAGE_CHARS: '4001' },
  { CHAT_MAX_MESSAGE_CHARS: 'NaN' },
  { GEMINI_MODEL: 'https://other.invalid/' },
  { GOOGLE_GEMINI_BASE_URL: 'https://proxy.invalid' },
  { GOOGLE_GENAI_USE_VERTEXAI: 'true' },
])('rejects invalid configuration without leaking values %#', (env) => {
  expect(() => loadChatConfig(env)).toThrow('AI_PROVIDER_NOT_CONFIGURED');
});

it('respects reduced configured request limits', () => {
  const cfg = loadChatConfig({
    CHAT_MAX_HISTORY_MESSAGES: '0',
    CHAT_MAX_MESSAGE_CHARS: '3',
  });
  expect(parseChatRequest({ message: 'abc', history: [] }, cfg)).toEqual({
    message: 'abc',
    history: [],
  });
  expect(() => parseChatRequest({ message: 'abcd', history: [] }, cfg)).toThrow(
    'INVALID_CHAT_REQUEST',
  );
  expect(() => parseChatRequest(input, cfg)).toThrow('INVALID_CHAT_REQUEST');
});

it('uses one stateless text request with bounded output and server-owned instruction', async () => {
  const generate = jest.fn(async (_: GenerateContentParameters) => response());
  const cfg = config();
  cfg.model = 'gemini-test-configured';
  const result = await new GeminiTextProvider(cfg, () => generate).reply(input);
  expect(result).toEqual({ replyText: 'Synthetic reply' });
  expect(generate).toHaveBeenCalledTimes(1);
  const params = generate.mock.calls[0][0];
  expect(params.model).toBe('gemini-test-configured');
  expect(params.contents).toEqual([
    { role: 'model', parts: [{ text: 'Synthetic earlier' }] },
    { role: 'user', parts: [{ text: 'Synthetic latest' }] },
  ]);
  expect(params.config).toEqual({
    systemInstruction: cfg.systemInstruction,
    maxOutputTokens: 1024,
    candidateCount: 1,
    responseMimeType: 'text/plain',
    abortSignal: expect.any(AbortSignal),
    httpOptions: { timeout: 12000, retryOptions: { attempts: 1 } },
  });
  expect(JSON.stringify(params)).not.toContain('offline-placeholder');
});

it('passes only safe usage counts and excludes thought text', async () => {
  const value = response();
  value.candidates![0].content!.parts!.unshift({
    text: 'internal synthetic thought',
    thought: true,
  });
  value.usageMetadata = {
    promptTokenCount: 5,
    candidatesTokenCount: -1,
    totalTokenCount: 9,
  };
  expect(
    await new GeminiTextProvider(config(), () => async () => value).reply(
      input,
    ),
  ).toEqual({
    replyText: 'Synthetic reply',
    usage: { inputTokens: 5, totalTokens: 9 },
  });
});

it.each([
  [429, 'AI_PROVIDER_RATE_LIMITED'],
  [401, 'AI_PROVIDER_UNAVAILABLE'],
  [403, 'AI_PROVIDER_UNAVAILABLE'],
  [402, 'AI_PROVIDER_UNAVAILABLE'],
  [404, 'AI_PROVIDER_UNAVAILABLE'],
  [500, 'AI_PROVIDER_UNAVAILABLE'],
  [503, 'AI_PROVIDER_UNAVAILABLE'],
  [408, 'AI_PROVIDER_TIMEOUT'],
  [504, 'AI_PROVIDER_TIMEOUT'],
])(
  'maps provider HTTP %s without forwarding its payload or cause',
  async (status, code) => {
    try {
      await rejected({
        status,
        message: 'PRIVATE_PROVIDER_DETAIL',
        body: { data: 'PRIVATE_BODY' },
      }).reply(input);
      throw new Error('Expected failure');
    } catch (error) {
      expect(error).toMatchObject({ code });
      expect(JSON.stringify(error)).not.toMatch(
        /PRIVATE_PROVIDER_DETAIL|PRIVATE_BODY/,
      );
      expect((error as Error).cause).toBeUndefined();
    }
  },
);

it('maps transport failure without forwarding its message', async () => {
  await expect(
    rejected(new Error('PRIVATE_NETWORK_DETAIL')).reply(input),
  ).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
});

it('aborts at the deadline even when generation never settles, with no second call', async () => {
  jest.useFakeTimers();
  const generate = jest.fn(
    (_params: GenerateContentParameters) =>
      new Promise<GenerateContentResponse>(() => undefined),
  );
  const call = new GeminiTextProvider(config(), () => generate).reply(input);
  const assertion = expect(call).rejects.toMatchObject({
    code: 'AI_PROVIDER_TIMEOUT',
  });
  await jest.advanceTimersByTimeAsync(12000);
  await assertion;
  expect(generate.mock.calls[0][0].config!.abortSignal!.aborted).toBe(true);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it.each([
  undefined,
  {},
  { candidates: [] },
  response('  '),
  response('x'.repeat(16001)),
  { promptFeedback: { blockReason: 'SAFETY' } },
  {
    candidates: [
      {
        finishReason: 'MAX_TOKENS',
        content: { role: 'model', parts: [{ text: 'cut off' }] },
      },
    ],
  },
  {
    candidates: [
      {
        finishReason: 'STOP',
        content: {
          role: 'model',
          parts: [{ functionCall: { name: 'forbidden' } }],
        },
      },
    ],
  },
])(
  'rejects invalid or nontext response %# without a fallback',
  async (value) => {
    await expect(
      new GeminiTextProvider(
        config(),
        () => async () => value as GenerateContentResponse,
      ).reply(input),
    ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  },
);

it.each([429, 503])(
  'the pinned SDK itself sends exactly one HTTP request on %s',
  async (status) => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: 'PRIVATE_PROVIDER_DETAIL',
            code: status,
            status: 'UNAVAILABLE',
          },
        }),
        { status, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await expect(
      new GeminiTextProvider(config()).reply(input),
    ).rejects.toMatchObject({
      code:
        status === 429 ? 'AI_PROVIDER_RATE_LIMITED' : 'AI_PROVIDER_UNAVAILABLE',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.origin).toBe(GEMINI_ORIGIN);
    expect(url.searchParams.has('key')).toBe(false);
  },
);
