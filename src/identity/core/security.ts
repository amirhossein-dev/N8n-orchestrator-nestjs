import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { IdentityConfig } from './config';
import { ClientType, fail } from './model';
export function digest(pepper: string, purpose: string, value: string): string {
  return createHmac('sha256', Buffer.from(pepper, 'base64url')).update(purpose).update('\0').update(value).digest('hex');
}
export function equal(a: string, b: string): boolean {
  const x=Buffer.from(a); const y=Buffer.from(b); return x.length===y.length && timingSafeEqual(x,y);
}
export const opaque = () => randomBytes(32).toString('base64url');
export function assertOrigin(config: IdentityConfig, origin: string | undefined, transport: ClientType, unsafe: boolean): void {
  // Browsers may not select native authentication to avoid cookie/CSRF checks.
  if (transport === 'native') { if (origin !== undefined) fail('BROWSER_MUST_USE_COOKIE_SESSION',403); return; }
  if ((unsafe && origin === undefined) || (origin !== undefined && !config.webOrigins.includes(origin))) fail('ORIGIN_DENIED',403);
}
export function csrfFor(config: IdentityConfig, sessionId: string): string { return digest(config.pepper,'csrf',sessionId); }
export function assertCsrf(config: IdentityConfig, sid: string, csrf: unknown): void {
  if (typeof csrf !== 'string' || !equal(csrfFor(config,sid),csrf)) fail('CSRF_DENIED',403);
}
export function readCookie(raw: string | undefined, name: string): string | null {
  const parts=(raw || '').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='));
  if (parts.length>1) fail('AMBIGUOUS_COOKIE',401);
  return parts.length ? parts[0].slice(name.length+1) : null;
}
