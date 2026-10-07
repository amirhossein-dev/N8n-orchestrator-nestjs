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

## HTTP runtime checkpoint — 2026-10-07
- Actual `npm run test:identity:http` passed with **39 checks**, real JwtService and PostgreSQL 15.19. OrchestratorService and legacy UsersService were mocked; their controllers and the identity engine were real. SMS and native SecureStore were not exercised.
- The tested source is now committed as `662be9276b340a136ce8f5b66648321ebff742a5` on `codex/identity-users-route-fix`, verified on origin. The run itself preceded that commit; the four source/test files below retain the exact tested bytes. The new guard was included, not only the previously tracked files.
- Working tree before this checkpoint documentation: only the pre-existing `package-lock.json` change. Its SHA-256 is `f8aaaf1e7457ea23a8dbbaface968df987250bbcd76ba777e08b6f103901cee5`; the existing binary diff SHA-256 is `f472d2bc4a0ec702eb46066ff7be3174e3408e65dd3dd345a80548320e3adbc7`. This documentation is an additional uncommitted change.
- Node v24.18.0 / npm 11.16.0. Nest build, production and integration typechecks, 26 identity logic tests, initialization-failure cleanup and independent patch review passed. Earlier Jest setup failures remain separate; the full Jest suite was not rerun.
- Real routing reproduced the old `/Users` bypass before the fix. After the controller guard, casing/slash/query/HEAD/native/prefix variants are denied, with zero legacy service calls. Authorized identity, orchestrate binding, logout, JWT tamper rejection and refresh/replay controls passed.
- Fresh `template0` test databases `dara_phase_a_20261007_identity_test` and `dara_phase_a_20261007_2_identity_test` remain intact. `mydb` was not used. Browser acceptance requires a separate fresh database and is not established by this HTTP checkpoint.
- Sanitized actual receipt: `TARGET_HTTP_IDENTITY_TEST_PASSED`, `checks=39`, `realJwt=true`, `realPostgresql=true`, `smsSent=false`, `orchestratorBusinessLogic=mocked`, `nativeSecureStoreTested=false`. The retained local receipt is in the Codex Security standalone artifact collection for this repository (`artifacts/phase-a-http-20261007.actual.json`).

| Tested file | SHA-256 |
|---|---|
| src/identity/identity.http.ts | e894d7aa866d52fee8f2bc4a7d54d5b297c5131b548e78c36aa7869550284352 |
| src/users/users.controller.ts | 2548634f327c826607da9e661dffe52fa7e60ccb07a3d3ea5ad8183cc2a0b34c |
| src/users/legacy-users-disabled.guard.ts | 62630d56e95af7d515018d8f8cb7c7c5119ffa7a7e08222f886645059567019b |
| test/identity-http.integration.ts | 8e4cc848b56419d036d6055f1bcb22ed3caac04853c95845947ca0830f00a574 |

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

## Local Web acceptance — 2026-10-08

The real Expo UI → `src/main.ts` Nest bootstrap → PostgreSQL path passed W01–W14 in Chromium 151.0.7922.34 and Firefox 153.0: 28 passed, 0 failed, 0 blocked. This adds browser evidence to the earlier 39-check HTTP checkpoint; it does not rerun or expand that HTTP/JWT result.

The isolated API used `http://localhost:3100`, bound to `127.0.0.1`, with Expo at `http://localhost:8082`. PostgreSQL 15.19 used the fresh database `dara_phase_a_browser_20261007_01_test`. Only the identity migration and synthetic roster provisioning ran; `DB_SYNCHRONIZE=false` remained set. The previous HTTP databases and `mydb` were untouched.

The ignored, mode-0600 `identity-private/.env.identity.browser.local` held independent development secrets and `development_test` OTP configuration. The controlled runner explicitly loaded this file after removing inherited AUTH/DB/runtime variables for migration, provisioning and startup. Existing `identity:*` npm scripts still name `.env.identity.local`; using them directly is not evidence of targeting the browser environment.

Checks included real cookie restoration, CSRF/Origin denial, replay rejection, three real UI logins in independent contexts, logout-all isolation, and preview/apply suspension of a synthetic membership. OTP limits remained unchanged; six real cooldown waits were observed. Normal login responses were not mocked or intercepted. No orchestrator/business or external requests were observed.

The browser regression fixed only frontend error handling for late responses from an old session. The previously committed controller-level `LegacyUsersDisabledGuard` remained unchanged. Idle observation confirmed that 60-second foreground polling can advance `last_seen_at` with no human input: the current policy measures request inactivity, not human inactivity.

Both test servers were stopped after the run; the dedicated database and earlier witnesses were retained. The retained harness/runner are local execution witnesses with fixed target paths and roster names. A future run needs a fresh database, a new private env/roster file, and coordinated target assertions in copies of those scripts; do not overwrite the existing env or clear evidence databases to reuse them.

The tested backend HEAD was `662be9276b340a136ce8f5b66648321ebff742a5`; documentation and the user's existing lockfile changes were uncommitted. See the [sanitized receipt](/home/daraarian/.codex/state/plugins/codex-security/scans/N8n-orchestrator-nestjs/artifacts-c806da034dd4f5aba6f4375d96020af0e56dc5a2a7059808d8ea43d00fac36b2/artifacts/phase-a-browser-20261008.receipt.json) and [scenario matrix/report](/home/daraarian/.codex/state/plugins/codex-security/scans/N8n-orchestrator-nestjs/artifacts-c806da034dd4f5aba6f4375d96020af0e56dc5a2a7059808d8ea43d00fac36b2/hardening/phase-a-browser-acceptance-20261008.md) for source manifests and scope. This stage made no commit or push and does not qualify native, SMS, production TLS, business tools, load capacity, or complete project Jest coverage.
