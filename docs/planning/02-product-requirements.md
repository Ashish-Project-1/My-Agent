# 02 — Product Requirements

| | |
|---|---|
| Status | Planning only. No requirement here is implemented or verified by a test. |
| Owner | Product + Architecture |
| Requirement IDs | `FR-<domain>-NN` (functional), `NFR-<domain>-NN` (non-functional). Stable; referenced by `21-requirements-traceability.md`. |
| Priority | `P0` = required for the first end-to-end milestone (M0) · `P1` = required for a paid public release · `P2` = post-launch / scale |

## 1. Product statement

**Universal Agent** lets a person or team hand a goal to software that plans,
executes and verifies it across domains — code, files and documents, the
browser, data, and external APIs — **on their own machine by default**, with a
complete, auditable record of every action it took and every approval it
needed, and with an optional cloud control plane for identity, team
collaboration, policy, audit and metering.

Three things make it different from "a chat window that calls tools":

1. **Local-first execution.** The user's files and credentials never have to
   leave the machine for the agent to be useful.
2. **Deterministic authorisation.** Dangerous actions require approval bound to
   the exact action, arguments, device and user — not a vibe check by a model.
3. **Recoverable, resumable, inspectable tasks.** A task is a durable object
   with a state machine, an event log, checkpoints and artifacts, not a
   fire-and-forget prompt.

## 2. Personas

| Persona | Description | Primary need |
|---|---|---|
| **P-1 Developer (primary)** | Solo developer or engineer on a Windows workstation with a mid-range GPU | Repo operations, refactors, dependency upgrades, test runs, browser checks — locally, privately |
| **P-2 Knowledge worker** | Analyst, ops, PM, researcher; less technical, more document- and web-centric | "Summarise these files", "collect this data from these sites", "draft and file this" |
| **P-3 Small team lead (buyer)** | Runs a 5–50 person team, owns the budget | Shared tasks, approvals, audit trail, usage limits per member, SSO later |
| **P-4 Org admin / security owner** | Enforces policy, responds to incidents | Deterministic policy, device inventory and revocation, audit export, data residency |
| **P-5 Platform operator (internal)** | Runs the control plane | Queues, SLOs, on-call, capacity, cost, incident response |
| **P-6 Integration developer (later)** | Builds tools/integrations on the platform | Stable contracts, tool SDK, sandboxed extension model |

`[ASSUMPTION]` The initial commercial wedge is P-1 and P-2 (self-serve,
local-first); P-3/P-4 revenue arrives with the team features in Phase 9.

## 3. Jobs to be done (with the domain that owns them)

| ID | Job | Domain | First phase |
|---|---|---|---|
| J-1 | "Do something in my repo and show me the diff before it lands" | Code | 4–6 |
| J-2 | "Ingest a pile of files and give me structured output" | Documents | 7 |
| J-3 | "Go to this site, do this repeatedly, and tell me what changed" | Browser | 7 |
| J-4 | "Chain these steps across services without me babysitting it" | Workflow | 6–9 |
| J-5 | "Use my local model; do not send my data anywhere" | Model | 4 |
| J-6 | "Stop and ask me before anything destructive" | Approval | 3 |
| J-7 | "Tell me exactly what it did and let me replay it" | Audit/events | 3 |
| J-8 | "Pause it, close my laptop, resume tomorrow" | Recovery | 4–6 |
| J-9 | "Give my team this capability without giving away my credentials" | Tenancy | 2, 9 |

## 4. Functional requirements

### 4.1 Identity, accounts, tenancy (`FR-AUTH`, `FR-ORG`)

