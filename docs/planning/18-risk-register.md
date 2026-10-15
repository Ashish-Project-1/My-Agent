# 18 — Risk Register

> Part of the Universal AI Agent planning set. Read `00-executive-summary.md`
> (§risks R-01…R-08), `11-security-threat-model.md` (§8 residual risks
> RR-1…RR-8) and `17-implementation-roadmap.md` (§9) first. This document is the
> **single consolidated register**; where a risk already has a name elsewhere it
> keeps that name so references stay stable.

**Honesty statement.** `[FACT]` No code, no deployment and no user behaviour
exist, so **no risk in this register has ever been observed**. Likelihood and
impact values are `[ASSUMPTION]` expert judgements, not measurements. They exist
to force prioritisation, not to predict the future. Every risk is expected to be
re-scored once real signals exist (usage data at S2, load-test results in Phase
11, incident history after launch).

---

## 1. How risks are scored and used

- **Likelihood (L):** 1 = remote, 2 = unlikely, 3 = possible, 4 = likely,
  5 = expected. `[ASSUMPTION]`
- **Impact (I):** 1 = cosmetic, 2 = minor rework, 3 = significant rework or a
  degraded release, 4 = data loss / security breach / launch blocked,
  5 = unrecoverable (permanent secret exposure, cross-tenant breach, destroyed
  user data, unrecoverable history loss).
- **Score = L × I.** Banding: 1–4 low, 5–9 medium, 10–15 high, 16–25 critical.
- **Status:** `open` (nothing done), `mitigating` (controls in progress/planned),
  `monitoring` (control exists, residual risk is watched), `retired`.
- Every risk has: an **owner role**, a **mitigation** (the planned control), a
  **detection** (how we would learn it happened), a **trigger** (the observable
  signal that raises its score), and **residual** (what remains after
  mitigation).
- Accepted residual risks must be signed off explicitly and recorded in
  `19-production-readiness-checklist.md` §4. A risk is never "closed" by being
  ignored; it is closed by being retired, mitigated to a monitored residue, or
  consciously accepted by a named human.

---

## 2. Critical and high risks

### 2.1 R-01 — A model, or a prompt-injected input, causes a destructive action

| Field | Value |
|---|---|
| Category | Security / agent safety |
| L | 4 |
| I | 5 (if the action destroys user data outside a snapshot) → **critical** |
| Status | mitigating |
| Owner | Agent engine + security |

- **Description.** The model proposes an action, or a hostile document/web page
  instructs it to, and the action is executed with real consequences. This is
  the defining risk of an agent product.
- **Why the design is the mitigation, not the prompt.** The model must have **no
  authority** (NFR-SEC-05). Authority lives in a deterministic, versioned policy
  engine plus digest-bound, single-use, user-issued approvals (`10`,
  ADR-004/ADR-007).
- **Mitigation.**
  1. Risk classes R0–R4 with R4 hard-coded as never executable (`10` §8).
  2. Digest binding over action, arguments, target, user, device, task, step,
     policy version, nonce and expiry (`10` §5.1).
  3. Untrusted content is tainted and cannot grant permissions (FR-DOC-03).
  4. Snapshot-before-mutate so most writes are revertible (FR-CODE-02).
  5. Path canonicalisation and argv allow-lists (no shell interpolation).
- **Detection.** `policy_decisions` and `audit_events` review; injection-corpus
  tests in CI; anomaly detection on unusual approval/rejection patterns.
- **Trigger to raise.** Any real incident where an unauthorised action executed;
  any injection test that produces `allow`.
- **Residual.** RR-1 and RR-3 (`11` §8): an authorised user can still approve a
  destructive action, and a local model can still propose nonsense. Consent plus
  snapshots plus clear previews are the only defences; they are not perfect.

### 2.2 R-02 — Local sandbox escape on Windows

| Field | Value |
|---|---|
| Category | Security / local execution |
| L | 3 |
| I | 5 → **critical** |
| Status | mitigating |
| Owner | Local runtime |

