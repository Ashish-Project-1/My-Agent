# 20 — Open Questions and Assumptions

> Part of the Universal AI Agent planning set. This document is the **single
> consolidated index** of everything the plan assumes and everything it has not
> decided. It exists so that no assumption is silently promoted to a fact and no
> open question is quietly forgotten.

**Honesty statement.** `[FACT]` No code, no deployment, no user, no load test and
no benchmark exists. Consequently **every quantity and every behavioural claim in
this plan is either a fact about this repository/toolchain (verified, and
labelled `[FACT]`) or an assumption (labelled `[ASSUMPTION]`)**. There is no
third category. Where a document uses a number without a label, that is a defect
to be fixed, not a licence to trust it.

---

## 1. How to read this document

- **§2 Assumption register** — every load-bearing assumption, what would falsify
  it, and when it will be validated. If you only read one section, read this.
- **§3 Open-question index** — all `Q-*` items, grouped by domain, with the
  document that owns the detail.
- **§4 Unresolved conflicts and tensions** — places where the plan's own goals
  pull against each other and no clean resolution exists yet.
- **§5 Decisions already made** — the things that are *not* open, so they are not
  relitigated.
- **§6 Validation plan** — how and when the assumptions get replaced by
  measurements.

Status vocabulary: `assumed` (nothing validated it), `partially validated`
(some evidence exists), `validated` (measured — none of these yet),
`falsified` (proven wrong — then the plan changes).

---

## 2. Assumption register

### 2.1 Product and usage assumptions

| # | Assumption | Why we assumed it | Impact if wrong | Validation | Status |
|---|---|---|---|---|---|
| A-01 | Registered ≠ concurrent: MAU ≈ 20–30% of registered, DAU ≈ 50–60% of MAU | Normal SaaS conversion for developer-adjacent tools | Sizing of every component swings wildly; cost model breaks | Aggregate usage analytics after S2 launch | assumed |
| A-02 | Peak concurrent **cloud** execution ≈ 1–5% of DAU because execution is local-first | Local-first is the product's default (D-15) | If false, the cloud needs a compute layer far earlier and cost is dominated by inference/compute | Share of tasks with `execution_location = cloud` after S2 | assumed (**largest single unvalidated assumption in the plan**) |
| A-03 | A typical task executes ~15 steps and ~10 events per step | Nothing has been run | `task_steps`/`task_events` growth, partitioning timing, cost | Metrics on real tasks (Phase 8) | assumed |
| A-04 | A typical user produces ~5 artifacts/day averaging ~2 MB | Nothing has been run | Object-storage cost, the largest variable cost line | Artifact telemetry after S2 | assumed |
| A-05 | A reference Windows machine is representative of the median user machine (4 GiB VRAM class, modest free disk) | The dev box is that class of machine | Model-fit UX and default model choice could be wrong for the real median | Aggregate capability report from the device fleet (privacy-respecting) | assumed |
| A-06 | Users will accept an approval prompt for R2 actions rather than abandoning the product | Approvals are a safety feature, not friction | Adoption; and if rejected, either security weakens or the product is unusable | Approval grant/abandon rates after launch | assumed |
| A-07 | Local-only mode (no remote provider) is genuinely usable on a 4 GiB VRAM GPU for the target tasks | `09` selects small quantised models | The privacy-first pitch collapses; users are forced to remote providers | Task success/satisfaction in local-only mode after launch | assumed |
| A-08 | A 100,000-registration target is a growth ambition, not a launch requirement or a contractual obligation | The brief states it as a target | Sequencing of Phases 10/11 and the entire cost model | Confirm with the owner (Q-RM-10) | `[OPEN]` — unconfirmed |

### 2.2 Architecture and implementation assumptions

