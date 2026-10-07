# Identity / Session Phase A — review candidate

This is application code, not a deployment or production certification. SMS vendor configuration, strong MFA/passkeys, a company-approved roster, full tenant isolation of every subsystem, real tool execution approval, queue/replay recovery, and production load qualification remain outside this change.

## Scope
- Allowlisted enterprise identities: global person + live organization membership; no public registration, no client-selected role or plan.
- E.164 phone required. Persian/Arabic digits normalized; national-only numbers rejected rather than guessing a country.
- OTP challenge has a cryptographic random code for HTTP SMS gateway mode, HMAC storage, three-minute expiration, five verification attempts, 60-second resend cooldown and persisted request limits. Requests to unknown/inactive members receive a same-shaped noneligible challenge.
- Web/PWA: opaque HttpOnly cookie, secure by default, SameSite=Lax, exact Origin verification for mutations and session-bound CSRF. JavaScript receives a CSRF value, not the cookie secret.
- Native: @nestjs/jwt HS256 access tokens (5 minutes), an opaque refresh family hashed in PostgreSQL, rotation and session revocation on replay. Membership/account/tenant and session are checked on every protected request, not trusted from old JWT claims.
- Two active sessions across all memberships of a user. A third login revokes the oldest; absolute seven days, twelve hours idle. Revocation affects subsequent authorization, not an already-committed action.
- Development OTP is explicitly NOT real phone verification; no SMS is sent, code is not returned over the API, and it is prohibited outside development/test.
- Conditional enterprise badge and paymentsEnabled=false from the server.
- Global guard protects legacy routes; /users is disabled, userId/channel/body meta cannot impersonate a principal in /orchestrate.
- Local integration correction: server-derived tenant/user and conversation scopes use full SHA-256 base64url digests to fit the existing memory `userId` (64) and `conversationId` (128) columns. Request IDs are limited to the existing `correlationId` width (64), with overlong input rejected before persistence. Regression tests check these widths and isolation; no legacy database schema change is needed.
- /confirm is deliberately blocked (APPROVAL_RUNTIME_NOT_QUALIFIED) until exact-payload one-use approval is implemented. /tool-result is only retained for the explicit development noop service-key lane. Do not treat logged noop success as a qualified real-tool receipt.

## API
All responses should be served with Cache-Control: no-store. Main bootstrap sets it; protect reverse-proxy caches independently.

| Method/path | Input | Result |
|---|---|---|
| GET /identity/config | none | mode and policy, no secrets |
| POST /identity/otp/request | phone, tenant slug, client web/native, deviceName | challengeId, expiry, resend delay |
| POST /identity/otp/verify | challengeId, code, firstName, lastName, same client | session view; cookie on web, native token pair on native |
| POST /identity/refresh | refreshToken; native only | rotated native token pair |
| GET /identity/me | cookie or bearer | current person, membership, roles, permissions, entitlement |
| GET /identity/sessions | authenticated | own active sessions across memberships |
| DELETE /identity/sessions/:id | authenticated + web CSRF/Origin | revoke own session only |
| POST /identity/logout | authenticated + web CSRF/Origin | revoke current session |
| POST /identity/logout-all | authenticated + web CSRF/Origin | revoke own sessions |

No native credential flow is accepted with a browser Origin. Cookies and bearer together are rejected. CORS is an additional browser control, not authentication. The reverse proxy must not strip browser Origin or overwrite identity from client headers.

## Installation on a review branch
1. `npm install` to resolve the added exact `@nestjs/jwt@11.0.2` and refresh package-lock. **A new lockfile was not fabricated in the builder's DNS-restricted environment. npm ci before syncing the lock will fail. Review and commit the lock change.**
2. `npm run identity:env` as the ordinary repository owner. It exclusively creates `identity-private/.env.identity.local`, mode 0600. Fill DB_PASSWORD with the existing local development password; keep this file private.
3. Back up the local DB. `npm run identity:migrate` explicitly creates eight `identity_*` tables and its own migration table. It does not drop or modify legacy tables and is not run automatically at startup.
4. Copy the synthetic example to `identity-private/roster.json`. Development-only testing can use the synthetic members; for a real roster get explicit organizational approval. `npm run identity:provision -- identity-private/roster.json` previews; append `--apply` to write. Omitted members are unchanged, never treated as removed. Explicit suspension revokes relevant sessions. The operator's file access is a privilege, not a public provisioning API.
5. `npm run identity:dev`. For existing local workflow DBs keep DB_SYNCHRONIZE=false. If a brand-new disposable DB needs the old non-identity entities, the old TypeORM auto-sync is available only with DB_SYNCHRONIZE=true and NODE_ENV development/test. Do not enable it for production or valuable existing data.
6. Browser frontend at localhost:8081 and API at localhost:3000 use the explicit local Origin allowlist. HTTPS and secure cookies are required outside explicit dev/test mode.

