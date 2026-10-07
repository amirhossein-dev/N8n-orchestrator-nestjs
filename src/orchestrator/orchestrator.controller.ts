import { Body, Controller, Post, Req } from '@nestjs/common';
import { ToolResultV1Dto } from '../contracts/v1/envelope.dto';
import { OrchestratorService } from './orchestrator.service';
import { requiredPrincipal } from '../identity/identity.http';
import type { IdentityRequest } from '../identity/identity.http';
import { fail } from '../identity/core/model';
import * as V from '../identity/core/validation';
import { bindConversation, bindOrchestrate } from '../identity/core/request-scope';

@Controller()
export class OrchestratorController {
  constructor(private readonly orch:OrchestratorService) {}
  @Post('orchestrate')
  async orchestrate(@Body()body:unknown,@Req()req:IdentityRequest) {
    const request=bindOrchestrate(req.smokeService?null:requiredPrincipal(req),!!req.smokeService,body);
    const response=await this.orch.orchestrate(request);
    const {debug:_debug,...safe}=response;return safe;
  }
  @Post('tool-result')
  async toolResult(@Body()body:unknown,@Req()req:IdentityRequest) {
    if(!req.smokeService)fail('TOOL_RESULT_REQUIRES_QUALIFIED_EXECUTOR',403);
    const x=V.object(body,['version','requestId','userId','conversationId','results']);
    if(x.version!=='1.0'||!Array.isArray(x.results)||x.results.length!==1)return fail('SERVICE_SCOPE_DENIED',403);
    const r=V.object(x.results[0],['name','ok','data','error']);
    if(r.name!=='noop.test'||typeof r.ok!=='boolean')return fail('SERVICE_SCOPE_DENIED',403);
    // Existing callback is retained ONLY for the development noop smoke lane.
    // Receipt binding / dedupe for real tools is explicitly outside phase A.
    const request:ToolResultV1Dto={version:'1.0',requestId:V.text(x.requestId,64),...bindConversation(null,true,x.conversationId),results:[{name:'noop.test',ok:r.ok,data:{fixture:'bounded_noop_callback',unverifiedCallerDataNotPersisted:true}}]};
    const response=await this.orch.toolResult(request);const {debug:_debug,...safe}=response;return safe;
  }
  @Post('confirm')
  confirm() {
    // Do not make the legacy repeatable approval route production-accessible merely
    // because login now exists. Phase F will qualify exact-payload, one-use approval.
    fail('APPROVAL_RUNTIME_NOT_QUALIFIED',403);
  }
}