| # | Assumption | Why we assumed it | Impact if wrong | Validation | Status |
|---|---|---|---|---|---|
| A-09 | A modular monolith plus four workers is sufficient through S3 | Nine services for a pre-revenue product is unearned (D-01) | A forced split late is expensive; conversely monolith-first is cheap to reverse | Queue/latency metrics vs. the `03` §4 triggers | assumed |
| A-10 | The outbound-only WSS device channel is sufficient for interactive approvals at S3 (~18k connections) | It avoids inbound ports entirely (ADR-003) | Delivery latency for approvals; connection storms after deploys | Load test with a simulated fleet (`13` §6.1) | assumed |
| A-11 | Postgres can hold `task_steps`/`task_events`/`policy_decisions`/`audit_events` at S3 row counts with monthly partitioning | Estimates in `13` §3.3 sit in ordinary managed-Postgres territory | A need for a different store for events/audit | Load test + migration rehearsal against a production-sized snapshot | assumed |
| A-12 | `pgvector` inside the primary database is sufficient for retrieval at S3 | Avoids a second datastore until it is earned | A retrieval subsystem becomes its own phase (Q-T7) | Index-size and QPS measurements in Phase 6/7 | assumed |
| A-13 | BullMQ 6 on Redis 8 is sufficient for all queue needs and job payloads stay small | One queue framework by policy (D-08) | Redis memory pressure; payload-size fallout | Load test + Redis memory metrics | assumed |
| A-14 | The `CodingEngine` adapter can wrap OpenCode V2 without leaking its permission model | The SDK hosts OpenCode in-process (ADR-011) | Rework of the engine layer if OpenCode's model shifts | Adapter contract tests + effective-policy readback (`10` §11 item 14) | partially validated (interface assumed; runtime unverified) |
| A-15 | Prisma 7.10 is stable enough and compatible with the pinned TypeScript, Next and Nest versions | Prisma 8 is an RC today (D-07, `[FACT]`) | Forced ORM work mid-project | Compatibility checks in Phase 1 task 1.1 (Q-T1) | partially validated (`[FACT]` versions inspected; integration untested) |
| A-16 | TypeScript 7.x works with the chosen lint/ORM/framework plugins | `[FACT]` it is a recent major | Pin back to the latest 6.x; rework of type-level code | Phase 1 compatibility check | assumed |
| A-17 | Electron 44 is the right Windows shell (over Tauri) given no `rustc` and a Node runner | `[FACT]` rustc is not installed (D-11) | Bundle size and memory costs; a future migration | Real distribution feedback; bundle/memory measurements | assumed |
| A-18 | Playwright 1.64 works for both device-side and cloud-side browsing with per-task isolation | Single browser technology by policy (ADR-023) | A second browser stack, or a managed provider (Q-T6) | Isolation and reliability tests in Phase 7 | assumed |
| A-19 | A deterministic policy engine can cover every authorisation decision with no model involvement | NFR-SEC-05 and the whole safety argument depend on it | The core safety claim weakens | Full policy test matrix (`10` §11) | accepted as a design requirement, not an assumption to falsify |
| A-20 | RLS plus a tenant-scoped data layer makes cross-tenant leakage testably impossible | Tenant isolation is a hard requirement (ADR-008) | The product is unsafe for multi-tenancy | The blocking isolation suite + load criterion C7 | assumed (unimplemented) |

### 2.3 Operational, cost and business assumptions

