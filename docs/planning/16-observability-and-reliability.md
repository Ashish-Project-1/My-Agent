# 16 — Observability and Reliability

| | |
|---|---|
| Status | Planning only. `[FACT]` No exporter, collector config, dashboard, alert rule, SLO definition or metric emitter exists in this repository (verified 2026-10-15: the repo holds four root files and `docs/planning/` only). **Nothing here is running.** |
| Owner | Platform operations (P-5 operator persona) |
| Scope | Telemetry (logs, metrics, traces), SLOs, alerts, runbooks, reliability patterns, health endpoints, backup/DR, incident management, and the observability of the local runner |
| Depends on | `02` (NFR IDs), `03` (components, invariants §10), `06` (tables, backup), `07` (endpoints, health), `08` (engine, budgets, recovery), `09` (runner heartbeat, diagnostics), `10` (approvals, audit), `11` (threats, RR-4/RR-5, §9 gates) |
| Builds on | D-13 (OpenTelemetry 0.223 → Grafana LGTM, managed first), D-12 (Kubernetes only from Phase 10) |
| Hand-off | Thresholds belong to `13` (capacity); SLO targets are pinned by `02`. This document defines the *signal*, not the number. |

Labels: `[PROPOSED]` unless marked otherwise. `[ASSUMPTION]` marks a number we
plan with but have not measured. `[OPEN]` needs a human or evidence. `[FACT]`
is reserved for things verifiable in this repository or a named official source.

## 1. Principles and scope

| # | Principle | Consequence if violated |
|---|---|---|
| O-1 | **One correlation spine.** A single trace starts at the API edge and survives queue, worker, device and client. | An incident becomes archaeology; no component can prove it handled a task. |
| O-2 | **Metadata in telemetry, content stays put.** Identifiers, counts and timings — never prompt text, file contents or secrets. | Breaks NFR-PRIV-02 / NFR-SEC-02 and the local-first promise. |
| O-3 | **Telemetry never blocks the request path.** Export is async and bounded. | An observability outage becomes a product outage. |
| O-4 | **Liveness is dumb.** Liveness checks nothing outside the process. | A slow dependency causes mass restarts — a self-inflicted outage. |
| O-5 | **Bounded cardinality.** No unbounded label value (org, user, task, device, path, URL) in a metric label. | Metrics become unqueryable and expensive. |
| O-6 | **Alerts are actionable and linked.** Every alert names a runbook (§10). | Alert fatigue — the same failure mode the approval model avoids. |
| O-7 | **Fail closed only where it protects data.** Redaction fails closed (§4); telemetry export does not. | Either a leak, or an outage from a secondary system. |
| O-8 | **Reliability is proven by drills.** Every pattern in §11 has a fault-injection test; every backup has a restore drill. | The failure is discovered by a customer. |

`[FACT]` Stack, per D-13: OpenTelemetry SDK 0.223.x → OTel Collector → Grafana
LGTM (Loki/Grafana/Tempo/Mimir), managed first. `03` §5.12 places artefacts in
`infrastructure/observability` (dashboards and rules as code) and `shared/logger`,
`shared/telemetry` (redaction and wiring). Scope: the cloud control plane
(`api`, four `worker-*` deployables), the Windows device fleet, and the contracts
between them.

## 2. What we deliberately do not instrument

`[PROPOSED]` The default is that **content never enters telemetry** — a privacy
control (NFR-SEC-02, NFR-PRIV-02), not a cost control.

| Not collected (cloud telemetry) | Why | Where it may exist instead |
|---|---|---|
| Task `goal` text and user prompts | User content; frequently contains IP or the very secret we protect | The task row, under the org retention window only |
| Model prompts and completions | Same, and they may embed workspace content | Nowhere by default; local `--debug` only, with a visible warning (`09` §11) |
| File contents, diffs, stdout/stderr bodies | Content and potentially large | Task artifacts in object storage, tenant-scoped |
| Secret values of any kind (§4 deny-list) | Leakage | Credential store and KMS only |
| Full workspace paths | Reveals user file structure | Cloud sees an opaque `workspace_id` and a path hash |
| Raw IP addresses beyond a short window | Personal data | Network layer for abuse mitigation; masked in dashboards |
| Screenshots / screen recordings | Content | Only as task artifacts the user chose to capture (FR-BRW-03) |
| Keystroke or process-tree telemetry in the sandbox | Surveillance of the user's machine | Nothing; command argv is already audited at approval time |

`[ASSUMPTION]` We still need aggregate, content-free signals to run the platform:
counts, states, durations, error codes, token counts, cost and device liveness.
All of §6 is that.

## 3. Correlation model

`[PROPOSED]` W3C Trace Context carries the trace; our own IDs carry the domain
entities (NFR-OBS-01).

| ID | Format | Created by | Carried in |
|---|---|---|---|
| `trace_id` | W3C `traceparent` trace-id | API edge (runner, for standalone tasks) | HTTP headers, queue job metadata, device envelope, SSE event, audit row |
| `span_id` | W3C span-id | Each OTel span | Never asserted across a boundary except via the trace |
| `request_id` | ULID | API edge (`X-Request-Id`, client value honoured) | Response headers, problem+json body (`07` §2), logs |
| `task_id` | UUIDv7 | `POST /v1/tasks` | Task row, all events, jobs, commands, approvals, usage, audit |
| `step_id` / `seq` | UUIDv7 / monotonic int | `agent-engine` | Step rows, jobs, commands, grants, artifacts |
| `approval_id` | UUIDv7 | Policy `ask` path | Approval row, notification, grant, decision event |
| `command_id` | ULID | API → device | `device_commands`, device ack, result message |
| `device_id` | UUIDv7 | Device registration | Commands, reports, telemetry resource attributes |
| `organization_id` | UUIDv7 | Org creation | Every tenant-owned row and cache key; **never a metric label** |
| `event_seq` | per-task monotonic int | `event-engine` | SSE `id`, replay cursor (`07` §5) |

Propagation per hop: **(1) API → queue** — the enqueue helper injects `traceparent` and `{ organizationId, taskId, stepId, requestId }` into BullMQ job metadata (`07` §6 already carries `organizationId`, `traceId`, `schemaVersion`), with a deterministic `jobId` where dedupe is needed; **(2) queue → worker** — the consumer starts a `CONSUMER` span as a child of the producer context; **(3) worker → device** — the command envelope (`09` §4) carries `traceId`, `commandId`, `taskId`, `stepId`, `approvalId` (the payload digest covers the payload, not the trace id); **(4) device → cloud** — reports carry `messageId`, `commandId`, `traceId`, and the device **resumes** the trace so a device-executed step is a child of the originating request; **(5) cloud → clients (SSE)** — every event carries `taskId`, `seq`, `traceId` for client error reports; **(6) audit** — `audit_events` rows carry `organization_id`, `request_id` and `trace_id` (`11` §5), so an alert pivots to the request.

### 3.1 What cannot be joined, and why

