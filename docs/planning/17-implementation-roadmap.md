# 17 — Implementation Roadmap

> Part of the Universal AI Agent planning set. Read `00-executive-summary.md`
> (decisions, risks, milestone M0), `03-system-architecture.md`,
> `04-architecture-decision-records.md`, `13-scalability-and-capacity-planning.md`,
> `14-testing-strategy.md` and `15-devops-and-infrastructure.md` before this
> document.

**Honesty statement.** `[FACT]` No code exists and no work has started. Every
phase below is a **plan**, not a record. Effort figures are `[ASSUMPTION]`
ranges for a small team (1–3 engineers) with no prior codebase, and they are
deliberately expressed as ranges because a single number here would be invented
precision. Dates are intentionally absent: the phases are ordered and gated, not
calendar-committed.

---

## 1. How to use this document

- It is **phase-gated**, not calendar-gated. A phase ends when its exit criteria
  are demonstrably met, not when a date arrives.
- Each phase states what it produces, what it depends on, what it must test, what
  security work it carries, and how we know it is done.
- The gates defined by `11-security-threat-model.md` §9 (M0, first external
  users, paid public release, enterprise readiness) are mapped onto phases in
  §15 and must not be moved without a recorded decision.
- If a phase slips, the lazy and correct response is to **cut scope from the
  phase**, never to skip its security or durability requirements.

---

## 2. Delivery principles

1. **Vertical slices before breadth.** Prefer one working end-to-end path over
   five half-built subsystems. This is what M0 (§5) enforces.
2. **Durability and tenancy are not "later".** They are cheap while the schema
   and module boundaries are small and expensive afterwards. Tenant scoping and
   the outbox land in the phase that first writes task data.
3. **Earn every service and every dependency** (`03` §4, `05` §6). No split, no
   new technology, no cloud service without a measured trigger.
4. **Local-first stays the default throughout** (D-15). Nothing in the roadmap
   introduces cloud inference cost.
5. **Windows is a first-class target from Phase 1**, not a port at the end
   (NFR-MAINT-03).
6. **Testability is designed in, not added.** The mock `CodingEngine`, the frozen
   clock and the two-org fixtures are Phase 1/3 deliverables, because the tests
   in `14` depend on them.
7. **Every phase leaves the repository in a working state** (green CI, reversible
   migrations) — no long-lived broken branches.

---

## 3. Phase overview

| # | Phase | Primary outcome | Exit gate | Effort `[ASSUMPTION]` |
|---|---|---|---|---|
| 0 | Repository foundation | Safe, versioned, consented starting point | none | 0.2–0.5 pw |
| 1 | Toolchain, contracts, CI baseline | Reproducible monorepo build on Windows and Linux | none | 2–4 pw |
| 2 | Identity, organizations, tenancy, cloud environment | A user can sign in and is strictly tenant-scoped | none | 3–5 pw |
| 3 | Task core and durable job pipeline | A task can be created, queued, and never lost | none | 3–5 pw |
| 4 | Local runner | A Windows device pairs, registers a workspace, runs a sandboxed command | none | 4–7 pw |
| 5 | Agent engine, tools, policy, approvals | **Milestone M0**: one task, one tool, one approval, end to end | **M0** | 6–9 pw |
| 6 | Context/retrieval and policy hardening | Useful code tasks with the full R0–R4 policy and scoped grants | first-external prep | 4–6 pw |
| 7 | Browser, document, integrations | The other tool families and external connections | first-external prep | 5–8 pw |
| 8 | Observability, quotas, notifications, admin | Operational visibility and self-serve limits | first external users | 4–6 pw |
| 9 | Hardening and scale review | Security gates for the paid release; measured service-split review | paid public release | 5–8 pw |
| 10 | Cloud execution and Kubernetes | Optional cloud execution at scale, on a measured trigger | paid growth | 6–10 pw |
| 11 | Validation: load, soak, chaos, DR | Evidence that the targets hold | enterprise readiness | 4–6 pw |

Total `[ASSUMPTION]`: roughly **46–79 person-weeks** of engineering for the full
plan; M0 alone is reached at the end of Phase 5, i.e. roughly **18–30
person-weeks in** for the smallest team that can run phases 2–5 in parallel.

---

## 4. Phase details

Each phase below uses the same shape: objective, prerequisites, deliverables,
dependencies, tests/gate, security work, acceptance/exit criteria, risks, effort.

### Phase 0 — Repository foundation

- **Objective.** Turn an unversioned directory into a safe, consented,
  reviewable starting point without touching the existing files' content.
- **Prerequisites.** Owner consent for `git init` (`05` §5 step 1; `AGENTS.md`
  requires asking).
