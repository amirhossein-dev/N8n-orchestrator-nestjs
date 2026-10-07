import { ClientType, fail, isRecord, Role, ROLES } from './model';
export function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some(k => !keys.includes(k))) return fail('INVALID_INPUT');
  return value;
}
export function text(value: unknown, max: number, min = 1): string {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) return fail('INVALID_INPUT');
  return value.trim();
}
export function digits(value: string): string {
  return value.replace(/[۰-۹]/g, x => String(x.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, x => String(x.charCodeAt(0) - 1632));
}
export function phone(value: unknown): string {
  const p = digits(text(value, 20));
  if (!/^\+[1-9][0-9]{7,14}$/.test(p)) return fail('PHONE_MUST_BE_E164');
  return p;
}
export function slug(value: unknown): string {
  const s = text(value, 64);
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(s)) return fail('INVALID_TENANT');
  return s;
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return fail('INVALID_IDENTIFIER');
  return value.toLowerCase();
}
export function client(value: unknown): ClientType { if (value !== 'web' && value !== 'native') return fail('INVALID_CLIENT'); return value; }
export function code(value: unknown): string { const c = digits(text(value, 6, 6)); if (!/^\d{6}$/.test(c)) return fail('INVALID_CODE'); return c; }
export function token(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return fail('INVALID_TOKEN', 401); return value; }
export function roles(value: unknown): Role[] {
  if (!Array.isArray(value) || !value.length || value.length > ROLES.length || value.some(x => !ROLES.includes(x)) || new Set(value).size !== value.length) return fail('INVALID_ROLES');
  return [...value] as Role[];
}