| Break | Why | Mitigation |
|---|---|---|
| A **local-only** device's internal spans | The user may be offline or may have declined telemetry export (NFR-PRIV-01) | The cloud trace stops at the device boundary; device-reported results carry the ids, so the story is complete even without the span |
| Device span **timestamps** vs cloud | Device clocks are untrusted (`09` §4; server-authoritative time) | Join by `trace_id`/`command_id`, never by wall-clock window; server-side durations only |
| **Remote model provider** internals | Third party, outside our trust | We time the call and keep the provider request id if returned; no child span inside the provider |
| **Ollama** internals | No distributed context in the local server | One `ua.model.call` span around the HTTP call with model digest and token counts |
| **Browser page / site** internals | Third-party site | Our actions and navigation timing only |
| **Metric data** | Metrics are aggregated; no task exists in a metric | Metrics say *when*, traces say *what*; exemplar pivot is `[OPEN]` Q-OBS-10 |
| **Content deleted under retention** (NFR-PRIV-02) | Gone by design | Metadata survives in its own window; the join is limited to what remains |
| **Trace-context loss** (proxy strips headers, long-poll fallback) | Not all infrastructure forwards `traceparent` | `request_id` is the fallback key; `ua.telemetry.context_missing_total` makes the loss visible |
| **Cross-task ordering** | Only per-task `seq` is promised (`08` §13) | Never assert cross-task causality |

## 4. Structured logging

`[PROPOSED]` `[FACT]` No logger exists. All cloud services and the runner emit
one JSON object per line (JSONL) via `shared/logger`.

### 4.1 Record schema

| Field | Type | Presence | Notes |
|---|---|---|---|
| `ts` | RFC 3339 ms UTC | always | Server-authoritative |
| `level` | enum | always | §4.2 |
| `msg` | string | always | Fixed template ("step completed"); never interpolated user data |
| `event` | stable dot-name | recommended | `task.state_changed`, `approval.decided` — pivot for log alerts |
| `service` / `service.version` | string | always | Deployable and build SHA |
| `deployment.environment` / `instance` | string | always | `dev`/`staging`/`prod`; pod or host id, never a secret |
| `trace_id` / `span_id` / `trace_flags` | hex | in a span | W3C |
| `request_id` | ULID | request paths | Fallback correlation key |
| `organization_id` | UUIDv7 | tenant-scoped | Fine as a log field (unlike a metric label) |
| `user_id`, `device_id`, `task_id`, `step_id`, `approval_id`, `command_id` | UUIDv7/ULID | relevant | Opaque ids only |
| `job_id`, `queue`, `attempt` | string/int | workers | |
| `code` | enum | failures | The `08` §6 error classes; stable and matchable |
| `error.type` / `error.message` | string | failures | Message sanitised and truncated; never a request body |
| `duration_ms` | number | timed ops | Monotonic-derived |
| `http.request.method` / `http.route` / `http.response.status_code` | string/int | API | `http.route` is the **template**, never a concrete path |
| `redaction` | object | when applied | `{ applied, rule_ids[], failed }` |

### 4.2 Levels, sampling, redaction

| Level | Use | Production default |
|---|---|---|
| `TRACE` / `DEBUG` | Per-chunk internals / targeted diagnosis (safe values only) | Off; `DEBUG` opt-in per service for a bounded window |
| `INFO` | State transitions, decisions, lifecycle | On, sampled |
| `WARN` | Degraded but handled (retry, circuit opened, lease expired, redaction rule skipped) | On, 100% |
| `ERROR` / `FATAL` | Operation failed / process about to exit | On, 100% |

`[PROPOSED]` Sampling: `WARN`+ is never sampled. `INFO` is head-sampled by trace
at the collector so the decision is consistent across services — `[ASSUMPTION]`
100% at S1/S2, tail-sampling later (keep all errors and slow requests, sample the
happy path). Rates are `[OPEN]` (Q-OBS-2).

Redaction is a **security control** (`03` §6): (1) log calls use structured fields, and a field not on the logger's **allow-list** for that event is refused, not printed; (2) a second independent scrub runs before any line is persisted and before any step result or event is stored (`08` §5); (3) secret-pattern detection runs over the few permitted free-text fields; (4) **fail closed** — if the redactor raises, a rule cannot be evaluated, or a value is not allow-listed, the field is dropped, the record carries `redaction.failed: true`, and a security event is raised; the raw value is never written "to be safe".

Deny-list (never logged, never a span attribute, never in an event or artifact, regardless of allow-list entries): passwords, Argon2 hashes, MFA/TOTP secrets and recovery codes, step-up tokens; access/refresh tokens, session ids, device tokens, SSE stream tickets, signed command tokens, webhook secrets; `Cookie`/`Set-Cookie`/CSRF tokens; private keys, KMS material, the runner device key; DSNs and any URL with userinfo or a signature query; provider and integration API keys and OAuth client secrets; file contents, diffs, `.env*` values and `--token=`-style argv secrets; and personal data beyond design need (full email, phone, raw IP past the abuse window). Enforcement is the "no secret in any sink" suite (`11` T-DAT-01): a canary pushed through every sink must fail the build if it appears.

## 5. Tracing

`[PROPOSED]` `[FACT]` Not implemented. Naming follows OTel semantic conventions
where one exists, `ua.*` otherwise.

| Span | Kind | Key attributes (bounded) | Notes |
|---|---|---|---|
| `http.server` | SERVER | `http.request.method`, `http.route`, `http.response.status_code`, `organization.tier` | Route template only; `organization_id` is a span attribute, not a metric label |
| `ua.policy.evaluate` | INTERNAL | `ua.policy.version`, `ua.risk.class`, `ua.policy.decision`, `ua.policy.matched_rule` | Deterministic; rule ids are a closed set |
| `ua.queue.enqueue` / `ua.queue.process` | PRODUCER / CONSUMER | `messaging.system` (bullmq), `messaging.destination.name`, `ua.job.type`, `ua.job.attempt` | Consumer is a child of the producer |
| `ua.agent.turn` | INTERNAL | `ua.model.role`, `ua.model.family`, `ua.task.step_seq` | One per model turn |
| `ua.model.call` | CLIENT | `ua.model.provider`, `ua.model.family`, `ua.model.location`, `ua.tokens.in/out`, `ua.cost.minor` | Content is never an attribute; counts are |
| `ua.tool.invoke` | INTERNAL | `ua.tool.name`, `ua.tool.version`, `ua.risk.class`, `ua.idempotency` | The arguments digest, not the arguments |
| `ua.verification.run` | INTERNAL | `ua.verification.assertions[]`, `ua.verification.result` | Assertion names are a closed set |
| `ua.approval.request` / `ua.approval.roundtrip` | INTERNAL | `ua.approval.risk_class`, `ua.approval.outcome`, `ua.approval.wait_seconds` | Roundtrip spans request → decision → device notified (NFR-PERF-03) |
| `ua.device.roundtrip` | INTERNAL | `ua.device.id`, `ua.command.kind`, `ua.command.attempt` | The device resumes the trace inside it |
| `ua.outbox.publish` / `ua.reaper.sweep` | INTERNAL | `ua.outbox.event_type`, `ua.outbox.attempt`; `ua.reaper.scanned/recovered/requeued` | |
| `ua.db.query` / `ua.redis.command` | CLIENT | `db.operation.name`, `db.collection.name`; `db.system` | Auto-instrumented (Prisma, ioredis) |

