import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CHAT_CONFIG } from './chat.config';
import type { ChatConfig } from './chat.config';
import { parseChatRequest } from './chat.contract';
import type { ChatReply } from './chat.contract';
import { TextModelProvider } from './text-model.provider';
import { ChatError } from './chat.error';

@Injectable()
export class ChatService {
  constructor(
    @Inject(CHAT_CONFIG) private readonly config: ChatConfig,
    private readonly provider: TextModelProvider,
  ) {}

  async reply(body: unknown): Promise<ChatReply> {
    const input = parseChatRequest(body, this.config);
    const requestId = randomUUID();
    const started = performance.now();
    try {
      const result = await this.provider.reply(input);
      return {
        version: '1.0',
        requestId,
        replyText: result.replyText,
        provider: 'gemini',
        model: this.config.model,
        latencyMs: Math.round(performance.now() - started),
        ...(result.usage ? { usage: result.usage } : {}),
      };
    } catch (error) {
      throw error instanceof ChatError
        ? error
        : new ChatError('AI_PROVIDER_UNAVAILABLE');
    } finally {
      console.info(
        JSON.stringify({
          requestId,
          provider: 'gemini',
          model: this.config.model,
          latencyMs: Math.round(performance.now() - started),
        }),
      );
    }
  }
}
