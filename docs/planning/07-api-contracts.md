# 07 — API Contracts

| | |
|---|---|
| Status | Planning only. **No controller, handler or route is implemented.** |
| Owner | API architecture |
| Style | REST over HTTPS, JSON, versioned path prefix `/v1`, OpenAPI 3.1 generated from `@ua/contracts` |
| Related | `06` (data), `08` (task semantics), `10` (authorisation), `11` (threats) |

## 1. Cross-cutting conventions

| Concern | Rule |
|---|---|
| Base URL | `https://api.<domain>/v1` for user-facing; `/admin/v1` for operator surfaces (separate auth audience) |
| Versioning | Major in the path (`/v1`). Breaking changes require a new major. Additive changes do not bump the version. Deprecation: `Deprecation` + `Sunset` headers, minimum **6 months** `[ASSUMPTION]` for public endpoints, 90 days for internal-only `[ASSUMPTION]` |
| Compatibility | Enforced by an OpenAPI diff gate in CI: removing a field, changing a type, making an optional field required, or removing an enum value **fails the build** unless the change is documented in a version-bump PR |
| Content type | `application/json; charset=utf-8` (requests); `text/event-stream` for SSE; `application/problem+json` for errors |
| Correlation | Every request carries or is assigned `X-Request-Id` (ULID) and a W3C `traceparent`. Both are echoed in the response and propagated into queue payloads, device commands, events and audit rows |
| Idempotency | Any `POST` that creates or performs an effect accepts `Idempotency-Key` (client-generated ULID/UUID). Stored per `(org, route-scope, key)` for 24 h `[ASSUMPTION]`. Replay returns the original response with `Idempotency-Replayed: true` |
| Pagination | Keyset/cursor everywhere: `?limit=` (default 25, max 100) + `?cursor=` (opaque, encodes `created_at,id` or `seq`). List responses: `{ "data": [...], "nextCursor": "..." }`. No `OFFSET` |
| Filtering/sorting | Explicit allow-listed query params per endpoint; unknown params are rejected (`400 unknown_query_param`), not ignored |
| Field selection | Not supported in v1 (avoids redaction bypass); responses use explicit DTO allow-lists |
| Timestamps | ISO 8601 UTC with milliseconds (`2026-10-15T09:30:00.123Z`) |
| Money | `{ "amountMinor": 1250, "currency": "USD" }` |
| IDs | UUIDv7 strings, opaque to clients |
| Rate limits | Applied per principal and per IP; per-org (not per-user) limits for expensive writes so one member cannot exhaust the org's budget. Headers: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and `Retry-After` on 429 |
| Errors | `application/problem+json` (RFC 9457 shape) — see §2 |
| Auth | Web: session cookie (`HttpOnly`, `Secure`, `SameSite=Lax`) with CSRF double-submit token on unsafe methods. First-party native clients: `Authorization: Bearer <access token>`. Device channel: WebSocket with a signed device challenge |
| Authorisation | Every endpoint: authenticated principal → active tenant membership → role → resource ownership → policy. Resource lookups are tenant-scoped, so a foreign ID yields **404**, never 403 |
| Redaction | Responses are built from explicit allow-lists; secrets, token hashes and credential values are structurally absent from DTOs |
| Audit | Any state-changing endpoint writes an `audit_events` row (action, actor, resource, result, reason) in the same transaction |
| Request size caps | JSON bodies ≤ 1 MB `[ASSUMPTION]`; artifact uploads go direct to object storage via pre-signed URLs, never through the API |

## 2. Standard error format

```jsonc
{
  "type": "https://docs.example.com/errors/approval-expired",
  "title": "Approval expired",
  "status": 409,
  "code": "approval_expired",
  "detail": "The approval for this action expired before it was used.",
  "instance": "/v1/tasks/018f.../steps/4/approvals/018f...",
  "requestId": "01J9Z...",
  "traceId": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  "errors": [ { "pointer": "/constraints/maxSteps", "code": "out_of_range", "detail": "must be ≤ 200" } ]
}
```