Cardinality discipline: span attributes may carry `task_id`, `device_id`,
`organization_id`; **metric labels may not**. Collectors disable span metrics for
these spans so ids cannot leak into label sets. Free text is never an attribute
(no goal, prompt, URL path with ids, error message, file path or username) — use
a closed enum or a hash prefix. A 404 on an unknown path is labelled
`http.route="<unmatched>"`, never the raw path (also an injection defence,
`11` T-INF-11). SDK attribute limits and span-size caps are set so a rogue span
cannot ship a megabyte.

## 6. Metrics catalogue

`[PROPOSED]` `[FACT]` No metric below is emitted. OTel-style dotted names; a
Prometheus backend renders underscores (`ua.queue.depth` → `ua_queue_depth`).
"Owner" is the emitting deployable. "Alert" ties to §8. Every label set is a
closed enum.

### 6.1 API, stream, database, Redis, outbox

| Metric | Type | Unit | Labels (bounded) | Owner | Alert |
|---|---|---|---|---|---|
| `http.server.request.duration` | histogram | s | method, route, status_code, service | `api` | A-01, A-02 |
| `http.server.active_requests` | updowncounter | count | method, service | `api` | — |
| `ua.stream.connections_active` | updowncounter | count | service | `api/realtime` | A-16 |
| `ua.stream.event_delivery.duration` | histogram | s | event.type, execution.location | `api/realtime` | A-02 |
| `ua.stream.resync_total` | counter | count | reason | `api/realtime` | — |
| `ua.ratelimit.rejected_total` | counter | count | class (A–E), scope | `api` | A-23 |
| `ua.idempotency.conflicts_total` | counter | count | route_scope | `api` | — |
| `ua.telemetry.context_missing_total` | counter | count | service | `shared/telemetry` | A-21 |
| `db.client.connection.count` | gauge | count | state (used/idle), pool | `api`, workers | A-10 |
| `db.client.connection.pending` / `.max` | gauge | count | pool | `api`, workers | A-10 |
| `db.client.operation.duration` | histogram | s | operation.name, collection.name (table) | all | — |
| `ua.db.replication_lag` | gauge | s | replica_class | `infrastructure` | A-24 |
| `ua.redis.up` | gauge | 1/0 | service | `shared/telemetry` | A-11 |
| `ua.redis.memory_used_bytes` | gauge | By | service | `shared/telemetry` | A-11 |
| `ua.redis.evicted_keys_total` | counter | count | keyspace (queues/cache/pubsub) | `shared/telemetry` | A-11 |
| `ua.outbox.pending` | gauge | count | aggregate_type | `api`, `worker-maintenance` | A-12 |
| `ua.outbox.oldest_age` | gauge | s | aggregate_type | `worker-maintenance` | A-12 |
| `ua.outbox.publish_failures_total` | counter | count | reason | `worker-maintenance` | A-12 |
| `ua.reconciliation.found_total` | counter | count | reason (orphan_queued, missing_job, expired_lease) | `worker-maintenance` | A-06 |

### 6.2 Queues, workers, agent loop, approvals, devices

| Metric | Type | Unit | Labels (bounded) | Owner | Alert |
|---|---|---|---|---|---|
| `ua.queue.depth` / `.waiting` / `.active` / `.delayed` | gauge | count | queue | `worker-maintenance`, `api` | A-03 |
| `ua.queue.oldest_job_age` | gauge | s | queue | same | A-03 |
| `ua.queue.failed_total` | counter | count | queue, reason (error class) | same | — |
| `ua.queue.dlq_depth` | gauge | count | queue | same | A-04 |
| `ua.queue.retry_total` | counter | count | queue, attempt | same | — |
| `ua.queue.job.duration` | histogram | s | queue, job.type, outcome | workers | — |
| `ua.worker.up` / `.heartbeat_age` | gauge | 1/0 / s | worker_class, instance | workers | A-05 |
| `ua.worker.jobs_processed_total` | counter | count | worker_class, queue, outcome | workers | — |
| `ua.worker.job_errors_total` | counter | count | worker_class, code (taxonomy) | workers | A-05 |
| `ua.worker.reaper_actions_total` | counter | count | reason (lease_expired, requeued, recovered_succeeded, abandoned) | `worker-maintenance` | A-15 |
| `ua.worker.leader_lock_held` | gauge | 1/0 | job_name | `worker-maintenance` | A-15 |
| `ua.task.in_state` | gauge | count | state, execution_location | `api/tasks` | A-06 |
| `ua.task.duration` | histogram | s | final_state, execution_location, risk_class_max | `api/tasks` | — |
| `ua.task.steps` | histogram | count | final_state, execution_location | `agent-engine` | — |
| `ua.task.state_transitions_total` | counter | count | from_state, to_state | `agent-engine` | — |
| `ua.task.stuck_total` | counter | count | state | `worker-maintenance` | A-06 |
| `ua.task.checkpoint_resumes_total` | counter | count | reason (reboot, crash, pause) | `agent-engine` | — |
| `ua.agent.iterations_total` | counter | count | model_role, outcome | `agent-engine` | — |
| `ua.agent.loop_detected_total` | counter | count | detector (repetition, no_progress, oscillation) | `agent-engine` | A-07 |
| `ua.agent.budget_exhausted_total` | counter | count | budget (steps, wall_clock, tokens, cost, replans, retries, approvals) | `agent-engine` | A-07 |
| `ua.approval.request_to_decision.duration` | histogram | s | risk_class, scope | `api/approvals` | A-08 |
| `ua.approval.decision_to_device.duration` | histogram | s | command_kind | `api/approvals` | A-08 |
| `ua.approval.decisions_total` | counter | count | decision (granted/denied/expired), risk_class | `api/approvals` | A-08 |
| `ua.approval.oldest_pending` / `.pending` | gauge | s / count | risk_class | `api/approvals` | A-08 |
| `ua.approval.per_task` | histogram | count | final_state | `api/approvals` | — |
| `ua.approval.validation_failures_total` | counter | count | reason (digest_mismatch, expired, reused) | `api` + runner | A-14 |
| `ua.device.online` | gauge | count | os, capability_tier | `api/devices` | A-09 |
| `ua.device.heartbeat_lag` | histogram | s | os | `api/devices` | A-09 |
| `ua.device.silence_detected_total` | counter | count | reason | `api/devices` | A-09 |
| `ua.device.requeued_tasks_total` | counter | count | reason (silence, revoke, capability_lost, deadline) | `api/devices` | A-09 |
| `ua.device.count_by_version` | gauge | count | version, channel | `api/devices` | A-22 |
| `ua.device.command.queue_depth` | gauge | count | state (queued/sent/acked/expired) | `api/devices` | A-03 |
| `ua.device.command.roundtrip.duration` | histogram | s | command_kind | `api/devices` | A-08 |
| `ua.device.local_queue_depth` | gauge | count | — | runner (opt-in) | — |

Approval **denial rate** and **expiry rate** are derived from
`ua.approval.decisions_total` by the `decision` label; they are not separate
counters. Queues are the closed set from `07` §6 (`task.plan`,
`task.step.execute`, `task.verify`, `tool.execute.*`, `device.command`,
`approval.*`, `usage.record`, `notification.send`, `webhook.deliver`,
maintenance jobs).

