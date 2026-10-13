import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { requiredPrincipal } from '../identity/identity.http';
import type { IdentityRequest } from '../identity/identity.http';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('reply')
  @HttpCode(200)
  reply(@Body() body: unknown, @Req() request: IdentityRequest) {
    // The global IdentityGuard authenticates and checks active membership.
    // Keep identity at this boundary: the provider receives text only.
    requiredPrincipal(request);
    return this.chat.reply(body);
  }
}