| # | Assumption | Why we assumed it | Impact if wrong | Validation | Status |
|---|---|---|---|---|---|
| A-21 | S2 cloud cost is USD 150–400/month and S3 is USD 1,500–6,000/month, with **no GPU cost** | Cited in `00`, derived from the local-first design | The business model; premature scaling decisions | Actual run-rate after S2; cost-per-active-user metric | assumed |
| A-22 | Availability target 99.9% for the API and event stream is achievable and sufficient | Standard managed-SaaS expectation | Over- or under-investment in availability | SLO data after launch (`16`) | assumed |
| A-23 | RPO ≤ 15 min / RTO ≤ 4 h is achievable from Phase 10 (weaker before) | Managed Postgres PITR capability | Data-loss exposure between RPO and RTO promises | **Restore drills** (`15` §10, `16`); unproven until a drill succeeds | assumed (unproven) |
| A-24 | Retention defaults (90 d content, 400 d metadata/audit, 30 d events, 25 months usage) are acceptable to most users | Common SaaS norms | Storage cost; user expectations; deletion semantics | Retention-setting distribution after launch | assumed |
| A-25 | Approval fatigue will not silently defeat the approvals control | The anti-fatigue design (`10` §9) exists | The safety argument becomes hollow (R-07) | Grant-rate and decision-latency metrics after launch | assumed |
| A-26 | One person/team can carry the documentation and knowledge load (bus factor) | Current team size | Continuity risk (R-17) | — | `[OPEN]` |
| A-27 | The repository may be initialised as a git repository with owner consent | `[FACT]` it is not one today; nothing is revertible without it | The plan's Phase 0 is blocked | Owner consent (Q-RM-1) | `[OPEN]` — requires consent |

### 2.4 Environment facts (verified — not assumptions)

These are recorded so they are not confused with assumptions. All `[FACT]`,
verified in `01`/`05`:

| # | Fact | Consequence |
|---|---|---|
| A-28 | 23.3 GiB RAM installed; ~4.9 GiB free in practice | Dev stack must be lean (R-05) |
| A-29 | GTX 1650, **4,096 MiB VRAM** (not 8 GB as the original brief assumed) | Only small quantised local models (D-10, `09`) |
| A-30 | `C:` has 11.9 GB free; `F:` has 133.9 GB | pnpm store, Docker data-root, `OLLAMA_MODELS` move to `F:` |
| A-31 | Node v24.18.0, npm 11.16.0, git 2.56.0, Docker 29.6.1/WSL2, Python 3.14.6 present | Baseline toolchain exists |
| A-32 | pnpm, Ollama, psql, uv, rustc **absent** | Phase 1/4 installs required; Rust absence rules out Tauri |
| A-33 | The repository contains only `AGENTS.md`, `INTEGRATIONS.md`, `opencode.jsonc`, `.env.example`; **no git repo** | Phase 0 exists for exactly this reason |
| A-34 | Node 26 enters LTS on 2026-10-28 (13 days after the plan date) | Stay on Node 24 LTS; revisit ~4 weeks later (D-03) |

---

## 3. Open-question index

Consolidated from every document. Each question's detail lives in the owning
document; this index is the map.

### 3.1 Technology (owner: `05`)

| # | Question | Blocks |
|---|---|---|
| Q-T1 | TypeScript 7.x compatibility with the chosen lint/ORM/framework plugin set | Phase 1 |
| Q-T2 | Managed PostgreSQL/Valkey provider (Neon vs RDS vs Aurora vs ElastiCache) | Phase 2, cost model |
| Q-T3 | Formatter/linter choice (Biome vs ESLint+Prettier) | Phase 1 |
| Q-T4 | Cloud container runtime (ECS/Fargate-class vs managed K8s vs serverless) | Phase 5 deploy |
| Q-T5 | Load-testing tool (k6 vs Artillery vs Locust) | Phase 11 |
| Q-T6 | Managed browser provider vs. self-hosted Playwright pods | Phase 7 cost |
| Q-T7 | Whether `pgvector` in the primary database suffices for indexing at S3 | Phase 6/7 |

### 3.2 Policy and approvals (owner: `10`)

| # | Question | Blocks |
|---|---|---|
| Q-P1 | Whether R3 standing grants (e.g. `git push` in one repo for 7 days) are ever allowed | Usability vs. blast radius |
| Q-P2 | Default `maxApprovalsPerTask` and approval TTL values | UX and safety tuning |
| Q-P3 | Whether the second-approver requirement for R3 applies to solo/personal orgs | Cannot require two humans for a team of one |
| Q-P4 | Whether a device may hold a policy an admin cannot override (tightening only proposed) | Enterprise/MDM control |
| Q-P5 | How much shell parsing we own vs. delegate to OpenCode's shell scanner | Correctness of the highest-risk classifier |