### 6.3 Models, cost, storage, security

| Metric | Type | Unit | Labels (bounded) | Owner | Alert |
|---|---|---|---|---|---|
| `ua.model.tokens_total` | counter | count | provider, model_family, direction, location | adapters, `model-runtime` | A-17 |
| `ua.model.cost_minor_total` | counter | count | provider, model_family, org_tier | `api/usage` | A-17 |
| `ua.model.request.duration` | histogram | s | provider, model_family, streaming | adapters | A-17 |
| `ua.model.errors_total` | counter | count | provider, error_class (rate_limit, timeout, auth, unavailable, content_filter) | adapters | A-17 |
| `ua.model.circuit_breaker.state` | gauge | 0/1/2 | provider | adapters | A-17 |
| `ua.local_model.gpu_offload_ratio` | gauge | ratio | model_family | runner (opt-in) | — |
| `ua.local_model.tokens_per_second` | histogram | tok/s | model_family, context_tier | runner (opt-in) | `[OPEN]` |
| `ua.cost.period_total` | gauge | minor | service (db, redis, storage, egress, compute), period | `infrastructure` | A-17 |
| `ua.cost.per_active_user` | gauge | minor | period (daily/monthly) | `api/usage` + billing | A-18 |
| `ua.active_users` | gauge | count | window (DAU/MAU) | `api` | — |
| `ua.storage.bytes` / `.growth_bytes_per_day` | gauge | By / By·day⁻¹ | class (artifacts, uploads, backups, logs) | `infrastructure` | A-13 |
| `ua.security.events_total` | counter | count | event_class (r4_attempt, digest_mismatch, sandbox_violation, cross_tenant_attempt, auth_abuse, secret_scrubbed, redaction_failed, kill_switch) | `api/audit`, runner | A-14 |
| `ua.audit.write_failures_total` | counter | count | reason | `api/audit` | A-14 |

`[OPEN]` `ua.local_model.tokens_per_second` is defined but must not be alerted on
or published as a claim until the Phase 4 measurement in `09` §10.2 exists.

## 7. SLIs, SLOs and error budgets

`[PROPOSED]` Rolling 30-day windows. Targets are `[ASSUMPTION]`, carried from `02`.

| SLO | SLI formula | Target | Source |
|---|---|---|---|
| API availability | `1 − (5xx ÷ valid requests)` from `http.server.request.duration`, excluding client 4xx and synthetic health probes | 99.9% | NFR-REL-01 |
| Event-stream availability | `1 − (stream failures ÷ stream requests)`; a resync-required counts as a failure | 99.9% | NFR-REL-01 |
| API read latency | proportion of read-route requests with `duration ≤ 300 ms`, server-side, client network excluded | p95 < 300 ms | NFR-PERF-01 |
| Event delivery latency | `ua.stream.event_delivery.duration`, produce → client acknowledgement | p95 < 2 s | NFR-PERF-02 |
| Approval decision latency | `ua.approval.decision_to_device.duration`, decision → device ack (online devices) | p95 < 5 s | NFR-PERF-03 |
| Task acceptance durability | accepted tasks reaching a terminal state or explicit expiry; `1 − lost ÷ accepted` | 100% (any non-zero is an incident) | NFR-REL-02 |
| Approval responsiveness | `ua.approval.oldest_pending` for online requesters | p50 < 60 s | FR-NOTIF-02 |

Error-budget policy:

1. **Budget** = `(1 − SLO) × window`. For 99.9% over 30 days, `[ASSUMPTION]`
   ~43 min/month. **Burn-rate** = `observed_error_rate ÷ (1 − SLO)`.
2. Multi-window, multi-burn `[PROPOSED]`: burn ≥ 14.4× over 1 h **and** over 5 min
   → page (A-01); burn ≥ 6× over 6 h → page; burn ≥ 1× over 3 days → ticket.
3. **When burn is too fast:** triage in the order "restore service → stop the
   bleeding → find cause", never "find cause first"; **freeze** non-essential
   deploys and flag rollouts; roll back if burn began within one release window
   (§10 RB-08); declare an incident if 14.4× persists past the first ack window;
   postmortem within 3 business days (§14).
4. Spending budget deliberately (a risky migration) needs a written decision;
   spending it accidentally is an incident.
5. `[OPEN]` Whether the event stream is a separate budget from the API: merging
   hides stream-only failures, splitting doubles the paging surface for a small
   team (Q-OBS-6).

## 8. Alert catalogue

`[PROPOSED]` Severity: **S1** page now · **S2** page in hours · **S3** ticket.
`TBD-13` means the threshold is owned by doc `13` and is deliberately not
invented here.

| Alert | Condition (sketch) | Sev | Why it matters | Runbook | SLO tie-in |
|---|---|---|---|---|---|
| A-01 API 5xx burn | Multi-window burn ≥ 14.4× | **S1** | Availability budget is bleeding | RB-08 | NFR-REL-01 |
| A-02 Latency breach | Read p95 > 300 ms, or event-delivery p95 > 2 s, for `TBD-13` | S2 | Users see a broken product before it errors | RB-04 | NFR-PERF-01/02 |
| A-03 Queue depth growth | `ua.queue.depth` or `oldest_job_age` rising monotonically for `TBD-13` | S2 | Arrival exceeds consumption; latency SLO is next | RB-03 | NFR-PERF-05 |
| A-04 DLQ non-empty | `ua.queue.dlq_depth > 0` | S2 | A job exhausted retries — lost or poisoned work | RB-03 | NFR-REL-05 |
| A-05 Worker down | `ua.worker.up == 0` or heartbeat > 3× interval | S2 | A whole capability class is offline | RB-08 | NFR-REL-05 |
| A-06 Task stuck | `ua.task.stuck_total` increments, or a non-terminal task past budget/`TBD-13` | S2 | Breaks "a task never sits silently" | RB-04 | NFR-REL-05, FR-NOTIF-02 |
| A-07 Runaway loop / budget spike | `ua.agent.loop_detected_total` or `budget_exhausted_total` above `TBD-13` | S3 | A model regression or a design gap; burns cost and trust | RB-05 | NFR-PERF-05 |
| A-08 Approval silent | `ua.approval.oldest_pending` > `TBD-13` with the requester online | **S2** | Directly violates FR-NOTIF-02 | RB-06 | FR-NOTIF-02 |
| A-09 Device fleet offline spike | `ua.device.online` drops > `TBD-13`%, or silence detections spike | S2 | Our bug, a Windows update, or a network split — all need a human | RB-07 | FR-DEV-04 |
| A-10 DB connection saturation | used ÷ max > `TBD-13`% | S2 | Connection exhaustion turns latency into hard errors (`06` §12) | RB-02 | NFR-REL-01 |
| A-11 Redis unavailable | `ua.redis.up == 0`, or queue-keyspace evictions > 0 | **S1** | Dispatch stops and SSE degrades (NFR-REL-06) | RB-01 | NFR-REL-06 |
| A-12 Outbox not draining | `ua.outbox.oldest_age` > `TBD-13` min | S2 | Durability (NFR-REL-02) is only as good as the publisher | RB-03 | NFR-REL-02 |
| A-13 Storage/disk growth | Storage or DB growth above a `TBD-13` trajectory | S3 | Silent cost and an eventual hard stop | RB-09 | NFR-COST-01 |
| A-14 Security anomalies | Critical `ua.security.events_total` classes > 0 (r4_attempt, cross_tenant_attempt, digest_mismatch, redaction_failed) | **S1** | These are the controls the safety model rests on | RB-11 | `11` RR-4/RR-5 |
| A-15 Maintenance failed | `ua.worker.leader_lock_held == 0` beyond a window, or a maintenance job fails | S3 (S2 for the reaper) | Reaper/retention/reconciliation stopping is invisible rot | RB-04 | NFR-REL-05 |
| A-16 Stream pressure | `ua.stream.connections_active` above `TBD-13`, or resync rate spikes | S3 | The realtime extraction trigger (`03` §4) approaching | RB-04 | NFR-PERF-02 |
| A-17 Provider/cost anomaly | Model errors or token cost above a trailing baseline by `TBD-13` | S2 | Cost shock or an outage that will surface as task failures | RB-09 | NFR-COST-01 |
| A-18 Cost per active user | `ua.cost.per_active_user` > the threshold set in `13` | S2 | The tracked metric of NFR-COST-01 | RB-09 | NFR-COST-01 |
| A-19 Backup or restore drill failed | Backup job failed, or the monthly restore drill did not pass | **S1** | RPO/RTO become fiction (§13) | RB-10 | NFR-REL-04 |
| A-20 Rotation overdue | A TLS/signing certificate or provider secret past its rotation date | S2 | Expiry is a scheduled outage | RB-10 | NFR-SEC-02 |
| A-21 Trace context lost | `ua.telemetry.context_missing_total` above `TBD-13` | S3 | Diagnosability degrades silently | RB-04 | NFR-OBS-01 |
| A-22 Runner version skew | Devices below the `TBD-13` minimum version above a threshold | S3 | Security patches and protocol changes lag on user machines | RB-07 | FR-DEV-09 |
| A-23 Rate-limit storm | `ua.ratelimit.rejected_total` above `TBD-13` | S3 | Abuse attempt or a client regression | RB-11 | NFR-PERF-05 |
| A-24 Replication lag | `ua.db.replication_lag` > `TBD-13` s (Phase 10+) | S3 | Stale reads for history and audit search | RB-02 | NFR-REL-04 |

