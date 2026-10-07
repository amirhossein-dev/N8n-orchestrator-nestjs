import { IdentityError } from './model';
export interface IdentityConfig {
  production: boolean; jwtSecret: string; pepper: string; webOrigins: string[];
  secureCookies: boolean; cookieName: string; issuer: string; audience: string;
  otpMode: 'disabled' | 'development_test' | 'http_gateway'; devOtp: string | null;
  smsUrl: string | null; smsToken: string | null; smokeKey: string | null;
  accessSeconds: number; absoluteMs: number; idleMs: number; otpMs: number;
  maxSessions: number; maxOtpAttempts: number;
}
export function loadIdentityConfig(env: Record<string, string | undefined> = process.env): IdentityConfig {
  const bad = (name: string): never => { throw new IdentityError(`CONFIG_REQUIRED:${name}`, 503); };
  const secret = (name: string) => { const v = env[name] || ''; if (!/^[A-Za-z0-9_-]{43,128}$/.test(v) || Buffer.from(v, 'base64url').length < 32) return bad(name); return v; };
  const jwtSecret = secret('AUTH_JWT_SECRET'); const pepper = secret('AUTH_TOKEN_PEPPER');
  if (jwtSecret === pepper) bad('distinct_auth_secrets');
  const production = env.NODE_ENV === 'production';
  const webOrigins = (env.AUTH_WEB_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!webOrigins.length) bad('AUTH_WEB_ORIGINS');
  for (const origin of webOrigins) {
    let u: URL; try { u = new URL(origin); } catch { return bad('AUTH_WEB_ORIGINS'); }
    if (u.origin !== origin || u.username || u.password || (u.protocol !== 'https:' && !(env.NODE_ENV === 'development' && ['localhost','127.0.0.1'].includes(u.hostname) && u.protocol === 'http:'))) bad('AUTH_WEB_ORIGINS');
  }
  const insecure = env.AUTH_ALLOW_INSECURE_DEV === 'true';
  if (insecure && env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') bad('AUTH_ALLOW_INSECURE_DEV');
  const otpMode = env.AUTH_OTP_MODE || 'disabled';
  if (!['disabled','development_test','http_gateway'].includes(otpMode)) bad('AUTH_OTP_MODE');
  let devOtp: string | null = null;
  if (otpMode === 'development_test') {
    if (!['development','test'].includes(env.NODE_ENV || '')) bad('development_test_disabled_outside_development');
    devOtp = env.AUTH_DEV_OTP || ''; if (!/^\d{6}$/.test(devOtp)) bad('AUTH_DEV_OTP');
  }
  const smsUrl = env.AUTH_SMS_GATEWAY_URL || null; const smsToken = env.AUTH_SMS_GATEWAY_TOKEN || null;
  if (otpMode === 'http_gateway') {
    let u: URL; try { u = new URL(smsUrl || ''); } catch { return bad('AUTH_SMS_GATEWAY_URL'); }
    if (u.protocol !== 'https:' || u.username || u.password || !smsToken || smsToken.length < 32) bad('AUTH_SMS_GATEWAY');
  }
  const smokeKey = env.AUTH_SMOKE_SERVICE_KEY || null;
  if (smokeKey && (!['development','test'].includes(env.NODE_ENV || '') || smokeKey.length < 43)) bad('AUTH_SMOKE_SERVICE_KEY_dev_only');
  return { production, jwtSecret, pepper, webOrigins, secureCookies: !insecure,
    cookieName: insecure ? 'dara_dev_sid' : '__Host-dara_sid', issuer: 'dara-identity', audience: 'dara-native-api',
    otpMode: otpMode as IdentityConfig['otpMode'], devOtp, smsUrl, smsToken, smokeKey,
    accessSeconds: 300, absoluteMs: 7*24*3600_000, idleMs: 12*3600_000, otpMs: 180_000, maxSessions: 2, maxOtpAttempts: 5 };
}