### 3.3 Scalability and capacity (owner: `13`)

| # | Question | Blocks |
|---|---|---|
| Q-SC-1 | Real DAU:registered ratio | Sizing everything |
| Q-SC-2 | Real share of tasks needing cloud execution | The dominant cost variable |
| Q-SC-3 | Managed Postgres/Valkey provider and its IOPS/connection limits (see Q-T2) | Connection budget, cost |
| Q-SC-4 | `pgvector` sufficiency (see Q-T7) | Retrieval architecture |
| Q-SC-5 | Real average artifact size and TTL tolerance | Storage cost |
| Q-SC-6 | Per-org queue partitioning vs. weighted fair dequeue | Queue-layer architecture |
| Q-SC-7 | Load-testing tool and whether per-PR environments can host S2-scale runs | Phase 11 realism |
| Q-SC-8 | Whether a paid cloud-execution tier is worth its cost and complexity | ST-9/ST-10 decisions |
| Q-SC-9 | BullMQ retention defaults that bound Redis without losing DLQ evidence | Reliability vs. memory |
| Q-SC-10 | Whether S3 needs a read replica at all | Cost |

### 3.4 DevOps and infrastructure (owner: `15`)

| # | Question | Blocks |
|---|---|---|
| Q-DEV-1 | Cloud provider and container runtime (see Q-T4) | All Terraform |
| Q-DEV-2 | Managed Postgres/Valkey provider (see Q-T2) | Backups, PITR, limits |
| Q-DEV-3 | Per-PR environment feasibility and cost | Review velocity vs. spend |
| Q-DEV-4 | Kubernetes timing (trigger ST-9) | Phase 10 |
| Q-DEV-5 | Desktop signing/notarisation account and update channel | Shipping the runner |
| Q-DEV-6 | Repository licence | Legal/OSS posture |
| Q-DEV-7 | Whether a public `sandbox`/trial environment ships | Ops load at launch |
| Q-DEV-8 | Versioning scheme and API versioning policy | Client compatibility |
| Q-DEV-9 | Whether a Linux developer path is supported | Team onboarding |

### 3.5 Roadmap (owner: `17`)

| # | Question | Blocks |
|---|---|---|
| Q-RM-1 | Team size and availability (also consent for `git init`) | Duration, parallelisation, Phase 0 |
| Q-RM-2 | Cloud provider/container runtime (see Q-T4) | Phase 5, Phase 10 |
| Q-RM-3 | Managed Postgres/Redis provider (see Q-T2) | Phase 2 staging |
| Q-RM-4 | Desktop signing account (see Q-DEV-5) | Phase 4 |
| Q-RM-5 | Penetration-test scope/timing | Phase 9 gate |
| Q-RM-6 | Licences for dependencies and the repository | Phase 0/1 |
| Q-RM-7 | Whether `sandbox`/public trial ships (see Q-DEV-7) | Phase 8/9 |
| Q-RM-8 | `pgvector` sufficiency (see Q-T7) | Phase 6 |
| Q-RM-9 | Whether any customer requires data residency | Phase 9/10 |
| Q-RM-10 | Whether the 100k target is marketing or contractual | Sequencing of Phases 10/11 |

### 3.6 Risk register (owner: `18`)

| # | Question | Blocks |
|---|---|---|
| Q-RK-1 | Real likelihood/impact calibration from S2 usage | All risk scores |
| Q-RK-2 | Penetration-test scope (see Q-RM-5) | R-01/R-02/R-03/R-15 |
| Q-RK-3 | Whether enterprise customers with contractual security requirements exist | R-19/R-20/R-21 |
| Q-RK-4 | Actual cloud-execution adoption | R-08/R-23/R-29 |
| Q-RK-5 | Team growth plan | R-17 |
| Q-RK-6 | Insurance/contractual risk-transfer options | R-01/R-03/R-21 |
| Q-RK-7 | Whether a managed inference fallback is ever worth it | R-04/R-13/R-23 |