Every alert payload carries the SLO it protects, a dashboard link, a runbook
link and the affected scope (which queue/tenant). An alert with no runbook is a
bug in the alert.

## 9. Dashboards to build later

`[PROPOSED]` Dashboards live as code in `infrastructure/observability` and are reviewed like any change. Metric names are from §6; each panel selects one metric family, aggregates over one bounded label, and splits by `service` where several deployables emit it.

- **D-ENG — Engineering health (on-call default):** availability burn (1 h/6 h/3 d); request and error rate by route class; p50/p95/p99 latency by route; DB pool used/pending/max; Redis up/memory/evictions; worker `up` grid; queue depth and oldest-job age; DLQ depth; outbox oldest age; top error codes; deploy markers.
- **D-TASK — Task pipeline:** tasks in state (stacked); state-transition rate (`from_state → to_state`); duration p50/p95 by location and final state; steps per task; checkpoint resumes by reason; replans; loop detections by detector; budget exhaustion by kind; stuck-task counter; verification pass/fail by assertion.
- **D-APPR — Approval UX:** pending approvals by risk class with oldest age; request→decision p50/p95; decision→device p95 against the 5 s SLO line; granted/denied/expired rates; approvals per task against the `≤ 2` median goal in `02` §9; notification delivery by channel; validation failures.
- **D-DEV — Device fleet:** online devices; heartbeat lag; silence detections; requeued tasks by reason; devices by runner version against the minimum supported; command queue depth by state; command round-trip p95; local-model fit (offload ratio, tok/s) labelled "opt-in, unmeasured".
- **D-COST — Cost:** cost per service per period; cost per active user against its threshold; tokens and cost by provider/model family; storage bytes and growth by class; cost anomaly ratio against a trailing baseline.
- **D-SEC — Security and audit anomalies:** security events by class; audit write failures; approval validation failures; rate-limit rejections by scope; device revocations and force-revocations; active impersonation sessions; policy version changes. Only the critical classes page (A-14); the rest is a tool, not a pager.

## 10. Runbook index

`[PROPOSED]` `[FACT]` No runbook file exists; they belong in
`infrastructure/disaster-recovery/` and `infrastructure/observability` per
`03` §5.12 and `06` §11. NFR-OBS-03 requires every alert to link here.

| Runbook | Trigger | First three diagnostic steps | Rollback / stop action |
|---|---|---|---|
| RB-01 Redis unavailable | A-11 | 1. `ua.redis.up` + eviction counter; 2. queue-keyspace memory and `maxmemory-policy` (never evict queue keys); 3. worker connect errors and API enqueue 5xx rate | Confirm the durability path is holding (API accepts to DB via outbox). Fail over the managed Redis. **Never** flush queues to "fix" it. |
| RB-02 DB failover / saturation | A-10, A-24 | 1. Failover or saturation? Check pool metrics and replica lag; 2. pool maths per `06` §12; 3. long transactions and statement timeouts | Shed load: smaller pools, halt non-essential maintenance, 503 + `Retry-After` (NFR-REL-06). Migrations are forward-only — never roll a database back (`06` §9). |
| RB-03 Queue backlog / DLQ | A-03, A-04, A-12 | 1. Which queue and oldest age; 2. is a worker class down (A-05) or is the handler slow; 3. DLQ error codes only — never payload contents | Scale the worker class. If the producer is at fault, pause the queue (`/admin/v1/queues/{q}/pause`), fix, drain. Requeue DLQ only after the fix. |
| RB-04 Stuck tasks / loops / orphaned browsers | A-02, A-06, A-15, A-16, A-21 | 1. Which state and which budget; 2. reaper last run and lease expiry; 3. for loops the offending step digests; for browsers the device browser-process count | Reaper requeues expired leases (safe, idempotent). Loops: pause and offer continue/re-plan/cancel (`08` §7). Orphans: device `stop-all` kill switch, then the job-object kill. |
| RB-05 Bad model / provider regression | A-07, A-17 | 1. Which provider/model family changed; 2. circuit-breaker state; 3. loop/budget metrics by model | Trip the breaker or pin the previous model; fall back to local only where policy and consent allow (it is data egress, `09` §12). |
| RB-06 Approval outage / silent approvals | A-08 | 1. Are requests created but not notified? 2. notification delivery by channel; 3. decision→device path (is the device online?) | Restore the notification path first; notify out of band; manual approver path via admin console only if policy permits. **Never auto-approve** to clear a queue. |
| RB-07 Device fleet outage / mass silence | A-09, A-22 | 1. Our side or theirs — WSS endpoint healthy, auth failing? 2. runner version skew and a recent update rollout; 3. DNS/TLS/proxy changes, Windows-update correlation | Roll back the bad runner release (FR-DEV-09) and halt the update feed. Tasks are safe in `WAITING_DEVICE`; never force-complete them. |
| RB-08 Bad release rollback | A-01, A-05, error-rate spike | 1. Correlate with the deploy marker; 2. which deployable and version; 3. migration fault or code fault? | Roll back the deployable to the previous image. Code rolls back; the schema does not (expand/contract, fix forward). |
| RB-09 Cost / storage anomaly | A-13, A-17, A-18 | 1. Which service and org tier; 2. tokens/cost by provider and model; 3. artifact growth by class and retention setting | Apply per-org quotas and stop non-essential cloud execution (NFR-COST-02). Lifecycle storage. Never delete data under legal hold or inside the retention promise. |
| RB-10 Restore from backup / rotation | A-19, A-20 | 1. Scope (DB, object storage, secrets) and the last successful backup/drill; 2. restore into an **isolated** environment (`06` §11); 3. verify with the smoke test and integrity checks | Promote only after verification. Rotation: stage the new secret, deploy, verify, then revoke the old one — never revoke first. |
| RB-11 Suspicious cross-tenant access / security event | A-14, A-23 | 1. Which event class and which actor/trace (pivot audit → traces); 2. real access or our own test? 3. blast radius: rows and orgs touched | **Fail closed:** revoke the actor (device/session/service account), rotate the affected secret, preserve evidence (no destructive cleanup), escalate as a security incident (§14). |

