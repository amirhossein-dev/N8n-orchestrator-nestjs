# Conversation Continuity v0.1 (B2)

Development implementation; production qualification is **false**. A conversation belongs to one authenticated user in one active tenant, independently of a login session. Saved text is not validated knowledge, cognitive memory, RAG, or evidence of sales impact. History displayed in the UI is larger than the bounded context sent to Gemini.

## Existing boundaries

Same IdentityEngine, native Bearer/refresh/SecureStore and Web HttpOnly cookie/CSRF. No credentials enter the chat store. Same Gemini adapter, model, key, system instruction, SDK, timeout, output limit and no-retry policy. `/chat/reply` remains authenticated and stateless for compatibility. The new UI calls only the durable API.

Conversation access is private even for manager/admin roles. Every list/read/write/status operation revalidates session, user, tenant and membership and filters by principal user + tenant. Missing/inaccessible conversation IDs return the same 404. The internal `revalidateInTransaction` seam reuses the existing IdentityEngine predicate, expected-denial values and PgTx adapter; it adds no auth rules or public identity endpoint.

## API v1.0

All writes require existing authorization and Web CSRF. Unknown body/query fields fail with 400. Paginated GETs accept the installed React Native fetch polyfill's numeric `_` cache-buster (one string of 1–16 digits), ignore it for domain behavior, and reject malformed/repeated values. UUIDs are validated. Bodies cannot supply owner, tenant, history, system instructions, roles or provider settings. Responses are `Cache-Control: no-store` through existing Nest middleware.

| Method / path | Input | Result |
|---|---|---|
| POST `/chat/conversations` | `{clientRequestId: UUID}` | 201 `{version:'1.0', conversation}`; replay returns the same conversation |
| GET `/chat/conversations` | optional `cursor`, `limit` (1–50; default 30) | `{version, conversations, nextCursor}` |
| GET `/chat/conversations/:id/messages` | optional `before`, `limit` (1–50; default 30) | `{version, conversation, messages, requests, nextCursor}` |
| POST `/chat/conversations/:id/messages` | `{clientRequestId: UUID, text: string}` | 202 pending or 200 terminal stored request envelope |
| GET `/chat/conversations/:id/requests/:key` | none | same stored request envelope, no model call |

`conversation = {id,title,createdAt,updatedAt}`. Title starts as “New conversation” and becomes the first message's whitespace-normalized first 80 characters, without inference. Conversation pages use immutable server creation sequence, newest first; updating a conversation does not reorder previous cursor pages. Message pages select newest records before a server sequence and return those selected records oldest first. Timestamps are epoch milliseconds. Cursors are opaque to the UI and never grant access.

`message = {id,turnId,role:'user'|'assistant',text,order,createdAt}`.
`request = {version:'1.0',conversationId,clientRequestId,turnId,order,status,startedAt,deadlineAt,completedAt,error,messages}`.
The messages endpoint includes requests for selected turns plus the latest turn so reopening can reconcile pending state. Each request has at most two messages. Client validators reject mismatched identity-of-resource, malformed status/message combinations and invalid order. Stored provider metadata/context IDs are not returned to the UI.

Sanitized conflicts: `REQUEST_KEY_CONFLICT` (same key, different exact text), `CONVERSATION_BUSY` (different key while pending), both 409. Validation: `INVALID_CONVERSATION_REQUEST` / `INVALID_CONVERSATION_QUERY` 400. Access: existing identity errors; `CONVERSATION_NOT_FOUND` / `REQUEST_NOT_FOUND` 404. The UI translates errors rather than displaying raw provider or transport errors.

## Additive schema

- `chat_conversations`: server UUID, membership FK `(tenant_id,owner_user_id)`, unique create key within owner/tenant, immutable list sequence, title, times and next-turn counter.
- `chat_turns`: conversation FK, unique client key and server turn order, exact validated text fingerprint, server attempt UUID, status/deadline/completion/error, selected context message IDs and nullable provider/model/latency/usage. Missing usage remains null/absent, not zero.
- `chat_messages`: server UUID, composite `(turn_id,conversation_id)` FK, role/text/server order/time. Unique role per turn and order per conversation. Only valid received assistant output is inserted.
- A partial unique index allows one pending turn per conversation. No identity schema changes, transcript import, deletes, schema sync or auto migration.