`npm run build` and `npm run test:identity` are target checks. The ordinary `npm test` does not discover this package's node:test files in test/; use the new script.

## Local verification — 2026-10-07
- Applied the bundle against its exact backend baseline on `codex/identity-session-phase-a`; updated `package-lock.json` with `npm install`. Existing locked package versions were retained.
- Full Nest build passed. The delivered noop callback guards needed explicit terminal `return fail(...)` branches for TypeScript to narrow validated arrays/booleans; rejection behavior is unchanged.
- All 26 identity tests passed (24 delivered tests plus two regressions for legacy memory column widths and request ID limits). The HTTP integration test and admin CLI also passed dependency-aware typechecking.
- The actual IdentityModule JwtService codec passed signing/verifying, payload-tamper rejection, and expiry rejection under Node 24.19.0, using random in-memory secrets without database access.
- The existing Jest suite has one passing AppController test and two unchanged Users tests failing because their test modules omit UsersService/UserRepository dependencies. A broader typecheck also finds an unchanged `supertest` namespace-import error in `test/app.e2e-spec.ts`; this file is excluded from the application build.
- No migration, roster apply, private environment generation, real HTTP/PostgreSQL integration, SMS, deployment, or production qualification was performed. `git diff --check` passed.

## Previous B/A2 n8n smoke workflows
This patch does not edit n8n or Compose. Anonymous requests now return 401 intentionally.
For the **bounded development noop test only** generate a separate random AUTH_SMOKE_SERVICE_KEY and set it privately in the backend environment. Add `X-DARA-Smoke-Key` Header Auth credentials to BOTH /orchestrate and /tool-result n8n nodes. Never put it in the mobile/PWA app or production environment. Only the exact text `tool:test`, only `noop.test`, and only the two paths are accepted. A browser Origin is rejected. The service identity is `service:local-noop-test`, not the userId supplied in the body. Restart the Nest process after environment changes.

The backend now defaults to loopback. For a containerized n8n client, review bind/firewall/proxy topology separately; host.docker.internal does not magically expose a loopback-only listener. Do not expose the development service API through the public n8n Cloudflare hostname to fix connectivity. This change does not grant a production execution callback identity.

## Real HTTP/JWT/PostgreSQL test (NOT executed by builder)
Requires a new empty, dedicated LOCAL PostgreSQL database with a name ending in `_identity_test`. This script rejects nonempty DBs and never drops anything.
Set IDENTITY_TEST_DATABASE_URL privately in identity-private/.env.identity.local and:
`IDENTITY_TEST_OPT_IN=CREATE_IDENTITY_TABLES_IN_EMPTY_TEST_DATABASE`
Then `npm run test:identity:http`.
It uses real JwtService and PostgreSQL, but a fake OrchestratorService to test HTTP identity binding safely. No SMS or external tools. It retains its synthetic tables for inspection. It is not a native device or browser cookie-engine test.

## Known ceilings / operator obligations
- The PostgreSQL adapter serializes identity transactions with one advisory lock. Correctness-first pilot design; throughput for 250 sessions is NOT benchmarked. No network call happens under the transaction lock. Account-scoped row locks are a later, separately tested optimization.
- Secrets and runtime configuration have no default production password/key. Runtime roles cannot be granted by the app. Runtime DB grants/RLS/least-privilege role provisioning are deployment tasks not implemented here.
- Existing MemoryService/RouterService log content in the baseline. This patch adds no OTP/token logs and strips response debug but is not a full historic logging/privacy audit.
- First/last names are user assertions, not verified legal identity. Phone_verified_at is set only after a nondevelopment challenge is verified.
- The HTTP SMS bridge contract is POST {phone,code,ttlSeconds}, bearer authorization, HTTPS, redirects disabled, ten-second timeout, no retries. It is not a vendor-specific production integration. Delivery error timing may disclose eligibility; rigorous enumeration-resistance is not claimed.
- Client refresh operations are serialized. A lost rotation response can require re-login; there is no unsafe token replay grace period and no claim of exactly-once network delivery.
- Run `npm run identity:cleanup` to preview expired challenge/rate/token housekeeping; append `-- --apply` to remove only rows expired for more than 24h. Consumed refresh tokens are retained until absolute family expiry so replay remains detectable. Sessions, persons, memberships and import history are not automatically deleted. Agree a retention policy before production.
- No automatic migration rollback is provided; down refuses destructive auth-table deletion. Restore code on a reviewed branch while retaining data, and plan any DB restoration explicitly. No Docker volume deletion.