## 11. Reliability patterns

`[PROPOSED]` Each pattern is backed by a fault-injection test (`03` invariant 7,
`14`). An untested pattern is a claim, not a control.

| Pattern | Failure it prevents | Mechanism | How it is verified |
|---|---|---|---|
| **Transactional outbox** (NFR-REL-02) | A task accepted with `201` but never queued (Redis lost the job, publisher restarted) | Task + first event + outbox row in **one** Postgres transaction; a publisher polls `outbox`; reconciliation re-enqueues `QUEUED`/`READY` rows with no live lease (`06` §8, `08` §11) | Flush Redis and restart the publisher mid-flight; every accepted task must still reach a terminal state (A-12) |
| **Lease + heartbeat + reaper** (NFR-REL-05) | A worker killed mid-step leaves a step `RUNNING` forever | Compare-and-set lease (`job_leases`), `heartbeat_at` every ~15 s `[ASSUMPTION]`, TTL = 3× interval; the reaper marks succeeded if the effect key is committed, else requeues with the same `jobId` (`03` §7.6) | Kill a worker mid-step; the reaper recovers or requeues exactly once (A-15) |
| **Idempotency keys** (NFR-REL-03) | A duplicate delivery or retry causes a double effect | `Idempotency-Key` per `(org, route-scope, key)`; a per-step effect key written in the same transaction as the terminal state; non-idempotent tools are never auto-retried (`08` §6) | Duplicate-delivery test, replay test, and the "same effect twice" invariant assertion |
| **Checkpoint / resume across reboot** (FR-TASK-06) | Pause, crash, sleep or reboot loses progress or corrupts the workspace | Bounded checkpoints + workspace snapshot before mutation (`09` §6); durable `device_commands` drained by cursor on reconnect (`09` §4); resume re-claims the lease | Suspend/resume mid-step; reboot test in the Windows matrix |
| **Bounded retries with jitter + DLQ** | A retry storm, or one failing job retried forever | Error-class-aware retry (only `transient`, `model_unavailable`, `verification_failed`), exponential backoff with jitter 2 s→5 min, `maxAttempts` 3 `[ASSUMPTION]`, then DLQ preserving the error code | Poison-payload test: a job that always throws lands in the DLQ and raises A-04 |
| **Backpressure and per-org fairness** (NFR-PERF-05) | One tenant starves every other tenant | Per-org rate limits (classes A–E, `07` §3), per-org concurrency caps, queue depth caps, bounded SSE buffers, 429/503 + `Retry-After`, fair scheduling | Multi-tenant load test: one org at 100× must not move another org's p95 past the SLO |
| **Circuit breakers (models, integrations)** | A dead provider becomes a global latency or error storm | Per-provider breaker (closed → open → half-open), per-call timeouts, fallback local→remote only with consent, clean `model_unavailable` failure state | Fault injection against a blackholed provider; the breaker opens, the task fails cleanly, A-17 fires |
| **Graceful degradation** (NFR-REL-06) | Any single dependency failure becoming a total outage | The matrix below | Kill each dependency in staging; assert the documented behaviour, not just "no crash" |
| **Kill switch for device commands** (RR-5) | A compromised cloud commanding user machines | Tray "stop all work" cancels tasks, kills job objects, unloads models and refuses new commands; plus `POST /admin/v1/devices/{id}/force-revoke`; the device re-evaluates policy locally (`09` §4) | Enable the switch, send a command, assert refusal (`kill_switch_active`) and no surviving sandbox or browser process |

Graceful degradation matrix:

| Dependency down | API | Workers | Local runner | User sees |
|---|---|---|---|---|
| Redis unavailable | Accepts tasks into the DB via the outbox; 503 **only** when the queue cannot be written; SSE falls back to DB polling by cursor | No new claims; in-flight work finishes its transaction | Executes already-claimed work; buffers events | "Live updates degraded"; tasks still accepted |
| Postgres failover | Writes fail → 503 + `Retry-After` | Pause; never retry into an open circuit | Executes claimed local work; buffers results | Clear error with retry guidance |
| One worker class down | Normal | Its queue backs up (A-03/A-05) | Unaffected for device-located tasks | Slower start, no data loss |
| Device fleet offline | Tasks → `WAITING_DEVICE`, TTL 72 h `[ASSUMPTION]` | N/A | Buffers locally, replays on reconnect | "Waiting for a device" with the TTL shown |
| Model provider outage | Normal | Breaker opens; fallback only if permitted, else clean `model_unavailable` | Local model unaffected | Fallback notice, or a clean failure |
| Object storage outage | Upload fails | Step marked `artifact_pending`; task completion is not blocked for a non-essential artifact (`03` §9) | Retains locally, retries | Artifact shows "pending upload" |
| Telemetry backend down | **Unchanged** (O-3): bounded buffer, then drop | Same | Local logs continue | Nothing (deliberately invisible) |
| KMS / secrets down | Actions needing a secret fail closed | Same | Uses locally-held material only | Clear, actionable error |

## 12. Health and readiness

`[PROPOSED]` Four distinct surfaces per deployable. The API endpoints are fixed
in `07` §3.7; `/health/dependencies` is operator-only and never tenant-visible.

| Deployable | Liveness | Readiness | Deep dependency (operator only) | Version |
|---|---|---|---|---|
| `api` | Process up, event loop responsive. **May not** touch DB/Redis/providers | DB reachable and schema version matches the build; accepting traffic (not shutting down). **Must not** require Redis — Redis down is degraded, not a reason to leave the load balancer (NFR-REL-06) | Redis, object storage, provider breaker states, queue depths, outbox age, replica lag | Build SHA, contract version, policy floor version, schema version |
| `worker-code` / `worker-browser` / `worker-document` | Process up, event loop responsive | Redis **and** DB reachable, consumer registered for its queues | Sandbox/browser runtime availability, provider breakers, queue depth | Build SHA, tool-manifest version |
| `worker-maintenance` | Process up | Redis + DB reachable, scheduler registered, **leader lock acquired** (single leader, `03` §3) | Last successful reaper/retention/reconciliation run and their ages | Build SHA, last-run versions |
| `local-runner` | Loopback `/status` for the tray; cloud-side liveness is *derived* from `heartbeat_age` (outbound-only, no inbound port — `03` A-6) | Can claim work: channel authenticated, sandbox self-test passed, model runtime reachable for configured roles | Local `/diagnostics`: model inventory, self-test, reachability, queue state (`09` §11) | Runner version, model manifest digests, sandbox profile |

