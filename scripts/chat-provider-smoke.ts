import { ChatService } from '../src/chat/chat.service';
import { loadChatConfig } from '../src/chat/chat.config';
import { ChatError } from '../src/chat/chat.error';
import { GeminiTextProvider } from '../src/chat/gemini-text.provider';

async function main() {
  if (
    !['development', 'test'].includes(process.env.NODE_ENV || '') ||
    process.env.CHAT_FREE_TIER_CONFIRMED !== 'true'
  ) {
    console.error(
      JSON.stringify({
        status: 'NOT_RUN',
        reason:
          'LOCAL_ENVIRONMENT_AND_OPERATOR_FREE_TIER_CONFIRMATION_REQUIRED',
        providerCalls: 0,
      }),
    );
    process.exitCode = 1;
    return;
  }
  const config = loadChatConfig();
  const service = new ChatService(config, new GeminiTextProvider(config));
  const response = await service.reply({
    message: 'Reply with exactly: GEMINI_LINK_OK',
    history: [],
  });
  const passed = response.replyText === 'GEMINI_LINK_OK';
  console.info(
    JSON.stringify({
      status: passed ? 'PASS' : 'FAIL',
      check: 'backend_provider_smoke',
      requestId: response.requestId,
      provider: response.provider,
      model: response.model,
      latencyMs: response.latencyMs,
      markerMatched: passed,
      ...(passed ? {} : { failureClass: 'AI_INVALID_RESPONSE' }),
    }),
  );
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: 'FAIL',
      check: 'backend_provider_smoke',
      failureClass:
        error instanceof ChatError ? error.code : 'AI_PROVIDER_UNAVAILABLE',
    }),
  );
  process.exitCode = 1;
});
