import { MigrationInterface, QueryRunner } from 'typeorm';
export class IdentityPhaseA1791331200000 implements MigrationInterface {
  name='IdentityPhaseA1791331200000';
  async up(q:QueryRunner):Promise<void> {
    await q.query(`
CREATE TABLE identity_users (
 id uuid PRIMARY KEY, phone varchar(16) UNIQUE NOT NULL,
 first_name varchar(80) NOT NULL, last_name varchar(80) NOT NULL,
 status text NOT NULL CHECK(status IN ('active','suspended')), phone_verified_at bigint
);
CREATE TABLE identity_tenants (
 id uuid PRIMARY KEY, slug varchar(64) UNIQUE NOT NULL, name varchar(120) NOT NULL,
 status text NOT NULL CHECK(status IN ('active','suspended')), enterprise boolean NOT NULL
);
CREATE TABLE identity_memberships (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES identity_users(id), tenant_id uuid NOT NULL REFERENCES identity_tenants(id),
 roles jsonb NOT NULL CHECK(jsonb_typeof(roles)='array' AND jsonb_array_length(roles)>0 AND roles <@ '["operator","manager","reviewer","tenant_admin"]'::jsonb),
 status text NOT NULL CHECK(status IN ('active','suspended')), revision integer NOT NULL CHECK(revision>0), UNIQUE(tenant_id,user_id)
);
CREATE TABLE identity_challenges (
 id uuid PRIMARY KEY, phone_key text NOT NULL, user_id uuid REFERENCES identity_users(id), tenant_id uuid REFERENCES identity_tenants(id),
 code_hash text NOT NULL, client text NOT NULL CHECK(client IN ('web','native')), device_name varchar(80) NOT NULL,
 expires_at bigint NOT NULL, attempts integer NOT NULL CHECK(attempts>=0), consumed_at bigint,
 assurance text NOT NULL CHECK(assurance IN ('sms_otp','development_test'))
);
CREATE INDEX identity_challenges_phone ON identity_challenges(phone_key);
CREATE TABLE identity_sessions (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES identity_users(id), tenant_id uuid NOT NULL REFERENCES identity_tenants(id),
 client text NOT NULL CHECK(client IN ('web','native')), assurance text NOT NULL CHECK(assurance IN ('sms_otp','development_test')),
 cookie_hash text UNIQUE, created_at bigint NOT NULL, last_seen_at bigint NOT NULL, expires_at bigint NOT NULL,
 revoked_at bigint, revoke_reason text, device_name varchar(80) NOT NULL,
 FOREIGN KEY(tenant_id,user_id) REFERENCES identity_memberships(tenant_id,user_id),
 CHECK((client='web' AND cookie_hash IS NOT NULL) OR (client='native' AND cookie_hash IS NULL))
);
CREATE INDEX identity_sessions_user ON identity_sessions(user_id);
CREATE TABLE identity_refresh_tokens (
 id text PRIMARY KEY, session_id uuid NOT NULL REFERENCES identity_sessions(id), expires_at bigint NOT NULL, consumed_at bigint
);
CREATE INDEX identity_refresh_session ON identity_refresh_tokens(session_id);
CREATE TABLE identity_rate_limits (id text PRIMARY KEY, count integer NOT NULL CHECK(count>0), expires_at bigint NOT NULL);
CREATE TABLE identity_import_batches (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES identity_tenants(id), recorded_at bigint NOT NULL,
 actor_label varchar(80) NOT NULL, added integer NOT NULL, updated integer NOT NULL
);
`);
  }
  async down():Promise<void> {
    throw new Error('IDENTITY_DATA_DELETION_REQUIRES_OPERATOR_PLAN: restore code separately; no automatic DROP of identity/session history.');
  }
}
