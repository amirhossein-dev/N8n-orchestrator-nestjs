export const ROLES = ['operator', 'manager', 'reviewer', 'tenant_admin'] as const;
export type Role = (typeof ROLES)[number];
export type ClientType = 'web' | 'native';
export type Assurance = 'sms_otp' | 'development_test';
export type Status = 'active' | 'suspended';
export interface User { id: string; phone: string; first_name: string; last_name: string; status: Status; phone_verified_at: number | null; }
export interface Tenant { id: string; slug: string; name: string; status: Status; enterprise: boolean; }
export interface Membership { id: string; user_id: string; tenant_id: string; roles: Role[]; status: Status; revision: number; }
export interface Challenge { id: string; phone_key: string; user_id: string | null; tenant_id: string | null; code_hash: string; client: ClientType; device_name: string; expires_at: number; attempts: number; consumed_at: number | null; assurance: Assurance; }
export interface Session { id: string; user_id: string; tenant_id: string; client: ClientType; assurance: Assurance; cookie_hash: string | null; created_at: number; last_seen_at: number; expires_at: number; revoked_at: number | null; revoke_reason: string | null; device_name: string; }
export interface RefreshToken { id: string; session_id: string; expires_at: number; consumed_at: number | null; }
export interface RateLimit { id: string; count: number; expires_at: number; }
export interface ImportBatch { id: string; tenant_id: string; recorded_at: number; actor_label: string; added: number; updated: number; }
export interface Tables { users: User; tenants: Tenant; memberships: Membership; challenges: Challenge; sessions: Session; refresh_tokens: RefreshToken; rate_limits: RateLimit; import_batches: ImportBatch; }
export type Table = keyof Tables;
export interface Tx {
  get<K extends Table>(table: K, id: string): Promise<Tables[K] | null>;
  find<K extends Table>(table: K, where: Partial<Tables[K]>): Promise<Tables[K][]>;
  put<K extends Table>(table: K, row: Tables[K]): Promise<void>;
}
export interface IdentityStore { transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>; }
export interface AccessClaims { sub: string; sid: string; aud: string; iss: string; exp: number; iat: number; typ: 'native_access'; }
export interface AccessTokens {
  sign(userId: string, sessionId: string, now: number, lifetimeSeconds: number): Promise<string>;
  verify(token: string, now: number): Promise<AccessClaims>;
}
export interface OtpDelivery { send(phone: string, code: string, ttlSeconds: number): Promise<void>; }
export interface Principal { session: Session; user: User; tenant: Tenant; membership: Membership; }
export class IdentityError extends Error {
  constructor(public readonly code: string, public readonly status: number = 400) { super(code); }
}
export const fail = (code: string, status = 400): never => { throw new IdentityError(code, status); };
export const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