- **Deliverables.**
  - `git init` + first commit containing the existing `AGENTS.md`,
    `INTEGRATIONS.md`, `opencode.jsonc`, `.env.example` **unmodified**.
  - Root hygiene files: `.gitignore` (excludes `.env`, `node_modules`, build
    output, model weights, local DB volumes), `.gitattributes` (line endings),
    `.editorconfig`, `README.md`, `SECURITY.md`, `CONTRIBUTING.md`
    `[OPEN]` + `LICENSE` `[OPEN]`.
  - Ratification note recording that ADR-001…ADR-028 (`04`) are accepted as the
    baseline, with the provisional ones flagged as revisitable.
- **Dependencies.** None.
- **Tests/gate.** `git status` clean; existing files byte-identical; CI not yet
  required.
- **Security work.** Confirm no secret is present in the working tree before the
  first commit; `.gitignore` corrects any leak path.
- **Acceptance/exit criteria.** The four existing files are committed unchanged;
  the repository has history; a `.gitignore` that would not have committed a
  `.env` exists.
- **Risks.** `[FACT]` There is no history today, so **this is the only phase
  whose omission is unrecoverable** — any later overwrite of the four files
  would be permanent.
- **Effort.** 0.2–0.5 pw.

### Phase 1 — Toolchain, contracts, and CI baseline

- **Objective.** A monorepo that builds, typechecks, lints and tests identically
  on Windows and Linux, with one contract source of truth.
- **Prerequisites.** Phase 0.
- **Deliverables.**
  - pnpm workspaces + Turborepo task graph (`build`, `typecheck`, `lint`,
    `test`, `test:integration`, `test:e2e`) with declared `dependsOn`/`outputs`.
  - Directory skeleton from `03` §5 created with placeholder packages (no
    speculative code inside).
  - `@ua/contracts`: Zod 4 schemas as the single source for API types, OpenAPI
    output and shared validation, with a schema→OpenAPI generation script.
  - TypeScript 7 pinned toolchain; lint/format chosen per `05` Q-T3 `[OPEN]`.
  - `shared/*`: structured logger with the redaction deny-list,
    error taxonomy and HTTP mapping, OTel wiring stub, test utilities (frozen
    clock, factory helpers, two-org fixtures).
  - `.github/workflows`: lint, typecheck, unit, contract, secret-scan, build — on
    **both** a Linux and a Windows runner; branch protection and `CODEOWNERS`.
  - `docker compose` for Postgres + Redis + MinIO with data on `F:` (`05` §5).
  - Startup config validation + `.env.example` drift check (`15` §6).
- **Dependencies.** pnpm 12 install (Corepack), Docker Desktop data-root move.
- **Tests/gate.** CI green on both OSes; a trivial unit test and a trivial
  contract test pass; the redaction helper has a failing test for at least one
  secret pattern (proves the deny-list is wired, not decorative).
- **Security work.** Secret scanning in CI and a pre-commit hook; redaction
  deny-list as a security control; least-privilege CI tokens; no long-lived
  cloud keys yet.
- **Acceptance/exit criteria.** `pnpm install --frozen-lockfile && pnpm turbo
  build typecheck test` succeeds from a clean checkout on both OSes; a
  deliberately malformed contract fails CI.
- **Risks.** `[FACT]` TypeScript 7.x is fresh (`05` Q-T1) — pin exact and be
  ready to pin back to the latest 6.x if lint/ORM/framework plugins break.
  `[FACT]` Prisma 7.10 pin trap (`05`): never install `prisma@latest`.
- **Effort.** 2–4 pw.

### Phase 2 — Identity, organizations, tenancy, and cloud environment

- **Objective.** A person can sign up, get an organization, and every subsequent
  read/write is provably scoped to exactly one tenant.
- **Prerequisites.** Phase 1.
- **Deliverables.**
  - Auth: email + password (Argon2id), email verification, reset, server-side
    revocable sessions, short-lived access + rotating refresh with reuse
    detection (FR-AUTH-01/02/03/08).
  - `organizations`, `memberships`, roles `owner`/`admin`/`member`/`viewer`,
    invitations (FR-ORG-01/02/03); default personal org on sign-up.
  - Tenant scoping mechanism: mandatory `organization_id` on tenant tables, a
    tenant-scoped data-access layer, and RLS as a backstop (ADR-008, NFR-SEC-01).
  - Cloud foundation: Terraform skeleton, remote state backend with locking,
    managed Postgres + Redis in dev/staging, `.env`-driven config, first
    environment promotion path (`15` §16).
  - `audit_events` write path for auth and org changes.
- **Dependencies.** Phase 1; `[OPEN]` managed-Postgres/Redis provider choice
  (Q-T2) needed before staging is real, but not before local development.
