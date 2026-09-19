import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MemoryService } from './memory.service';
import { MemoryItem } from './entities/memory-item.entity';
import { ConversationMessage } from './entities/conversation-message.entity';
import { ToolExecution } from './entities/tool-execution.entity';
import { PendingAction } from './entities/pending-action.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MemoryItem,
      ConversationMessage,
      ToolExecution,
      PendingAction,
    ]),
  ],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