### 3.7 Frontend, testing, observability, production readiness

Owned by `12`, `14`, `16` and `19` respectively; their own `Q-UI-*`, `Q-TEST-*`,
`Q-OBS-*` and `Q-PR-*` tables are authoritative. Thematically they cover:
UI state handling and accessibility verification; test-environment realism and
flake budgets; telemetry consent and sampling; and which readiness items remain
blocked on the unresolved decisions above.

---

## 4. Unresolved conflicts and tensions

These are places where the plan's goals genuinely pull against each other. Each
has a **documented recommendation** and a **reason it is not resolved**.

### C-1 — Privacy (local-first) vs. capability (remote models)

- **Tension.** Local models on 4 GiB VRAM are weak (`00`, `09`); remote models
  are strong but send content off the device. Making local-first the default
  honours privacy but delivers a worse product for some users.
- **Recommendation.** Keep local-first as the default (D-15) with a first-class,
  explicit consent flow for remote providers (FR-MODEL-06), so the choice is the
  user's and is never silent.
- **Why unresolved.** Only real users can tell us which side of the trade-off
  matters more. Tracked as A-07 and Q-SC-2.

### C-2 — Safety (approvals) vs. adoption (friction)

- **Tension.** More approvals mean more safety and less usable product;
  fewer approvals mean an agent that can harm the user.
- **Recommendation.** No approval for R0; risk-tiered defaults so only R2+ asks;
  scoped, expiring grants to reduce repetition while keeping the blast radius
  bounded (`10` §9).
- **Why unresolved.** The right thresholds need real usage data (Q-P2, A-25).

### C-3 — Shipping speed vs. durability and tenancy correctness

- **Tension.** Tenant scoping, the outbox, idempotency and digest binding all
  slow the first visible feature; retrofitting them is far more expensive.
- **Recommendation.** Put them in the phase that first writes the data
  (Phase 2/3), and keep M0 as the *only* schedule-pressure release valve
  (`17` §5).
- **Why unresolved.** It is a judgement call made under unknown schedule
  pressure; the recommendation is recorded so the decision is explicit.

### C-4 — One monolith vs. scaling signals

- **Tension.** A modular monolith is cheap now (D-01) but a forced late split is
  expensive; splitting early is unearned complexity.
- **Recommendation.** Keep the monolith, enforce module boundaries with lint, and
  split only on a **measured** trigger (`03` §4, `13` §7), with a review point at
  the end of Phase 9.
- **Why unresolved.** The triggers themselves are `[ASSUMPTION]` numbers until
  load tests replace them.

### C-5 — 100,000 users vs. cost discipline

- **Tension.** The target invites over-provisioning; the cost model assumes
  restraint (R-08).
- **Recommendation.** Size for **active/concurrent** usage, not registrations;
  require a measured trigger for every scale step; track cost per active user.
- **Why unresolved.** Whether the target is an ambition or a commitment is
  unanswered (A-08, Q-RM-10).

### C-6 — One cloud provider vs. avoiding lock-in

- **Tension.** D-12 picks AWS for operational simplicity; managed services are
  convenient and coupling.
- **Recommendation.** Accept the provider choice, keep the *interfaces* portable
  (queue, storage, model provider, identity behind adapters), and treat data
  egress as a cost, not a migration project.
- **Why unresolved.** Whether cost or portability wins is a business decision not
  yet made.

### C-7 — Documentation depth vs. "nothing implemented yet"

- **Tension.** Twenty-two planning documents for a repository with four files is
  a large up-front investment with no running code.
- **Recommendation.** Accept it: the pure-code parts (policy, approvals,
  durability, tenancy) are precisely the ones that are cheapest to design and
  most expensive to retrofit. Freeze the plan at Phase 0 and let implementation
  drive revisions.
- **Why unresolved.** By design — the plan is explicitly expected to change.

---

## 5. Decisions already made (do not relitigate without an ADR)

