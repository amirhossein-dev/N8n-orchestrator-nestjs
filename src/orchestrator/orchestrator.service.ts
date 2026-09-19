import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MemoryService } from '../memory/memory.service';
import { RouterService } from './router/router.service';
import { GuardService } from './guard/guard.service';
import { ToolRegistryService } from './tools/tool-registry.service';

import {
  OrchestrateRequestV1Dto,
  OrchestrateResponseV1Dto,
  ToolResultV1Dto,
  ConfirmV1Dto,
} from '../contracts/v1/envelope.dto';

@Injectable()
export class OrchestratorService {
  constructor(
    private readonly memory: MemoryService,
    private readonly router: RouterService,
    private readonly guard: GuardService,
    private readonly tools: ToolRegistryService,
  ) {}

  /* =========================
   * ORCHESTRATE
   * ========================= */
  async orchestrate(
    req: OrchestrateRequestV1Dto,
  ): Promise<OrchestrateResponseV1Dto> {
    const requestId = req.requestId || randomUUID();

    // log user message
    await this.memory.logMessage({
      userId: req.userId,
      conversationId: req.conversationId,
      role: 'user',
      text: req.text,
      correlationId: requestId,
      meta: { channel: req.channel, ...req.meta },
    });
    console.log('ORCH req.text =', JSON.stringify(req.text));

    const decision = this.router.route(req.text);

    // no tools → reply
    if (!decision.toolCalls.length) {
      const replyText = decision.draftReply ?? 'اوکی.';
      await this.memory.logMessage({
        userId: req.userId,
        conversationId: req.conversationId,
        role: 'assistant',
        text: replyText,
        correlationId: requestId,
      });

      return {
        version: '1.0',
        type: 'reply',
        requestId,
        replyText,
        debug: decision,
      };
    }

    const toolCall = decision.toolCalls[0];

    // guard
    const g = this.guard.evaluate({ name: toolCall.name, args: toolCall.args });

    if (g.kind === 'deny') {
      const replyText = `انجام نشد: ${g.reason}`;
      await this.memory.logMessage({
        userId: req.userId,
        conversationId: req.conversationId,
        role: 'assistant',
        text: replyText,
        correlationId: requestId,
      });

      return {
        version: '1.0',
        type: 'reply',
        requestId,
        replyText,
        debug: { ...decision, guard: g },
      };
    }

    if (g.kind === 'confirm') {
      const pending = await this.memory.createPendingAction({
        userId: req.userId,
        conversationId: req.conversationId,
        toolCall: { name: toolCall.name, args: toolCall.args },
        reason: g.reason,
      });

      const replyText = `نیاز به تایید: ${g.reason}`;
      await this.memory.logMessage({
        userId: req.userId,
        conversationId: req.conversationId,
        role: 'assistant',
        text: replyText,
        correlationId: requestId,
      });

      return {
        version: '1.0',
        type: 'needs_confirmation',
        requestId,
        replyText,
        pendingAction: {
          id: pending.id,
          toolCall: {
            name: toolCall.name,
            args: toolCall.args,
            idempotencyKey: randomUUID(),
          },
        },
        debug: { ...decision, guard: g },
      };
    }

    // allowed
    const def = this.tools.getTool(toolCall.name);
    if (!def) {
      const replyText = `Tool ثبت نشده: ${toolCall.name}`;
      await this.memory.logMessage({
        userId: req.userId,
        conversationId: req.conversationId,
        role: 'assistant',
        text: replyText,
        correlationId: requestId,
      });

      return {
        version: '1.0',
        type: 'reply',
        requestId,
        replyText,
        debug: decision,
      };
    }

    // integration → return tool_call
    if (def.scope === 'integration') {
      const replyText = decision.draftReply ?? 'دارم انجامش می‌دم…';
      await this.memory.logMessage({
        userId: req.userId,
        conversationId: req.conversationId,
        role: 'assistant',
        text: replyText,
        correlationId: requestId,
      });

      return {
        version: '1.0',
        type: 'tool_call',
        requestId,
        replyText,
        toolCalls: [
          {
            name: toolCall.name,
            args: toolCall.args,
            idempotencyKey: randomUUID(),
          },
        ],
        debug: decision,
      };
    }

    // core tool execution
    const result = await this.tools.executeCoreTool({
      userId: req.userId,
      conversationId: req.conversationId,
      correlationId: requestId,
      toolCall: { name: toolCall.name, args: toolCall.args },
    });

    await this.memory.logToolExecution({
      userId: req.userId,
      conversationId: req.conversationId,
      correlationId: requestId,
      toolName: toolCall.name,
      args: toolCall.args,
      ok: result.ok,
      data: result.ok ? result.data : undefined,
      error: result.ok ? undefined : result.error,
    });

    const replyText = this.renderToolResultToReply(result);

    await this.memory.logMessage({
      userId: req.userId,
      conversationId: req.conversationId,
      role: 'assistant',
      text: replyText,
      correlationId: requestId,
    });

    return {
      version: '1.0',
      type: 'reply',
      requestId,
      replyText,
      debug: { ...decision, toolResult: result },
    };
  }