| Code family | Meaning | Client action |
|---|---|---|
| `400 invalid_request`, `validation_failed` | Malformed or schema-invalid | Fix the request; `errors[]` points at fields |
| `401 unauthenticated` | Missing/expired credential | Re-authenticate |
| `403 forbidden`, `insufficient_role` | Authenticated but not permitted | Do not retry |
| `404 not_found` | Absent **or** not visible to this tenant | Do not retry |
| `409 conflict`, `idempotency_conflict`, `state_conflict`, `approval_expired` | Precondition or state conflict | Re-read state |
| `410 gone` | Deleted/resource retired | Remove from UI |
| `413 payload_too_large` | Body/artifact too big | Split |
| `422 unprocessable_entity` | Schema-valid but semantically impossible | Show the message |
| `429 rate_limited` | Quota/rate | Honour `Retry-After` |
| `500 internal_error` | Unhandled | Retry with backoff, report with `requestId` |
| `502/503/504` | Upstream/unavailable/timeout | Retry with jitter |

Rules: error `detail` never contains a secret, a file path outside the workspace,
a stack trace, or another tenant's data. Internal error IDs map to server logs.

## 3. Endpoint groups

Rate-limit classes (proposed): `A` cheap reads (600/min/principal `[ASSUMPTION]`) ·
`B` standard mutations (120/min) · `C` expensive creates — tasks, uploads,
cloud execution (30/min, plus per-org concurrency caps) · `D` auth-sensitive
(10/min per IP+account) · `E` admin (60/min, audited).

### 3.1 Authentication

| Method & path | Purpose | Authn | Authz | Class | Idem |
|---|---|---|---|---|---|
| `POST /v1/auth/register` | Create account + personal org | none | — | D | optional |
| `POST /v1/auth/login` | Password sign-in | none | — | D | no |
| `POST /v1/auth/login/verify` | Complete MFA challenge | partial (mfa ticket) | — | D | no |
| `POST /v1/auth/refresh` | Rotate refresh token | refresh token | own session | D | no |
| `POST /v1/auth/logout` | Revoke current session | session | own session | B | yes |
| `POST /v1/auth/password/reset/request` | Send reset link | none | — | D | no |
| `POST /v1/auth/password/reset/confirm` | Apply new password | reset token | — | D | no |
| `POST /v1/auth/email/verify` | Verify email | token | — | D | no |
| `POST /v1/auth/mfa/enroll`, `POST /v1/auth/mfa/verify`, `DELETE /v1/auth/mfa` | TOTP lifecycle | session | own account | D | yes |
| `POST /v1/auth/step-up` | Re-authenticate for R3 actions | session | own account | D | no |
| `GET /v1/auth/sessions` · `DELETE /v1/auth/sessions/{id}` | List/revoke sessions | session | own sessions | A/B | yes |
| `POST /v1/auth/oauth/{provider}/start` · `GET /v1/auth/oauth/{provider}/callback` | Federated sign-in (`[OPEN]` Phase 9) | none | — | D | no |
| `POST /v1/auth/device/code` | Create device-authorisation code | session | own account | D | no |
| `POST /v1/auth/device/approve` | Approve a device (browser) | session | own account | D | yes |
| `POST /v1/auth/device/token` | Exchange code+device key for device credentials | code + device public key | — | D | no |

Representative request/response (`POST /v1/auth/login`):

```jsonc
// request
{ "email": "a@b.com", "password": "…", "organizationId": null, "deviceName": "Web" }
// 200 (no MFA)
{ "user": { "id": "018f…", "email": "a@b.com", "displayName": "A" },
  "organizations": [ { "id": "018f…", "name": "Personal", "role": "owner" } ],
  "activeOrganizationId": "018f…",
  "accessToken": null, "expiresAt": "2026-10-15T10:30:00.000Z" }  // web: cookie set, token null
// 200 (MFA required)
{ "mfaRequired": true, "mfaTicket": "…", "expiresAt": "2026-10-15T09:40:00.000Z" }
// errors: 401 invalid_credentials, 403 account_suspended, 429 rate_limited
```