- **Tests/gate.** **Cross-tenant isolation test suite** (NFR-SEC-01) — a second
  org's data must be invisible and unwritable through every implemented path;
  session revocation works; refresh reuse revokes the family; audit rows are
  written for each sensitive action.
- **Security work.** Password policy + Argon2id parameters, timing-safe
  comparisons, generic auth error messages (no user enumeration), rate limits on
  auth endpoints, `login_attempts`, cookie flags
  (`HttpOnly`/`Secure`/`SameSite=Lax`), CSRF posture documented, secret handling
  in the cloud environment.
- **Acceptance/exit criteria.** A user signs up, verifies, creates a team and
  invites a member; the isolation suite passes with zero findings; a revoked
  session is rejected on the next request; Terraform plan is reproducible.
- **Risks.** R-03 (cross-tenant leak) — this phase is where it is prevented or
  entrenched; do not defer the isolation suite.
- **Effort.** 3–5 pw.

### Phase 3 — Task core and durable job pipeline

- **Objective.** A task can be created, planned (as data), queued and executed by
  a trivial worker, and **cannot be lost** by a crash, deploy or Redis restart.
- **Prerequisites.** Phase 2.
- **Deliverables.**
  - `tasks`, `task_steps`, `task_events`, `task_checkpoints`, `agent_sessions`
    (`06` §2.3) with the state machine from `08` §4 (`QUEUED → PLANNING →
    RUNNING → …`).
  - Append-only `task_events` with monotonic per-task `seq` (ADR-006) and the
    SSE contract from `07`.
  - Durable intent: transactional `outbox` + queue publication (ADR-005),
    idempotency keys for mutations (FR-TASK-10), `job_leases` with heartbeat.
  - NestJS module boundaries with lint-enforced no-cross-module-DB-access.
  - Web app shell + task creation form + task workspace basic view (plan,
    timeline, live stream) (FR-TASK-01/03/04, FR-UI-01 minimal).
  - The mock `CodingEngine` and the frozen clock land here if not in Phase 1.
- **Dependencies.** Phase 2; Redis/BullMQ.
- **Tests/gate.** Task-not-lost-after-crash (NFR-REL-02); duplicate submission
  returns the original task (FR-TASK-10, NFR-REL-03); SSE reconnect resumes
  without gaps or duplicates (FR-TASK-04); state-machine illegal transitions are
  rejected (unit); outbox replay is idempotent.
- **Security work.** Every task read/write is tenant-scoped; event payloads are
  redacted and size-capped (`06`); no secrets in task content logs.
- **Acceptance/exit criteria.** Kill the worker and Redis mid-task; on restart
  the task resumes or re-queues with a consistent event log; two identical
  submissions produce one task; the isolation suite still passes with tasks in
  scope.
- **Risks.** R-06 (resource leaks) starts here; hard budgets exist as data but
  enforcement arrives in Phase 5.
- **Effort.** 3–5 pw.

### Phase 4 — Local runner

- **Objective.** A Windows device pairs with the account, declares its
  capabilities and workspaces, and can execute a sandboxed command under
  declared boundaries.
- **Prerequisites.** Phase 2 (device identity) and Phase 3 (commands need a
  task/step to attach to).
- **Deliverables.**
  - Electron 44 desktop shell (D-11) hosting the Node runner in-process.
  - Device-authorisation pairing flow: short code + browser confirmation
    (FR-AUTH-07), Ed25519 device key pair where **the private key never leaves
    the machine** (FR-DEV-01), `devices` + `device_pairing_codes` (`06` §2.2).
  - Outbound-only WSS device channel with long-poll fallback (FR-DEV-03,
    ADR-003); jittered reconnect backoff; `device_commands` durability +
    ack/expiry; heartbeat and capability report; offline detection and
    requeue (FR-DEV-04); per-device revocation invalidating pending
    approvals (FR-DEV-08).
  - Workspace registration with canonical path validation and
    `external_directory` grants (FR-DEV-05).
  - Windows sandbox layering per `09` (job object / AppContainer / path
    canonicalisation / argv allow-list without shell interpolation) and a
    sandbox self-test.
  - Model runtime: Ollama 0.40 with `OLLAMA_MODELS` on `F:`, model inventory +
    health + honest fit reporting for 4 GiB VRAM (`09`, FR-MODEL-03).
  - Runner diagnostics screen (FR-DEV-06).
- **Dependencies.** Phase 3; `F:` disk space; Ollama install (`05` §5 step 6).
- **Tests/gate.** Windows test matrix from `09` (path escapes `..`, symlink,
  junction, 8.3 names, ADS, UNC, case collisions — each denied and audited);
  pairing code expiry/single-use; revoked device gets no work and cannot call
  the API; offline→online sync; sandbox self-test gates mutating tools.