- **Description.** The agent reads or writes outside declared workspaces, or
  escapes into the host OS, via shell injection, symlink/junction traversal,
  path canonicalisation bugs, short (8.3) names, alternate data streams, UNC
  paths or case-collision tricks.
- **Mitigation.** Layered containment per `09` (job object / AppContainer,
  canonical path checks, egress default-deny, argv allow-list without shell
  strings); the **path-escape corpus** is a required test (`10` §11 item 9,
  `14`); the sandbox self-test gates mutating tools.
- **Detection.** Path-escape test suite in CI; sandbox self-test on every runner
  start; audit of denied attempts; Windows test matrix per ADR-028.
- **Trigger to raise.** Any escape found in testing; any user report of an
  out-of-workspace write.
- **Residual.** RR-2: Windows desktop confinement is **not VM-grade**; a
  determined kernel-level attacker defeats it. Containers (L3) on capable
  machines and cloud execution for the riskiest work are the intended answers,
  and neither is available in the MVP.

### 2.3 R-03 — Cross-tenant data leak

| Field | Value |
|---|---|
| Category | Security / tenancy |
| L | 3 |
| I | 5 → **critical** |
| Status | mitigating |
| Owner | Backend / data |

- **Description.** A missing tenant filter on one query exposes another
  organization's tasks, artifacts, credentials or audit records. One bug is
  enough; the exposure is total and often silent.
- **Mitigation.** Mandatory `organization_id` on every tenant table, a
  tenant-scoped data-access layer that cannot be bypassed by accident, RLS as
  an independent backstop, and a **dedicated cross-tenant test suite as a
  blocking CI gate** (NFR-SEC-01, ADR-008).
- **Detection.** The isolation suite (Phases 2 and 9); load-test criterion C7
  (`13` §6.2); audit review for impossible access patterns.
- **Trigger to raise.** Any isolation-suite failure; any multi-tenant load test
  finding; any support-visible cross-org anomaly.
- **Residual.** RLS plus code-layer scoping removes most paths but does not
  remove the possibility of a privileged-operator mistake (RR-7).

### 2.4 R-04 — Version churn in a young, heterogeneous stack

| Field | Value |
|---|---|
| Category | Technical / delivery |
| L | 4 |
| I | 3 → **high** |
| Status | mitigating |
| Owner | Platform |

- **Description.** `[FACT]` OpenCode V2 is young; TypeScript 7.x, Prisma 7.10 and
  Next 16 are recent (`05` §1). A breaking change or an incompatibility between
  pinned versions stalls development mid-phase.
- **Mitigation.** Pin **exact** versions (`05` §3), never `latest` (`[FACT]` the
  `prisma@latest` = 8.0.0-rc.22 trap); an adapter interface at every third-party
  boundary (CodingEngine, model provider, queue, storage); contract tests that
  fail loudly on drift; a documented upgrade cadence with validation in Phase 1.
- **Detection.** CI failures on lockfile updates; adapter contract tests;
  `pnpm outdated` review.
- **Trigger to raise.** A forced major upgrade; two or more adapters needing
  changes for one dependency; an upstream project abandoned or re-scoped.
- **Residual.** Adapters reduce the cost of a swap but do not remove the work;
  choices such as the embedded OpenCode dependency (ADR-011) remain a real
  coupling.

### 2.5 R-05 — The development machine cannot run the full stack

| Field | Value |
|---|---|
| Category | Delivery / environment |
| L | 4 |
| I | 3 → **high** |
| Status | mitigating |
| Owner | Platform |

- **Description.** `[FACT]` The reference machine has **23.3 GiB RAM** (about
  **4.9 GiB free** while other work runs), a **GTX 1650 with 4,096 MiB VRAM**,
  and only **11.9 GB free on `C:`** (`01`, `05` §1.3). Running Postgres, Redis,
  MinIO, Ollama, Next and Nest with tests concurrently will thrash; model weights
  and Docker images do not fit on `C:`.
