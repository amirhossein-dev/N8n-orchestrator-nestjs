import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { MemoryItem } from './entities/memory-item.entity';
import { ConversationMessage } from './entities/conversation-message.entity';
import { ToolExecution } from './entities/tool-execution.entity';
import { PendingAction } from './entities/pending-action.entity';

@Injectable()
export class MemoryService {
  constructor(
    @InjectRepository(MemoryItem)
    private readonly memoryRepo: Repository<MemoryItem>,
    @InjectRepository(ConversationMessage)
    private readonly msgRepo: Repository<ConversationMessage>,
    @InjectRepository(ToolExecution)
    private readonly execRepo: Repository<ToolExecution>,
    @InjectRepository(PendingAction)
    private readonly pendingRepo: Repository<PendingAction>,
  ) {}

  async logMessage(params: {
    userId: string;
    conversationId: string;
    role: 'user' | 'assistant' | 'tool';
    text: string;
    correlationId?: string;
    meta?: Record<string, any>;
  }) {
    console.log('logMessage params:', params);
    const row = this.msgRepo.create(params);
    console.log('entity after create:', row);
    return this.msgRepo.save(row);
  }

  async writeMemory(params: {
    userId: string;
    conversationId: string;
    type: MemoryItem['type'];
    content: string;
    tags?: string[];
    meta?: Record<string, any>;
  }) {
    const row = this.memoryRepo.create(params);
    return this.memoryRepo.save(row);
  }

  async searchMemory(params: { userId: string; q: string; limit?: number }) {
    const limit = Math.min(params.limit ?? 10, 50);
    // MVP: simple substring search (بعداً semantic search)
    return this.memoryRepo.find({
      where: { userId: params.userId, content: ILike(`%${params.q}%`) },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async logToolExecution(params: {
    userId: string;
    conversationId: string;
    correlationId: string;
    toolName: string;
    args: Record<string, any>;
    ok: boolean;
    data?: any;
    error?: string;
  }) {
    const row = this.execRepo.create(params);
    return this.execRepo.save(row);
  }

  async createPendingAction(params: {
    userId: string;
    conversationId: string;
    toolCall: { name: string; args: Record<string, any> };
    reason?: string;
  }) {
    const row = this.pendingRepo.create({
      userId: params.userId,
      conversationId: params.conversationId,
      status: 'pending',
      toolCall: params.toolCall,
      reason: params.reason,
    });
    return this.pendingRepo.save(row);
  }

  async resolvePendingAction(params: {
    id: string;
    userId: string;
    conversationId: string;
    approved: boolean;
  }) {
    const row = await this.pendingRepo.findOne({
      where: {
        id: params.id,
        userId: params.userId,
        conversationId: params.conversationId,
      },
    });
    if (!row) return null;

    row.status = params.approved ? 'approved' : 'rejected';
    return this.pendingRepo.save(row);
  }

  async getPendingAction(id: string) {
    return this.pendingRepo.findOne({ where: { id } });
  }
}