- **Security work.** Device key handling, command signing/verification, local
  policy re-evaluation before execution (RR-5), egress default-deny, no shell
  string interpolation (FR-CODE-03).
- **Acceptance/exit criteria.** On a real Windows machine (ADR-028), a device
  pairs via short code, registers a workspace, runs an allowed command inside
  the sandbox, is denied an out-of-workspace path, and a revoked device is
  inert.
- **Risks.** R-02 (sandbox escape) — the highest-severity local risk; and R-05
  (dev-machine capacity) `[FACT]` with 4.9 GiB free RAM, so the runner and the
  dev stack run in separate sessions.
- **Effort.** 4–7 pw.

### Phase 5 — Agent engine, tools, policy, approvals (Milestone M0)

- **Objective.** **One task, one tool, one approval, end to end** — plus the
  beginnings of the real engine, registry and policy engine.
- **Prerequisites.** Phases 3 and 4.
- **Deliverables.**
  - Agent loop per `08`: plan → validate → execute step → verify → next; budgets
    (steps, wall-clock, tokens, cost, retries) enforced; loop detection; bounded
    cancellation (FR-TASK-02/05/07).
  - Tool registry with declarative manifests (FR-TOOL-01) and **one** real tool
    end-to-end (a workspace-scoped code action), executed in isolation
    (FR-TOOL-04) with a logged arguments hash, decision and result digest
    (FR-TOOL-03).
  - `CodingEngine` interface with the embedded OpenCode adapter behind it
    (ADR-011) and the mock adapter already used by tests.
  - Risk classifier + policy engine (FR-POL-01/02/03/05, FR-APPR-01/02) as a
    pure, deterministic function, seeded with the **built-in floor** and enough
    rules for the M0 tool; `policy_documents`, `policy_decisions` persisted.
  - Approval request/decision/expiry with **digest binding** (FR-APPR-03/04),
    single-use grants, and a minimal approval UI (FR-APPR-08, FR-UI-02).
  - Worker deployment: `worker-code` at minimum, with lease/heartbeat/reaper
    (NFR-REL-05).
  - **First cloud deploy** of the API path used by M0 (`05` Q-T4 resolved here
    `[OPEN]`).
- **Dependencies.** Phases 3–4; a decision on the M0 tool's risk class.
- **Tests/gate.** The M0 acceptance test (§5) plus the first tranche of the
  required tests from `10` §11: policy determinism; last-match-wins ordering;
  `R4` unapprovable; digest binding (mutate one argv character / one path letter
  / one expiry second / device / policy version → grant invalid); replay fails;
  expiry returns the step to *needing approval*, not *allowed*; budget
  exhaustion fails cleanly with a resumable checkpoint.
- **Security work.** Digest-bound approvals; the model can request but never
  authorise (NFR-SEC-05); audit records for every approval and policy decision;
  redaction verified in the M0 path.
- **Acceptance/exit criteria.** §5.
- **Risks.** R-01 (destructive action via model output) and R-07 (approval
  fatigue) begin here; the anti-fatigue rules (`10` §9) must ship with the
  first approval UI, not after users complain.
- **Effort.** 6–9 pw.

### Phase 6 — Context and retrieval, policy hardening

- **Objective.** Code tasks become genuinely useful (project context) and the
  policy system reaches its full, documented shape.
- **Prerequisites.** Phase 5.
- **Deliverables.**
  - Context/retrieval: `context_chunks` with embeddings, taint tracking
    (`trusted`/`untrusted`), incremental indexing of a workspace, and retrieval
    quality controls (FR-DOC-03 taint rules, `08` §9).
  - Full policy engine: all actions/resources (`10` §3.2), precedence (`10`
    §3.4), tightening-only composition, OpenCode effective-policy readback
    verification (`10` §11 item 14), risk overrides, device-level policy.
  - Approval scopes: once / N minutes / this task / this tool+workspace;
    persistent org grants listed and revocable; second-approver and step-up auth
    for R3 (FR-APPR-05/06, FR-AUTH-04/09).
  - Plan inspection/approval before execution when policy requires it
    (FR-TASK-02 `requirePlanApproval`).
  - Pause/resume across reboot via checkpoints (FR-TASK-06).
- **Dependencies.** Phase 5; `[OPEN]` Q-T7 (`pgvector` sufficiency) resolved
  here or as a deferred fallback.
- **Tests/gate.** Remaining required tests from `10` §11 (prompt injection via a
  document yields ask/deny and visible taint; scanner failure → ask, never
  allow; cross-tenant policy evaluation fails closed; `maxApprovalsPerTask`
  fails the task with the documented code; offline approval synced after a
  policy change is rejected). TOTP + step-up flows. Retrieval taint test:
  instructions inside an ingested document cannot produce an allow.