`[FACT]` D-01…D-15 and ADR-001…ADR-028 are recorded in
`00-executive-summary.md` and `04-architecture-decision-records.md`. Summary of
the load-bearing ones:

| Decision | Choice | Status |
|---|---|---|
| D-01 / ADR-001 | Modular monolith + 4 workers; split only on a measured trigger | Final (revisit per trigger) |
| D-02 | pnpm + Turborepo monorepo | Final |
| D-03 / ADR-014 | Node 24 LTS now; Node 26 LTS after 2026-10-28 | Provisional |
| D-04 | TypeScript 7 + Zod 4.6 as the single contract source | Provisional |
| D-05 / ADR-016/017 | Next 16 + React 19 + Tailwind 4 | Final |
| D-06 / ADR-018 | NestJS 12 API | Final |
| D-07 / ADR-020 | Prisma 7.10 stable (**not** the Prisma 8 RC) | Provisional |
| D-08 / ADR-012 | Redis 8 + BullMQ 6 as the only queue framework | Final |
| D-09 / ADR-011 | Embed OpenCode via `@opencode/sdk` behind a `CodingEngine` interface | Final |
| D-10 / ADR-022 | Ollama locally; local-first default; remote opt-in | Final |
| D-11 / ADR-010 | Electron desktop shell (not Tauri) | Provisional |
| D-12 / ADR-024/025 | One cloud provider + Terraform; Kubernetes only from Phase 10 | Provisional |
| D-13 / ADR-026 | OpenTelemetry → Grafana LGTM stack | Provisional |
| D-14 | No local Kubernetes, no self-hosted model serving for the cloud MVP | Final |
| D-15 / ADR-002 | Cloud executes only with no device or on explicit request | Final |

---

## 6. Validation plan (how assumptions become measurements)

| When | What gets replaced | Where the evidence lands |
|---|---|---|
| Phase 1 | A-15, A-16 (toolchain/ORM compatibility) | `05` §4 updated; ADR statuses |
| Phase 2 | A-20 (tenant isolation provable) | `14` isolation-suite result |
| Phase 5 | A-14 (adapter feasibility) | Adapter contract-test result |
| Phase 6/7 | A-12 (pgvector sufficiency), A-18 (browser reliability) | `05` Q-T7/Q-T6 closed; ADR updates |
| Phase 8 | A-03 (steps/task), A-24 (retention), A-23 (recovery targets, via drills) | `13` revised; `16` drill log |
| Phase 9 | A-22 (availability achievable), A-25 (approval fatigue) partially | `19` gate evidence |
| Phase 11 | A-01, A-02, A-04, A-21 (usage/cost/concurrency) | `13` §2/§3 numbers replaced; cost model updated |
| After launch | A-05, A-06, A-07, A-25 fully; A-02 finally | Product analytics; `18` re-scored |
| Never fully | A-28…A-30 (hardware constraints) | Accepted; workarounds documented in R-05 |

**Rule.** When an assumption is replaced by a measurement, the source document is
updated and this register's status changes — an assumption is never silently
deleted. `[FACT]` None of the validations above have been performed.

---

## 7. What would force a re-plan

Stated explicitly so a future reader knows when this document set is stale:

1. **A-02 falsified** (cloud-execution share far above 20%) → the entire capacity
   and cost model changes; Phase 10 moves earlier.
2. **A-10 falsified** (the device channel cannot meet approval latency at S3) →
   the communication architecture changes, which touches `03`, `07`, `10`, `16`.
3. **A-20 falsified** (any cross-tenant leak) → stop-the-line; the plan assumes
   tenant isolation is provable.
4. **A-08 confirmed as contractual** (100k is a commitment) → Phases 10/11
   sequencing and the budget change materially.
5. **A-16/A-15 falsified** (TypeScript 7 or Prisma 7.10 incompatible) → pin back
   and revise `05`, `15`; no architectural change expected thanks to adapters.

Labels: `[FACT]` `[ASSUMPTION]` `[PROPOSED]` `[OPEN]`