### 3.2 Users and organizations

| Method & path | Purpose | Authz | Class | Idem |
|---|---|---|---|---|
| `GET /v1/me` | Current user + memberships | self | A | — |
| `PATCH /v1/me` | Profile (name, locale, timezone) | self | B | yes |
| `GET/PATCH /v1/me/notification-preferences` | Channels | self | A/B | yes |
| `GET /v1/organizations` | List my orgs | membership | A | — |
| `POST /v1/organizations` | Create org | any user | B | yes |
| `GET/PATCH/DELETE /v1/organizations/{orgId}` | Read/update/delete org | `admin`/`owner` (`DELETE` = `owner` + step-up) | B | yes |
| `GET /v1/organizations/{orgId}/members` · `PATCH .../members/{userId}` (role) · `DELETE ...` | Membership | `admin`+ (`owner` required to change owners) | B | yes |
| `POST /v1/organizations/{orgId}/invitations` · `DELETE .../{id}` | Invite/cancel | `admin`+ | B | yes |
| `POST /v1/invitations/{token}/accept` | Accept invite | authenticated user | B | yes |
| `GET /v1/organizations/{orgId}/settings` · `PATCH` | Execution location default, retention days, policy refs | `admin`+ | B | yes |
| `GET/POST /v1/organizations/{orgId}/service-accounts` | Service accounts (+ scopes) | `owner` | B | yes |
| `POST /v1/organizations/{orgId}/export` · `GET .../exports/{id}` | Data export job | `owner` | B | yes |
| `POST /v1/organizations/{orgId}/transfer-ownership` | Owner transfer | `owner` + step-up | C | yes |

### 3.3 Tasks

| Method & path | Purpose | Authz | Class | Idem |
|---|---|---|---|---|
| `POST /v1/tasks` | Create a task (durable, enqueued) | `member`+ | C | **required** |
| `GET /v1/tasks` | List/filter (state, tool, workspace, date, device) | `member`+ (viewer: own org, redacted) | A | — |
| `GET /v1/tasks/{taskId}` | Task detail incl. current plan + budget | `member`+ | A | — |
| `POST /v1/tasks/{taskId}/cancel` | Request cancellation (cooperative) | `member`+ (creator or admin) | B | yes |
| `POST /v1/tasks/{taskId}/pause` · `/resume` | Pause/resume | `member`+ | B | yes |
| `POST /v1/tasks/{taskId}/retry` | Retry a failed task from a step | `member`+ | C | yes |
| `POST /v1/tasks/{taskId}/approve-plan` | Accept a plan (when policy requires plan review) | `member`+ | B | yes |
| `GET /v1/tasks/{taskId}/steps` | Step list with state, risk class, cost | `member`+ | A | — |
| `GET /v1/tasks/{taskId}/steps/{seq}` | Step detail incl. arguments preview + result | `member`+ | A | — |
| `POST /v1/tasks/{taskId}/steps/{seq}/retry` | Retry one step | `member`+ | B | yes |
| `GET /v1/tasks/{taskId}/artifacts` | Artifact list | `member`+ | A | — |
| `POST /v1/artifacts/{artifactId}/download-url` | Short-lived pre-signed download | `member`+ | A | — |
| `POST /v1/tasks/{taskId}/artifacts` | Register an artifact + request upload URL | `member`+ | C | yes |
| `GET /v1/tasks/{taskId}/explain` | Why: matched policy rules, risk classes, approvals | `member`+ | A | — |

Representative create (`POST /v1/tasks`):

