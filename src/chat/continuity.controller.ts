import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IdentityPermission, requiredPrincipal } from '../identity/identity.http';
import type { IdentityRequest } from '../identity/identity.http';
import { ContinuityService } from './continuity.service';

@Controller('chat/conversations')
@IdentityPermission('conversation.use')
export class ContinuityController {
  constructor(private readonly service:ContinuityService) {}
  @Post() create(@Req()req:IdentityRequest,@Body()body:unknown) {return this.service.create(requiredPrincipal(req),body);}
  @Get() list(@Req()req:IdentityRequest,@Query()query:unknown) {return this.service.list(requiredPrincipal(req),query);}
  @Get(':id/messages') messages(@Req()req:IdentityRequest,@Param('id')id:string,@Query()query:unknown) {return this.service.messages(requiredPrincipal(req),id,query);}
  @Get(':id/requests/:key') status(@Req()req:IdentityRequest,@Param('id')id:string,@Param('key')key:string) {return this.service.status(requiredPrincipal(req),id,key);}
  @Post(':id/messages') async send(@Req()req:IdentityRequest,@Param('id')id:string,@Body()body:unknown,@Res({passthrough:true})res:Response) {
    const result=await this.service.send(requiredPrincipal(req),id,body);
    res.status(result.status==='pending'?202:200);return result;
  }
}