- **Mitigation.** Relocate pnpm store, Docker data-root and `OLLAMA_MODELS` to
  `F:`; lean dev profile with Testcontainers-per-suite rather than always-on
  services; prefer the 3B local model for iteration and unload it when idle;
  cap Turbo concurrency; optional shared/cloud dev database for integration
  tests (`05` §5).
- **Detection.** Slower-than-expected local test runs; OOM kills; disk-full
  errors; VRAM exhaustion.
- **Trigger to raise.** A developer blocked for more than a day by resources;
  a local model that cannot load at all.
- **Residual.** This is a **known, permanent constraint of the current machine**;
  it is a workaround, not a fix, until hardware changes.

### 2.6 R-06 — Long-running tasks leak resources

| Field | Value |
|---|---|
| Category | Reliability / operations |
| L | 4 |
| I | 3 → **high** |
| Status | mitigating |
| Owner | Workers / runtime |

- **Description.** Orphaned browser contexts, runaway loops, stuck leases and
  leaked file handles accumulate until the worker or the user's machine
  degrades. Introduced as soon as real work runs (Phase 3) and materially worse
  with browsers (Phase 7).
- **Mitigation.** Hard budgets (steps, wall-clock, tokens, cost, retries) per
  `08` §7; three independent loop detectors; leased work with heartbeats plus a
  reaper for expired leases (NFR-REL-05); browser contexts bound to task
  lifetime; per-task isolation.
- **Detection.** Queue-age and lease-expiry metrics; orphan reaping counts;
  process/handle counts per worker; the soak test (`13` §6.1).
- **Trigger to raise.** Reaper count rising over time; a worker restarting
  because of resource exhaustion; users reporting a slow machine after tasks.
- **Residual.** Budgets and reapers bound leaks but do not eliminate them;
  continued monitoring is required.

### 2.7 R-07 — Approval fatigue

| Field | Value |
|---|---|
| Category | Product / security-by-usability |
| L | 4 |
| I | 3 → **high** |
| Status | mitigating |
| Owner | Product + policy |

- **Description.** If approvals are frequent and noisy, users approve
  reflexively and the control becomes theatre. This is a **usability failure
  that silently becomes a security failure**.
- **Mitigation.** No approval for read-only R0; risk-tiered defaults so only R2+
  asks; scoped grants (for N minutes / this task / this tool+workspace) with
  expiry; plain-language, machine-checkable previews; an approval inbox with
  context and one-click decisions; budget `maxApprovalsPerTask` so a task cannot
  generate an unbounded queue of prompts (`10` §9, FR-APPR-05/08, FR-TASK-07).
- **Detection.** Approval grant rate (near-100% grant with sub-second latency is
  the warning sign); per-task approval counts; denial/expiry rates; user
  feedback.
- **Trigger to raise.** Median decision latency dropping below a
  `[ASSUMPTION]` reflexive-approval threshold; grant rate above
  `[ASSUMPTION]` 99% on R2 actions.
- **Residual.** Approval fatigue is a human-factors problem; the design reduces
  it but cannot prove its absence. This is also RR-1/`Q-P2` (`10` §12) territory
  and needs real usage data.

### 2.8 R-08 — Premature scale spend

| Field | Value |
|---|---|
| Category | Business / cost |
| L | 3 |
| I | 3 → **high** |
| Status | mitigating |
| Owner | Owner / finance |

- **Description.** The 100,000-user target pulls the project into Kubernetes,
  cloud GPU inference, multi-region and enterprise features long before revenue
  or usage justifies them. Cost compounds monthly and consumes the engineering
  budget that would have delivered the product.
- **Mitigation.** Local-first execution keeps inference off our bill (D-14/D-15);
  staged scenarios S1/S2/S3 with **measured** triggers (`13` §7); Kubernetes
  only at ST-9; every scale decision recorded as an ADR with the trigger that
  fired; cost-per-active-user as a tracked metric with an alert (NFR-COST-01).
- **Detection.** Monthly cost trend vs. active users; count of resources without
  a cost tag; unprompted infrastructure growth.
- **Trigger to raise.** Cloud spend growing faster than active users for two
  consecutive months; a Kubernetes decision made without ST-9 having fired.