| ID | Requirement | Pri |
|---|---|---|
| FR-AUTH-01 | Email + password sign-up/sign-in with Argon2id hashing and a documented password policy | P0 |
| FR-AUTH-02 | Email verification; password reset with single-use, time-boxed, hashed tokens | P0 |
| FR-AUTH-03 | Web sessions via `HttpOnly`, `Secure`, `SameSite=Lax` cookies; server-side session records that can be revoked individually | P0 |
| FR-AUTH-04 | TOTP second factor, with recovery codes; enforceable per organization | P1 |
| FR-AUTH-05 | OIDC/OAuth sign-in (Google, Microsoft, GitHub) with account linking rules | P1 |
| FR-AUTH-06 | SSO (SAML/OIDC) and SCIM provisioning for enterprise organizations | P2 |
| FR-AUTH-07 | Device-authorisation flow (short code + browser confirmation) so a desktop runner can join without typing a password into it | P0 |
| FR-AUTH-08 | Access tokens (short-lived) + rotating refresh tokens for first-party clients; reuse detection revokes the family | P0 |
| FR-AUTH-09 | Step-up re-authentication for high-risk actions (risk class R3) and for elevate-to-admin | P1 |
| FR-ORG-01 | Every user gets a default personal organization on sign-up (a team of one) | P0 |
| FR-ORG-02 | Organizations, memberships with roles `owner`/`admin`/`member`/`viewer`, invitations with expiry | P0 |
| FR-ORG-03 | Every tenant-owned row carries `organization_id`; every API call is scoped to exactly one organization | P0 |
| FR-ORG-04 | Per-organization settings: default execution location, allowed providers, data-retention window, approval policy | P1 |
| FR-ORG-05 | Organization deletion and per-user data export (machine-readable) | P1 |

### 4.2 Tasks and agent execution (`FR-TASK`, `FR-CODE`, `FR-TOOL`)

| ID | Requirement | Pri |
|---|---|---|
| FR-TASK-01 | Create a task from a natural-language goal plus optional attachments, workspace reference and constraints (deadline, budget, allowed tools) | P0 |
| FR-TASK-02 | Task is planned into explicit **steps**, each with a tool, arguments, risk class and expected effect — the plan is inspectable before execution | P0 |
| FR-TASK-03 | Execute steps sequentially or as an explicit dependency graph; record every step's input, output, duration, cost and outcome | P0 |
| FR-TASK-04 | Live progress streaming to every attached client (web, desktop, IDE) with resumable reconnection | P0 |
| FR-TASK-05 | Cancel a running task; cancellation is cooperative, bounded and leaves a consistent record | P0 |
| FR-TASK-06 | Pause/resume, including across a machine reboot, via checkpoints | P1 |
| FR-TASK-07 | Bounded execution: max steps, max wall-clock, max tokens, max cost, max retries per step, loop detection | P0 |
| FR-TASK-08 | Task templates / saved workflows with parameters | P2 |
| FR-TASK-09 | Schedule a task (cron or one-shot future time) | P2 |
| FR-TASK-10 | Duplicate submission of the same idempotency key returns the original task, never a second execution | P0 |
| FR-CODE-01 | Code tasks run against a user-chosen workspace directory with an explicit permission boundary | P0 |
| FR-CODE-02 | Every code change is shown as a diff before it is applied when the policy requires approval; the workspace is snapshotted (git) so changes are revertible | P0 |
| FR-CODE-03 | Command execution uses an allow-list of binaries with structured arguments; no shell string interpolation by default | P0 |
| FR-CODE-04 | Coding engine adapter: embedded OpenCode (default) or an alternative engine, selected per task | P0 |
| FR-TOOL-01 | Tool registry: declarative tool manifests (name, version, input/output schema, risk class, side effects, required permissions, idempotency, timeout) | P0 |
| FR-TOOL-02 | Tools resolve per-task: a task declares the capability it needs, the registry selects a compatible tool, and the selection is recorded | P1 |
| FR-TOOL-03 | Every tool invocation is logged with arguments hash, policy decision, approval reference and result digest | P0 |
| FR-TOOL-04 | Tools execute in isolation appropriate to their class (process/job-object, container, browser context) | P0 |

### 4.3 Approvals and policy (`FR-APPR`, `FR-POL`)

