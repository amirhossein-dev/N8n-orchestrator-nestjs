# Phase B authenticated text chat

This is a bounded functional integration, not production qualification. Chat is separate from the legacy orchestrator and does not persist prompts, replies or conversation history. It does not call tools, memory, n8n or other providers.

`POST /chat/reply` is protected by the existing global IdentityGuard. Native bearer authentication and Web cookie/CSRF use the unchanged identity implementation. Active user, tenant and membership are required. The controller requires the principal, but passes no identity fields to the model provider.

```json
{
  "message": "Synthetic question",
  "history": [
    { "role": "user", "text": "Earlier synthetic question" },
    { "role": "assistant", "text": "Earlier synthetic answer" }
  ]
}
```

Only these keys are accepted. History is required (empty is valid), up to 12 entries, each text 1–4,000 JavaScript string units, up to 16,000 history units total. Message is 1–4,000 units. Whitespace-only values, client system roles, extra properties and identity fields are rejected. Config can reduce these ceilings.

HTTP 200 returns `version: "1.0"`, server-generated UUID `requestId`, `replyText`, `provider: "gemini"`, configured `model`, nonnegative `latencyMs`, and optional validated `usage.inputTokens`, `usage.outputTokens`, `usage.totalTokens`. No raw provider response is exposed. Empty, blocked, truncated, nontext or oversized output fails rather than fabricating an answer.

Errors use `{"error":"CODE"}`:

| Code                       | HTTP |
| -------------------------- | ---- |
| INVALID_CHAT_REQUEST       | 400  |
| AI_PROVIDER_NOT_CONFIGURED | 503  |
| AI_PROVIDER_TIMEOUT        | 504  |
| AI_PROVIDER_RATE_LIMITED   | 429  |
| AI_PROVIDER_UNAVAILABLE    | 503  |
| AI_INVALID_RESPONSE        | 502  |

Identity errors keep the existing status and semantics. Provider rejection of a key, model, region or account maps to provider unavailable; it is not reported as an application user's authentication error. Provider messages, payloads, credentials and error causes are not forwarded or logged.

## Private configuration

Use the existing ignored backend-only environment file `identity-private/.env.identity.native.local` for the local integration. Install `GEMINI_API_KEY` there privately; do not put it into a shell command, repository example, test fixture, transcript or frontend variable. Never copy the file into a receipt or hash it. Preserve all existing identity, DB and listener settings.

| Variable                  | Default               | Allowed                            |
| ------------------------- | --------------------- | ---------------------------------- |
| GEMINI_ENABLED            | false                 | true or false                      |
| GEMINI_API_KEY            | absent                | Private key; required when enabled |
| GEMINI_MODEL              | gemini-3.5-flash-lite | Bounded Gemini model identifier    |
| GEMINI_TIMEOUT_MS         | 12000                 | 1000–12000 ms                      |
| GEMINI_MAX_OUTPUT_TOKENS  | 1024                  | 1–2048                             |
| CHAT_MAX_HISTORY_MESSAGES | 12                    | 0–12                               |
| CHAT_MAX_MESSAGE_CHARS    | 4000                  | 1–4000                             |

The instruction in `chat.config.ts` identifies a basic, non-authoritative integration-test assistant and explicitly denies tools, files, private/persistent memory and execution capabilities. Clients cannot override it through request configuration.

The official `@google/genai` SDK is pinned to `2.29.1`. Requests use the Gemini Developer API, `models.generateContent`, one candidate, text output and `httpOptions.retryOptions.attempts: 1`. There is no automatic application retry. The deadline aborts the request and bounds waiting even if a transport does not settle. Client cancellation cannot guarantee cancellation of work already accepted by the provider. The deadline stays below the existing frontend transport's 15 seconds.

Conflicting Gemini endpoint or Vertex environment overrides are rejected. This slice does not install a proxy or alter the host network route. Requests are stateless; only the client-supplied bounded text history is provided. No grounding, tools, file uploads, cached content or code execution are configured.

## Focused checks

```sh
npm run build
npm run test:chat
```

The focused endpoint tests use the real existing guard, identity engine and JWT with an isolated in-memory identity store and fake text provider. They do not claim PostgreSQL or physical-device acceptance. Provider tests inject generation or intercept fetch and never read the private environment or make external calls.

Before frontend integration, get explicit operator confirmation that the key's project is on the free tier and has available quota. Then run exactly one backend-only smoke in the same host process environment/network route that Nest will use:

```sh
CHAT_FREE_TIER_CONFIRMED=true node --env-file=identity-private/.env.identity.native.local -r ts-node/register scripts/chat-provider-smoke.ts
```

The private file must enable Gemini and set NODE_ENV to development or test. The opt-in is an operator assertion, not an automated billing check. The script sends only `Reply with exactly: GEMINI_LINK_OK` and an empty history. It outputs a marker-match result and sanitized metadata, never the key or model text. Stop on failure; do not retry automatically, enable paid billing or change networking. Frontend changes are gated on success.

For the later Android smoke, use the task's verified loopback Metro launcher. Keep Nest at 127.0.0.1:3101 and ADB reverse for 3101 and 8083. Ask the operator to attach and authorize the device when needed; do not weaken device security or launch unrestricted Expo.

Send only these synthetic prompts in the Android Chat UI:

1. Reply with exactly: GEMINI_LINK_OK
2. My temporary test word is ORBIT-47.
3. What is the temporary test word?

Verify the actual UI reply and bounded history without logging prompt bodies. Application chat logs have only requestId/provider/model/latencyMs. Record provider, endpoint and Android evidence separately.

N09 and N10-B remain OPEN, W01–W14 remains unrecovered, and the recorded Phase A evidence is not relabeled. No claim of production readiness, persistent memory, DARA tactics, tool capability, multi-provider resilience, privacy qualification or load qualification follows from this slice. No commit, push or deployment is authorized.
