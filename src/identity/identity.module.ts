import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { IdentityEngine } from './core/engine';
import { AccessClaims, AccessTokens, IdentityError, OtpDelivery } from './core/model';
import { loadIdentityConfig, IdentityConfig } from './core/config';
import { PgIdentityStore } from './pg-store';
import { IdentityController, IdentityErrorFilter, IdentityGuard } from './identity.http';
export const IDENTITY_CONFIG = 'DARA_IDENTITY_CONFIG';
// Config token is a literal in identity.http to avoid a circular module dependency.
@Global()
@Module({
  imports:[JwtModule.register({})], controllers:[IdentityController],
  providers:[
    {provide:IDENTITY_CONFIG,useFactory:()=>loadIdentityConfig()},
    {provide:IdentityEngine,inject:[DataSource,JwtService,IDENTITY_CONFIG],useFactory:(ds:DataSource,jwt:JwtService,cfg:IdentityConfig)=>{
      const tokens:AccessTokens={
        sign:(sub,sid,now,ttl)=>jwt.signAsync({sub,sid,typ:'native_access',iat:Math.floor(now/1000),exp:Math.floor(now/1000)+ttl},{secret:cfg.jwtSecret,algorithm:'HS256',issuer:cfg.issuer,audience:cfg.audience}),
        verify:(raw,now)=>jwt.verifyAsync<AccessClaims>(raw,{secret:cfg.jwtSecret,algorithms:['HS256'],issuer:cfg.issuer,audience:cfg.audience,clockTimestamp:Math.floor(now/1000),maxAge:cfg.accessSeconds}),
      };
      const delivery:OtpDelivery={send:async(phone,code,ttlSeconds)=>{
        if(cfg.otpMode!=='http_gateway'||!cfg.smsUrl||!cfg.smsToken)throw new IdentityError('OTP_DELIVERY_NOT_CONFIGURED',503);
        const response=await fetch(cfg.smsUrl,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10_000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${cfg.smsToken}`},body:JSON.stringify({phone,code,ttlSeconds})});
        if(!response.ok)throw new IdentityError('OTP_DELIVERY_UNAVAILABLE',503);
        // Gateway contract: 2xx means accepted for delivery, not proof of phone ownership.
        await response.body?.cancel();
      }};
      return new IdentityEngine(new PgIdentityStore(ds),cfg,tokens,delivery);
    }},
    {provide:APP_GUARD,useClass:IdentityGuard},
    {provide:APP_FILTER,useClass:IdentityErrorFilter},
  ],exports:[IdentityEngine,IDENTITY_CONFIG],
})
export class IdentityModule {}