| ID | Requirement | Pri |
|---|---|---|
| FR-APPR-01 | Risk classifier assigns each concrete action (often each tool call with concrete arguments) to risk class `R0`–`R4` | P0 |
| FR-APPR-02 | `R0` (read-only, in-workspace) proceeds without approval; `R1` (bounded, reversible write in workspace) per policy; `R2` (sensitive: shell, network egress, external paths, credentials) requires explicit approval; `R3` (irreversible / production / account-level) requires approval **plus** step-up auth and, where configured, an org admin; `R4` is prohibited and never executable | P0 |
| FR-APPR-03 | An approval request states, in plain language and machine-checkable form: the action, its target, its arguments, the diff/effect preview, the requesting device, the policy version, and the expiry | P0 |
| FR-APPR-04 | An approval is **bound**: single-use token covering action digest, arguments digest, user, device, task, step, policy version, nonce, expiry. Replay or mutation of any bound field is rejected | P0 |
| FR-APPR-05 | Approval scopes: once, for-N-minutes, for-this-task, for-this-tool-this-workspace (persistent grants are per-organization, listed, revocable and shown in the UI) | P1 |
| FR-APPR-06 | Approvals route to the requesting user by default; org policy can require a second approver or an admin for `R3` | P1 |
| FR-APPR-07 | Denied or expired approvals are terminal for that step and produce an explicit, user-visible reason | P0 |
| FR-APPR-08 | The approval inbox shows pending items across tasks and devices, with age, task context and one-click approve/deny | P0 |
| FR-POL-01 | Policies are declared data (not code paths), versioned, and evaluated by a deterministic engine with no model involvement | P0 |
| FR-POL-02 | Policy evaluation is reproducible: given (action, context, policy version) the decision is identical every time | P0 |
| FR-POL-03 | Policies can only *tighten*: no policy grants what the built-in security floor forbids | P0 |
| FR-POL-04 | Local-runner policy and cloud policy compose with a documented precedence order, and the effective policy is inspectable per device | P1 |
| FR-POL-05 | Every policy decision (allow/ask/deny) is recorded with the rule that matched | P0 |

### 4.4 Devices and local runtime (`FR-DEV`)

| ID | Requirement | Pri |
|---|---|---|
| FR-DEV-01 | Register a Windows device via the device-authorisation flow; store a device key pair; the private key is never transmitted | P0 |
| FR-DEV-02 | Device list with name, OS, runner version, last-seen, capabilities (GPU class, model inventory), and per-device revocation | P0 |
| FR-DEV-03 | All device communication is **outbound-initiated** (WebSocket, long-poll fallback). No inbound port, no port forwarding | P0 |
| FR-DEV-04 | Heartbeat + capability report; cloud marks a device offline after a configurable silence window and requeues affected work | P0 |
| FR-DEV-05 | Workspace registration: a user selects directories the agent may touch; anything outside requires an explicit `external_directory` grant | P0 |
| FR-DEV-06 | Local diagnostics screen: runner version, model inventory, queue state, last errors, network reachability, sandbox self-test | P1 |
| FR-DEV-07 | Offline mode: tasks queued locally run without the cloud when the task does not require cloud services; results sync on reconnect | P1 |
| FR-DEV-08 | Revocation: a revoked device receives no new work, cannot call the API, and its pending approvals are invalidated | P0 |
| FR-DEV-09 | Auto-update of the runner with signature verification and rollback to the previous version | P1 |

### 4.5 Browser, documents, data, integrations (`FR-BRW`, `FR-DOC`, `FR-INT`)

