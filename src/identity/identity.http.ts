import { ArgumentsHost, Body, CanActivate, Catch, Controller, Delete, ExceptionFilter, ExecutionContext, Get, Inject, Injectable, Param, Post, Req, Res, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { IdentityConfig } from './core/config';
import { IdentityEngine } from './core/engine';
import { ClientType, IdentityError, Principal, fail } from './core/model';
import { assertCsrf, assertOrigin, equal, readCookie } from './core/security';
import * as V from './core/validation';

export const IdentityPublic=()=>SetMetadata('identity.public',true);
export const IdentityPermission=(permission:string)=>SetMetadata('identity.permission',permission);
export interface IdentityRequest extends Request { principal?:Principal; smokeService?:true; }
const CFG='DARA_IDENTITY_CONFIG';
const SAFE=new Set(['GET','HEAD','OPTIONS']);
function header(req:Request,name:string):string|undefined { const value=req.headers[name];return typeof value==='string'?value:undefined; }
export function requiredPrincipal(req:IdentityRequest):Principal { if(!req.principal)return fail('AUTHENTICATION_REQUIRED',401);return req.principal; }
function requestIp(req:Request) { return req.ip || req.socket.remoteAddress || 'unknown'; }
@Injectable()
export class IdentityGuard implements CanActivate {
  constructor(private readonly reflector:Reflector,private readonly identity:IdentityEngine,@Inject(CFG)private readonly config:IdentityConfig) {}
  async canActivate(ctx:ExecutionContext):Promise<boolean> {
    if(this.reflector.getAllAndOverride<boolean>('identity.public',[ctx.getHandler(),ctx.getClass()]))return true;
    const req=ctx.switchToHttp().getRequest<IdentityRequest>();
    const origin=header(req,'origin');
    const service=header(req,'x-dara-smoke-key');
    if(service && this.config.smokeKey && equal(service,this.config.smokeKey)) {
      if(origin!==undefined || !['/orchestrate','/tool-result'].includes(req.path) || req.method!=='POST')fail('SERVICE_SCOPE_DENIED',403);
      req.smokeService=true;return true;
    }
    const auth=header(req,'authorization');const cookie=readCookie(header(req,'cookie'),this.config.cookieName);
    if(auth && cookie)fail('AMBIGUOUS_AUTHENTICATION',401);
    if(auth) {
      assertOrigin(this.config,origin,'native',!SAFE.has(req.method));
      if(!auth.startsWith('Bearer '))fail('INVALID_ACCESS_TOKEN',401);
      req.principal=await this.identity.authenticateNative(auth.slice(7));
    } else if(cookie) {
      assertOrigin(this.config,origin,'web',!SAFE.has(req.method));
      req.principal=await this.identity.authenticateWeb(cookie);
      if(!SAFE.has(req.method))assertCsrf(this.config,req.principal.session.id,header(req,'x-dara-csrf'));
    } else fail('AUTHENTICATION_REQUIRED',401);
    const permission=this.reflector.getAllAndOverride<string>('identity.permission',[ctx.getHandler(),ctx.getClass()]);
    if(permission && !this.identity.publicView(requiredPrincipal(req)).permissions.includes(permission))fail('PERMISSION_DENIED',403);
    return true;
  }
}
@Catch(IdentityError)
export class IdentityErrorFilter implements ExceptionFilter {
  catch(error:IdentityError,host:ArgumentsHost) {
    const response=host.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control','no-store');
    response.status(error.status).json({error:error.code});
  }
}
@Controller('identity')
export class IdentityController {
  constructor(private readonly identity:IdentityEngine,@Inject(CFG)private readonly config:IdentityConfig) {}
  @IdentityPublic() @Get('config')
  configView() {return {otpMode:this.config.otpMode==='development_test'?'development_test':this.config.otpMode==='disabled'?'disabled':'sms',maxActiveSessions:this.config.maxSessions,paymentsEnabled:false};}
  @IdentityPublic() @Post('otp/request')
  requestOtp(@Body()body:unknown,@Req()req:IdentityRequest) {
    const x=V.object(body,['phone','tenant','client','deviceName']);
    assertOrigin(this.config,header(req,'origin'),V.client(x.client),true);
    return this.identity.requestOtp(x,requestIp(req));
  }
  @IdentityPublic() @Post('otp/verify')
  async verify(@Body()body:unknown,@Req()req:IdentityRequest,@Res({passthrough:true})res:Response) {
    const x=V.object(body,['challengeId','code','firstName','lastName','client']);
    const transport=V.client(x.client);assertOrigin(this.config,header(req,'origin'),transport,true);
    const result=await this.identity.verifyOtp(x,requestIp(req));
    if('cookieToken' in result) {
      res.cookie(this.config.cookieName,result.cookieToken,{httpOnly:true,secure:this.config.secureCookies,sameSite:'lax',path:'/',maxAge:this.config.absoluteMs});
      const {cookieToken: _secret,...view}=result;return view;
    }
    return result;
  }
  @IdentityPublic() @Post('refresh')
  refresh(@Body()body:unknown,@Req()req:IdentityRequest) {
    assertOrigin(this.config,header(req,'origin'),'native',true);
    if(readCookie(header(req,'cookie'),this.config.cookieName))fail('AMBIGUOUS_AUTHENTICATION',401);
    return this.identity.refreshNative(body,requestIp(req));
  }
  @Get('me') me(@Req()req:IdentityRequest) {return this.identity.publicView(requiredPrincipal(req));}
  @Get('sessions') sessions(@Req()req:IdentityRequest) {return this.identity.listSessions(requiredPrincipal(req));}
  @Delete('sessions/:id') async revoke(@Param('id')id:string,@Req()req:IdentityRequest,@Res({passthrough:true})res:Response) {
    const p=requiredPrincipal(req);await this.identity.revoke(p,id);if(id===p.session.id)this.clear(res,p.session.client);return {revoked:true};
  }
  @Post('logout') async logout(@Req()req:IdentityRequest,@Res({passthrough:true})res:Response) {
    const p=requiredPrincipal(req);await this.identity.revoke(p,p.session.id);this.clear(res,p.session.client);return {revoked:true};
  }
  @Post('logout-all') async logoutAll(@Req()req:IdentityRequest,@Res({passthrough:true})res:Response) {
    const p=requiredPrincipal(req);await this.identity.logoutAll(p);this.clear(res,p.session.client);return {revoked:true};
  }
  private clear(res:Response,client:ClientType) {if(client==='web')res.clearCookie(this.config.cookieName,{httpOnly:true,secure:this.config.secureCookies,sameSite:'lax',path:'/'});}
}