## Admission, inference and completion

1. A short PostgreSQL transaction takes the existing identity advisory lock, revalidates with the same transaction manager, then locks the owner-scoped conversation. It closes expired pending records, checks duplicate/conflicting keys, captures bounded context, and commits one pending turn + one user message.
2. The existing ChatService/provider runs outside every SQL transaction/lock.
3. A short second transaction repeats identity and ownership checks. Only the same pending attempt before its deadline can insert assistant text and mark completed. Response is returned after commit.

All transactions use their passed manager. Global identity-lock serialization is inherited from Phase A and intentionally retained; this is not a scale qualification. DB constraints work across processes, not just within a React instance.

On in-flight session revocation or suspended membership, output is discarded; the pending turn becomes `failed / AUTHORIZATION_LOST` and no assistant is stored or returned. Existing identity denial/revocation mutations commit as expected-denial values. A still-authorized new session can inspect the saved user message/failure later.

| State | Meaning and recovery |
|---|---|
| pending | User text committed; response not yet committed. Duplicate same-key POST returns this record without another dispatch. |
| completed | User + valid assistant committed and retrievable with stable IDs/order. |
| failed | No assistant saved; sanitized failure such as not configured, quota/rate limit, invalid response or authorization lost. |
| outcome_unknown | Timeout/unavailability after possible dispatch, or stale pending past deadline. Processing/billing outside the app may have occurred. No assistant is invented and no automatic retry occurs. |

Receipt deadline is the unchanged configured provider timeout plus 5 seconds for completion. Reads/admission lazily close expired pending records. No background retry worker exists. A late old attempt cannot commit after closure; a new explicit request may use a new key only after the previous state is terminal. Same-key/same-text replay never starts inference again. This does **not** guarantee exactly-once external inference.

Client timeout is uncertainty, not a failed server write. The view keeps the unresolved key per conversation across list/detail navigation, blocks fresh sends and checks GET/status (up to 18 checks at 2-second intervals, then manual check). A reopened page retrieves server state. If GET returns REQUEST_NOT_FOUND while this runtime still retains the original request, the UI offers explicit “Recover original request”: it reuses the exact original text and key, never a new key. This may start generation if the original never arrived; an already admitted or delayed original is coalesced by the same server idempotency constraint. No timer calls this recovery. Changing identity/disposal clears the transient payload. Runtime memory is not a durable offline cache; killing the app can lose an unsent draft or local pre-admission key. Opening/listing/status never calls Gemini.

## Context and UI

Current text: at most 4,000 JS string characters. Context: only completed prior turns from this conversation, chronological server order, at most 12 entries and 16,000 total characters; entries exceeding the configured 4,000-character input bound stop selection. Current text is provided once, separately from history. No account/tenant/session/request identifiers, roles or phone numbers are added to the prompt. Full saved history remains pageable for display. Existing provider output bound is unchanged.

List/new/detail share the Android/Web codebase. Web query parameter `conversation` restores selection on direct refresh; ownership is always server checked. Desktop content is capped at 860 layout units, with flexible small-width layout. Lists are virtualized. Draft is cleared only after a stored receipt and only if the user has not edited it meanwhile. Drafts are not imported into storage. Receipt callbacks are scoped by account/tenant/session, conversation and client key; older responses cannot append to another view.

L/+/- and Deepen/Structure/Narrate selection actions remain local UI controls and add no provider instruction. Persisted replies are labeled “ASSISTANT · SAVED”; they do not invent historical L/mode metadata, which the persistence contract does not store. Legacy local transcripts are not uploaded.

B1 ownership remains: Chat owns actual top/side safe-area insets, tabs own the bottom inset, one KeyboardAvoidingView adjusts IME overlap; tab bar hides via existing `tabBarHideOnKeyboard`. No fixed phone-specific inset, extra IME height, SDK/native configuration change or APK rebuild.

## Explicit migration / local startup

