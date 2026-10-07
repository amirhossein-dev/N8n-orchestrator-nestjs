import { createHash } from 'node:crypto';
import { Principal, fail } from './model';
import * as V from './validation';

// Native/browser identity and tenant come only from a verified Principal.
// The development service key NEVER inherits an end user's identity.
export function bindConversation(principal: Principal | null, smoke: boolean, conversation: unknown) {
  const raw = V.text(conversation, 120);
  if (!principal && !smoke) return fail('AUTHENTICATION_REQUIRED', 401);
  if (principal && smoke) return fail('AMBIGUOUS_AUTHENTICATION', 401);
  // Keep both server-owned scope IDs within the existing memory column widths
  // (userId 64, conversationId 128), without truncating tenant/user identity.
  const userId = principal
    ? `identity:${createHash('sha256').update(JSON.stringify([principal.tenant.id,principal.user.id])).digest('base64url')}`
    : 'service:local-noop-test';
  return {
    userId,
    conversationId: `${userId}:conversation:${createHash('sha256').update(raw).digest('base64url')}`,
  };
}
export function bindOrchestrate(principal: Principal | null, smoke: boolean, body: unknown) {
  const x = V.object(body, ['version','requestId','channel','userId','conversationId','text','meta']);
  if(x.version!=='1.0'||typeof x.text!=='string'||!x.text.trim()||x.text.length>16000||x.text.includes('\0'))fail('INVALID_INPUT');
  if(smoke&&x.text!=='tool:test')fail('SERVICE_SCOPE_DENIED',403);
  return {
    version:'1.0' as const,
    requestId:V.text(x.requestId,64),
    ...bindConversation(principal,smoke,x.conversationId),
    channel:(smoke?'app':principal!.session.client==='web'?'web':'app') as 'web'|'app',
    text:x.text as string,
    meta:{identityPhase:'A',tenantId:principal?.tenant.id||null,sessionId:principal?.session.id||null},
  };
}
