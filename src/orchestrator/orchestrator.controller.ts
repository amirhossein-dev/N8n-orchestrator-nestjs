import { Body, Controller, Post } from '@nestjs/common';
import {
  OrchestrateRequestV1Dto,
  ToolResultV1Dto,
  ConfirmV1Dto,
} from '../contracts/v1/envelope.dto';
import { OrchestratorService } from './orchestrator.service';

@Controller()
export class OrchestratorController {
  constructor(private readonly orch: OrchestratorService) {}

  @Post('orchestrate')
  orchestrate(@Body() body: OrchestrateRequestV1Dto) {
    return this.orch.orchestrate(body);
  }

  @Post('tool-result')
  toolResult(@Body() body: ToolResultV1Dto) {
    return this.orch.toolResult(body);
  }

  @Post('confirm')
  confirm(@Body() body: ConfirmV1Dto) {
    return this.orch.confirm(body);
  }
}
