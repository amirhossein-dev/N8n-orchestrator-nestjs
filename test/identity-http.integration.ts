/**
 * TARGET-ONLY HTTP + real JWT + PostgreSQL integration test.
 * NEVER run against the development/workflow database. Requires a pre-created,
 * EMPTY database whose name ends in _identity_test plus explicit opt-in.
 * This file was authored but NOT executed in the builder environment.
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { IdentityModule } from '../src/identity/identity.module';
import { IdentityPhaseA1791331200000 } from '../src/identity/migrations/1791331200000-IdentityPhaseA';
import { PgIdentityStore } from '../src/identity/pg-store';
import { provision, parseRoster } from '../src/identity/core/provision';
import { OrchestratorController } from '../src/orchestrator/orchestrator.controller';
import { OrchestratorService } from '../src/orchestrator/orchestrator.service';

async function main() {
  if(process.env.IDENTITY_TEST_OPT_IN!=='CREATE_IDENTITY_TABLES_IN_EMPTY_TEST_DATABASE')throw new Error('EXPLICIT_TEST_OPT_IN_REQUIRED');
  const db=new URL(process.env.IDENTITY_TEST_DATABASE_URL||'');
  if(!['postgres:','postgresql:'].includes(db.protocol)||!/^\/[a-zA-Z0-9_]+_identity_test$/.test(db.pathname)||!['localhost','127.0.0.1'].includes(db.hostname))throw new Error('REQUIRES_LOCAL_DISPOSABLE_IDENTITY_TEST_DATABASE');
  const code=String(Math.floor(100000+Math.random()*900000)); // test fixture only; production uses crypto.randomInt
  const origin='https://app.example.test';const smokeKey=randomBytes(32).toString('base64url');
  Object.assign(process.env,{NODE_ENV:'test',AUTH_JWT_SECRET:randomBytes(32).toString('base64url'),AUTH_TOKEN_PEPPER:randomBytes(32).toString('base64url'),AUTH_WEB_ORIGINS:origin,AUTH_ALLOW_INSECURE_DEV:'true',AUTH_OTP_MODE:'development_test',AUTH_DEV_OTP:code,AUTH_SMOKE_SERVICE_KEY:smokeKey});
  const opts={type:'postgres' as const,url:db.toString(),entities:[],synchronize:false,logging:false};
  const setup=new DataSource({...opts,migrations:[IdentityPhaseA1791331200000],migrationsTableName:'identity_migrations'});
  await setup.initialize();
  try {
    const tables=await setup.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    if(tables.length)throw new Error('TEST_DATABASE_MUST_BE_EMPTY: no existing table will be dropped');
    await setup.runMigrations({transaction:'all'});
    await provision(new PgIdentityStore(setup),parseRoster({tenant:{slug:'enterprise-pilot',name:'Synthetic test tenant',status:'active',enterprise:true},members:[{phone:'+15550001001',firstName:'Synthetic',lastName:'Only',roles:['operator'],status:'active'},{phone:'+15550001002',firstName:'Synthetic',lastName:'Two',roles:['reviewer'],status:'active'}]}),true,'target-http-integration');
  } finally {await setup.destroy();}
  let observed:Record<string,unknown>|null=null;
  const fakeOrchestrator={orchestrate:async(body:Record<string,unknown>)=>{observed=body;return {version:'1.0',type:'reply',requestId:body.requestId,replyText:'Synthetic route reply',debug:{mustNotLeak:true}};},toolResult:async(body:Record<string,unknown>)=>({version:'1.0',type:'reply',requestId:body.requestId,replyText:'Synthetic callback reply'})};
  const module=await Test.createTestingModule({imports:[TypeOrmModule.forRoot(opts),IdentityModule],controllers:[OrchestratorController],providers:[{provide:OrchestratorService,useValue:fakeOrchestrator}]}).compile();
  const app=module.createNestApplication();await app.init();const server=app.getHttpServer();let checks=0;
  const pass=()=>{checks++;};
  try {
    await request(server).get('/identity/me').expect(401);pass();
    await request(server).post('/identity/otp/request').send({phone:'+15550001001',tenant:'enterprise-pilot',client:'web'}).expect(403);pass();
    await request(server).post('/identity/otp/request').set('Origin',origin).send({phone:'+15550001001',tenant:'enterprise-pilot',client:'native'}).expect(403);pass();
    const c=await request(server).post('/identity/otp/request').set('Origin',origin).send({phone:'+15550001001',tenant:'enterprise-pilot',client:'web',deviceName:'Integration web'}).expect(201);
    const loginBody={challengeId:c.body.challengeId,code,firstName:'Name',lastName:'Test',client:'web'};
    const signed=await request(server).post('/identity/otp/verify').set('Origin',origin).send(loginBody).expect(201);
    assert.equal('accessToken' in signed.body,false);assert.equal('cookieToken' in signed.body,false);pass();
    const header=(signed.headers['set-cookie'] as unknown as string[])[0];assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Lax/);const cookie=header.split(';')[0];pass();
    await request(server).post('/identity/otp/verify').set('Origin',origin).send(loginBody).expect(401);pass();
    const me=await request(server).get('/identity/me').set('Cookie',cookie).expect(200);assert.equal(me.body.entitlements.enterprise,true);pass();
    await request(server).post('/identity/logout').set('Cookie',cookie).set('Origin',origin).send({}).expect(403);pass();
    const envelope={version:'1.0',requestId:randomUUID(),userId:'victim',channel:'telegram',conversationId:'same',text:'Hello',meta:{admin:true}};
    const out=await request(server).post('/orchestrate').set('Cookie',cookie).set('Origin',origin).set('X-DARA-CSRF',me.body.csrfToken).send(envelope).expect(201);
    assert.equal('debug' in out.body,false);assert.notEqual(observed!['userId'],'victim');assert.equal(observed!['channel'],'web');pass();
    await request(server).post('/tool-result').set('Cookie',cookie).set('Origin',origin).set('X-DARA-CSRF',me.body.csrfToken).send({}).expect(403);pass();
    await request(server).post('/confirm').set('Cookie',cookie).set('Origin',origin).set('X-DARA-CSRF',me.body.csrfToken).send({}).expect(403);pass();
    await request(server).post('/orchestrate').set('X-DARA-Smoke-Key',smokeKey).send({...envelope,text:'remember secret'}).expect(403);pass();
    const callback={version:'1.0',requestId:'r'.repeat(64),conversationId:'chat',results:[{name:'noop.test',ok:true}]};
    await request(server).post('/tool-result').set('X-DARA-Smoke-Key',smokeKey).send(callback).expect(201);pass();
    await request(server).post('/tool-result').set('X-DARA-Smoke-Key',smokeKey).send({...callback,requestId:'r'.repeat(65)}).expect(400);pass();
    await request(server).post('/identity/logout').set('Cookie',cookie).set('Origin',origin).set('X-DARA-CSRF',me.body.csrfToken).send({}).expect(201);
    await request(server).get('/identity/me').set('Cookie',cookie).expect(401);pass();
    const n=await request(server).post('/identity/otp/request').send({phone:'+15550001002',tenant:'enterprise-pilot',client:'native',deviceName:'Integration native'}).expect(201);
    const native=await request(server).post('/identity/otp/verify').send({challengeId:n.body.challengeId,code,firstName:'Native',lastName:'Test',client:'native'}).expect(201);
    const token=native.body.accessToken;assert.equal(token.split('.').length,3);
    await request(server).get('/identity/me').set('Authorization',`Bearer ${token}`).expect(200);pass();
    const parts=token.split('.');parts[1]=Buffer.from(JSON.stringify({sub:'victim'})).toString('base64url');
    await request(server).get('/identity/me').set('Authorization',`Bearer ${parts.join('.')}`).expect(401);pass();
    const refreshed=await request(server).post('/identity/refresh').send({refreshToken:native.body.refreshToken}).expect(201);pass();
    await request(server).post('/identity/refresh').send({refreshToken:native.body.refreshToken}).expect(401);
    await request(server).get('/identity/me').set('Authorization',`Bearer ${refreshed.body.accessToken}`).expect(401);pass();
    console.log(JSON.stringify({status:'TARGET_HTTP_IDENTITY_TEST_PASSED',checks,realJwt:true,realPostgresql:true,smsSent:false,orchestratorBusinessLogic:'mocked',nativeSecureStoreTested:false}));
  } finally {await app.close();}
}
main().catch(()=>{console.error('TARGET_HTTP_IDENTITY_TEST_FAILED. Inspect test assertions/config locally; no request tokens are printed. The dedicated test DB is retained, not deleted.');process.exitCode=1;});
