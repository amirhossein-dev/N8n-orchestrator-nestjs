import { Injectable } from '@nestjs/common';
import { MemoryService } from '../../memory/memory.service';
import { ToolCall, ToolDefinition, ToolExecutionResult } from './tool.types';

@Injectable()
export class ToolRegistryService {
  private readonly tools: Map<string, ToolDefinition>;

  constructor(private readonly memory: MemoryService) {
    const defs: ToolDefinition[] = [
      {
        name: 'memory.write',
        scope: 'core',
        description: 'Write a memory item (note/task/fact/link) to Postgres',
        handler: async (ctx) => {
          const type = (ctx.args.type ?? 'note') as any;
          const content = String(ctx.args.content ?? '').trim();
          if (!content)
            return {
              name: 'memory.write',
              ok: false,
              error: 'content is empty',
            };

          const saved = await this.memory.writeMemory({
            userId: ctx.userId,
            conversationId: ctx.conversationId,
            type,
            content,
            tags: Array.isArray(ctx.args.tags) ? ctx.args.tags : undefined,
            meta: ctx.args.meta ?? undefined,
          });

          return {
            name: 'memory.write',
            ok: true,
            data: { id: saved.id, type: saved.type },
          };
        },
      },
      {
        name: 'memory.search',
        scope: 'core',
        description: 'Search memory items by substring (MVP)',
        handler: async (ctx) => {
          const q = String(ctx.args.q ?? '').trim();
          const limit = Number(ctx.args.limit ?? 5);
          if (!q)
            return { name: 'memory.search', ok: false, error: 'q is empty' };

          const rows = await this.memory.searchMemory({
            userId: ctx.userId,
            q,
            limit,
          });
          return {
            name: 'memory.search',
            ok: true,
            data: rows.map((r) => ({
              id: r.id,
              type: r.type,
              content: r.content,
              createdAt: r.createdAt,
            })),
          };
        },
      },
      {
        name: 'noop.test',
        scope: 'integration',
        description:
          'MVP integration tool for testing the tool_call loop (executed by n8n)',
      },
      // integration tools would be registered here with scope: 'integration'
    ];

    this.tools = new Map(defs.map((d) => [d.name, d]));
  }

  getTool(name: string) {
    return this.tools.get(name);
  }

  isRegistered(name: string) {
    return this.tools.has(name);
  }

  async executeCoreTool(params: {
    userId: string;
    conversationId: string;
    correlationId: string;
    toolCall: ToolCall;
  }): Promise<ToolExecutionResult> {
    const def = this.tools.get(params.toolCall.name);
    if (!def)
      return {
        name: params.toolCall.name,
        ok: false,
        error: 'tool not registered',
      };
    if (def.scope !== 'core' || !def.handler) {
      return {
        name: params.toolCall.name,
        ok: false,
        error: 'tool is not core-executable',
      };
    }
    return def.handler({
      userId: params.userId,
      conversationId: params.conversationId,
      correlationId: params.correlationId,
      args: params.toolCall.args,
    });
  }
}