- **Residual.** The plan deliberately accepts that the business may need to grow
  faster than the staged model if demand surprises; the trigger requirement makes
  that a decision, not an accident.

---

## 3. Medium and lower risks

| ID | Risk | L | I | Score | Band | Status | Owner | Mitigation | Detection | Trigger |
|---|---|---|---|---|---|---|---|---|---|---|
| R-09 | **Redis data loss loses queued work** | 2 | 4 | 8 | medium | mitigating | Backend | Postgres is the system of record; outbox + reconciliation; durable `device_commands`; explicit `maxmemory-policy` so queue keys are never evicted | Outbox backlog metric, queue reconciliation report | evicted_keys > 0, or any lost accepted task |
| R-10 | **CI flakiness erodes trust in the gate** | 3 | 3 | 9 | medium | mitigating | Platform | Flake policy in `14`; deterministic clock/seed; quarantine with an owner; Windows CI job so OS-specific flakes surface early | Flake-rate dashboard, retry counts | Retry-to-green rate above `[ASSUMPTION]` 5% |
| R-11 | **Windows path/symlink/case semantics cause subtle bugs** | 4 | 2 | 8 | medium | mitigating | Platform + runtime | `.gitattributes` normalisation; Windows CI; the path-escape corpus; canonicalisation as a tested control | Windows-specific test failures | A bug found in production that Windows CI would have caught |
| R-12 | **Device fleet fragmentation (runner version skew)** | 3 | 2 | 6 | medium | mitigating | Runner | Auto-update with signature verification and rollback (FR-DEV-09); capability and version reporting; minimum-version enforcement | Version-skew metric (`16`) | Skew spanning two minor versions, or a support cost |
| R-13 | **Remote model provider outage or rate limiting** | 4 | 2 | 8 | medium | mitigating | Model layer | Provider abstraction; circuit breakers; clean failure with resumable state (FR-MODEL-07); local-first default means most tasks are unaffected | Provider error-rate metric | Sustained provider error rate above threshold |
| R-14 | **Cost of observability exceeds its value** | 3 | 2 | 6 | medium | mitigating | Platform | Sampling and redaction at source; cardinality discipline; dashboards-as-code with owners; log retention limits | Observability line-item vs. budget | Observability above `[ASSUMPTION]` 25% of cloud spend |
| R-15 | **Prompt-injection defence regresses over time** | 3 | 4 | 12 | high | mitigating | Security | Injection corpus as a blocking CI test; taint propagation tested; new tool families must add corpus cases in the same PR (`14`) | CI injection tests; decision-record review | Any injection case producing `allow` |
| R-16 | **Artifact storage grows unbounded** | 3 | 3 | 9 | medium | mitigating | Backend | Per-org quotas; artifact TTL; lifecycle tiering; capped agent logs; `13` cost model | Storage growth vs. active users | Growth outpacing the `13` §3.5 model materially |
| R-17 | **Single-person knowledge concentration (bus factor)** | 4 | 4 | 16 | **critical** | mitigating | Owner | These planning documents; ADRs for every significant decision; runbooks; infrastructure as code; no undocumented manual steps | — | Any decision that exists only in someone's head |
| R-18 | **Legal/licensing surprise (dependency licence, AGPL-style obligation)** | 2 | 4 | 8 | medium | mitigating | Owner | Licence scanning in CI; SBOM per release; dependency-approval step in review | Licence scan findings | An incompatible licence entering the dependency graph |
| R-19 | **Accessibility debt blocks an enterprise customer** | 3 | 2 | 6 | medium | mitigating | Frontend | WCAG 2.2 AA target from `12`; automated axe checks plus manual checklist in `14`; accessibility in the Phase 9 gate | Accessibility test failures | A procurement questionnaire requiring WCAG evidence |
| R-20 | **Support access (impersonation) misused** | 2 | 4 | 8 | medium | open | Owner | Time-boxing, full audit, no secret visibility, user-visible notice (FR-ADMIN-02); four-eyes `[OPEN]` (`11` RR-7) | Audit review, access review cadence | Any support action without a matching ticket |
| R-21 | **Compliance requirement appears late (SOC 2, residency, DPA)** | 3 | 3 | 9 | medium | monitoring | Owner | GDPR-shaped data handling from Phase 2; export/delete/restrict; retention configurability; `records of processing`; residency kept as an `[OPEN]` decision (`NFR-PRIV-04`) | Sales/procurement conversations | A contract that requires certification or residency |
| R-22 | **Recovery targets are aspirational, not proven** | 3 | 4 | 12 | high | mitigating | Platform | Restore drills with a recorded log (`15` §10, `16`); RPO/RTO explicitly labelled unproven until a drill succeeds; Phase 8 and Phase 11 drills | Drills log; measured RTO | Any drill missing the documented target |
| R-23 | **The local-first assumption is wrong** (users push work to the cloud) | 2 | 5 | 10 | high | monitoring | Owner | Provider abstraction and clean `execution_location` switch; consent UX; the sizing model in `13` §10 explicitly names this as the plan's largest unvalidated assumption | Share of tasks with `execution_location = cloud`; provider configuration telemetry (aggregate, privacy-respecting) | Cloud-execution share far above `[ASSUMPTION]` 20% |
| R-24 | **Approval system outage blocks all work** | 2 | 4 | 8 | medium | mitigating | Backend | Approvals are durable in Postgres, not memory; offline approval path (`10` §5.4) with policy-change re-validation; runbook for approval-system outage | Approval-latency and pending-count metrics | Pending approvals growing with no decisions |
| R-25 | **Tenant-level noisy neighbour degrades others** | 3 | 3 | 9 | medium | mitigating | Backend | Per-org rate limits and quotas at admission; per-org queue fairness; load-test criterion C9 | Fairness metric in load tests (`13` §6.2) | One tenant's load moving another's p95 |
| R-26 | **Auto-update of the runner breaks the fleet** | 2 | 4 | 8 | medium | mitigating | Runner | Signature verification, staged rollout, rollback to the previous version (FR-DEV-09); minimum-version policy; a hold-back channel | Version distribution and error-rate metrics post-update | Error-rate spike after a runner release |
| R-27 | **Secret leakage into logs or prompts** | 3 | 5 | 15 | high | mitigating | Security | Redaction deny-list as a control with a failing test; secrets never placed in prompts without explicit per-use consent (NFR-SEC-02); secret scanning in CI; redaction failure fails closed | Secret-scan hits; log-content audit; redaction unit tests | Any real secret found in a log, a trace or a prompt |
| R-28 | **Scope creep from the 100k-user framing** | 4 | 3 | 12 | high | mitigating | Owner | MVP/M0 scope explicitly bounded (`17` §5); service splits and cloud features gated by measured triggers; "for later" code discouraged by `AGENTS.md` | Phase exit criteria; scope changes without an ADR | A feature added with no requirement ID and no gate |
| R-29 | **Cost model wrong in either direction** | 3 | 3 | 9 | medium | monitoring | Owner | Every figure marked `[ASSUMPTION]`; measured thresholds and alerts; S2 run-rate review before committing capacity | Cost-per-active-user metric | Actual cost outside the `13` §2 band for two months |
| R-30 | **Third-party dependency is abandoned or re-licensed** | 3 | 3 | 9 | medium | mitigating | Platform | Minimal dependency count; adapter boundary at each third-party edge; provenance and SBOM; exit plan for the coding engine specifically (OpenCode vs. the mock/alternative) | Upstream activity review, advisory feeds | Upstream announcement or six months without releases |