```jsonc
// request (Idempotency-Key required)
{
  "goal": "Upgrade this repo's dependencies and show me the diff",
  "executionLocation": "device",          // "cloud" requires org opt-in + consent
  "deviceId": "018f…",
  "workspaceId": "018f…",
  "agentSessionId": null,
  "attachments": [{ "kind": "file", "name": "package.json", "sha256": "…", "sizeBytes": 2134 }],
  "constraints": { "maxSteps": 60, "maxWallClockSeconds": 3600, "maxTokens": 400000,
                   "maxCostMinor": 500, "requirePlanApproval": true },
  "modelOverrides": { "planner": "local:qwen2.5-coder:7b", "executor": null },
  "allowedTools": ["fs.read", "fs.write", "shell", "git", "code.engine"]
}
// 201
{ "task": { "id": "018f…", "state": "QUEUED", "executionLocation": "device",
            "createdAt": "2026-10-15T09:30:00.000Z", "riskClass": "R0" },
  "streamUrl": "/v1/tasks/018f…/stream",
  "links": { "self": "/v1/tasks/018f…", "events": "/v1/tasks/018f…/events" } }
// errors: 400 validation_failed, 403 cloud_execution_not_enabled, 409 idempotency_conflict,
//         404 workspace_not_found, 409 device_offline, 429 quota_exceeded, 422 goal_ambiguous
```

List response shape (every list):

```jsonc
{ "data": [ { "id": "018f…", "state": "RUNNING", "goalSummary": "Upgrade dependencies",
              "riskClass": "R2", "costMinor": 12, "startedAt": "…", "finishedAt": null } ],
  "nextCursor": "eyJjcmVhdGVkQXQiOiI…" }
```

### 3.4 Task events (streaming and history)

| Method & path | Purpose | Authz | Notes |
|---|---|---|---|
| `GET /v1/tasks/{taskId}/events?after={seq}&limit=` | Historical events (keyset by `seq`) | `member`+ | Backfill/resync; capped page |
| `GET /v1/tasks/{taskId}/stream` | SSE live stream | `member`+ | See §5 |
| `GET /v1/stream` | Multiplexed SSE for all my org activity (dashboard) | `member`+ | Server-side filter by membership |
| `GET /v1/tasks/{taskId}/events/{seq}` | Single event (deep link) | `member`+ | Immutable |

### 3.5 Approvals

| Method & path | Purpose | Authz | Class | Idem |
|---|---|---|---|---|
| `GET /v1/approvals` | Inbox: `state`, `riskClass`, `deviceId`, `taskId`, age sort | `member`+ (only their own pending items unless `admin`) | A | — |
| `GET /v1/approvals/{id}` | Full context: action, target, arguments preview, effect preview, policy rule, expiry | `member`+ | A | — |
| `POST /v1/approvals/{id}/grant` | Approve (optional scope + step-up token for `R3`) | `member`+ (creator of the task, or approver per policy) | B | **required** |
| `POST /v1/approvals/{id}/deny` | Deny with reason | same | B | required |
| `GET /v1/orgs/{orgId}/grants` | Standing grants (tool/workspace scoped) | `member`+ | A | — |
| `DELETE /v1/grants/{grantId}` | Revoke a standing grant | grant creator or `admin` | B | yes |
| `GET /v1/orgs/{orgId}/policies` · `POST` · `PUT /{version}` | Policy documents and versions | `admin`+ | B | yes |
| `POST /v1/orgs/{orgId}/policies/{version}/simulate` | Dry-run a policy against a sample action (no side effects) | `admin`+ | A | — |

Representative grant:

