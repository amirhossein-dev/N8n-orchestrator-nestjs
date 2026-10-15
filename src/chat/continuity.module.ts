import { Module } from '@nestjs/common';
import { ChatModule } from './chat.module';
import { ContinuityController } from './continuity.controller';
import { ContinuityService } from './continuity.service';

@Module({imports:[ChatModule],controllers:[ContinuityController],providers:[ContinuityService]})
export class ContinuityModule {}