---

## 4. Risk-to-phase mapping

Which phase creates, mitigates or must prove each top risk
(cross-reference `17` §9):

| Risk | Created by | Mitigated in | Proven in |
|---|---|---|---|
| R-01 | Phase 5 (tools exist) | Phases 5–6 | Phase 9 (gate) / 11 |
| R-02 | Phase 4 | Phase 4 | Phase 9 / 11 |
| R-03 | Phase 2 | Phase 2, Phase 9 (RLS) | Phase 11 (C7) |
| R-04 | Phase 1 | Phases 1–9 | Phase 9 |
| R-05 | Phase 1 | Phase 1 (relocation/lean profile) | never fully (hardware) |
| R-06 | Phase 3 | Phases 5, 7 | Phase 11 (soak) |
| R-07 | Phase 5 | Phase 5 (anti-fatigue at first UI) | after launch (usage data) |
| R-08 | Phase 0 | Phases 0, 10 (trigger gate) | Phase 11 (cost criterion) |
| R-15 | Phase 6/7 | continuous | every CI run |
| R-17 | Phase 0 | Throughout (`docs/`, ADRs, runbooks) | Phase 9 review |
| R-22 | Phase 2 | Phase 8 drill | Phase 11 |
| R-23 | Phase 0 (assumption) | Phases 4–5 | after launch (usage data) |
| R-27 | Phase 1 | Phases 1–5 | every CI run |