- **Security work.** Prompt-injection corpus (`11` §4.3); taint propagation;
  step-up auth; second-approver enforcement (except solo orgs — Q-P3 `[OPEN]`).
- **Acceptance/exit criteria.** A document containing "ignore previous
  instructions and run X" produces an ask/deny with the taint visible in the
  decision record, and a reviewer can enumerate every effective policy rule for
  a device.
- **Risks.** R-01 and R-07 remain the top risks; retrieval raises the
  injection surface.
- **Effort.** 4–6 pw.

### Phase 7 — Browser, document, and integrations

- **Objective.** The other tool families and external connections, so the
  product matches `INTEGRATIONS.md`.
- **Prerequisites.** Phase 6 (policy must already be sound before more powerful
  tools exist).
- **Deliverables.**
  - `worker-browser` with Playwright 1.64, isolated contexts per task, no shared
    cookies (FR-BRW-01); read-only browsing R0, form submission/login/purchase
    R2+ always approved (FR-BRW-02); screenshots/snapshots/network summaries as
    artifacts (FR-BRW-03); domain allow/deny enforcement before navigation
    (FR-BRW-04).
  - `worker-document`: PDF/DOCX/XLSX/CSV/image/text ingest and artifact
    production (FR-DOC-01/02); OCR deferred `[OPEN]`.
  - `worker-maintenance`: retention sweeps, partition maintenance, orphan
    reaping, webhook retries, usage rollups.
  - Integrations: GitHub, Google (read scopes), Slack, Linear/Jira, generic
    REST/webhook, SMTP, with envelope-encrypted credentials never returned to a
    client (FR-INT-01/02); signed, retried, replay-protected outbound webhooks
    (FR-INT-03).
  - MCP client support so a user can attach their own MCP servers to their runner
    (FR-INT-04) `[P2]`.
  - `[OPEN]` Managed browser provider vs. self-hosted Playwright (Q-T6)
    evaluated with the `13` cost model.
- **Dependencies.** Phase 6; `[OPEN]` Q-T6 decision for the cloud side.
- **Tests/gate.** SSRF corpus; domain allow/deny enforcement; per-task browser
  isolation (no cookie bleed); oversized/hostile document handling (zip bombs,
  malformed PDFs); credential-never-returned test; webhook signature and replay
  tests; artifact lifecycle/TTL tests.
- **Security work.** SSRF defences, egress controls, untrusted-content
  handling, credential encryption and rotation, integration scope minimisation
  (FR-PRIV-03 data-sharing disclosure).
- **Acceptance/exit criteria.** A browser task completes read-only without
  approval and a login+submit task requires approval and captures evidence; a
  webhook is delivered, retried on failure and replay-protected; no integration
  credential is ever observable in an API response or a log.
- **Risks.** R-06 (orphaned browsers) and a materially larger attack surface;
  the domain-allowlist control is the main mitigation.
- **Effort.** 5–8 pw.

### Phase 8 — Observability, quotas, notifications, admin

- **Objective.** We can see what the system is doing and users can see and
  limit their own usage.
- **Prerequisites.** Phase 7 (there is enough behaviour to observe).
- **Deliverables.**
  - OTel instrumentation per `16`: correlation IDs end to end, structured logs
    with redaction, the metrics catalogue, SLOs and error budgets, alert rules
    linked to runbooks.
  - Health/readiness/deep-dependency endpoints per deployable (`16` §11).
  - Usage metering (`usage_records` immutable, `usage_rollups`), plans and
    quotas with soft warning + hard stop enforced at admission (FR-BILL-01/02);
    admin quota overrides (FR-ADMIN-01).
  - Notifications: in-app centre, per-user preferences, and the rule that an
    approval request must never sit silently (FR-NOTIF-01/02).
  - Admin console: users, organizations, devices, sessions, usage, quota
    overrides, audit search, integration status, feature flags (FR-ADMIN-01);
    service health page (FR-ADMIN-03). Impersonation deferred `[P2]`
    (FR-ADMIN-02).
  - Backup schedule + first **restore drill** recorded in the DR drills log.
- **Dependencies.** Phase 7; observability backend (D-13).
- **Tests/gate.** Alert-fires-and-links-to-runbook test (synthetic fault in
  staging); quota hard-stop test; notification-delivery test; PII/log-redaction
  test; **backup restore drill succeeds within the documented RTO** (proves
  NFR-REL-04 is at least achievable).
- **Security work.** Audit search privacy (no secret visibility), admin access
  reviews, least-privilege for the admin console, retention/deletion
  verification test (NFR-PRIV-02).
- **Acceptance/exit criteria.** A synthetic incident triggers the correct alert
  with a working runbook link; a restore of Postgres into a scratch environment
  completes and is recorded; a user hitting a quota gets a clear, actionable
  error, not a silent failure.