Rules: liveness never checks a dependency (O-4); readiness never reports tenant
data or secret-bearing values; the version endpoint leaks no build secrets and is
safe to cache; a failing sandbox self-test **disables mutating tools** (fail
closed, `09` §11) and surfaces as a device readiness failure, not a liveness one.

## 13. Backup, restore and disaster recovery

`[PROPOSED]` Consistent with `06` §11. RPO/RTO are targets until a drill proves
them.

| Asset | Backup (frequency / retention) | Encryption | Restore rehearsal | Verified by |
|---|---|---|---|---|
| PostgreSQL (system of record) | Continuous WAL archiving + daily snapshots; 30 d `[ASSUMPTION]`; PITR enabled | At rest (KMS) + in transit | **Monthly**, automated, into an isolated environment with a smoke test; failure is an incident | Restore log + smoke result (A-19) |
| Object storage (artifacts, uploads) | Versioning + lifecycle rules; user uploads immutable and versioned | SSE-KMS | Restore a sample object set into an isolated account; compare digests | Digest comparison log |
| Secrets / KMS | No separate backup; KMS durability + rotation (`06` §11); a restore needing a lost key is a reportable incident | KMS-managed | Key-restore and rotation drill (RB-10) | Rotation record |
| Configuration / IaC | Terraform state in a locked remote backend; all config in Git | State encrypted | Periodic re-apply into a scratch account | Plan/apply log |
| Redis | **Not backed up** (ADR-021): no system-of-record data | N/A | Recovery = outbox republish + reaper requeue | RB-01 drill: flush Redis, assert no task loss |
| Device-local state | Not ours; the device buffers bounded events and replays | Local OS protections | Re-run the runner install/recovery path | Windows matrix (`09` §14) |

| Phase | RPO | RTO | Notes |
|---|---|---|---|
| ≤ 9 (pre-Kubernetes, D-12) | ≤ 24 h `[ASSUMPTION]` | ≤ 24 h, documented **manual** restore | Daily snapshots; restore is a runbook, not automation |
| ≥ 10 (HA + PITR) | ≤ 15 min `[ASSUMPTION]` | ≤ 4 h `[ASSUMPTION]` | Managed HA, PITR, automated drill |

**Explicit statement:** `[FACT]` No backup, restore or failover has ever been
executed for this platform, because no platform exists. RPO/RTO are therefore
**unproven** until a restore drill and a failover drill both succeed on the real
deployment with recorded evidence. A green drill creates the number; the number
does not exist before it.

Restore runbook outline (RB-10): (1) declare and scope — which asset, point in
time, environment; (2) freeze writes (maintenance mode or read-only) to protect
the target; (3) restore into an **isolated** environment, never over live;
(4) verify — counts, referential integrity, and a smoke test that creates,
advances and completes a task; (5) reconcile — outbox republish and reaper
requeue, since Redis is intentionally not restored; (6) cut over and re-open
writes; (7) record actual RPO/RTO achieved versus target, and file a postmortem
if the delta is material.

## 14. Incident management

`[PROPOSED]` For a small team (P-5 is internal and initially one or two people).

| Severity | Definition | Response |
|---|---|---|
| **SEV1** | Total outage, data-loss risk, suspected cross-tenant exposure, or a safety-control failure (R4 bypass, digest mismatch in volume, kill-switch failure) | Page immediately; one incident commander; public status update; comms ≤ 30 min |
| **SEV2** | Major degradation or a broken core promise (tasks stuck, approvals silent, a worker class down, fleet spike, cost runaway) | Page in hours; ack within 30 min; ≤ 2 h updates |
| **SEV3** | Partial degradation, one tenant or queue, workaround exists | Ticket, next business day |
| **SEV4** | Cosmetic or alert noise | Backlog |

On-call for a small team: one primary rotation, business-hours paging for
SEV2–SEV3 and **always-on paging for SEV1**; documented best-effort
acknowledgement for SEV2 outside hours until the team is larger `[OPEN]`
(Q-OBS-8). Escalation is time-based (ack → secondary → engineering lead), never
"hope someone sees it". Prefer automated actions (rollback, scaling, kill switch)
to manual ones at 03:00.

Communication templates (stored with the runbooks): **initial** — what is broken,
who is affected, what we know, what we are doing, next update time, no cause
speculation and no customer data; **update** — change since last, current impact,
next action, next update time; **resolved** — duration, user-visible impact, what
fixed it, whether a postmortem follows, where the record lives.

Postmortem template (blameless): summary; impact (users, tasks, tenants, budget
burned); timeline (UTC, built from telemetry and audit); detection (which alert
or which customer, and the time to detect — the observability gap); root cause
and contributing factors; what went well; what went badly; action items, each
with an owner, a due date and a real tracking issue — never "be more careful";
links to traces, dashboards and the runbook used. Rules: the report names systems
and conditions, never individuals; human error is a design signal; action items
are tracked to closure and reviewed monthly; a postmortem is required for every
SEV1 and for every A-14 or A-19 trigger.

## 15. Capacity and the hand-off to `13`

`[PROPOSED]` `13-scalability-and-capacity-planning.md` owns the scaling triggers
and the numbers. This document owns the **signal definitions** and the alert
wiring; `13` must reference §6 rather than invent a new metric name.

| Trigger `13` will define | Covered here by | Status |
|---|---|---|
| API pods on RPS + p95 latency | §6.1 request duration, §7 latency SLO | Signal ready; threshold owned by `13` |
| Worker scaling on queue depth + oldest-job age | §6.2 `ua.queue.depth`, `ua.queue.oldest_job_age` | Ready |
| DB connection ceiling / PgBouncer introduction | §6.2 pool metrics; formula in `06` §12 | Ready |
| Read-replica introduction | §6.1 operation duration + `ua.db.replication_lag` | Ready (Phase 10) |
| Realtime service extraction (> 5,000 streams/pod) | §6.1 `ua.stream.connections_active` | Ready (`03` §4 trigger) |
| Notification-service extraction | §6.2 notification delivery via queue/job metrics | Partially covered |
| Integration back-pressure | Provider error/latency metrics only; no dedicated integration metric yet | **Gap** — needs one before the trigger can fire |
| Cloud-execution GPU cost (only if ever offered) | `ua.cost.period_total`; no GPU metric exists (no GPU serving planned, D-14) | Not applicable by design |
| Load-test outputs feeding the formulas | None here; `13`/`14` produce them | Hand-off |

Also handed off with no owner here: partition thresholds for `task_events` /
`audit_events` / `usage_records` (`06` §12) and every `TBD-13` threshold in §8.

## 16. Observability for the local runner

