import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { loadIdentityConfig } from './identity/core/config';

async function bootstrap() {
  const cfg=loadIdentityConfig();
  const app=await NestFactory.create(AppModule,{bodyParser:true});
  // Deliberately DO NOT trust arbitrary X-Forwarded-* headers. Configure a reviewed
  // exact proxy topology separately. Shared proxy IPs can share OTP rate limits.
  app.enableCors({origin:cfg.webOrigins,credentials:true,methods:['GET','POST','DELETE','OPTIONS'],allowedHeaders:['Content-Type','Authorization','X-DARA-CSRF']});
  app.use((req:Request,res:Response,next:NextFunction)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');next();
  });
  app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true,validationError:{target:false,value:false}}));
  await app.listen(Number(process.env.PORT||3000),process.env.APP_HOST||'127.0.0.1');
}
bootstrap().catch(()=>{console.error('BOOT_FAILED: inspect configuration and database availability; secrets are not logged.');process.exitCode=1;});
