import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { IdentityEngine } from '../identity/core/engine';
import { IdentityError, Principal } from '../identity/core/model';
import { PgTx } from '../identity/pg-store';
import { CHAT_CONFIG } from './chat.config';
import type { ChatConfig } from './chat.config';
import type { ChatReply } from './chat.contract';
import { ChatService } from './chat.service';
import { ChatError } from './chat.error';
import { ContinuityError, page, sendInput, strictObject, uuid } from './continuity.contract';

type Row = Record<string, any>;
const conversationView = (r: Row) => ({ id: r.id as string, title: r.title as string, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) });
const messageView = (r: Row) => ({ id: r.id as string, turnId: r.turn_id as string, role: r.role as 'user' | 'assistant', text: r.text as string, order: Number(r.message_order), createdAt: Number(r.created_at) });

@Injectable()
export class ContinuityService {
  constructor(private readonly db: DataSource, private readonly identity: IdentityEngine, private readonly chat: ChatService, @Inject(CHAT_CONFIG) private readonly config: ChatConfig) {}

  private async transaction<T>(p: Principal, work: (m: EntityManager) => Promise<T>, denied?: (m: EntityManager) => Promise<void>): Promise<T> {
    if (!p?.user?.id || !p?.tenant?.id || !p?.session?.id) throw new IdentityError('AUTHENTICATION_REQUIRED', 401);
    const result = await this.db.transaction(async m => {
      await m.query("SET LOCAL lock_timeout = '3s'");
      await m.query("SET LOCAL statement_timeout = '10s'");
      // Same ordering as existing identity mutations. Never held during inference.
      await m.query('SELECT pg_advisory_xact_lock(44051,1)');
      const actor = await this.identity.revalidateInTransaction(new PgTx(m), p);
      if (actor instanceof IdentityError) { await denied?.(m); return actor; }
      if (actor.user.id !== p.user.id || actor.tenant.id !== p.tenant.id) return new IdentityError('SESSION_INVALID',401);
      return work(m);
    });
    if (result instanceof IdentityError) throw result;
    return result;
  }
  private async owned(m: EntityManager, p: Principal, id: string): Promise<Row> {
    const [r] = await m.query('SELECT * FROM chat_conversations WHERE id=$1 AND owner_user_id=$2 AND tenant_id=$3 FOR UPDATE', [id,p.user.id,p.tenant.id]);
    if (!r) throw new ContinuityError('CONVERSATION_NOT_FOUND',404);
    return r;
  }
  private async expire(m: EntityManager, id: string) {
    await m.query("UPDATE chat_turns SET status='outcome_unknown',error_code='REQUEST_DEADLINE_ELAPSED',completed_at=$2 WHERE conversation_id=$1 AND status='pending' AND deadline_at<=$2", [id,Date.now()]);
  }
  private async requestView(m: EntityManager, id: string, key: string) {
    const [r] = await m.query('SELECT * FROM chat_turns WHERE conversation_id=$1 AND client_request_id=$2', [id,key]);
    if (!r) throw new ContinuityError('REQUEST_NOT_FOUND',404);
    const rows: Row[] = await m.query('SELECT * FROM chat_messages WHERE conversation_id=$1 AND turn_id=$2 ORDER BY message_order', [id,r.id]);
    return { version: '1.0' as const, conversationId: id, clientRequestId: key, turnId: r.id as string, order: Number(r.turn_order), status: r.status as 'pending'|'completed'|'failed'|'outcome_unknown', startedAt: Number(r.started_at), deadlineAt: Number(r.deadline_at), completedAt: r.completed_at === null ? null : Number(r.completed_at), error: r.error_code as string|null, messages: rows.map(messageView) };
  }
  async create(p: Principal, body: unknown) {
    const x = strictObject(body,['clientRequestId']), key = uuid(x.clientRequestId);
    return this.transaction(p, async m => {
      const now = Date.now();
      await m.query('INSERT INTO chat_conversations(id,tenant_id,owner_user_id,client_request_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5) ON CONFLICT(tenant_id,owner_user_id,client_request_id) DO NOTHING', [randomUUID(),p.tenant.id,p.user.id,key,now]);
      const [r] = await m.query('SELECT * FROM chat_conversations WHERE tenant_id=$1 AND owner_user_id=$2 AND client_request_id=$3', [p.tenant.id,p.user.id,key]);
      return { version: '1.0' as const, conversation: conversationView(r) };
    });
  }
  async list(p: Principal, query: unknown) {
    const {cursor,limit}=page(query,'cursor');
    return this.transaction(p,async m => {
      const rows: Row[] = await m.query('SELECT * FROM chat_conversations WHERE tenant_id=$1 AND owner_user_id=$2 AND ($3::bigint IS NULL OR list_order<$3) ORDER BY list_order DESC LIMIT $4',[p.tenant.id,p.user.id,cursor??null,limit+1]);
      return { version:'1.0' as const, conversations:rows.slice(0,limit).map(conversationView),nextCursor:rows.length>limit?String(rows[limit-1].list_order):null };
    });
  }
  async messages(p: Principal, conversationId: string, query: unknown) {
    const id=uuid(conversationId),{cursor,limit}=page(query,'before');
    return this.transaction(p,async m => {
      const c=await this.owned(m,p,id);await this.expire(m,id);
      const rows:Row[]=await m.query('SELECT * FROM chat_messages WHERE conversation_id=$1 AND ($2::bigint IS NULL OR message_order<$2) ORDER BY message_order DESC LIMIT $3',[id,cursor??null,limit+1]);
      const selected=rows.slice(0,limit);
      const turns:Row[]=await m.query('SELECT client_request_id FROM chat_turns WHERE conversation_id=$1 AND (id=ANY($2::uuid[]) OR turn_order=$3) ORDER BY turn_order',[id,selected.map(r=>r.turn_id),c.next_turn-1]);
      const requests=[] as Awaited<ReturnType<ContinuityService['requestView']>>[];
      for(const t of turns) requests.push(await this.requestView(m,id,t.client_request_id));
      return {version:'1.0' as const,conversation:conversationView(c),messages:selected.reverse().map(messageView),requests,nextCursor:rows.length>limit?String(rows[limit-1].message_order):null};
    });
  }
  async status(p:Principal,conversationId:string,key:string) {
    const id=uuid(conversationId);key=uuid(key);
    return this.transaction(p,async m=>{await this.owned(m,p,id);await this.expire(m,id);return this.requestView(m,id,key);});
  }
  async send(p:Principal,conversationId:string,body:unknown) {
    const id=uuid(conversationId),input=sendInput(body,this.config.maxMessageChars);
    const hash=createHash('sha256').update(JSON.stringify({text:input.text})).digest('hex');
    const admission=await this.transaction(p,async m=>{
      const c=await this.owned(m,p,id);await this.expire(m,id);
      const [existing]=await m.query('SELECT payload_hash FROM chat_turns WHERE conversation_id=$1 AND client_request_id=$2',[id,input.clientRequestId]);
      if(existing) {
        if(existing.payload_hash!==hash) throw new ContinuityError('REQUEST_KEY_CONFLICT',409);
        return { existing:await this.requestView(m,id,input.clientRequestId) };
      }
      if((await m.query("SELECT id FROM chat_turns WHERE conversation_id=$1 AND status='pending'",[id])).length) throw new ContinuityError('CONVERSATION_BUSY',409);
      const recent:Row[]=await m.query("SELECT msg.* FROM chat_messages msg JOIN chat_turns t ON t.id=msg.turn_id AND t.conversation_id=msg.conversation_id WHERE msg.conversation_id=$1 AND t.status='completed' ORDER BY msg.message_order DESC LIMIT $2",[id,this.config.maxHistoryMessages]);
      const context:Row[]=[];let chars=0;
      for(const r of recent) { if(r.text.length>this.config.maxMessageChars || chars+r.text.length>16000) break;context.unshift(r);chars+=r.text.length; }
      const attempt=randomUUID(),turn=randomUUID(),now=Date.now(),order=c.next_turn;
      // Same configured provider timeout; small bounded commit allowance is not a provider retry/deadline change.
      const deadline=now+this.config.timeoutMs+5000;
      await m.query("INSERT INTO chat_turns(id,conversation_id,client_request_id,turn_order,payload_hash,attempt_id,status,started_at,deadline_at,context_message_ids) VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9)",[turn,id,input.clientRequestId,order,hash,attempt,now,deadline,context.map(r=>r.id)]);
      await m.query("INSERT INTO chat_messages(id,conversation_id,turn_id,role,text,message_order,created_at) VALUES($1,$2,$3,'user',$4,$5,$6)",[randomUUID(),id,turn,input.text,order*2-1,now]);
      await m.query('UPDATE chat_conversations SET next_turn=next_turn+1,updated_at=$2,title=CASE WHEN next_turn=1 THEN $3 ELSE title END WHERE id=$1',[id,now,input.text.replace(/\s+/g,' ').trim().slice(0,80)]);
      return {attempt,turn,order,history:context.map(r=>({role:r.role as 'user'|'assistant',text:r.text as string}))};
    });
    if(admission.existing) return admission.existing;
    let result:ChatReply|undefined,error:string|undefined;
    try {
      result=await this.chat.reply({message:input.text,history:admission.history});
      if(typeof result.replyText!=='string'||!result.replyText.trim()||result.replyText.length>16000||result.replyText.includes('\0')) {result=undefined;error='AI_INVALID_RESPONSE';}
    } catch(e) {error=e instanceof ChatError?e.code:'AI_PROVIDER_UNAVAILABLE';}
    return this.transaction(p,async m=>{
      await this.owned(m,p,id);await this.expire(m,id);
      const [turn]=await m.query("SELECT id FROM chat_turns WHERE conversation_id=$1 AND id=$2 AND attempt_id=$3 AND status='pending' FOR UPDATE",[id,admission.turn,admission.attempt]);
      if(turn) {
        const now=Date.now();
        if(result) {
          await m.query("INSERT INTO chat_messages(id,conversation_id,turn_id,role,text,message_order,created_at) VALUES($1,$2,$3,'assistant',$4,$5,$6)",[randomUUID(),id,turn.id,result.replyText,admission.order*2,now]);
          await m.query("UPDATE chat_turns SET status='completed',completed_at=$2,provider=$3,model=$4,latency_ms=$5,usage=$6 WHERE id=$1",[turn.id,now,result.provider,result.model,result.latencyMs,result.usage?JSON.stringify(result.usage):null]);
        } else {
          const unknown=['AI_PROVIDER_TIMEOUT','AI_PROVIDER_UNAVAILABLE'].includes(error!);
          await m.query('UPDATE chat_turns SET status=$2,completed_at=$3,error_code=$4 WHERE id=$1',[turn.id,unknown?'outcome_unknown':'failed',now,error]);
        }
        await m.query('UPDATE chat_conversations SET updated_at=$2 WHERE id=$1',[id,now]);
      }
      return this.requestView(m,id,input.clientRequestId);
    },async m=>{
      // Same authenticated original owner; no assistant saved or returned after revocation.
      await this.owned(m,p,id);await this.expire(m,id);
      await m.query("UPDATE chat_turns SET status='failed',error_code='AUTHORIZATION_LOST',completed_at=$4 WHERE conversation_id=$1 AND id=$2 AND attempt_id=$3 AND status='pending'",[id,admission.turn,admission.attempt,Date.now()]);
    });
  }
}