- **Risks.** Observability volume becoming a cost line (`13` §9); admin console
  becoming a privilege-escalation surface.
- **Effort.** 4–6 pw.

### Phase 9 — Hardening and scale review (paid-release gate)

- **Objective.** Meet the paid-public-release security gate and make an
  evidence-based decision about service splits.
- **Prerequisites.** Phase 8.
- **Deliverables.**
  - Remediation of findings from scans, the injection/SSRF/path corpora, and a
    penetration test `[OPEN]` scope.
  - RLS enabled and proven in production; cross-tenant suite in CI as a blocking
    gate; SBOM/images signed; vulnerability-response process documented.
  - `03` §4 review point: re-evaluate all six service-split candidates with
    measured data; record decisions (split or keep) as ADRs.
  - Retention/deletion verification in production; GDPR-shaped
    export/delete/restrict flows (NFR-PRIV-04, FR-ORG-05).
  - Accessibility pass to WCAG 2.2 AA on the flows in `12` (FR-UI-05).
  - Documentation set for operators and users; incident runbooks complete.
- **Dependencies.** Phase 8.
- **Tests/gate.** `11` §9 paid-release gate list complete; accessibility checks
  pass; the isolation suite and the 14 required policy tests are all green in CI.
- **Security work.** This phase *is* security work plus scale decisions.
- **Acceptance/exit criteria.** A paid-release readiness review against
  `19-production-readiness-checklist.md` returns "go", or the remaining items are
  explicitly accepted with a named owner and a revisit trigger.
- **Risks.** R-04 (version churn) — pin-and-adapter discipline must have held
  through eight phases; any accumulated drift is repaid here.
- **Effort.** 5–8 pw.

### Phase 10 — Cloud execution and Kubernetes

- **Objective.** Optional cloud execution for users with no device or an explicit
  request, at a scale the business has earned.
- **Prerequisites.** Phase 9 **and trigger ST-9** (`13` §7): sustained, measured
  demand for cloud execution that exceeds the simpler deployment's capacity.
  Without the trigger, **this phase does not start** (D-12, R-08).
- **Deliverables.**
  - Kubernetes manifests/Helm for `api` + four workers, HPA on queue depth,
    pod disruption budgets, external-secrets (`03` §5.12).
  - Cloud execution path: a task with `execution_location = cloud` runs in our
    infrastructure with the same policy engine and the same approval semantics;
    explicit consent and a visible notice whenever content leaves the device
    (FR-MODEL-06).
  - Multi-AZ Postgres, PITR/WAL archiving, RPO ≤ 15 min / RTO ≤ 4 h
    (NFR-REL-04) with drills.
  - Cost controls and budgets for the new compute line (NFR-COST-01).
- **Dependencies.** ST-9; budget approval; recorded ADR.
- **Tests/gate.** Cloud-execution tests proving identical policy behaviour to
  local; failover drill meeting RPO/RTO; HPA behaviour under a synthetic queue
  surge.
- **Security work.** No new trust boundary is created (the runner already
  distrusts the cloud), but cloud execution increases blast radius and requires
  workload isolation review.
- **Acceptance/exit criteria.** A cloud task completes with the same approval
  guarantees as a local task; a failover drill meets the RPO/RTO target; the cost
  per active user stays inside the projection.
- **Risks.** **This is the largest cost-commitment in the plan** and the one most
  likely to be started too early. The measured trigger is the control.
- **Effort.** 6–10 pw.

### Phase 11 — Validation: load, soak, chaos, DR

- **Objective.** Produce the evidence that the S2/S3 targets and reliability
  claims actually hold.
- **Prerequisites.** Phase 9 (load tests against paid-release expectations) and,
  if Phase 10 ran, its infrastructure.
- **Deliverables.**
  - Load-test drivers for the workloads in `13` §6.1 and a run against the
    criteria `13` §6.2 (C1–C10), executed in staging.
  - 72-hour soak test with retention sweeps and partition maintenance running.
  - Failure-injection suite: worker killed mid-task, Redis restart, DB failover,
    device disconnect mid-approval, clock skew on digest expiry, queue backlog,
    deploy during in-flight tasks.
  - Restore drills recorded with measured RTO; RPO confirmed by archiving
    verification.
  - Results published with the assumptions they replace in `13` and the
    checklist items they close in `19`.
- **Dependencies.** Phases 9/10; `[OPEN]` load-testing tool (Q-T5).
- **Tests/gate.** All of C1–C10 must pass or produce a named defect. A failed
  criterion blocks the enterprise-readiness gate.
- **Security work.** Multi-tenant load run doubles as the isolation-under-load
  proof (C7).
- **Acceptance/exit criteria.** Every `[ASSUMPTION]` number used for sizing has
  either been replaced by a measurement or explicitly retained as an accepted
  assumption with an owner.