```jsonc
// request
{ "scope": "once",                 // "once" | "minutes" | "task" | "standing"
  "minutes": null,
  "standing": { "tool": "shell", "workspaceId": "018f…", "expiresAt": "2026-11-01T00:00:00Z", "argvAllowList": ["npm ci", "npm test"] },
  "stepUpToken": null }
// 200
{ "approval": { "id": "018f…", "state": "granted", "decidedAt": "…", "decidedBy": "018f…" },
  "grant": { "id": "018f…", "expiresAt": "2026-10-15T09:45:00.000Z", "useCount": 0, "maxUses": 1 },
  "boundTo": { "actionDigest": "sha256:…", "argumentsDigest": "sha256:…", "policyVersion": 7 } }
// errors: 403 not_eligible_approver, 409 approval_already_decided, 410 approval_expired,
//         422 step_up_required, 409 digest_mismatch
```

### 3.6 Devices and workspaces

| Method & path | Purpose | Authz | Class | Idem |
|---|---|---|---|---|
| `POST /v1/devices/pairing-codes` | Start device authorisation | `member`+ | D | yes |
| `POST /v1/devices` | Register device (public key + capabilities) | pairing code | D | yes |
| `GET /v1/devices` | List org devices (status, last seen, capabilities) | `member`+ | A | — |
| `GET /v1/devices/{id}` | Detail + effective policy + model inventory | `member`+ | A | — |
| `PATCH /v1/devices/{id}` | Rename, set allowed workspaces | owner or `admin` | B | yes |
| `POST /v1/devices/{id}/revoke` | Revoke (invalidates grants, expires commands) | owner or `admin` + step-up | B | yes |
| `WS /v1/devices/{id}/channel` | Device command/event channel (device-authenticated) | device key | — | — |
| `GET /v1/devices/{id}/commands?cursor=` | Long-poll fallback | device key | A | — |
| `POST /v1/devices/{id}/commands/{cmdId}/ack` | Acknowledge a command | device key | B | yes |
| `POST /v1/devices/{id}/events` | Device-reported progress/result batches (idempotent by `eventId`) | device key | B | yes |
| `GET/POST /v1/workspaces` · `PATCH/DELETE /v1/workspaces/{id}` | Workspace registry | `member`+ (delete: owner) | B | yes |
| `POST /v1/devices/{id}/diagnostics` | Upload a diagnostics bundle (redacted by the runner) | owner | C | yes |

### 3.7 Integrations, models, usage, notifications, admin, health

| Method & path | Purpose | Authz | Class |
|---|---|---|---|
| `GET /v1/integrations/catalog` | Available integrations + data-sharing declaration | `member`+ | A |
| `GET/POST /v1/integrations` (connect) · `DELETE /v1/integrations/{id}` | Connection lifecycle | `admin`+ | B |
| `POST /v1/integrations/{id}/test` | Health check | `admin`+ | B |
| `GET /v1/model-providers` · `PUT /v1/model-providers/{provider}` | Provider policy, allowed models, budgets | `admin`+ | B |
| `POST /v1/model-providers/{provider}/test` | Connectivity + model listing | `admin`+ | B |
| `GET /v1/devices/{id}/models` | Local model inventory + health | `member`+ | A |
| `GET /v1/usage?metric=&from=&to=&groupBy=` | Usage series (org or member) | `member`+ | A |
| `GET /v1/usage/summary` · `GET /v1/quotas` | Current period + limits | `member`+ | A |
| `GET /v1/notifications` · `POST /v1/notifications/{id}/read` · `POST /v1/notifications/read-all` | In-app notifications | self | A/B |
| `GET/POST /v1/webhooks` · `PATCH/DELETE /v1/webhooks/{id}` · `POST .../{id}/rotate-secret` | Customer webhooks | `admin`+ | B |
| `GET /v1/webhooks/{id}/deliveries` | Delivery log (paginated) | `admin`+ | A |
| `GET /health/live` · `GET /health/ready` | Liveness/readiness (no auth, no tenant data, minimal detail) | none | A |
| `GET /health/dependencies` | Dependency status — **admin/operator only** | operator | E |
| `GET /admin/v1/users` · `GET /admin/v1/orgs` · `GET /admin/v1/devices` | Operator listing (search, cursor) | operator | E |
| `POST /admin/v1/orgs/{id}/quota-overrides` · `POST /admin/v1/feature-flags` | Administrative overrides | operator (audited) | E |
| `GET /admin/v1/audit-events` | Audit search (actor, action, resource, time, result) | `admin`+/operator | E |
| `GET /admin/v1/queues` · `POST /admin/v1/queues/{q}/pause` · `/drain` | Operational controls | operator (audited, step-up) | E |
| `POST /admin/v1/devices/{id}/force-revoke` | Platform-level revocation | operator (audited) | E |
| `POST /admin/v1/impersonation` (start/stop) | Support impersonation, time-boxed, audited, banner shown | operator (step-up) | E |