---

## 5. Risks that cannot be eliminated, only accepted

These are recorded so they are **never presented as solved**. Formal acceptance
is signed off in `19-production-readiness-checklist.md` §4.

| # | Residual risk | Why it is irreducible | Accepted posture |
|---|---|---|---|
| RR-1 | An authorised user approves a destructive action | Consent is the design | Snapshots, prominent previews, undo affordances |
| RR-2 | Windows confinement is not VM-grade | Platform reality | L3 containers later; cloud execution for the riskiest work |
| RR-3 | A local model can be socially engineered into proposing bad actions | Model behaviour is not a control | Policy engine + approvals grant no authority to the model |
| RR-4 | A compromised device with a valid credential can report false results | No remote attestation | Verification engine, anomaly detection, per-device revocation |
| RR-5 | A compromised cloud could command devices | Trust is asymmetric, not absent | Device-side re-evaluation, signed commands, visible action log, kill switch |
| RR-6 | Supply-chain compromise of a dependency | Inherent to software | Pins, provenance, SBOM, scanners, fast patching, fewer dependencies |
| RR-7 | Operator misuse of support access | Human access exists | Time-boxing, audit, no secret access, `[OPEN]` four-eyes |
| RR-8 | Zero-day in Chromium/Ollama/Electron | Inherent | Fast patch cadence, layering, least privilege, no auto-open of downloads |
| R-17 | One person holds most of the knowledge | Team size | Documentation, ADRs, runbooks — a mitigation, not a cure |
| R-23 | The local-first assumption may be wrong | Unvalidated until usage exists | Explicitly named; the architecture supports both modes |

---

## 6. Register governance

- **Owner:** whoever is responsible for the layer the risk lives in; the
  register owner is the project owner.
- **Review cadence:** at every phase boundary (`17`), and after every incident or
  near-miss.
- **Change rule:** scores, statuses and mitigations are updated in this document;
  a risk is retired only with a recorded reason.
- **Incident rule:** any real incident produces (a) an entry or a re-score here,
  (b) a postmortem (`16`), and (c) a test or control that would have caught it
  (`14`).
- **Rule of honesty:** a risk is never removed because it is embarrassing. This
  file is expected to grow.

---

## 7. Open questions affecting the register

| # | Question | Affects |
|---|---|---|
| Q-RK-1 | Real likelihood/impact calibration from S2 usage | All scores |
| Q-RK-2 | Whether a formal penetration test is commissioned and its scope | R-01, R-02, R-03, R-15 |
| Q-RK-3 | Whether the product will be used by enterprises with contractual security requirements | R-19, R-20, R-21 |
| Q-RK-4 | Actual cloud-execution adoption (falsifies R-23) | R-08, R-23, R-29 |
| Q-RK-5 | Team growth plan (changes R-17's score) | R-17 |
| Q-RK-6 | Insurance/contractual risk-transfer options `[OPEN]` | R-01, R-03, R-21 |
| Q-RK-7 | Whether a custom local model or a managed inference fallback is ever worth the complexity | R-04, R-13, R-23 |

Labels: `[FACT]` `[ASSUMPTION]` `[PROPOSED]` `[OPEN]`