- **Risks.** Load tests that do not reproduce real user behaviour (e.g. omitting
  SSE or approval round-trips) give false confidence; the workload list exists to
  prevent that.
- **Effort.** 4–6 pw.

---

## 5. Milestone M0 — definition

`[FACT]` M0 is defined in `00` as **"one task, one tool, one approval, end to
end"** and is the exit criterion of **Phase 5**. It is deliberately the smallest
complete slice of the product, because the risky parts of this system
(policy determinism, digest-bound approval, durable execution, device trust) are
all exercised by it.

**In scope (the M0 slice):**

1. A signed-in user in a tenant-scoped org creates a task with a natural-language
   goal against one registered Windows device and one registered workspace.
2. The device pairs via the device-authorisation flow and holds a private key
   that never leaves the machine.
3. The engine plans at least one step, and the plan is visible.
4. One real tool is invoked, in the sandbox, from the tool registry, with a
   logged arguments hash, policy decision, and result digest.
5. That tool's action is risk class **R2**, so it produces an approval request
   bound to the action digest.
6. The user approves from the web UI; the grant is delivered over the
   outbound-only device channel; **mutating any bound field invalidates it**.
7. The tool executes, the result is recorded, the task reaches `COMPLETED`
   through `VERIFYING`, and the whole path carries one correlation ID.
8. Killing the worker or Redis mid-task does not lose the task.

**Explicitly out of scope for M0** (named so they are not smuggled in): browser
tooling, document ingest, integrations, retrieval/embeddings, billing,
notifications beyond the approval prompt, admin console, cloud execution, TOTP,
scoped/persistent grants beyond single-use, and multi-step dependency graphs.

**M0 acceptance test.** A scripted end-to-end run that performs steps 1–8 above,
plus negative variants: a tampered digest is rejected, a replayed grant is
rejected, an expired grant returns the step to needing approval, and a
cross-tenant attempt to read the task fails closed.

**M0 exit criteria.** The acceptance test and its negative variants pass in CI on
a Windows runner; the isolation suite is green; no secret appears in logs; the
task survives a worker kill.

**Why M0 is the "thin vertical".** If schedule pressure appears before Phase 5,
the correct response is to build the M0 slice *directly* by cutting Phases 6–8
scope, not to build Phase 2–4 breadth-first. The M0 slice is the minimum
demonstration that the architecture's hardest invariants hold.

---

## 6. Critical path

The critical path runs through the invariants that cannot be retrofitted:

```
Phase 0 (history)
  → Phase 1 (toolchain + contracts + CI)
    → Phase 2 (identity + tenancy + isolation suite)
      → Phase 3 (task core + outbox + idempotency)
        → Phase 4 (runner + pairing + Windows sandbox)
          → Phase 5 (engine + tool + policy + approval) = M0
```

Everything else is parallelisable or additive:

- `worker-browser`, `worker-document`, integrations, retrieval, billing,
  notifications and the admin console are **leaves** — they extend the M0 spine
  and can be built in any order, by different people, once the spine exists.
- Observability (`16`) should be *started* early (correlation IDs in Phase 1/3)
  and *completed* in Phase 8; starting it late is a classic rework trap.
- Cloud environments (Phase 2) and Kubernetes (Phase 10) are on the path only
  when their triggers fire.

**Longest-lead prerequisites** `[ASSUMPTION]`: the managed-Postgres/Redis
provider choice (Q-T2) before staging is real; the Windows signing/update channel
(Q-DEV-5) before any desktop distribution; and the penetration test (Q-`19`)
before the public launch. These have procurement/queue times and should be
started well before the phase that needs them.

---

## 7. Parallelisation guidance

For a 2–3 person team `[ASSUMPTION]`:

| Track | Owner shape | Can start |
|---|---|---|
| Backend spine (API, DB, tenancy, tasks) | engineer A | Phase 1 |
| Runner + Windows/sandbox + model runtime | engineer B | Phase 3 (needs device API from Phase 2) |
| Frontend (web + admin) | engineer C or A | Phase 3 shell, Phase 8 admin |
| Worker families | any, after Phase 5 | Phase 7 |
| DevOps | anyone, partially | Phase 1 local, Phase 2 cloud |

Two people can reach M0; three can reach it faster but the M0 slice has little
parallelism inside it.

---

## 8. What would compress or expand this plan

**Compress (legitimately):** cutting Phase 6–8 scope to reach a demonstrable M0
sooner; deferring Kubernetes (already deferred); running M0 with a stubbed policy
engine seeded only with the built-in floor (already the Phase 5 plan).

**Would force expansion (do not wish these away):**