Model-provider note: `[ASSUMPTION]` selected request/response schemas for the
above are specified in `@ua/contracts` at implementation time; this document
fixes the surface, the authorisation rule and the error codes, not the final
field list.

## 4. Webhook (outbound) contracts

| Field | Rule |
|---|---|
| Payload | `{ "id", "type", "organizationId", "createdAt", "data": {…} }` |
| Signature | `X-UA-Signature: t=<unix>,v1=<hex hmac-sha256(secret, t + "." + body)>`; receiver must reject > 5 min skew `[ASSUMPTION]` |
| Replay protection | `id` is unique per event; receivers should dedupe on it |
| Delivery | At-least-once, exponential backoff (1 s → 1 m → 5 m → 30 m → 2 h → 6 h, 6 attempts `[ASSUMPTION]`), then the endpoint is marked `degraded` and the owner is notified |
| Event types (initial) | `task.queued`, `task.started`, `task.completed`, `task.failed`, `task.cancelled`, `approval.requested`, `approval.granted`, `approval.denied`, `approval.expired`, `device.offline`, `device.revoked`, `quota.threshold_reached` |
| Redaction | Webhook payloads contain metadata and summaries, never file contents or credentials |

## 5. SSE contract (task progress)

| Concern | Design |
|---|---|
| Endpoint | `GET /v1/tasks/{taskId}/stream` and `GET /v1/stream` (multiplexed) |
| Auth | **Cookies work for same-origin browser SSE.** Because native `EventSource` cannot set headers, cross-origin/native clients use `fetch()` + `ReadableStream` with a Bearer token, or a 60-second single-use stream ticket: `POST /v1/tasks/{id}/stream-ticket` → `?ticket=…`. **No long-lived token in a URL** (it would land in logs) |
| Resume | Every event has `id` = `{taskId}:{seq}`. The client sends `Last-Event-ID`; the server replays from `seq+1` out of `task_events`, then switches to live. **State beats stream:** on any gap the client refetches `GET /v1/tasks/{id}` |
| Heartbeat | Comment frame (`:hb`) every 15 s `[ASSUMPTION]` to defeat proxy idle timeouts |
| Backpressure | Per-connection bounded buffer; on overflow the server drops to "resync required" (sends `event: resync` and the client refetches), rather than unbounded memory growth |
| Fan-out | Redis pub/sub per `task:{id}` and per `org:{id}`; API replicas hold the client sockets, so any replica can serve any client |
| Ordering | Per-task monotonic `seq` guarantees causal order; cross-task ordering is not promised |
| Reconnect | Client backoff 1 s → 2 s → 4 s → … → 30 s with jitter; after 3 failures it polls `GET /tasks/{id}` every 10 s until the stream recovers |
| Limits | `[ASSUMPTION]` max 10 concurrent streams per user, 60-minute max stream lifetime with transparent re-establishment |
| Termination | `event: done` when the task reaches a terminal state; the client then stops reconnecting |

## 6. Internal contracts (queue jobs, device commands, events)

`[PROPOSED]` All defined once in `@ua/contracts` and validated at **produce and
consume**. Payloads carry `organizationId`, `traceId`, `schemaVersion`, and
never a secret.

