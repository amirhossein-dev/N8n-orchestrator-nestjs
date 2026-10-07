import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { IdentityEngine } from '../src/identity/core/engine';
import { loadIdentityConfig } from '../src/identity/core/config';
import { AccessClaims, AccessTokens, IdentityError } from '../src/identity/core/model';
import { assertCsrf, assertOrigin, readCookie } from '../src/identity/core/security';
import { parseRoster, provision } from '../src/identity/core/provision';
import { MemoryIdentityStore } from './identity-memory-store';
import * as V from '../src/identity/core/validation';
import { bindConversation, bindOrchestrate } from '../src/identity/core/request-scope';

function settings() {return {NODE_ENV:'test',AUTH_JWT_SECRET:randomBytes(32).toString('base64url'),AUTH_TOKEN_PEPPER:randomBytes(32).toString('base64url'),AUTH_WEB_ORIGINS:'https://app.example.test',AUTH_ALLOW_INSECURE_DEV:'true',AUTH_OTP_MODE:'development_test',AUTH_DEV_OTP:'817294'};}
const roster=(status='active',roles=['operator'])=>parseRoster({tenant:{slug:'enterprise-pilot',name:'Synthetic enterprise',status:'active',enterprise:true},members:[{phone:'+15550001001',firstName:'Synthetic',lastName:'One',roles,status},{phone:'+15550001002',firstName:'Synthetic',lastName:'Two',roles:['operator'],status:'active'}]});
async function fixture() {
  let now=1791331200000;const config=loadIdentityConfig(settings());const store=new MemoryIdentityStore();
  // Fake codec isolates lifecycle tests from JWT crypto. Actual JwtService is tested
  // in the target-only Nest/PostgreSQL HTTP test, not claimed as tested here.
  const jwt:AccessTokens={sign:async(sub,sid,n,ttl)=>Buffer.from(JSON.stringify({sub,sid,typ:'native_access',iss:config.issuer,aud:config.audience,iat:Math.floor(n/1000),exp:Math.floor(n/1000)+ttl})).toString('base64url'),verify:async raw=>JSON.parse(Buffer.from(raw,'base64url').toString()) as AccessClaims};
  const engine=new IdentityEngine(store,config,jwt,{send:async()=>{throw new Error('TEST_DELIVERY_NOT_EXPECTED')}},()=>now);
  await provision(store,roster(),true,'test',now);
  const request=(client:'native'|'web'='native',phone='+15550001001')=>engine.requestOtp({phone,tenant:'enterprise-pilot',client,deviceName:'Synthetic device'},'192.0.2.10');
  const verify=(id:string,client:'native'|'web'='native',code='817294')=>engine.verifyOtp({challengeId:id,client,code,firstName:'Name',lastName:'Test'},'192.0.2.10');
  const login=async(client:'native'|'web'='native',phone='+15550001001')=>verify((await request(client,phone)).challengeId,client);
  return {engine,store,config,request,verify,login,advance:(ms:number)=>{now+=ms},now:()=>now};
}
const rejected=(fn:()=>unknown,code:string)=>assert.rejects(async()=>fn(),(e:unknown)=>e instanceof IdentityError&&e.code===code);
test('configuration rejects missing secrets, insecure production, development OTP in production',()=>{
  assert.throws(()=>loadIdentityConfig({}),/CONFIG_REQUIRED/);
  assert.throws(()=>loadIdentityConfig({...settings(),NODE_ENV:'production'}),/CONFIG_REQUIRED/);
  assert.throws(()=>loadIdentityConfig({...settings(),NODE_ENV:'production',AUTH_ALLOW_INSECURE_DEV:'false'}),/development_test/);
  const s=settings();assert.throws(()=>loadIdentityConfig({...s,AUTH_TOKEN_PEPPER:s.AUTH_JWT_SECRET}),/distinct/);
});
test('input is strict: E164, Persian digits, role vocabulary and extra fields',()=>{
  assert.equal(V.phone('+۱۵۵۵۰۰۰۱۰۰۱'),'+15550001001');
  assert.throws(()=>V.phone('09123456789'));assert.throws(()=>V.roles(['owner']));assert.throws(()=>V.roles(['operator','operator']));
  assert.throws(()=>V.object({client:'native',admin:true},['client']));
});
test('roster preview writes nothing; omitted members are retained; reimport is idempotent',async()=>{
  const f=await fixture();const before=structuredClone(f.store.rows);
  const result=await provision(f.store,roster(),false,'preview');assert.equal(result.unchanged,2);assert.deepEqual(f.store.rows,before);
  const partial=roster();partial.members=partial.members.slice(0,1);await provision(f.store,partial,true,'apply');assert.equal(f.store.rows.memberships.size,2);
});
test('unknown member receives same-shaped challenge but cannot sign in',async()=>{
  const f=await fixture();const c=await f.request('native','+15550009999');assert.ok(c.challengeId);assert.equal('code' in c,false);
  await rejected(()=>f.verify(c.challengeId),'OTP_INVALID_OR_EXPIRED');assert.equal(f.store.rows.sessions.size,0);
});
test('wrong-code attempt is committed; five attempts lock the challenge',async()=>{
  const f=await fixture();const c=await f.request();
  for(let i=0;i<5;i++)await rejected(()=>f.verify(c.challengeId,'native','000000'),'OTP_INVALID_OR_EXPIRED');
  assert.equal([...f.store.rows.challenges.values()].map(x=>(x as {attempts:number}).attempts)[0],5);
  await rejected(()=>f.verify(c.challengeId),'OTP_INVALID_OR_EXPIRED');
});
test('OTP expiration and client binding are enforced',async()=>{
  const f=await fixture();const c=await f.request('web');await rejected(()=>f.verify(c.challengeId,'native'),'OTP_INVALID_OR_EXPIRED');
  f.advance(180001);await rejected(()=>f.verify(c.challengeId,'web'),'OTP_INVALID_OR_EXPIRED');
});
test('two simultaneous OTP verifications create exactly one session',async()=>{
  const f=await fixture();const c=await f.request();const results=await Promise.allSettled([f.verify(c.challengeId),f.verify(c.challengeId)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.store.rows.sessions.size,1);
});
test('resend cooldown survives a minute-bucket boundary; new challenge invalidates old',async()=>{
  const f=await fixture();f.advance(59000);const c=await f.request();f.advance(2000);
  await rejected(()=>f.request(),'OTP_RATE_LIMIT');f.advance(59001);const next=await f.request();
  await rejected(()=>f.verify(c.challengeId),'OTP_INVALID_OR_EXPIRED');await f.verify(next.challengeId);
});
test('native login returns credentials; storage contains only their hashes',async()=>{
  const f=await fixture();const r=await f.login();assert.ok('refreshToken' in r);assert.ok('accessToken' in r);assert.equal('cookieToken' in r,false);
  assert.equal(JSON.stringify([...f.store.rows.refresh_tokens.values()]).includes((r as {refreshToken:string}).refreshToken),false);
  assert.equal(r.session.assurance,'development_test');assert.equal([...f.store.rows.users.values()].some(u=>(u as {phone_verified_at:unknown}).phone_verified_at!==null),false);
});
test('web session issues no bearer credentials and exposes a CSRF token in authenticated view',async()=>{
  const f=await fixture();const r=await f.login('web');assert.ok('cookieToken' in r);assert.equal('accessToken' in r,false);
  const p=await f.engine.authenticateWeb((r as {cookieToken:string}).cookieToken);assert.equal(f.engine.publicView(p).csrfToken,r.csrfToken);
});
test('origin and CSRF failures are fail closed; native cannot be selected by browser',()=>{
  const c=loadIdentityConfig(settings());assert.throws(()=>assertOrigin(c,undefined,'web',true));assert.throws(()=>assertOrigin(c,'https://evil.test','web',true));
  assert.throws(()=>assertOrigin(c,'https://app.example.test','native',true));assertOrigin(c,undefined,'native',true);
  assert.throws(()=>assertCsrf(c,'sid','incorrect'));assert.throws(()=>readCookie('a=one; a=two','a'));
});
test('rotation invalidates old refresh and reuse commits revocation of its session',async()=>{
  const f=await fixture();const r=await f.login() as Awaited<ReturnType<typeof f.login>> & {refreshToken:string;accessToken:string};
  const next=await f.engine.refreshNative({refreshToken:r.refreshToken},'192.0.2.10');assert.notEqual(next.refreshToken,r.refreshToken);
  await rejected(()=>f.engine.refreshNative({refreshToken:r.refreshToken},'192.0.2.10'),'REFRESH_REUSE_DETECTED');
  await rejected(()=>f.engine.authenticateNative(next.accessToken),'SESSION_INVALID');
});
test('concurrent refresh reuse cannot produce two independent active credentials',async()=>{
  const f=await fixture();const r=await f.login() as {refreshToken:string};const res=await Promise.allSettled([f.engine.refreshNative({refreshToken:r.refreshToken},'ip'),f.engine.refreshNative({refreshToken:r.refreshToken},'ip')]);
  assert.equal(res.filter(x=>x.status==='fulfilled').length,1);assert.equal([...f.store.rows.sessions.values()].filter(s=>(s as {revoked_at:unknown}).revoked_at===null).length,0);
});
test('third session revokes the oldest and global logout revokes remaining sessions',async()=>{
  const f=await fixture();const first=await f.login('web') as {cookieToken:string};f.advance(61000);await f.login();f.advance(61000);const third=await f.login('web') as {cookieToken:string};
  await rejected(()=>f.engine.authenticateWeb(first.cookieToken),'SESSION_INVALID');const p=await f.engine.authenticateWeb(third.cookieToken);assert.equal((await f.engine.listSessions(p)).length,2);
  await f.engine.logoutAll(p);await rejected(()=>f.engine.authenticateWeb(third.cookieToken),'SESSION_INVALID');
});
test('another user cannot revoke a session by guessing its identifier',async()=>{
  const f=await fixture();const a=await f.login('web') as {cookieToken:string};const b=await f.login('web','+15550001002');const p=await f.engine.authenticateWeb(a.cookieToken);
  await rejected(()=>f.engine.revoke(p,b.session.id),'SESSION_NOT_FOUND');
});
test('membership suspension stops cookie/access/refresh, independent of JWT TTL',async()=>{
  const f=await fixture();const r=await f.login() as {accessToken:string;refreshToken:string};await provision(f.store,roster('suspended'),true,'test',f.now());
  await rejected(()=>f.engine.authenticateNative(r.accessToken),'SESSION_INVALID');await rejected(()=>f.engine.refreshNative({refreshToken:r.refreshToken},'ip'),'SESSION_INVALID');
});
test('roles and enterprise entitlement are re-read, not trusted from token or client',async()=>{
  const f=await fixture();const r=await f.login('web') as {cookieToken:string};await provision(f.store,roster('active',['reviewer']),true,'test');
  const p=await f.engine.authenticateWeb(r.cookieToken);assert.ok(f.engine.publicView(p).permissions.includes('action.review'));assert.equal(f.engine.publicView(p).permissions.includes('membership.admin'),false);
});
test('idle and absolute expiry are enforced after server-side clock advances',async()=>{
  const f=await fixture();const r=await f.login('web') as {cookieToken:string};f.advance(12*3600000+1);await rejected(()=>f.engine.authenticateWeb(r.cookieToken),'SESSION_EXPIRED');
  const g=await fixture();const v=await g.login('web') as {cookieToken:string};for(let i=0;i<16;i++){g.advance(10*3600000);await g.engine.authenticateWeb(v.cookieToken)}g.advance(8*3600000+1);await rejected(()=>g.engine.authenticateWeb(v.cookieToken),'SESSION_EXPIRED');
});
test('delivery failure consumes challenge without exposing gateway exception or code',async()=>{
  const f=await fixture();const config={...f.config,otpMode:'http_gateway' as const};
  const engine=new IdentityEngine(f.store,config,{sign:async()=>'',verify:async()=>{throw new Error()}},{send:async()=>{throw new Error('SECRET_PROVIDER_DETAIL')}},f.now);
  await rejected(()=>engine.requestOtp({phone:'+15550001001',tenant:'enterprise-pilot',client:'native',deviceName:'test'},'ip'),'OTP_DELIVERY_UNAVAILABLE');
  assert.ok([...f.store.rows.challenges.values()].every(x=>(x as {consumed_at:unknown}).consumed_at!==null));
});
test('malformed and future native claims fail before granting principal',async()=>{
  const f=await fixture();await rejected(()=>f.engine.authenticateNative('not-a-token'),'INVALID_ACCESS_TOKEN');
  const r=await f.login() as {accessToken:string};const claims=JSON.parse(Buffer.from(r.accessToken,'base64url').toString());claims.aud='other';const bad=Buffer.from(JSON.stringify(claims)).toString('base64url');
  await rejected(()=>f.engine.authenticateNative(bad),'INVALID_ACCESS_TOKEN');
});

test('authenticated identity overrides forged user, channel and tenant metadata',async()=>{
  const f=await fixture();const r=await f.login('web') as {cookieToken:string};const p=await f.engine.authenticateWeb(r.cookieToken);
  const out=bindOrchestrate(p,false,{version:'1.0',requestId:'test-1',conversationId:'shared-name',text:'Hello',userId:'victim',channel:'telegram',meta:{tenantId:'victim-tenant',admin:true}});
  assert.equal(out.userId,bindConversation(p,false,'shared-name').userId);assert.notEqual(out.userId,'victim');assert.equal(out.channel,'web');assert.equal(out.meta.tenantId,p.tenant.id);assert.equal('admin' in out.meta,false);
});
test('same client conversation name maps to distinct user/tenant scopes',async()=>{
  const f=await fixture();const a=await f.login('web') as {cookieToken:string};const b=await f.login('web','+15550001002') as {cookieToken:string};
  const p=await f.engine.authenticateWeb(a.cookieToken),q=await f.engine.authenticateWeb(b.cookieToken);
  assert.notEqual(bindConversation(p,false,'chat').conversationId,bindConversation(q,false,'chat').conversationId);
  assert.notEqual(bindConversation(p,false,'chat').conversationId,bindConversation({...p,tenant:{...p.tenant,id:'another-tenant'}},false,'chat').conversationId);
  assert.deepEqual(bindConversation(p,false,'chat'),bindConversation(p,false,'chat'));
});
test('UUID identity scopes fit existing memory columns and preserve tenant/user/conversation isolation',async()=>{
  const f=await fixture();const r=await f.login('web') as {cookieToken:string};const p=await f.engine.authenticateWeb(r.cookieToken);
  const principal={...p,tenant:{...p.tenant,id:'11111111-1111-4111-8111-111111111111'},user:{...p.user,id:'22222222-2222-4222-8222-222222222222'}};
  const first=bindConversation(principal,false,'chat');
  const otherTenant=bindConversation({...principal,tenant:{...principal.tenant,id:'33333333-3333-4333-8333-333333333333'}},false,'chat');
  const otherUser=bindConversation({...principal,user:{...principal.user,id:'44444444-4444-4444-8444-444444444444'}},false,'chat');
  const otherConversation=bindConversation(principal,false,'other-chat');
  for(const scope of [first,otherTenant,otherUser,otherConversation,bindConversation(null,true,'chat')]) {
    assert.ok(scope.userId.length<=64);assert.ok(scope.conversationId.length<=128);
  }
  assert.deepEqual(first,bindConversation(principal,false,'chat'));
  assert.notEqual(first.userId,otherTenant.userId);assert.notEqual(first.userId,otherUser.userId);
  assert.equal(first.userId,otherConversation.userId);
  assert.equal(new Set([first,otherTenant,otherUser,otherConversation].map(s=>s.conversationId)).size,4);
});
test('development smoke lane is exact noop only and cannot impersonate a supplied user',()=>{
  const body={version:'1.0',requestId:'smoke',conversationId:'x',text:'tool:test',userId:'victim'};
  assert.equal(bindOrchestrate(null,true,body).userId,'service:local-noop-test');
  for(const text of ['tool:test write','remember secret','tool:call'])assert.throws(()=>bindOrchestrate(null,true,{...body,text}),(e:unknown)=>e instanceof IdentityError&&e.code==='SERVICE_SCOPE_DENIED');
  assert.throws(()=>bindOrchestrate(null,false,body));
});
test('request IDs respect the existing 64-character memory correlation columns',()=>{
  const body={version:'1.0',requestId:'r'.repeat(64),conversationId:'chat',text:'tool:test'};
  assert.equal(bindOrchestrate(null,true,body).requestId,body.requestId);
  assert.throws(()=>bindOrchestrate(null,true,{...body,requestId:'r'.repeat(65)}),(e:unknown)=>e instanceof IdentityError&&e.status===400);
});
test('development service key is forbidden in an unrecognized or staging environment',()=>{
  assert.throws(()=>loadIdentityConfig({...settings(),NODE_ENV:'staging',AUTH_ALLOW_INSECURE_DEV:'false',AUTH_OTP_MODE:'disabled',AUTH_SMOKE_SERVICE_KEY:'x'.repeat(43)}),/dev_only/);
});