`[PROPOSED]` The runner is the privacy-sensitive edge; telemetry is a data-egress decision governed by `11` §7 and `09` §12.

**The device sends** (operational telemetry, needed for FR-DEV-04/06): a heartbeat (~30 s `[ASSUMPTION]`) with runner version, OS/arch, capability and resource summary (GPU class, VRAM, RAM, free disk) and active-task count; task/step state changes with timings, error codes and digests; local queue depth, pending-command count and reconnect count; model inventory **metadata** (name, digest, health); the sandbox self-test result per check and kill-switch state; and a bounded error diagnostic (code plus a redacted, truncated message).

**Stays local** (never sent without the explicit per-purpose flows in `11` §7): file contents; workspace paths (the cloud sees an opaque `workspace_id` and a path hash); prompts and model outputs; step stdout/stderr bodies; credentials and the device private key; browsing history and page content; anything inside a sandbox.

Controls: operational telemetry is part of the cloud-connected service and is described in the install consent; local-only/offline mode sends nothing because there is no cloud session (`09` §10.4). `[OPEN]` whether a cloud account may disable *all* telemetry beyond heartbeat (Q-OBS-3; proposal: no — silent tasks are the failure FR-NOTIF-02 exists to prevent). Content telemetry and product analytics are a **separate, opt-in** decision, off by default and revocable, never a condition of the product working (NFR-PRIV-01); no third-party analytics carries task content, file paths or prompts.

The **privacy statement** is user-facing plain English covering what we collect, why, where it goes, how long we keep it, how to turn it off and how to export it; this section is its source of truth. **Diagnostics export:** the local `/diagnostics` command and `POST /v1/devices/{id}/diagnostics` produce a bundle redacted **by the runner**, which the user can inspect before sending (`09` §11, `07` §3.6, `11` T-DAT-02) — versions, a redacted log tail, model inventory, sandbox self-test, reachability and pending-command counts, never file contents. Runner logs are JSONL, rotated locally, redacted by the same deny-list (§4.4); `--debug` content logging is local-only with a visible warning and is never uploaded automatically.

## 17. Open questions

| # | Question | Impact | Proposal / default |
|---|---|---|---|
| Q-OBS-1 | Managed vs self-hosted Grafana LGTM, and when to switch | Cost vs control; log volume is the driver | Managed first (D-13); revisit at S3 with measured volume |
| Q-OBS-2 | Log and trace sampling rates at S2/S3 | Telemetry cost vs diagnosability | Errors and slow requests always; sample the happy path; measure first |
| Q-OBS-3 | May a cloud-connected device disable all telemetry beyond heartbeat? | Privacy promise vs FR-NOTIF-02 | No; heartbeat/state is the minimum; content telemetry opt-in |
| Q-OBS-4 | Are device-internal spans exported by default? | Trace completeness vs privacy and egress volume | Off by default; opt-in, with trace-id continuity from reports |
| Q-OBS-5 | Telemetry retention windows and IP-address handling | Privacy (NFR-PRIV-04) vs forensics | `[ASSUMPTION]` 30 d logs/traces, 13 mo metrics; mask IPs after the abuse window |
| Q-OBS-6 | Is the event-stream SLO a separate budget from the API? | Paging surface vs hiding stream-only failures | Separate SLO display, shared on-call surface |
| Q-OBS-7 | Does `ua.cost.per_active_user` include the user's own device cost? | The NFR-COST-01 number is meaningless if undefined | Cloud-only; document it on the dashboard |
| Q-OBS-8 | On-call rotation shape for a team of one or two | SEV2 response time, burnout | SEV1 always pages; SEV2 best-effort until larger |
| Q-OBS-9 | Synthetic probing from multiple regions, and who pays | Catches edge/DNS/TLS failures the app cannot see | One cheap probe per region at S2, more at S3 |
| Q-OBS-10 | Adopt exemplars (metric → trace pivot) and continuous profiling? | Diagnosability vs cardinality, cost and risk | Exemplars yes on request histograms; profiling deferred |
| Q-OBS-11 | A per-org analytics path for very large tenants | Cardinality explosion from any tenant-labelled metric | Never tenant-labelled metrics; per-org views via logs and traces, not labels |

Telemetry that **cannot** be collected without explicit consent, restated as a
hard constraint: file contents, prompts and model I/O, workspace paths, browser
content, step stdout/stderr, and anything from a sandbox. No alert, dashboard or
investigation may promise data that requires that consent.

## 18. Traceability

| Requirement | Where addressed |
|---|---|
| NFR-OBS-01 (`trace_id`/domain ids across API→queue→worker→device→client; what cannot join) | §3, §3.1 |
| NFR-OBS-02 (OTel logs/metrics/traces; SLOs, error budgets, burn alerts) | §1 (O-1, O-3), §4–§8 |
| NFR-OBS-03 (every incident has a runbook; every alert links to one) | §8, §10, §14 |
| NFR-REL-01, NFR-REL-02 (99.9% API + stream; acceptance durability) | §7 SLIs, §11 outbox, §8 A-01/A-02/A-12 |
| NFR-REL-03, NFR-REL-05 (no double effect; leases, heartbeats, reaper, retries) | §6.2, §11 idempotency and lease/reaper and retries+DLQ, §8 A-04/A-05/A-15 |
| NFR-REL-04, NFR-REL-06 (RPO/RTO, restore drills; graceful degradation) | §13, §12 readiness rules, §11 degradation matrix, §8 A-11/A-19/A-24 |
| NFR-PERF-01, NFR-PERF-02, NFR-PERF-03 (read p95 < 300 ms; event delivery < 2 s; approval → device < 5 s) | §6.1/§6.2, §7, §8 A-02/A-08 |
| NFR-PERF-04, NFR-PERF-05 (sized by formula; per-org fairness) | §15 hand-off; §6.2, §11 backpressure, §8 A-03/A-07/A-23 |
| NFR-COST-01, NFR-COST-02 (cost per active user + alert; device-default execution) | §6.3, §8 A-17/A-18, §15, §16, §17 Q-OBS-7 |
| NFR-SEC-02, NFR-PRIV-02 (secrets never logged; retention) | §2, §4 redaction, §5, §13, §16, §8 A-20 |
| FR-DEV-04, FR-DEV-06 (silence detection + requeue; local diagnostics) | §6.2, §8 A-09, §10 RB-07; §12, §16 |
| FR-TASK-06, FR-TASK-07 (pause/resume across reboot; budgets, loop detection) | §6.2, §11, §10 RB-04 |
| FR-NOTIF-02 (a task never sits silently) | §6.2, §7, §8 A-06/A-08, §10 RB-06 |
| FR-ADMIN-03, FR-MODEL-05 (service health page; token and cost accounting) | §9 D-ENG/D-TASK, §12; §6.3 |
| `11` RR-4, RR-5 (device reports false results; compromised cloud commands devices) | §3.1 (device spans are claims), §6.3 anomaly metrics, §11 kill switch, §16 |
| `11` §9 gates (M0 / first users / paid release) | §7 (M0 needs trace ids + redaction), §13 (restore drill is a paid-release gate), §14 |

Labels: `[FACT]` `[ASSUMPTION]` `[PROPOSED]` `[OPEN]`
