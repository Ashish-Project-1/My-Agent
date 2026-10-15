# 00 — Executive Summary

| | |
|---|---|
| Status | Planning only. **No application code exists.** |
| Last updated | 2026-10-15 |
| Owner | Architecture |
| Scope | Whole platform: product, architecture, data, security, delivery |
| Read this first, then | `01-repository-audit.md`, `03-system-architecture.md`, `17-implementation-roadmap.md` |

## Label legend (used in every planning document)

| Label | Meaning |
|---|---|
| `[FACT]` | Verified on 2026-10-15 from this repository, this machine, or a named official source. |
| `[ASSUMPTION]` | A number or behaviour we chose to plan with. Not measured. Must be replaced by evidence. |
| `[PROPOSED]` | A recommended design decision. Not implemented. |
| `[OPEN]` | A decision that needs a human, or evidence we do not have yet. |

No document in `docs/planning/` describes implemented, deployed, or load-tested
functionality. Where a document says "will", it means "is planned to".

## 1. What we are building

**Universal Agent** is a local-first agent platform. A user submits a goal
("upgrade this repo's dependencies", "summarise these 40 PDFs", "fill this web
form"), the platform plans it, executes it with tools across domains
(code, files, browser, data, APIs, local models), asks for approval before
anything risky, verifies the result, and keeps a complete, replayable record of
what happened.

Two deployment shapes, one product:

- **Local-first** — the user's Windows machine runs the agent loop, the tools
  and the models. Nothing leaves the machine unless the user configures a
  remote provider. The cloud is optional.
- **Cloud control plane (optional)** — identity, tenancy, task records, policy,
  approval routing, audit, usage metering, and optional server-side execution
  for users without a capable local machine or for team/enterprise use.

The 100,000+ registered-user target applies to the **cloud control plane**. It
does **not** mean 100,000 concurrent agent tasks, because the default execution
location is the user's own device. This single fact is what makes the target
tractable and is developed in
[`13-scalability-and-capacity-planning.md`](13-scalability-and-capacity-planning.md).

## 2. Current repository state (verified, 2026-10-15)

`[FACT]` The repository contains **four files and no application code**:
`AGENTS.md` (agent working rules), `INTEGRATIONS.md` (a catalogue of which
external tools integrate with OpenCode and how), `opencode.jsonc` (OpenCode V2
configuration: MCP servers, permissions, agents, commands), `.env.example`
(environment variable names). It is **not a git repository** — `git rev-parse`
fails. There is no `package.json`, no source tree, no tests, no CI, no
infrastructure. Full detail in
[`01-repository-audit.md`](01-repository-audit.md).

Consequence: this planning phase is greenfield. There is no existing
functionality to preserve beyond the four files, which must not be modified.
There is also no existing architecture to be consistent with, so every decision
below is a proposal, not a description.

## 3. Two corrections to the brief (verified, not assumed)

`[FACT]` The brief's development-machine assumptions are partly wrong. Measured
on this machine with `nvidia-smi` and `Win32_*` CIM queries:

| Brief said | Actually measured | Consequence |
|---|---|---|
| 16 GB RAM | **24 GiB RAM** (23.3 GiB usable), ~5 GiB free at inspection | Better than assumed; still not enough to host PostgreSQL + Redis + Docker + a browser + a 7B model + an IDE comfortably at once. Dev environment must stay lean. |
| 8 GB VRAM | **4 GiB VRAM** (GTX 1650, 4096 MiB, driver 617.14) | Worse than assumed. This changes model selection: 7B-class models only run with partial CPU offload. See [`09-local-runtime-design.md`](09-local-runtime-design.md). |
| Windows | Windows 11 Pro, build 26300, AMD Ryzen 5 5600H (6C/12T) | Confirmed. |
| — | **C: has 11.9 GB free; F: has 133.9 GB free** | `[FACT]` Real constraint. Package stores, Docker images and model weights must be redirected to F:. |

Toolchain present: Node **v24.18.0**, npm 11.16.0, git 2.56.0, Docker 29.6.1
(WSL2 backend), Python 3.14.6, VS Code 1.130.0.
Toolchain **absent**: pnpm, Ollama, psql, uv, Rust (`rustc`).

## 4. Recommended architecture in one page

`[PROPOSED]` A pnpm + Turborepo monorepo with **one modular backend**, not nine
microservices. Three runtime shapes, three trust zones:

1. **Cloud control plane** — a single NestJS 12 API deployable containing
   identity, tenancy, tasks, approvals, devices, integrations, usage,
   notifications and audit as *modules*, plus the SSE/WebSocket gateway.
   One PostgreSQL 18 database, one Redis 8, one object store. Split a module
   into its own service only when a measured trigger is hit (documented per
   module).
2. **Workers** — separate processes (BullMQ on Redis) for code, browser and
   document execution and for maintenance. These are separate because they have
   different resource profiles, different container images and different blast
   radii — not because "microservices".
3. **Local runner** — a Node 24 Windows application (service + tray + optional
   Electron shell) that hosts the agent loop, the sandbox, the browser runtime
   and the model runtime on the user's machine. It connects **outbound only**
   to the control plane over WebSocket and long-polls when offline. OpenCode V2
   is embedded in-process via `@opencode/sdk` as the coding engine behind a
   swappable `CodingEngine` interface.

The critical architectural commitment: **every side effect passes through the
policy engine and, when required, a deterministic approval bound to the exact
action, arguments, user, device, task, policy version and expiry.** No model
output can grant itself permission. This is the spine of
[`10-tool-permissions-and-approvals.md`](10-tool-permissions-and-approvals.md).

## 5. Key decisions (summary)

| # | Decision | Rationale in one line | Status |
|---|---|---|---|
| D-01 | Modular monolith backend first; 4 workers separate from day one | Nine services for a pre-revenue product is unearned complexity | Final (revisit per trigger) |
| D-02 | pnpm 12 + Turborepo 2.11 | Fast, content-addressed, cacheable; standard for Next+Nest monorepos | Final |
| D-03 | Node 24 LTS now (v24.18.0 already installed), plan Node 26 LTS after 2026-10-28 | Node 26 becomes LTS 13 days from now; migrating mid-plan adds risk for no immediate benefit | Provisional |
| D-04 | TypeScript 7.x, Zod 4.6 as the single contract source | One schema definition → API types, OpenAPI, client, DB-adjacent validation | Provisional |
| D-05 | Next.js 16 + React 19 + Tailwind 4 for web and admin | Matches requested stack; App Router supports streaming UI needed for task progress | Final |
| D-06 | NestJS 12 for the API | Requested; strong module system for a modular monolith | Final |
| D-07 | PostgreSQL 18 + Prisma 7.10 (**not** the Prisma 8 RC) | Prisma 8 is a release candidate as of today; clients on RCs is avoidable risk | Provisional |
| D-08 | Redis 8 + BullMQ 6 as the only queue framework | One queue technology; BullMQ gives delayed jobs, retries, flows, rate limits | Final |
| D-09 | Embed OpenCode via `@opencode/sdk`; map its permissions/policies onto our policy engine | Avoids writing our own coding agent; the SDK hosts OpenCode with no HTTP listener | Final |
| D-10 | Ollama locally (v0.40.x), local-first default, remote providers opt-in per organization | Privacy default; 4 GiB VRAM means small quantised models only | Final |
| D-11 | Electron for the Windows desktop shell (**not** Tauri) | The runner is Node; Electron hosts it in-process. `rustc` is not installed and Tauri would need a Rust toolchain plus a Node sidecar | Provisional |
| D-12 | One cloud provider (AWS) + Terraform 1.16; Kubernetes only from Phase 10, Docker Compose before that | Don't buy Kubernetes before paying customers | Provisional |
| D-13 | OpenTelemetry 0.223 → Grafana LGTM stack (managed first) | One instrumentation for metrics, logs, traces; manageable at our scale | Provisional |
| D-14 | No local Kubernetes, no self-hosted model serving for the cloud MVP | 4 GiB VRAM and 11.9 GB free on C: cannot host anything real | Final |
| D-15 | Cloud executes only when the user has no device or explicitly requests it | Keeps GPU cost near zero and privacy intact | Final |

Full reasoning, alternatives and consequences:
[`04-architecture-decision-records.md`](04-architecture-decision-records.md) and
[`05-technology-stack.md`](05-technology-stack.md).

## 6. Version baseline (verified from npm and endoflife.date, 2026-10-15)

`[FACT]` Recommended pins at planning time: Node 24.18.0 · pnpm 12.11.x ·
TypeScript 7.0.x · Next 16.4.x · React 19.3.x · Tailwind 4.3.x · NestJS 12.1.x ·
Zod 4.6.x · Prisma 7.10.x + @prisma/client 7.10.0 · PostgreSQL 18.6 ·
Redis 8.10 (or Valkey 9.1) · BullMQ 6.3.x · Playwright 1.64.x · Electron 44.7.x ·
Ollama 0.40.x · OpenCode 2.0.29 (`@opencode/sdk` / `@opencode/client`) ·
Kubernetes 1.36.x · Terraform 1.16.x · Docker 29.6.x ·
`@opentelemetry/sdk-node` 0.223.x. Rationale and pinning policy:
[`05-technology-stack.md`](05-technology-stack.md).

## 7. What it costs to operate (order of magnitude)

`[ASSUMPTION]` Cloud infrastructure for scenario **S2 — Initial production**
(2,000 registered users, 300 DAU) is projected in the range **USD 150–400 /
month**, dominated by managed PostgreSQL and Redis, with **no GPU cost** because
execution is local-first. For scenario **S3** (100,000 registered, ~12,000 DAU),
the projection is **USD 1,500–6,000 / month**, and the dominant variable becomes
whether users push inference to the cloud. Every figure is an unverified
assumption with the formula behind it in
[`13-scalability-and-capacity-planning.md`](13-scalability-and-capacity-planning.md).
No benchmark has been run.

## 8. Top risks (full list: [`18-risk-register.md`](18-risk-register.md))

| ID | Risk | Severity | Mitigation headline |
|---|---|---|---|
| R-01 | A model (or a prompt-injected document) tricks the agent into a destructive action on the user's machine | Critical | Deterministic policy + argument-bound approvals; the model can request but never authorise |
| R-02 | Local sandbox escape on Windows (shell, symlink, path traversal) | Critical | Job-object/AppContainer containment, path canonicalisation, no shell string interpolation, allow-list |
| R-03 | Cross-tenant data leak through a missing tenant filter | Critical | Tenant-scoped Prisma extension + RLS + mandatory `org_id` in every table + dedicated cross-tenant test suite |
| R-04 | Concrete model/agent architecture is heterogeneous and version-churning (OpenCode V2 is young; TS 7 and Prisma 8 are fresh) | High | Pin exact versions, adapter interfaces at every boundary, contract tests |
| R-05 | Dev machine cannot run the full stack comfortably (4 GiB VRAM, 11.9 GB free on C:) | High | Lean dev profile, artifacts and model weights on F:, cloud dev database option |
| R-06 | Long-running tasks leak resources (orphaned browsers, runaway loops, stuck locks) | High | Hard budgets, watchdog reaper, lease + heartbeat, checkpoint/resume |
| R-07 | Approval fatigue: users click "approve" reflexively | High | Risk-tiered defaults, scoped/persistent grants with expiry, no approval for read-only, clear previews |
| R-08 | 100,000-user target drives premature scale spend | Medium | Local-first execution; staged scenarios with measured triggers |

## 9. The smallest end-to-end milestone (implementation starts here)

`[PROPOSED]` **Milestone M0 — "one task, one tool, one approval, end to end."**
A signed-in user creates a task in the web app; the local runner claims it,
executes exactly one read-only tool and one write tool, requests approval for
the write, streams progress to the browser, verifies the result, writes an
artifact and completes. No browser automation, no document parsing, no
integrations, no billing. It exists to prove the *spine*: identity → task →
queue → device → policy → approval → execution → verification → event log →
UI.

Everything in Phases 1–5 of [`17-implementation-roadmap.md`](17-implementation-roadmap.md)
is justified by being on the path to M0 or immediately protecting it.

## 10. Reading order for a developer starting work

1. [`01-repository-audit.md`](01-repository-audit.md) — what actually exists.
2. [`03-system-architecture.md`](03-system-architecture.md) — the shape and the diagrams.
3. [`17-implementation-roadmap.md`](17-implementation-roadmap.md) — what to build first.
4. [`04-architecture-decision-records.md`](04-architecture-decision-records.md) — why.
5. Then the domain document for your area (`06`–`12`).

## 11. Status of this planning phase

- 22 planning documents are produced under `docs/planning/`.
- None of them creates application code, dependency manifests, migrations,
  infrastructure, or folders for unimplemented code.
- No file outside `docs/planning/` was modified. `AGENTS.md`,
  `INTEGRATIONS.md`, `opencode.jsonc` and `.env.example` are untouched.
- Items needing a human decision are collected in
  [`20-open-questions-and-assumptions.md`](20-open-questions-and-assumptions.md).

Labels: `[FACT]` `[ASSUMPTION]` `[PROPOSED]` `[OPEN]`