| ID | Requirement | Pri |
|---|---|---|
| FR-BRW-01 | Drive a real browser (Playwright) with isolated contexts per task; no shared cookies between tasks | P0 |
| FR-BRW-02 | Read-only browsing is `R0`; submitting forms, uploading, purchasing, messaging or logging in is `R2`+ and always approved | P0 |
| FR-BRW-03 | Screenshots, page snapshots and network summaries are captured as artifacts for audit | P1 |
| FR-BRW-04 | Domain allow/deny lists per organization, enforced before navigation | P1 |
| FR-DOC-01 | Ingest PDF, DOCX, XLSX, CSV, images (OCR later), and plain text; extract structure and metadata | P0 |
| FR-DOC-02 | Produce artifacts: extracted text/JSON, generated reports (MD/PDF/XLSX), diffs, archives | P0 |
| FR-DOC-03 | Untrusted document content is tainted: instructions inside a document can never grant permissions (prompt-injection defence) | P0 |
| FR-INT-01 | Integration connections with per-provider credentials, stored encrypted, never returned to any client | P1 |
| FR-INT-02 | First integrations: GitHub, Google (Drive/Gmail read scopes), Slack, Linear/Jira, generic REST/webhook, SMTP | P1 |
| FR-INT-03 | Webhooks out: task completed/failed, approval required — signed, retried, replay-protected | P1 |
| FR-INT-04 | MCP client support so a user can attach their own MCP servers to their runner | P2 |

### 4.6 Models (`FR-MODEL`)

| ID | Requirement | Pri |
|---|---|---|
| FR-MODEL-01 | Provider abstraction: local (Ollama) and remote (OpenAI-compatible, Anthropic, Google, OpenRouter, custom base URL) behind one interface | P0 |
| FR-MODEL-02 | Per-organization provider policy: which providers may be used at all; local-only mode is a supported, first-class setting | P0 |
| FR-MODEL-03 | Model inventory discovery with health checks; unusable models are not offered | P1 |
| FR-MODEL-04 | Per-task model selection (planner model, executor model, embedding model) with sensible defaults | P1 |
| FR-MODEL-05 | Token and cost accounting per task, per model, per provider, per organization | P0 |
| FR-MODEL-06 | Explicit consent and a visible notice whenever content leaves the device for remote inference | P0 |
| FR-MODEL-07 | Graceful degradation: if a model is unavailable or the budget is exhausted, the task fails cleanly with a resumable state, not a corrupt half-write | P0 |

### 4.7 Usage, billing, notifications, admin (`FR-BILL`, `FR-NOTIF`, `FR-ADMIN`, `FR-UI`)

| ID | Requirement | Pri |
|---|---|---|
| FR-BILL-01 | Metered usage records (tasks, tasks-minutes, tokens, artifacts bytes, cloud-execution seconds, browser minutes) | P1 |
| FR-BILL-02 | Plans and quotas: per-org limits with soft warning and hard stop; quota state visible to members | P1 |
| FR-BILL-03 | Subscription with a payment provider, invoices, and self-serve upgrade/downgrade | P2 |
| FR-NOTIF-01 | In-app notification centre; optional email; per-user notification preferences | P1 |
| FR-NOTIF-02 | "Approval required" must reach the user promptly (in-app + push-capable channels); a task must never sit silently waiting | P0 |
| FR-ADMIN-01 | Admin console: users, organizations, devices, sessions, usage, quota overrides, audit search, integration status, feature flags | P1 |
| FR-ADMIN-02 | Impersonation for support, fully audited, with user-visible notice and no ability to read secrets | P2 |
| FR-ADMIN-03 | Service health page: queue depths, worker liveness, error rates, DB/Redis status | P1 |
| FR-UI-01 | Task workspace showing plan, step timeline, live logs, artifacts, approvals, and cost | P0 |
| FR-UI-02 | Approval inbox with risk context and effect preview | P0 |
| FR-UI-03 | Devices page, models page, integrations page, settings, usage page | P1 |
| FR-UI-04 | Task history with search/filter by state, tool, workspace, date, and outcome | P1 |
| FR-UI-05 | Full keyboard navigation, screen-reader labels, visible focus, WCAG 2.2 AA target, dark/light themes | P1 |

## 5. Non-functional requirements

### Reliability and durability (`NFR-REL`)

