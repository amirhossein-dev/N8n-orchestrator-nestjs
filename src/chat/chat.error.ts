import { HttpException } from '@nestjs/common';

export const CHAT_ERROR_STATUS = {
  AI_PROVIDER_NOT_CONFIGURED: 503,
  AI_PROVIDER_TIMEOUT: 504,
  AI_PROVIDER_RATE_LIMITED: 429,
  AI_PROVIDER_UNAVAILABLE: 503,
  AI_INVALID_RESPONSE: 502,
  INVALID_CHAT_REQUEST: 400,
} as const;

export type ChatErrorCode = keyof typeof CHAT_ERROR_STATUS;

export class ChatError extends HttpException {
  constructor(public readonly code: ChatErrorCode) {
    // Never attach the provider error as a cause or response field.
    super({ error: code }, CHAT_ERROR_STATUS[code]);
    this.message = code;
  }
}