  /* =========================
   * TOOL RESULT (from n8n)
   * ========================= */
  async toolResult(
    payload: ToolResultV1Dto,
  ): Promise<OrchestrateResponseV1Dto> {
    const requestId = payload.requestId;

    for (const r of payload.results) {
      await this.memory.logToolExecution({
        userId: payload.userId,
        conversationId: payload.conversationId,
        correlationId: requestId,
        toolName: r.name,
        args: {},
        ok: r.ok,
        data: r.data,
        error: r.error,
      });
    }

    const okCount = payload.results.filter((r) => r.ok).length;
    const failCount = payload.results.length - okCount;

    const replyText =
      failCount === 0
        ? `انجام شد ✅ (${okCount} ابزار)`
        : `برخی عملیات انجام نشد ⚠️ (موفق: ${okCount} / ناموفق: ${failCount})`;

    await this.memory.logMessage({
      userId: payload.userId,
      conversationId: payload.conversationId,
      role: 'assistant',
      text: replyText,
      correlationId: requestId,
      meta: { toolResults: payload.results },
    });

    return {
      version: '1.0',
      type: 'reply',
      requestId,
      replyText,
      debug: { toolResults: payload.results },
    };
  }

  /* =========================
   * CONFIRM
   * ========================= */
  async confirm(body: ConfirmV1Dto): Promise<OrchestrateResponseV1Dto> {
    const requestId = body.requestId ?? randomUUID();

    const resolved = await this.memory.resolvePendingAction({
      id: body.pendingActionId,
      userId: body.userId,
      conversationId: body.conversationId,
      approved: body.approved,
    });

    if (!resolved) {
      const replyText = 'Pending action پیدا نشد.';
      await this.memory.logMessage({
        userId: body.userId,
        conversationId: body.conversationId,
        role: 'assistant',
        text: replyText,
        correlationId: requestId,
      });

      return { version: '1.0', type: 'reply', requestId, replyText };
    }

    if (!body.approved) {
      const replyText = 'تایید نشد. عملیات لغو شد.';
      await this.memory.logMessage({
        userId: body.userId,
        conversationId: body.conversationId,
        role: 'assistant',
        text: replyText,
        correlationId: requestId,
      });

      return {
        version: '1.0',
        type: 'reply',
        requestId,
        replyText,
        debug: { pendingAction: resolved },
      };
    }

    const toolCall = resolved.toolCall;
    const def = this.tools.getTool(toolCall.name);

    if (!def) {
      const replyText = `Tool ثبت نشده: ${toolCall.name}`;
      await this.memory.logMessage({
        userId: body.userId,
        conversationId: body.conversationId,
        role: 'assistant',
        text: replyText,
        correlationId: requestId,
      });

      return { version: '1.0', type: 'reply', requestId, replyText };
    }

    if (def.scope === 'integration') {
      const replyText = 'تایید شد. دارم انجامش می‌دم…';
      await this.memory.logMessage({
        userId: body.userId,
        conversationId: body.conversationId,
        role: 'assistant',
        text: replyText,
        correlationId: requestId,
      });

      return {
        version: '1.0',
        type: 'tool_call',
        requestId,
        replyText,
        toolCalls: [
          {
            name: toolCall.name,
            args: toolCall.args,
            idempotencyKey: randomUUID(),
          },
        ],
        debug: { approved: true, pendingActionId: body.pendingActionId },
      };
    }

    const result = await this.tools.executeCoreTool({
      userId: body.userId,
      conversationId: body.conversationId,
      correlationId: requestId,
      toolCall,
    });

    await this.memory.logToolExecution({
      userId: body.userId,
      conversationId: body.conversationId,
      correlationId: requestId,
      toolName: toolCall.name,
      args: toolCall.args,
      ok: result.ok,
      data: result.ok ? result.data : undefined,
      error: result.ok ? undefined : result.error,
    });

    const replyText = this.renderToolResultToReply(result);

    await this.memory.logMessage({
      userId: body.userId,
      conversationId: body.conversationId,
      role: 'assistant',
      text: replyText,
      correlationId: requestId,
    });

    return {
      version: '1.0',
      type: 'reply',
      requestId,
      replyText,
      debug: { approved: true, toolResult: result },
    };
  }

  /* =========================
   * RENDER
   * ========================= */
  private renderToolResultToReply(result: any): string {
    if (!result.ok) return `انجام نشد: ${result.error}`;

    if (result.name === 'memory.write') return 'حتماً—یادداشت شد ✅';

    if (result.name === 'memory.search') {
      const items = Array.isArray(result.data) ? result.data : [];
      if (!items.length) return 'چیزی پیدا نکردم.';
      const lines = items
        .slice(0, 5)
        .map((x: any, i: number) => `${i + 1}) ${x.content}`);
      return `این‌ها مرتبط بودند:\n${lines.join('\n')}`;
    }

    return 'انجام شد ✅';
  }
}