| ID | Requirement |
|---|---|
| NFR-REL-01 | `[ASSUMPTION]` Cloud control-plane monthly availability target: **99.9%** for the API and event stream (≈43 min/month). Proposed, unvalidated. |
| NFR-REL-02 | `[ASSUMPTION]` Task acceptance durability: once the API returns 201 for a task, the task is not lost — worker crash, deploy or Redis restart must not drop it (outbox + queue+DB reconciliation). |
| NFR-REL-03 | No duplicate side effects: every externally visible effect is guarded by an idempotency key or a uniqueness constraint. |
| NFR-REL-04 | `[ASSUMPTION]` RPO ≤ 15 min and RTO ≤ 4 h from Phase 10; before that, RPO ≤ 24 h / RTO ≤ 24 h with a documented manual restore. |
| NFR-REL-05 | A worker killed mid-task must be recoverable: leased work with heartbeats, bounded retries, checkpointed steps, and a reaper for expired leases. |
| NFR-REL-06 | Graceful degradation: Redis down → tasks are accepted into the DB and refused with 503 only when the queue cannot be written; DB down → API returns 503 with a health signal, and the local runner keeps working locally. |

### Performance and capacity (`NFR-PERF`)

| ID | Requirement |
|---|---|
| NFR-PERF-01 | `[ASSUMPTION]` p95 API latency < 300 ms for read endpoints under S2 load, measured server-side excluding client network. |
| NFR-PERF-02 | `[ASSUMPTION]` p95 first task-event delivered to an attached client < 2 s after the event is produced. |
| NFR-PERF-03 | `[ASSUMPTION]` p95 time from approval request to the user's device learning the decision < 5 s when the device is online. |
| NFR-PERF-04 | Scaling target: the control plane must be sized by formula, not by guesswork, for the three scenarios in `13`; every number there is an assumption until load-tested. |
| NFR-PERF-05 | Task throughput must be bounded by explicit budgets so one tenant cannot degrade another (per-org rate limits, queue fairness). |

### Security and privacy (`NFR-SEC`, `NFR-PRIV`)

| ID | Requirement |
|---|---|
| NFR-SEC-01 | Zero cross-tenant reads or writes; enforced in code and in the database, and proven by a dedicated test suite. |
| NFR-SEC-02 | Secrets are encrypted at rest (envelope encryption with a KMS/HSM-backed key), never logged, never returned to a client, never placed in a model prompt without explicit per-use consent. |
| NFR-SEC-03 | Every state-changing request is authenticated by a user session or a device key, authorised by policy, and recorded in the audit log. |
| NFR-SEC-04 | All media in transit: TLS 1.2+ (1.3 preferred) with HSTS; certificate pinning is not used (operational risk) but the runner verifies the cloud's certificate normally. |
| NFR-SEC-05 | Prompt injection cannot escalate privilege: no tool invocation is authorised by model output alone. |
| NFR-SEC-06 | The local sandbox prevents the agent from reading or writing outside declared workspaces and prevents escape into the host OS. |
| NFR-PRIV-01 | Local-first default: with no remote provider configured, no task content leaves the device. |
| NFR-PRIV-02 | Data retention is configurable per organization (default `[ASSUMPTION]` 90 days for task content, 400 days for audit metadata); deletion is verifiable. |
| NFR-PRIV-03 | User-visible, per-integration disclosure of what data is shared with whom; org-level egress auditing. |
| NFR-PRIV-04 | GDPR-shaped posture: export, delete, restrict processing, and a records-of-processing document. `[OPEN]` whether formal certification is required. |

### Observability, operability, cost (`NFR-OBS`, `NFR-COST`, `NFR-MAINT`)

