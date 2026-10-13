import type { ChatRequest, ChatUsage } from './chat.contract';

export interface TextModelResult {
  replyText: string;
  usage?: ChatUsage;
}

export abstract class TextModelProvider {
  abstract reply(input: ChatRequest): Promise<TextModelResult>;
}