Use installed dependencies. Keep `DB_SYNCHRONIZE=false` and migration auto-run disabled. Never run the old hard-coded identity env commands against B2 targets.

```sh
npm run test:continuity -- /absolute/private/dara_b2_test_unique.env
npm run chat:migrate -- /absolute/private/.env.identity.native.local dara_phase_a_native_20261010_204435
```

The test runner requires `NODE_ENV=test`, loopback, a `dara_b2_test_…` DB and `dara_b2_…` role, explicit 0600 env; it strips real provider/identity environment, creates only synthetic identity fixtures, uses the real PostgreSQL migrations/constraints and a fake provider. Never point it at runtime/evidence databases. It retains its isolated DB; it does not drop databases. Create the isolated DB/role and generated credential first through an authorized operator workflow.

Before the runtime migration, verify actual `current_database()/current_user` and take a unique private PostgreSQL backup outside repositories/public artifacts. Test first on the separate DB. The runtime migration runner accepts explicit env + expected DB, confirms loopback:55432, allows only the named native DB or isolated B2 prefix, applies the additive chat migration + `chat_migrations` ledger. `down()` intentionally rejects data deletion. Recovery is operator reviewed: stop durable writes, restore compatible application code while retaining tables/data, or use the private checkpoint only under a separate restore plan. A code rollback is not a data rollback.

Local native topology remains Nest 127.0.0.1:3101, verified loopback Metro 127.0.0.1:8083 and ADB reverse 3101/8083. Web Metro is 127.0.0.1:8084 with existing localhost API origin. When native and Web Metro run concurrently, use an isolated source-matched Web working copy and installed dependencies; verify the actual browser API origin. In this environment, a separate TMPDIR alone did not prevent native API configuration from appearing in the Web bundle; the isolated copy did. This is a development-process separation, not an auth or production configuration change. Never change Docker socket, device security or firewall to run this feature. Web export is a build check; the local HTTP development runtime is not a production deployment.

## Focused checks and limits

Repository commands: backend `npm run build`, `npm run test:chat`, `npm run test:continuity -- <isolated env>`; frontend `npm run typecheck`, `npm run test:identity`, `npm run test:chat`; both `git diff --check`; installed Expo Web export. Existing Phase B tests remain intact. PostgreSQL tests cover auth/CSRF, ownership, two-connection duplicate/busy behavior, constraints, lock release during inference, pagination, stale/late requests, outcome uncertainty, revocation and bounded server context. Client tests cover transport reuse, refresh coalescing, malformed receipts, stale identity/conversation callbacks, unresolved navigation and no automatic resend.

Execution results, exact source hashes and device/browser observations belong in the private B2 receipt. A passing build/test is not physical keyboard, actual restart, iOS/Safari, load/race, or production acceptance. See the deferred roadmap for deliberately open evidence.

## Development checkpoint — 2026-10-16 (Asia/Tehran)

Focused checks passed: backend build, existing chat 64, identity core 26, PostgreSQL continuity 20; frontend typecheck, identity 9, chat 35; both diff checks; installed Expo Web export from a source-matched isolated copy. The native additive migration was applied only after separate-DB tests and a private backup.

Actual evidence: Android created/sent and reopened saved user + assistant messages after app and Nest restart; independent Chromium Web opened the same history, preserved its route across refresh, created an empty conversation, and received a context-based continuation. Narrow 390×844 and wide 1067×750 CSS viewports had no horizontal overflow for these new pages. These are bounded observations, not all-device/browser acceptance.

Four real synthetic dispatches yielded two completed and two outcome_unknown. Android's post-restart continuation response remains BLOCKED by provider connectivity; saved-message recovery succeeded. A process-only IPv4-first diagnostic was separately operator-approved, tested, and removed at smoke completion; it did not prove a durable network repair. Provider source/model/key/config remain unchanged. No more inference is authorized within the consumed four-call smoke budget.

B1 remains implementation complete / physical acceptance partial. N09 and N10-B remain OPEN; historical Web harness remains NOT_RECOVERED; real iOS Safari NOT_TESTED; production qualification false.