| ID | Requirement |
|---|---|
| NFR-OBS-01 | Every request, task, step, tool call and approval carries a correlation/trace ID propagated across API → queue → worker → device → client. |
| NFR-OBS-02 | Metrics, logs and traces via OpenTelemetry; SLOs with error budgets; alerts tied to SLO burn. |
| NFR-OBS-03 | Every production incident has a runbook; every alert links to one. |
| NFR-COST-01 | Cloud cost per active user is a tracked metric with an alert threshold. |
| NFR-COST-02 | Default execution location is the device; cloud compute is opt-in per task and per organization. |
| NFR-MAINT-01 | Migrations are forward-only, reviewed, and safe to run while the previous version is live (expand/contract). |
| NFR-MAINT-02 | One-command local bring-up (`docker compose up`) for Postgres + Redis, no Kubernetes requirement for development. |
| NFR-MAINT-03 | Windows is a first-class development and runtime target: no path, symlink, signal, or process-model assumption that only holds on POSIX. |

## 6. Domain concepts (shared vocabulary)

| Term | Meaning |
|---|---|
| **Organization** | Tenancy root. Owns members, devices, workspaces, tasks, policies, integrations, usage. |
| **User** | A person. Belongs to ≥1 organization via membership. |
| **Session** | An authenticated cloud session for a user (web) or a device (runner). |
| **Device** | A registered local runner installation with a key pair and capabilities. |
| **Workspace** | A directory (or bucket of files) a device may operate on, with a permission boundary. |
| **Agent session** | A conversation/context container. 1 : N with tasks. |
| **Task** | A durable unit of work with a goal, constraints and a state machine. |
| **Step** | One planned unit inside a task: one tool call, or one model turn. |
| **Tool** | A declared capability with schema, risk class and side-effect declaration. |
| **Risk class** | `R0`–`R4` classification of a concrete action. |
| **Approval request / grant** | A request for, or a signed permission for, one concrete action. |
| **Artifact** | A produced or captured file (diff, report, screenshot, dataset, log bundle). |
| **Checkpoint** | A resumable snapshot of task progress and workspace state. |
| **Usage record** | A metered, immutable measurement for billing/limits. |
| **Audit event** | An immutable security-relevant record. |
| **Execution location** | `device` (default) or `cloud` (opt-in; policy-controlled). |

## 7. Out of scope (deliberately, at this stage)

- Mobile applications (iOS/Android) — the desktop/IDE/web triad is enough.
- macOS/Linux desktop runners in the first release `[OPEN]` — the code should
  not *preclude* them, but only Windows is planned and tested initially.
- A marketplace for third-party tools (Phase ≥ 11).
- Real-time multi-user co-editing of a task.
- Training or fine-tuning models.
- Hosting customer models on our GPUs.
- On-premise enterprise deployment of the control plane (single-tenant VPC
  deployment is a later Enterprise option).
- Compliance certifications (SOC 2, ISO 27001) — planned as a business track,
  not engineered in Phase 1–9.

## 8. Product constraints that shape the architecture

`[FACT]`/`[PROPOSED]`

1. Windows-first: every execution primitive (process kill trees, job objects,
   path semantics, service lifecycle, symlink/reparse points, Defender
   interactions) must be handled natively.
2. 4 GiB VRAM on the reference dev machine: the local model tier is *small*
   models, partial offload, and explicit remote-provider escape hatches.
3. Local-first: the cloud must add value without owning the data.
4. The cloud is multi-tenant from day one even if the first customers are solo
   users — retrofitting tenancy is the classic catastrophic refactor.
5. Approvals must be cheap to give and cheap to refuse. If approving is
   annoying, users disable the agent or rubber-stamp everything.

## 9. Success metrics (proposed, unmeasured)

| Metric | Target | Note |
|---|---|---|
| Task completion rate (non-model failures excluded) | ≥ 95% | `[ASSUMPTION]` |
| Median time-to-first-useful-action after sign-up | < 10 min | Requires the runner install to be trivial |
| Crash-free task rate | ≥ 99% | Crash = state machine left inconsistent |
| Median approvals per task | ≤ 2 | Higher means the risk model is too coarse |
| Approval response time (p50) | < 60 s | Higher means the notification path is broken |
| Runner install success rate | ≥ 95% | Windows installer + first-run diagnostics |

Labels: `[FACT]` `[ASSUMPTION]` `[PROPOSED]` `[OPEN]`
