import { Module } from '@nestjs/common';
import { CHAT_CONFIG, loadChatConfig } from './chat.config';
import type { ChatConfig } from './chat.config';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { TextModelProvider } from './text-model.provider';
import { GeminiTextProvider } from './gemini-text.provider';

@Module({
  controllers: [ChatController],
  providers: [
    { provide: CHAT_CONFIG, useFactory: () => loadChatConfig() },
    {
      provide: TextModelProvider,
      inject: [CHAT_CONFIG],
      useFactory: (config: ChatConfig) => new GeminiTextProvider(config),
    },
    ChatService,
  ],
  exports: [ChatService, CHAT_CONFIG],
})
export class ChatModule {}
