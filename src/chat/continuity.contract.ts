import { HttpException } from '@nestjs/common';

export type TurnStatus = 'pending' | 'completed' | 'failed' | 'outcome_unknown';
export class ContinuityError extends HttpException {
  constructor(code: string, status = 400) { super({ error: code }, status); }
}
export function strictObject(value: unknown, fields: string[], code = 'INVALID_CONVERSATION_REQUEST'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !fields.includes(k))) throw new ContinuityError(code);
  return value as Record<string, unknown>;
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new ContinuityError('INVALID_CONVERSATION_REQUEST');
  return value.toLowerCase();
}
export function page(value: unknown, cursorKey: 'cursor' | 'before') {
  // Installed React Native whatwg-fetch adds a timestamp for cache:'no-store'.
  // It has no domain meaning; accept only one bounded decimal transport value.
  const x = strictObject(value, [cursorKey, 'limit', '_'], 'INVALID_CONVERSATION_QUERY');
  if (x._ !== undefined && (typeof x._ !== 'string' || !/^\d{1,16}$/.test(x._))) throw new ContinuityError('INVALID_CONVERSATION_QUERY');
  const cursor = x[cursorKey];
  if (cursor !== undefined && (typeof cursor !== 'string' || !/^[1-9]\d{0,14}$/.test(cursor))) throw new ContinuityError('INVALID_CONVERSATION_QUERY');
  const limit = x.limit === undefined ? 30 : typeof x.limit === 'string' && /^\d{1,2}$/.test(x.limit) ? Number(x.limit) : 0;
  if (limit < 1 || limit > 50) throw new ContinuityError('INVALID_CONVERSATION_QUERY');
  return { cursor: cursor as string | undefined, limit };
}
export function sendInput(body: unknown, maxChars: number) {
  const x = strictObject(body, ['clientRequestId', 'text']);
  const clientRequestId = uuid(x.clientRequestId);
  if (typeof x.text !== 'string' || !x.text.trim() || x.text.length > maxChars || x.text.includes('\0')) throw new ContinuityError('INVALID_CONVERSATION_REQUEST');
  return { clientRequestId, text: x.text };
}
