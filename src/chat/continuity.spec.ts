import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { randomBytes, randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { dbConnection } from '../identity/db-options';
import { IdentityPhaseA1791331200000 } from '../identity/migrations/1791331200000-IdentityPhaseA';
import { PgIdentityStore } from '../identity/pg-store';
import { IdentityEngine } from '../identity/core/engine';
import { loadIdentityConfig } from '../identity/core/config';
import { AccessClaims, AccessTokens, Principal } from '../identity/core/model';
import { parseRoster, provision } from '../identity/core/provision';
import { IdentityErrorFilter, IdentityGuard } from '../identity/identity.http';
import { ConversationContinuity1792108800000 } from './migrations/1792108800000-ConversationContinuity';
import { ContinuityService } from './continuity.service';
import { ContinuityController } from './continuity.controller';
import { ChatService } from './chat.service';
import { ChatError } from './chat.error';
import { loadChatConfig } from './chat.config';

function deferred<T>() { let resolve!: (value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve}; }

describe('Conversation continuity on isolated PostgreSQL; fake provider only', () => {
  let db:DataSource,db2:DataSource,engine:IdentityEngine,service:ContinuityService,otherProcess:ContinuityService,app:INestApplication;
  let a:Principal,b:Principal,otherTenant:Principal,token:string,cookie:string,csrf:string;
  let info:jest.SpyInstance;
  const origin='https://continuity.example.test';
  const cfg=loadIdentityConfig({NODE_ENV:'test',AUTH_JWT_SECRET:randomBytes(32).toString('base64url'),AUTH_TOKEN_PEPPER:randomBytes(32).toString('base64url'),AUTH_WEB_ORIGINS:origin,AUTH_ALLOW_INSECURE_DEV:'true',AUTH_OTP_MODE:'development_test',AUTH_DEV_OTP:'817294'});
  const chatConfig=loadChatConfig({});
  const fake={reply:jest.fn()};
  const created:string[]=[];
  const create=async(p=a)=>{const result=await service.create(p,{clientRequestId:randomUUID()});created.push(result.conversation.id);return result.conversation.id;};
  const send=(id:string,text='Synthetic input',key=randomUUID())=>service.send(a,id,{clientRequestId:key,text});
  beforeAll(async()=>{
    if(process.env.NODE_ENV!=='test'||!/^dara_b2_test_[a-z0-9_]+$/.test(process.env.DB_NAME||''))throw Error('ISOLATED_TEST_DATABASE_REQUIRED');
    db=new DataSource({...dbConnection(),entities:[],synchronize:false,migrations:[IdentityPhaseA1791331200000,ConversationContinuity1792108800000],migrationsTableName:'b2_test_migrations',logging:false});
    await db.initialize();
    expect((await db.query('SELECT current_database() name'))[0].name).toBe(process.env.DB_NAME);
    await db.runMigrations({transaction:'all'});
    db2=new DataSource({...dbConnection(),entities:[],synchronize:false,logging:false});await db2.initialize();
    const jwt=new JwtService();
    const tokens:AccessTokens={
      sign:(sub,sid,now,ttl)=>jwt.signAsync({sub,sid,typ:'native_access',iat:Math.floor(now/1000),exp:Math.floor(now/1000)+ttl},{secret:cfg.jwtSecret,algorithm:'HS256',issuer:cfg.issuer,audience:cfg.audience}),
      verify:(raw,now)=>jwt.verifyAsync<AccessClaims>(raw,{secret:cfg.jwtSecret,algorithms:['HS256'],issuer:cfg.issuer,audience:cfg.audience,clockTimestamp:Math.floor(now/1000),maxAge:cfg.accessSeconds})
    };
    const store=new PgIdentityStore(db);
    engine=new IdentityEngine(store,cfg,tokens,{send:async()=>{throw Error('NO_SMS');}});
    const suffix=randomBytes(4).toString('hex');
    const phones=['+1555'+String(Date.now()).slice(-7),'+1556'+String(Date.now()).slice(-7)];
    for(const slug of ['a-'+suffix,'b-'+suffix])await provision(store,parseRoster({tenant:{slug,name:'Synthetic B2',status:'active',enterprise:true},members:phones.map(phone=>({phone,firstName:'Synthetic',lastName:'B2',roles:['tenant_admin'],status:'active'}))}),true,'b2-test');
    async function login(phone:string,tenant:string,client:'native'|'web') {
      const c=await engine.requestOtp({phone,tenant,client,deviceName:'Synthetic B2'},'192.0.2.'+(10+Math.floor(Math.random()*200)));
      return engine.verifyOtp({challengeId:c.challengeId,code:cfg.devOtp,firstName:'Synthetic',lastName:'B2',client},'192.0.2.20');
    }
    const first=await login(phones[0],'a-'+suffix,'native');
    if(!('accessToken' in first))throw Error('NATIVE_REQUIRED');token=first.accessToken;a=await engine.authenticateNative(token);
    const second=await login(phones[1],'a-'+suffix,'native');
    if(!('accessToken' in second))throw Error('NATIVE_REQUIRED');b=await engine.authenticateNative(second.accessToken);
    // Test-only cooldown reset for this isolated synthetic fixture, not runtime TTL configuration.
    await db.query('DELETE FROM identity_rate_limits');
    const third=await login(phones[1],'b-'+suffix,'native');
    if(!('accessToken' in third))throw Error('NATIVE_REQUIRED');otherTenant=await engine.authenticateNative(third.accessToken);
    await db.query('DELETE FROM identity_rate_limits');
    const web=await login(phones[0],'a-'+suffix,'web');
    if(!('cookieToken' in web))throw Error('WEB_REQUIRED');cookie=cfg.cookieName+'='+web.cookieToken;csrf=web.csrfToken!;
    const chat=new ChatService(chatConfig,fake);
    service=new ContinuityService(db,engine,chat,chatConfig);
    otherProcess=new ContinuityService(db2,engine,chat,chatConfig);
    const module=await Test.createTestingModule({controllers:[ContinuityController],providers:[{provide:ContinuityService,useValue:service},{provide:IdentityEngine,useValue:engine},{provide:'DARA_IDENTITY_CONFIG',useValue:cfg},{provide:APP_GUARD,useClass:IdentityGuard},{provide:APP_FILTER,useClass:IdentityErrorFilter}]}).compile();
    app=module.createNestApplication({logger:false});
    app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true,validationError:{target:false,value:false}}));
    await app.init();
  });
  beforeEach(()=>{fake.reply.mockReset().mockResolvedValue({replyText:'SYNTHETIC_REPLY',usage:{outputTokens:3}});info=jest.spyOn(console,'info').mockImplementation(()=>undefined);});
  afterEach(()=>info.mockRestore());
  afterAll(async()=>{await app?.close();if(db2?.isInitialized)await db2.destroy();if(db?.isInitialized)await db.destroy();});

  it('applies additive migrations once and rejects destructive rollback',async()=>{
    expect(await db.runMigrations()).toEqual([]);
    await expect(new ConversationContinuity1792108800000().down()).rejects.toThrow('DELETION_REQUIRES_OPERATOR_PLAN');
    const rows=await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'chat_%'");
    expect(rows.map((r:{tablename:string})=>r.tablename).sort()).toEqual(['chat_conversations','chat_messages','chat_turns']);
  });
  it('CC01 rejects unauthenticated list/read/status/send and Web writes without CSRF',async()=>{
    const id=await create(),key=randomUUID();
    for(const path of ['/chat/conversations',`/chat/conversations/${id}/messages`,`/chat/conversations/${id}/requests/${key}`])await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer()).post(`/chat/conversations/${id}/messages`).send({clientRequestId:key,text:'Synthetic'}).expect(401);
    await request(app.getHttpServer()).post('/chat/conversations').set('Cookie',cookie).set('Origin',origin).send({clientRequestId:key}).expect(403);
    await request(app.getHttpServer()).post('/chat/conversations').set('Cookie',cookie).set('Origin',origin).set('X-DARA-CSRF',csrf).send({clientRequestId:key}).expect(201);
    expect(fake.reply).not.toHaveBeenCalled();
  });
  it('accepts paginated HTTP queries through the actual global ValidationPipe', async()=>{
    const id=await create();
    const list=await request(app.getHttpServer()).get('/chat/conversations?limit=30').set('Authorization','Bearer '+token);
    expect(list.body).not.toHaveProperty('error');expect(list.status).toBe(200);
    const messages=await request(app.getHttpServer()).get(`/chat/conversations/${id}/messages?limit=30`).set('Authorization','Bearer '+token);
    expect(messages.body).not.toHaveProperty('error');expect(messages.status).toBe(200);
    for (const path of ['/chat/conversations',`/chat/conversations/${id}/messages`]) {
      await request(app.getHttpServer()).get(path+'?limit=30&_=1792098000000').set('Authorization','Bearer '+token).expect(200);
      await request(app.getHttpServer()).get(path+'?limit=30&_=bad').set('Authorization','Bearer '+token).expect(400);
      await request(app.getHttpServer()).get(path+'?limit=30&_=1&_=2').set('Authorization','Bearer '+token).expect(400);
      await request(app.getHttpServer()).get(path+'?limit=30&owner=any').set('Authorization','Bearer '+token).expect(400);
    }
  });
  it('CC01 membership suspension blocks all operations, even an already admitted principal',async()=>{
    const id=await create();
    await db.query("UPDATE identity_memberships SET status='suspended' WHERE id=$1",[a.membership.id]);
    try {
      for(const work of [()=>service.list(a,{}),()=>service.messages(a,id,{}),()=>send(id),()=>service.status(a,id,randomUUID())])await expect(work()).rejects.toMatchObject({status:401});
      expect(fake.reply).not.toHaveBeenCalled();
    } finally {
      await db.query("UPDATE identity_memberships SET status='active' WHERE id=$1",[a.membership.id]);
      await db.query('UPDATE identity_sessions SET revoked_at=NULL,revoke_reason=NULL WHERE id=$1',[a.session.id]);
    }
  });
  it('CC02 private owner/tenant scope applies to known IDs, including admin roles',async()=>{
    const id=await create(),key=randomUUID();await send(id,'Synthetic A',key);fake.reply.mockClear();
    for(const p of [b,otherTenant]) {
      expect((await service.list(p,{})).conversations.some(c=>c.id===id)).toBe(false);
      for(const work of [()=>service.messages(p,id,{}),()=>service.status(p,id,key),()=>service.send(p,id,{clientRequestId:randomUUID(),text:'denied'})])await expect(work()).rejects.toMatchObject({status:404});
    }
    await expect(service.messages(a,randomUUID(),{})).rejects.toMatchObject({status:404});
    expect(fake.reply).not.toHaveBeenCalled();
  });
  it('CC03/04 committed messages and IDs are identical from another DB connection and same-account Web session; reads never infer',async()=>{
    const id=await create(),r=await send(id);fake.reply.mockClear();
    const reopened=await otherProcess.messages(a,id,{});
    expect(reopened.messages).toEqual(r.messages);
    const web=await request(app.getHttpServer()).get(`/chat/conversations/${id}/messages`).set('Cookie',cookie).set('Origin',origin).expect(200);
    expect(web.body.messages).toEqual(r.messages);expect(fake.reply).not.toHaveBeenCalled();
  });
  it('CC05 conversation creation key is idempotent under concurrent connections',async()=>{
    const key=randomUUID();const [x,y]=await Promise.all([service.create(a,{clientRequestId:key}),otherProcess.create(a,{clientRequestId:key})]);
    expect(x).toEqual(y);
    expect((await db.query('SELECT count(*)::int n FROM chat_conversations WHERE tenant_id=$1 AND owner_user_id=$2 AND client_request_id=$3',[a.tenant.id,a.user.id,key]))[0].n).toBe(1);
  });
  it('CC05 sequential key replay returns the same result; changed payload conflicts',async()=>{
    const id=await create(),key=randomUUID(),r=await send(id,'Synthetic exact text',key);
    expect(await send(id,'Synthetic exact text',key)).toEqual(r);
    await expect(send(id,'changed text',key)).rejects.toMatchObject({status:409});
    expect(fake.reply).toHaveBeenCalledTimes(1);
    expect((await service.messages(a,id,{})).messages).toHaveLength(2);
  });
  it('CC05/06 concurrent duplicates coalesce across connections, other keys are busy, and no SQL lock survives provider wait',async()=>{
    const id=await create(),key=randomUUID(),started=deferred<void>(),release=deferred<{replyText:string}>();
    fake.reply.mockImplementationOnce(()=>{started.resolve();return release.promise;});
    const first=send(id,'Synthetic race',key);await started.promise;
    try {
      const pending=await otherProcess.send(a,id,{clientRequestId:key,text:'Synthetic race'});expect(pending.status).toBe('pending');
      await expect(otherProcess.send(a,id,{clientRequestId:randomUUID(),text:'different'})).rejects.toMatchObject({status:409});
      await db2.transaction(async m=>{await m.query("SET LOCAL lock_timeout='150ms'");await m.query('SELECT id FROM chat_conversations WHERE id=$1 FOR UPDATE NOWAIT',[id]);});
      expect(fake.reply).toHaveBeenCalledTimes(1);
    } finally {release.resolve({replyText:'SYNTHETIC_DONE'});}
    expect((await first).status).toBe('completed');
    const counts=await db.query('SELECT role,count(*)::int n FROM chat_messages WHERE conversation_id=$1 GROUP BY role',[id]);
    expect(counts).toEqual(expect.arrayContaining([{role:'user',n:1},{role:'assistant',n:1}]));
  });
  it('CC06 stable keyset pagination has no duplicate messages or conversations when new data arrives',async()=>{
    const id=await create();for(let i=0;i<4;i++)await send(id,'Synthetic page '+i);
    const first=await service.messages(a,id,{limit:'3'});await send(id,'new arrival');
    const rest=[] as string[];let cursor=first.nextCursor;
    while(cursor){const p=await service.messages(a,id,{limit:'3',before:cursor});rest.push(...p.messages.map(m=>m.id));cursor=p.nextCursor;}
    const ids=[...first.messages.map(m=>m.id),...rest];expect(ids).toHaveLength(8);expect(new Set(ids).size).toBe(8);
    const c1=await service.list(a,{limit:'2'});await create();const c2=await service.list(a,{limit:'2',cursor:c1.nextCursor!});
    expect(c2.conversations.some(c=>c1.conversations.some(x=>x.id===c.id))).toBe(false);
  });
  it.each([['AI_PROVIDER_TIMEOUT','outcome_unknown'],['AI_PROVIDER_UNAVAILABLE','outcome_unknown'],['AI_PROVIDER_RATE_LIMITED','failed'],['AI_INVALID_RESPONSE','failed']] as const)('CC07 %s produces %s with no assistant or automatic retry',async(code,status)=>{
    const id=await create(),key=randomUUID();fake.reply.mockRejectedValueOnce(new ChatError(code));
    const r=await send(id,'Synthetic failure',key);expect(r.status).toBe(status);expect(r.error).toBe(code);expect(r.messages.map(m=>m.role)).toEqual(['user']);
    expect(await service.status(a,id,key)).toEqual(r);expect(await send(id,'Synthetic failure',key)).toEqual(r);expect(fake.reply).toHaveBeenCalledTimes(1);
  });
  it('CC07 stale pending closes once and an old late result cannot commit over the terminal state',async()=>{
    const id=await create(),key=randomUUID(),started=deferred<void>(),release=deferred<{replyText:string}>();
    fake.reply.mockImplementationOnce(()=>{started.resolve();return release.promise;});const first=send(id,'Synthetic stale',key);await started.promise;
    await db.query('UPDATE chat_turns SET started_at=$3::bigint-1000,deadline_at=$3::bigint WHERE conversation_id=$1 AND client_request_id=$2',[id,key,Date.now()-1]);
    const expired=await service.status(a,id,key);expect(expired.status).toBe('outcome_unknown');
    release.resolve({replyText:'MUST_NOT_COMMIT'});expect(await first).toEqual(expired);
    expect((await service.messages(a,id,{})).messages).toHaveLength(1);
    expect((await send(id,'Explicit separate request')).status).toBe('completed');
  });
  it('CC07 a response discarded by the client is recovered by GET without another inference',async()=>{
    const id=await create(),key=randomUUID();await send(id,'Synthetic lost acknowledgment',key);
    const recovered=await otherProcess.status(a,id,key);expect(recovered.status).toBe('completed');expect(recovered.messages).toHaveLength(2);expect(fake.reply).toHaveBeenCalledTimes(1);
  });
  it('CC07 revoking the original session during generation discards output and commits sanitized failure',async()=>{
    const id=await create(),key=randomUUID(),started=deferred<void>(),release=deferred<{replyText:string}>();
    fake.reply.mockImplementationOnce(()=>{started.resolve();return release.promise;});const response=send(id,'Synthetic revoke',key);const denial=expect(response).rejects.toMatchObject({status:401});await started.promise;
    await engine.revoke(a,a.session.id);release.resolve({replyText:'MUST_NOT_STORE'});await denial;
    const web=await request(app.getHttpServer()).get(`/chat/conversations/${id}/requests/${key}`).set('Cookie',cookie).set('Origin',origin).expect(200);
    expect(web.body.status).toBe('failed');expect(web.body.error).toBe('AUTHORIZATION_LOST');expect(web.body.messages.map((m:{role:string})=>m.role)).toEqual(['user']);
    await db.query('UPDATE identity_sessions SET revoked_at=NULL,revoke_reason=NULL WHERE id=$1',[a.session.id]);
  });
  it('CC08 context is DB-owned, bounded, ordered, excludes failed turns and includes the current input once',async()=>{
    const id=await create();for(let i=0;i<8;i++)await send(id,'Synthetic history '+i);
    fake.reply.mockRejectedValueOnce(new ChatError('AI_INVALID_RESPONSE'));await send(id,'FAILED_INPUT');
    await send(id,'CURRENT_INPUT');const input=fake.reply.mock.calls.at(-1)![0];
    expect(input.message).toBe('CURRENT_INPUT');expect(input.history).toHaveLength(12);expect(input.history[0].text).toBe('Synthetic history 2');
    expect(input.history.some((m:{text:string})=>['FAILED_INPUT','CURRENT_INPUT'].includes(m.text))).toBe(false);
    expect(Object.keys(input).sort()).toEqual(['history','message']);
    fake.reply.mockResolvedValue({replyText:'x'.repeat(4000)});for(let i=0;i<4;i++)await send(id,'y'.repeat(4000));await send(id,'bounded');
    const bounded=fake.reply.mock.calls.at(-1)![0];expect(bounded.history.reduce((n:number,m:{text:string})=>n+m.text.length,0)).toBeLessThanOrEqual(16000);
  });
  it('CC08 rejects client-supplied authority/history/system and malformed pagination without inference',async()=>{
    const id=await create();
    for(const field of ['history','system','owner','userId','tenantId','provider'])await expect(service.send(a,id,{clientRequestId:randomUUID(),text:'Synthetic',[field]:'forbidden'})).rejects.toMatchObject({status:400});
    for(const query of [{limit:'51'},{before:'-1'},{owner:a.user.id},{limit:['1','2']}])await expect(service.messages(a,id,query)).rejects.toMatchObject({status:400});
    expect(fake.reply).not.toHaveBeenCalled();
  });
  it('database constraints reject duplicate role, cross-conversation turn, and second pending turn',async()=>{
    const id=await create(),r=await send(id),other=await create();
    const insert=(conversation:string,role:string)=>db.query('INSERT INTO chat_messages(id,conversation_id,turn_id,role,text,message_order,created_at) VALUES($1,$2,$3,$4,$5,99,$6)',[randomUUID(),conversation,r.turnId,role,'Synthetic constraint',Date.now()]);
    await expect(insert(id,'user')).rejects.toMatchObject({code:'23505'});
    await expect(insert(other,'user')).rejects.toBeDefined();
    const started=deferred<void>(),release=deferred<{replyText:string}>();fake.reply.mockImplementationOnce(()=>{started.resolve();return release.promise;});const pending=send(id);await started.promise;
    try {await expect(db.query("INSERT INTO chat_turns(id,conversation_id,client_request_id,turn_order,payload_hash,attempt_id,status,started_at,deadline_at,context_message_ids) VALUES($1,$2,$3,999,$4,$5,'pending',1,2,'{}')",[randomUUID(),id,randomUUID(),'a'.repeat(64),randomUUID()])).rejects.toMatchObject({code:'23505'});}finally{release.resolve({replyText:'Synthetic constraint done'});await pending;}
  });
});