- R-04 fires: a major version of OpenCode, TypeScript or Prisma breaks an
  adapter — the adapter discipline (`05` §4) limits but does not eliminate the
  cost.
- R-06 fires at scale: orphaned browsers/loops require more reaper and isolation
  work than planned.
- Q-T7 resolves to "Postgres is not enough" — a retrieval subsystem becomes its
  own phase.
- The local-first assumption is falsified (most users want cloud execution) —
  Phase 10 is pulled forward and the cost model changes materially (`13` §10).

---

## 9. Risks carried by the roadmap

`[FACT]` The risks are defined in `00` §risks (R-01…R-08) and
`11` §8 (RR-1…RR-8). Roadmap-relevant framing:

| Risk | Phase where it is created or mitigated |
|---|---|
| R-01 destructive action | Mitigated in Phases 5–6; created by the very existence of tools |
| R-02 sandbox escape | Mitigated in Phase 4; re-tested in Phase 9/11 |
| R-03 cross-tenant leak | Prevented in Phase 2; proven continuously thereafter |
| R-04 version churn | Controlled from Phase 1; repaid in Phase 9 |
| R-05 dev-machine capacity | From Phase 1; never fully solved, only worked around |
| R-06 resource leaks | From Phase 3; hardened with workers in Phase 7 |
| R-07 approval fatigue | Created in Phase 5; must be designed against from the first approval UI |
| R-08 premature scale spend | Guarded by Phase 10's measured trigger |

---

## 10. Open questions

| # | Question | Impact | Phase |
|---|---|---|---|
| Q-RM-1 | Team size and availability | Total duration; parallelisation | Phase 0 |
| Q-RM-2 | Cloud provider / container runtime (Q-T4) | Phase 5 deploy and Phase 10 | Phase 5 |
| Q-RM-3 | Managed Postgres/Redis provider (Q-T2) | Phase 2 staging, backups | Phase 2 |
| Q-RM-4 | Desktop signing/notarisation account (Q-DEV-5) | Shipping the runner | Phase 4 |
| Q-RM-5 | Penetration-test scope/timing (`11` §9) | Phase 9 gate | Phase 9 |
| Q-RM-6 | Licences for dependencies and the repo | Legal posture | Phase 0/1 |
| Q-RM-7 | Whether `sandbox`/public trial ships | Ops load at launch | Phase 8/9 |
| Q-RM-8 | `pgvector` sufficiency (Q-T7) | May add a retrieval phase | Phase 6 |
| Q-RM-9 | Whether any paying customer requires data residency | Phase 9/10 scope | Phase 9 |
| Q-RM-10 | Whether the 100k-registration target is a marketing goal or a contractual one | Sequencing of Phases 10/11 | Phase 0 |

---

## 11. Traceability

| Requirement / decision | Where addressed |
|---|---|
| FR-AUTH-01…09 | Phase 2 (01–03, 08), Phase 6 (04, 09), Phase 4 (07) |
| FR-ORG-01…05 | Phase 2; export/delete in Phase 9 |
| FR-TASK-01…10 | Phase 3 (01, 03, 04, 10), Phase 5 (02, 05, 07), Phase 6 (06), deferred (08, 09) |
| FR-CODE-01…04 | Phase 4/5 |
| FR-TOOL-01…04 | Phase 5 |
| FR-APPR-01…08 | Phase 5 (01–04, 07, 08), Phase 6 (05, 06) |
| FR-POL-01…05 | Phase 5 (01–03, 05), Phase 6 (04) |
| FR-DEV-01…09 | Phase 4 (01–06, 08), Phase 6 (07), Phase 8 (09, per `15` §15) |
| FR-BRW-01…04, FR-DOC-01…03, FR-INT-01…04 | Phase 7 |
| FR-MODEL-01…07 | Phase 4 (03), Phase 5 (01), Phase 6 (04), Phase 8 (05), Phase 10 (06) |
| FR-BILL-01/02, FR-NOTIF-01/02, FR-ADMIN-01…03, FR-UI-01…05 | Phase 8, with FR-UI-01/02 in Phase 3/5 |
| NFR-REL-01…06 | Phases 2–5, proven in Phase 8 (drills) and Phase 11 |
| NFR-PERF-01…05 | Phase 11 (criteria in `13` §6.2) |
| NFR-SEC-01…06 | Phases 2–6; gates in Phase 9 |
| NFR-PRIV-01…04 | Phases 4–9 |
| NFR-OBS-01…03, NFR-COST-01/02 | Phase 8 |
| NFR-MAINT-01…03 | Phases 0–1, maintained throughout |
| M0 | Phase 5 (§5 of this document) |
| D-01…D-15 | Applied throughout; D-12/D-15 gate Phase 10 |

Labels: `[FACT]` `[ASSUMPTION]` `[PROPOSED]` `[OPEN]`