| Contract | Fields (sketch) | Notes |
|---|---|---|
| `task.plan` | `taskId`, `organizationId`, `traceId`, `attempt` | Planner job |
| `task.step.execute` | `taskId`, `stepId`, `seq`, `executionLocation`, `deviceId`, `leaseId` | Dispatched exactly once per lease |
| `task.verify` | `taskId`, `stepId`, `assertions[]` | Verification job |
| `tool.execute.*` | `taskId`, `stepId`, `toolName`, `toolVersion`, `argumentsRef` | Arguments held in the DB; the payload carries a reference + digest, not the blob |
| `device.command` | `commandId`, `deviceId`, `kind`, `payload`, `digest`, `expiresAt` | Also persisted in `device_commands` for durability |
| `device.event` | `eventId`, `deviceId`, `taskId`, `stepId`, `type`, `data`, `digest` | Idempotent by `eventId` |
| `approval.requested` / `.decided` | `approvalRequestId`, `digest`, `policyVersion` | Decided payload carries no grant token |
| `usage.record` | `metric`, `quantity`, `idempotencyKey`, `taskId` | Exactly-once by key |
| `notification.send` | `userId`, `kind`, `ref`, `channels[]` | Preference-resolved by the consumer |
| `webhook.deliver` | `endpointId`, `eventId`, `attempt` | Signed at send time |
| Task event types | `task.created`, `task.state_changed`, `plan.created`, `step.started`, `step.output`, `step.succeeded`, `step.failed`, `approval.requested`, `approval.granted`, `approval.denied`, `approval.expired`, `artifact.created`, `verification.passed`, `verification.failed`, `task.completed`, `task.failed`, `task.cancelled`, `task.expired`, `budget.exhausted`, `loop_detected` | `task_events.type`; each has a documented `data` schema and a size cap |

Rationale for reference-plus-digest payloads: keeping large or sensitive blobs
out of the queue means (a) Redis never holds user content, (b) an event can be
replayed deterministically, (c) a queue dump is not a data breach.

## 7. OpenAPI generation and contract enforcement

`[PROPOSED]`

1. `@ua/contracts` holds Zod schemas: `Task`, `TaskStep`, `ApprovalRequest`,
   request DTOs, error shapes, event payloads, queue payloads, tool manifests.
2. The API decorates routes with the schema; a generator emits **OpenAPI 3.1**
   to `contracts/openapi.json` (committed) on demand.
3. A generator emits `@ua/client` — a typed fetch client (plus an SSE helper)
   used by web, admin, desktop and the VS Code extension. One client, one
   behaviour.
4. CI gates: (a) `openapi.json` must match the generator output (drift fails the
   build); (b) an OpenAPI **diff** check fails on breaking changes; (c) contract
   tests run the client against a live API for a representative subset.
5. The desktop/IDE clients are versioned against `@ua/contracts`; a client
   older than N majors is refused at connect time with a clear upgrade message.

## 8. Open API questions

| # | Question | Impact |
|---|---|---|
| Q-A1 | Should task creation accept an uploaded file directly (inline) or only reference pre-uploaded artifacts? | Simplicity vs. round-trips; proposal: artifacts first, `attachments[]` references only |
| Q-A2 | Do we need a bulk endpoint for artifact uploads (multi-file task input)? | Document workflows |
| Q-A3 | Does the SSE multiplexed endpoint need per-org rate limiting separate from task streams? | Fan-out cost |
| Q-A4 | Should approvals be routable to email/push in v1, or in-app only plus webhook? | FR-NOTIF-02 coverage |
| Q-A5 | `[OPEN]` public API access for customers (API keys/service accounts) in v1, or web app only? | Product scope, ABAC design |

Labels: `[FACT]` `[ASSUMPTION]` `[PROPOSED]` `[OPEN]`
