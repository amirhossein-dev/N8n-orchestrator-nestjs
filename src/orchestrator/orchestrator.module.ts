import { Module } from '@nestjs/common';
import { MemoryModule } from '../memory/memory.module';
import { OrchestratorController } from './orchestrator.controller';
import { OrchestratorService } from './orchestrator.service';
import { RouterService } from './router/router.service';
import { GuardService } from './guard/guard.service';
import { ToolRegistryService } from './tools/tool-registry.service';

@Module({
  imports: [MemoryModule],
  controllers: [OrchestratorController],
  providers: [
    OrchestratorService,
    RouterService,
    GuardService,
    ToolRegistryService,
  ],
})
export class OrchestratorModule {}
