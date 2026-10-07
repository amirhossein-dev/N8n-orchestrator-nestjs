import { randomInt, randomUUID } from 'node:crypto';
import { IdentityConfig } from './config';
import { AccessTokens, ClientType, IdentityError, IdentityStore, OtpDelivery, Principal, Session, Tx, fail } from './model';
import * as V from './validation';
import { csrfFor, digest, equal, opaque } from './security';

// This engine deliberately has no HTTP, Nest, SMS vendor, or JWT parser dependency.
// Repository transactions must serialize identity mutations (see PgIdentityStore).
export class IdentityEngine {
  constructor(public readonly store: IdentityStore, public readonly config: IdentityConfig,
    private readonly jwt: AccessTokens, private readonly delivery: OtpDelivery,
    private readonly clock: () => number = Date.now) {}

  private hash(kind: string, value: string) { return digest(this.config.pepper,kind,value); }
  private async commit<T>(work: (tx: Tx) => Promise<T | IdentityError>): Promise<T> {
    // Expected denials are VALUES until commit. Throwing inside the transaction
    // would roll back wrong-code attempts and refresh-replay revocation.
    const result=await this.store.transaction(work);
    if (result instanceof IdentityError) throw result;
    return result;
  }
  private async limit(tx: Tx, key: string, max: number, period: number): Promise<boolean> {
    const now=this.clock(); const id=this.hash('limit',key+':'+Math.floor(now/period));
    const row=await tx.get('rate_limits',id);
    if (row && row.count>=max) return false;
    await tx.put('rate_limits',{id,count:(row?.count || 0)+1,expires_at:(Math.floor(now/period)+1)*period});
    return true;
  }
  private async cooldown(tx:Tx,key:string,period:number):Promise<boolean> {
    const id=this.hash('cooldown',key),now=this.clock();const row=await tx.get('rate_limits',id);
    if(row && row.expires_at>now)return false;
    await tx.put('rate_limits',{id,count:1,expires_at:now+period});return true;
  }
  private async principal(tx: Tx, s: Session | null): Promise<Principal | IdentityError> {
    const now=this.clock();
    if (!s || s.revoked_at!==null) return new IdentityError('SESSION_INVALID',401);
    if (s.expires_at<=now || s.last_seen_at+this.config.idleMs<=now || (this.config.production && s.assurance!=='sms_otp')) {
      await tx.put('sessions',{...s,revoked_at:now,revoke_reason:'expired_or_insufficient_assurance'});
      return new IdentityError('SESSION_EXPIRED',401);
    }
    const [u,t,ms]=await Promise.all([tx.get('users',s.user_id),tx.get('tenants',s.tenant_id),tx.find('memberships',{user_id:s.user_id,tenant_id:s.tenant_id})]);
    const m=ms[0];
    if (!u || !t || !m || u.status!=='active' || t.status!=='active' || m.status!=='active') {
      await tx.put('sessions',{...s,revoked_at:now,revoke_reason:'membership_or_account_inactive'});
      return new IdentityError('MEMBERSHIP_INACTIVE',401);
    }
    if (now-s.last_seen_at>=60_000) { s={...s,last_seen_at:now}; await tx.put('sessions',s); }
    return {session:s,user:u,tenant:t,membership:m};
  }
  publicView(p: Principal) {
    const permissions=['conversation.use','session.manage_self'];
    if (p.membership.roles.includes('reviewer')) permissions.push('action.review');
    if (p.membership.roles.includes('manager')) permissions.push('team.read');
    if (p.membership.roles.includes('tenant_admin')) permissions.push('membership.admin');
    return {
      user:{id:p.user.id,phone:p.user.phone,firstName:p.user.first_name,lastName:p.user.last_name},
      tenant:{id:p.tenant.id,slug:p.tenant.slug,name:p.tenant.name},
      membership:{id:p.membership.id,roles:p.membership.roles,revision:p.membership.revision},
      entitlements:{enterprise:p.tenant.enterprise,paymentsEnabled:false},
      session:{id:p.session.id,client:p.session.client,assurance:p.session.assurance,expiresAt:p.session.expires_at,idleTimeoutMs:this.config.idleMs,maxActiveSessions:this.config.maxSessions},
      permissions, csrfToken:p.session.client==='web'?csrfFor(this.config,p.session.id):null,
    };
  }
  async requestOtp(body: unknown, ip: string) {
    const x=V.object(body,['phone','tenant','client','deviceName']);
    const phone=V.phone(x.phone), tenant=V.slug(x.tenant), client=V.client(x.client);
    const device=V.text(x.deviceName ?? 'Device',80), now=this.clock();
    if(this.config.otpMode==='disabled') fail('OTP_DELIVERY_NOT_CONFIGURED',503);
    const code=this.config.otpMode==='development_test'?this.config.devOtp!:String(randomInt(0,1_000_000)).padStart(6,'0');
    const pk=this.hash('phone',phone), id=randomUUID();
    const eligible=await this.commit(async tx=>{
      if(!await this.limit(tx,'request_ip:'+ip,30,600_000) || !await this.limit(tx,'request_phone:'+pk,5,3600_000) || !await this.cooldown(tx,'request_cooldown:'+pk,60_000)) return new IdentityError('OTP_RATE_LIMIT',429);
      const t=(await tx.find('tenants',{slug:tenant}))[0];
      const u=(await tx.find('users',{phone}))[0];
      const m=t&&u?(await tx.find('memberships',{tenant_id:t.id,user_id:u.id}))[0]:null;
      const ok=!!(t&&u&&m&&t.status==='active'&&u.status==='active'&&m.status==='active');
      // Every accepted request gets the same-shaped challenge, including ineligible phones.
      for(const previous of await tx.find('challenges',{phone_key:pk})) if(previous.consumed_at===null) await tx.put('challenges',{...previous,consumed_at:now});
      await tx.put('challenges',{id,phone_key:pk,user_id:ok?u.id:null,tenant_id:ok?t.id:null,code_hash:this.hash('otp',id+':'+code),client,device_name:device,expires_at:now+this.config.otpMs,attempts:0,consumed_at:null,assurance:this.config.otpMode==='development_test'?'development_test':'sms_otp'});
      return ok;
    });
    if(eligible && this.config.otpMode==='http_gateway') {
      try { await this.delivery.send(phone,code,this.config.otpMs/1000); }
      catch {
        await this.store.transaction(async tx=>{const c=await tx.get('challenges',id);if(c) await tx.put('challenges',{...c,consumed_at:this.clock()});});
        fail('OTP_DELIVERY_UNAVAILABLE',503); // Never echo provider errors, phone, or code.
      }
    }
    return {challengeId:id,expiresInSeconds:this.config.otpMs/1000,resendAfterSeconds:60,
      deliveryMode:this.config.otpMode==='development_test'?'development_test':'sms',
      message:'If the account is eligible, follow the configured verification channel.'};
  }
  async verifyOtp(body: unknown, ip: string) {
    const x=V.object(body,['challengeId','code','firstName','lastName','client']);
    const id=V.uuid(x.challengeId), supplied=V.code(x.code), client=V.client(x.client);
    const firstName=V.text(x.firstName,80), lastName=V.text(x.lastName,80), now=this.clock();
    const raw=opaque();
    const result=await this.commit(async tx=>{
      if(!await this.limit(tx,'verify_ip:'+ip,60,600_000)) return new IdentityError('OTP_RATE_LIMIT',429);
      let c=await tx.get('challenges',id);
      if(!c || c.consumed_at!==null || c.expires_at<=now || c.attempts>=this.config.maxOtpAttempts || c.client!==client) return new IdentityError('OTP_INVALID_OR_EXPIRED',401);
      c={...c,attempts:c.attempts+1};
      const valid=equal(c.code_hash,this.hash('otp',id+':'+supplied)) && c.user_id!==null && c.tenant_id!==null;
      if(!valid) { if(c.attempts>=this.config.maxOtpAttempts)c.consumed_at=now;await tx.put('challenges',c);return new IdentityError('OTP_INVALID_OR_EXPIRED',401); }
      await tx.put('challenges',{...c,consumed_at:now});
      const u=await tx.get('users',c.user_id!); const t=await tx.get('tenants',c.tenant_id!);
      const m=(await tx.find('memberships',{user_id:c.user_id!,tenant_id:c.tenant_id!}))[0];
      if(!u||!t||!m||u.status!=='active'||t.status!=='active'||m.status!=='active') return new IdentityError('OTP_INVALID_OR_EXPIRED',401);
      const user={...u,first_name:firstName,last_name:lastName,phone_verified_at:c.assurance==='sms_otp'?now:u.phone_verified_at};
      await tx.put('users',user);
      const sessions=await tx.find('sessions',{user_id:u.id});
      const active=sessions.filter(s=>s.revoked_at===null && s.expires_at>now && s.last_seen_at+this.config.idleMs>now).sort((a,b)=>a.created_at-b.created_at || a.id.localeCompare(b.id));
      for(const s of active.slice(0,Math.max(0,active.length-this.config.maxSessions+1))) await tx.put('sessions',{...s,revoked_at:now,revoke_reason:'session_limit'});
      const s:Session={id:randomUUID(),user_id:u.id,tenant_id:t.id,client,assurance:c.assurance,cookie_hash:client==='web'?this.hash('session',raw):null,created_at:now,last_seen_at:now,expires_at:now+this.config.absoluteMs,revoked_at:null,revoke_reason:null,device_name:c.device_name};
      await tx.put('sessions',s);
      if(client==='native') await tx.put('refresh_tokens',{id:this.hash('refresh',raw),session_id:s.id,expires_at:s.expires_at,consumed_at:null});
      return {session:s,user,tenant:t,membership:m} as Principal;
    });
    const view=this.publicView(result);
    return client==='web'?{...view,cookieToken:raw}:{...view,accessToken:await this.jwt.sign(result.user.id,result.session.id,now,this.config.accessSeconds),accessExpiresAt:now+this.config.accessSeconds*1000,refreshToken:raw};
  }
  async authenticateWeb(raw: string): Promise<Principal> {
    try { V.token(raw); } catch { fail('SESSION_INVALID',401); }
    return this.commit(async tx=>this.principal(tx,(await tx.find('sessions',{cookie_hash:this.hash('session',raw),client:'web'}))[0] || null));
  }
  async authenticateNative(raw: string): Promise<Principal> {
    if(raw.length>4096) fail('INVALID_ACCESS_TOKEN',401);
    let claims;try{claims=await this.jwt.verify(raw,this.clock());}catch{return fail('INVALID_ACCESS_TOKEN',401);}
    if(!claims || claims.typ!=='native_access' || claims.iss!==this.config.issuer || claims.aud!==this.config.audience || !Number.isInteger(claims.exp) || !Number.isInteger(claims.iat) || claims.iat>Math.floor(this.clock()/1000)+5 || claims.exp-claims.iat>this.config.accessSeconds || claims.exp<=Math.floor(this.clock()/1000)) fail('INVALID_ACCESS_TOKEN',401);
    let sessionId:string;try { sessionId=V.uuid(claims.sid); V.uuid(claims.sub); } catch { return fail('INVALID_ACCESS_TOKEN',401); }
    return this.commit(async tx=>{const s=await tx.get('sessions',sessionId);if(!s||s.client!=='native'||s.user_id!==claims.sub)return new IdentityError('SESSION_INVALID',401);return this.principal(tx,s);});
  }
  async refreshNative(body: unknown, ip: string) {
    const x=V.object(body,['refreshToken']);const raw=V.token(x.refreshToken), replacement=opaque(), now=this.clock();
    const p=await this.commit(async tx=>{
      if(!await this.limit(tx,'refresh_ip:'+ip,120,60_000)) return new IdentityError('RATE_LIMIT',429);
      const r=await tx.get('refresh_tokens',this.hash('refresh',raw));
      if(!r || r.expires_at<=now)return new IdentityError('REFRESH_INVALID',401);
      const s=await tx.get('sessions',r.session_id);
      if(!s || s.client!=='native')return new IdentityError('REFRESH_INVALID',401);
      if(r.consumed_at!==null){await tx.put('sessions',{...s,revoked_at:now,revoke_reason:'refresh_reuse'});return new IdentityError('REFRESH_REUSE_DETECTED',401);}
      const principal=await this.principal(tx,s);if(principal instanceof IdentityError)return principal;
      await tx.put('refresh_tokens',{...r,consumed_at:now});
      await tx.put('refresh_tokens',{id:this.hash('refresh',replacement),session_id:s.id,expires_at:s.expires_at,consumed_at:null});
      await tx.put('sessions',{...principal.session,last_seen_at:now});
      return principal;
    });
    return {...this.publicView(p),accessToken:await this.jwt.sign(p.user.id,p.session.id,now,this.config.accessSeconds),accessExpiresAt:now+this.config.accessSeconds*1000,refreshToken:replacement};
  }
  async listSessions(p: Principal) {
    return this.store.transaction(async tx=>(await tx.find('sessions',{user_id:p.user.id})).filter(s=>s.revoked_at===null && s.expires_at>this.clock() && s.last_seen_at+this.config.idleMs>this.clock()).map(s=>({id:s.id,tenantId:s.tenant_id,deviceName:s.device_name,client:s.client,assurance:s.assurance,createdAt:s.created_at,lastSeenAt:s.last_seen_at,expiresAt:s.expires_at,current:s.id===p.session.id})));
  }
  async revoke(p: Principal, id: string): Promise<void> {
    V.uuid(id);
    await this.commit(async tx=>{
      // Recheck the actor in the same transaction as the mutation.
      const actor=await this.principal(tx,await tx.get('sessions',p.session.id));if(actor instanceof IdentityError)return actor;
      const s=await tx.get('sessions',id);if(!s||s.user_id!==actor.user.id)return new IdentityError('SESSION_NOT_FOUND',404);
      await tx.put('sessions',{...s,revoked_at:s.revoked_at??this.clock(),revoke_reason:s.revoke_reason??'user_revoked'});
    });
  }
  async logoutAll(p: Principal): Promise<void> {
    await this.commit(async tx=>{
      const actor=await this.principal(tx,await tx.get('sessions',p.session.id));if(actor instanceof IdentityError)return actor;
      for(const s of await tx.find('sessions',{user_id:actor.user.id}))if(s.revoked_at===null)await tx.put('sessions',{...s,revoked_at:this.clock(),revoke_reason:'logout_all'});
    });
  }
}
