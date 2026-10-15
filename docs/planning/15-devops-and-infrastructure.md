# 15 — DevOps and Infrastructure

> Part of the Universal AI Agent planning set. Read `00-executive-summary.md`,
> `03-system-architecture.md` §3/§5.12, `05-technology-stack.md` and
> `13-scalability-and-capacity-planning.md` before this document.

**Honesty statement.** `[FACT]` This repository contains no CI configuration, no
Dockerfile, no Terraform, no Kubernetes manifests, no git history and no
deployed environment. Everything below is a **proposal**, marked `[PROPOSED]`,
and nothing here has been executed or verified. Where a number appears it is an
`[ASSUMPTION]` to be confirmed by the Phase 11 load tests (`13` §6) or by the
first real deploy.

---

## 1. Principles

1. **One way to deploy.** `[PROPOSED]` A single repeatable pipeline produces the
   same artefact for staging and production; promotion is a promotion of a
   versioned artefact, never a rebuild.
2. **Local parity without local heaviness.** `[FACT]` The dev machine has
   11.9 GB free on `C:` and ~4.9 GiB free RAM (`01`, `05` §5), so local
   infrastructure is the *minimum* (Postgres + Redis + object-storage stand-in)
   and heavier needs are pushed to a shared dev environment.
3. **Configuration is data, secrets are references.** No secret in an image, a
   repository file, a log or a prompt (`AGENTS.md`, NFR-SEC-02).
4. **Infrastructure is reviewable and revertible.** Terraform and manifests live
   in git; destructive operations are gated (§8).
5. **Don't buy scale before the trigger fires** (D-12, `13` §7). Before Phase 10
   the cloud runs on the simplest managed primitives, not Kubernetes.
6. **A backup that has never been restored is not a backup** (`11` RR, `16`).

---

## 2. Environments

| Environment | Purpose | Data | Lifetime | Notes |
|---|---|---|---|---|
| `local` | Day-to-day development | Synthetic only | Persistent | Postgres + Redis + MinIO via Compose; Ollama optional |
| `pr-<n>` | Per-pull-request preview + integration tests | Synthetic, ephemeral | Destroyed on merge/close `[ASSUMPTION]` | Namespaced or provider-preview deployments |
| `staging` | Pre-production verification, migrations, load tests | Synthetic / anonymised | Persistent | Must mirror production topology `[ASSUMPTION]` |
| `production` | Customers | Real | — | Least access, change-controlled |
| `sandbox` | Demos, docs, public trial `[OPEN]` | Synthetic | Reset periodically | `[OPEN]` whether it ships in the MVP |

`[OPEN]` Whether per-PR environments can host S2-scale load tests is a cost
question (`13` Q-SC-7); the default assumption is **no** — load tests run in
staging on a schedule, not on every PR.

Environment isolation rules: separate cloud accounts or at minimum separate
projects/VPCs and separate credentials per environment; production credentials
are never issued to a developer workstation; no production data is copied down.

---

## 3. Source control and repository layout

- `[FACT]` The directory is **not** a git repository today. `[PROPOSED]` **Step 0
  of Phase 1 is `git init` plus a first commit** of the existing four files
  (`AGENTS.md`, `INTEGRATIONS.md`, `opencode.jsonc`, `.env.example`), preserving
  them exactly. **This requires explicit owner consent** because it writes git
  metadata into the user's directory.
- Trunk-based development `[PROPOSED]`: short-lived branches, small PRs, a
  protected `main`.
- The monorepo layout is fixed by `03` §5 (`frontend/*`, `backend/*`,
  `runtime/*`, `infrastructure/*`, `shared/*`, `tests/*`, `docs/*`, `scripts/*`,
  `.github/workflows/`). DevOps concerns stay inside `infrastructure/` and
  `.github/workflows/` so application code does not learn about cloud specifics.
- Required files at root `[PROPOSED]`: `.gitignore` (must exclude `.env`,
  `node_modules`, build output, model weights, local DB volumes), `LICENSE`
  `[OPEN]` (licence choice unresolved), `SECURITY.md` (vulnerability reporting),
  `CONTRIBUTING.md`, `CODEOWNERS`, `.editorconfig`, `.gitattributes`
  (line-ending normalisation — `[FACT]` Windows is a first-class target,
  NFR-MAINT-03).

---

## 4. Build and dependency management

- `[PROPOSED]` pnpm workspaces + Turborepo for build orchestration and remote
  caching (D-02). Turbo's task graph defines `build`, `typecheck`, `lint`,
  `test`, `test:integration`, `test:e2e` as first-class tasks with declared
  `dependsOn` and `outputs` so CI and local runs agree.
- **Deterministic installs:** `pnpm install --frozen-lockfile` in CI; the lockfile
  is committed; `publishConfig`/`engines` pins Node ≥ 24 (`05` §3).
- **Exact pinning** per `05` §3 (no `^`/`~` for the framework and
  infrastructure-critical set; see the Prisma 7.10 pin trap recorded there).
  `[PROPOSED]` Renovate/Dependabot with grouped, review-required updates rather
  than auto-merge on majors.
- **Windows build parity:** `[PROPOSED]` CI runs the unit/type/lint/build jobs on
  a Windows runner as well as Linux, so Windows-only breakage (paths, symlinks,
  line endings, case-insensitivity) is caught before the desktop release, not
  after.

---

## 5. Containerisation

`[PROPOSED]` Every deployable (`api`, four workers, and the web front ends if
container-hosted) gets a multi-stage Dockerfile.

| Aspect | Rule |
|---|---|
| Base image | Pinned digest; no `:latest` |
| Stages | `deps` → `build` → `runtime`, runtime contains no dev tooling |
| User | Non-root, read-only root filesystem where possible |
| Artefact | Image tagged with the git SHA + semver; immutable |
| Health | Container `HEALTHCHECK` matches the app's readiness endpoint (`16`) |
| Secrets | Injected at runtime; never baked in |
| Signals | Graceful shutdown on SIGTERM with a drain window bounded by the in-flight lease timeout (`16` shutdown runbook) |

`[FACT]` Long-running work must survive a deploy: the API and workers drain, and
tasks/commands are durable in Postgres and the queue (`06`: `outbox`,
`job_leases`, `device_commands`), so a rolling deploy must not lose accepted
work (NFR-REL-02/05).

`[OPEN]` The eventual container runtime (ECS/Fargate-class vs managed Kubernetes
vs serverless) is Q-T4 in `05`. Before Phase 10 the plan is
Compose-locally / managed-container-in-cloud; Kubernetes enters only on trigger
ST-9 (`13` §7).

---

## 6. Configuration management

- Hierarchical config `[PROPOSED]`: sane defaults in code → environment variables
  → secret manager references. Invalid or missing critical config **fails
  startup**, never defaults silently to something insecure.
- `[FACT]` A `.env.example` already exists and must not be modified. `[PROPOSED]`
  It is treated as the *documented contract* of required variables; the plan adds
  a startup validation step that checks every declared variable is present and
  well-formed, and a CI check that no new variable is consumed without being
  added to `.env.example` (a doc-drift gate).
- Secrets: one central secret store; workloads fetch at start and cache in
  memory; rotation is a supported operation (`16` runbook). `[FACT]` `.env.example`
  already mentions database and Redis URLs and several provider keys; the
  matching rule is that none of these are ever committed with real values.

---

## 7. CI/CD pipeline

`[PROPOSED]` GitHub Actions (already the assumed home: `.github/workflows` in
`03` §5.12). Stage table — what runs, and what it blocks:

| Stage | Runs | Blocks merge? | Gate |
|---|---|---|---|
| Lint + format check | Biome/ESLint per `05` Q-T3 | Yes | all |
| Typecheck | `tsc --noEmit` per package | Yes | all |
| Unit tests | Vitest | Yes | all |
| Contract tests | Zod schema + OpenAPI drift | Yes | all |
| Integration tests | Postgres + Redis containers | Yes | all |
| Migration check | `prisma migrate diff` / expand-contract lint, forward-only (NFR-MAINT-01) | Yes | all |
| E2E | Playwright (web) on merge queue | Yes (merge queue) | first-external |
| E2E desktop | Windows runner, Electron | Yes for desktop release | first-external |
| Security scans | secret scan, dependency audit, SAST, container scan, SBOM | Yes | all |
| Accessibility | axe on key flows (`12`) | Yes | paid |
| Build | artefacts + images | Yes | all |
| Deploy staging | automatic on `main` | — | all |
| Deploy production | manual approval, promotion of the staging artefact | — | paid |
| Load test | scheduled, staging | — | paid/enterprise |

Branch protection: required checks, required review (`CODEOWNERS` for
`infrastructure/`, `backend/contracts`, security-sensitive paths), no force
push to `main`, no direct commits.

Deployment strategy `[PROPOSED]`: rolling by default; canary for the API and
device gateway once traffic justifies it; **route migrations separately** from
code so a bad migration is not discovered by a binary rollback (§9). Every
deploy is reversible by redeploying the previous image tag.

`[FACT]` The project has no CI today; the first pipeline is a Phase 1
deliverable and is a prerequisite for M0 (`17`).

---

## 8. Destructive-operation gates

`[FACT]` `AGENTS.md` already requires asking before destructive or irreversible
actions. DevOps encodes that rule:

| Operation | Gate |
|---|---|
| `git push`, force push | Explicit human action; never automated from a plan |
| Production deploy | Manual approval + release checklist (`19`) |
| Database migration on production | Reviewed, expand/contract, with a tested rollback path; `[PROPOSED]` two-person review for destructive DDL |
| `terraform apply` on production | Reviewed plan output pasted into the PR; manual apply `[PROPOSED]` |
| `kubectl delete` / namespace teardown | Explicit confirmation; never in an automated cleanup job without a dry run |
| Data deletion / retention sweep | Dry-run mode first; verifiable deletion records (NFR-PRIV-02) |
| Secret rotation | Runbook-driven (`16`), with rollback |
| Restoring a backup over live data | Explicit incident-commander decision; see §10 |

`[PROPOSED]` All such operations appear in a single `scripts/` namespace so they
are discoverable, reviewed and not re-invented per engineer.

---

## 9. Database change management

- `[FACT]` Prisma 7.10 is the pinned ORM/migration tool (`05`, D-07). Migrations
  are forward-only, committed, reviewed and **safe to run while the previous
  version is live** (NFR-MAINT-01).
- `[PROPOSED]` Expand/contract discipline: add nullable column → backfill in
  batches → switch reads → switch writes → drop in a later release. A migration
  that requires downtime is an explicit, approved exception.
- CI runs migrations against a throw-away database copy and fails on: destructive
  DDL without an accompanying contract step, missing index for a new foreign
  key, non-concurrent index creation on a large table `[ASSUMPTION]` threshold,
  or a lock-risking operation.
- `[PROPOSED]` A migration "dry run against a production-sized snapshot" in
  staging before paid release (`13` §6.1 soak).
- Rollback reality: code rolls back instantly; a **schema** change usually does
  not. Hence the rule that every migration ships in a state that the *previous*
  code version can still tolerate (the core of expand/contract).

---

## 10. Backup, restore and disaster recovery (infrastructure side)

`[FACT]` `infrastructure/disaster-recovery` is already specified in `03` §5.12 as
the home for backup schedules, restore scripts, DR runbooks and a **restore
drills log**. Targets (NFR-REL-04, `[ASSUMPTION]`, unproven until a drill
succeeds):

| Phase | RPO | RTO | Mechanism `[PROPOSED]` |
|---|---|---|---|
| Before Phase 10 | ≤ 24 h | ≤ 24 h | Managed daily snapshots + documented manual restore |
| Phase 10+ | ≤ 15 min | ≤ 4 h | PITR/WAL archiving, multi-AZ, documented automated restore |

What must be backed up and restorable **together** (a partial restore is a
corruption source):

- PostgreSQL (schema + data), including the `audit_events` and
  `policy_decisions` history that is audit-critical.
- Object storage (artifacts) — with the understanding that artifacts are
  recoverable-but-important, not the system of record.
- Secret store / KMS keys — `[FACT]` without the key material, the encrypted
  secrets and envelope-encrypted columns are permanently unreadable; key backup
  and recovery is a first-class DR concern, not an afterthought.
- Infrastructure definitions (Terraform state + templates, in a locked remote
  backend).

`[PROPOSED]` Restore drills on a schedule (at least before each gate in `11` §9),
recorded in the drills log with the measured RTO. `[FACT]` None has been run;
they are all `[OPEN]`.

---

## 11. Observability infrastructure

`[FACT]` Decision D-13: OpenTelemetry → Grafana LGTM stack, managed first. This
section covers only the *infrastructure*; the telemetry content (metrics, logs,
traces, SLOs, alerts, runbooks) is specified in `16-observability-and-reliability.md`.

- One OTel collector deployment/gateway; applications export OTLP, never vendor
  SDKs directly, so a backend swap is a collector config change.
- Dashboards as code, alert rules as code, SLO definitions as code — all inside
  `infrastructure/observability` and reviewed like any other change.
- Log/trace sampling and redaction happen **at the source** so sensitive data
  never reaches the backend (NFR-SEC-02, `16` §3).
- Observability access is least-privilege; audit logs are separately retained and
  tamper-evident (`06` retention notes).

---

## 12. Security infrastructure

Cross-reference: `11-security-threat-model.md` for the threats; this is the
build/deploy side of the controls.

| Control | Where it lives |
|---|---|
| Secret scanning | CI + pre-commit hook |
| Dependency & licence scanning, SBOM generation | CI artefact per release |
| Container image scanning + signing | CI before publish |
| SAST | CI |
| WAF / edge rate limiting | Cloud edge config |
| Network policies / security groups (default-deny egress) | `infrastructure/security-policies` |
| IAM least privilege, per-workload identity | Terraform + workload identity, no long-lived keys |
| TLS termination, HSTS | Edge/load balancer config (NFR-SEC-04) |
| Device-key trust boundary | Application-level; the runner holds a private key that never leaves the machine (`11`) |
| Vulnerability response process | Documented; severity-based patch cadence (`11` RR-8) |

`[OPEN]` Penetration-test scope and timing is unresolved (`11` §9, `19`); the
plan assumes an external test before the paid public release.

---

## 13. Cost and FinOps

- Budgets and alerts from day one; `[PROPOSED]` a per-environment budget line and
  an alert when 80% of the monthly budget is consumed.
- Non-production teardown: ephemeral PR environments self-destruct; staging has a
  defined scale-down schedule `[ASSUMPTION]`.
- Cost tagging on every resource (env, component, owner) so cost-per-active-user
  (`13` §9, NFR-COST-01) is attributable.
- Reserved/committed capacity only after S2 run-rates are stable for
  `[ASSUMPTION]` two consecutive months.
- `[FACT]` Local-first execution keeps model inference off our bill (D-14/D-15);
  the plan must not introduce cloud inference cost without a recorded ADR.

---

## 14. Windows developer environment

`[FACT]` From `05` §5 and the environment audit in `01`:

| Constraint | Action `[PROPOSED]` |
|---|---|
| C: has 11.9 GB free | pnpm store, Docker data-root and `OLLAMA_MODELS` relocated to `F:` |
| ~4.9 GiB free RAM | Cap Turbo concurrency (~4), unload models when idle, prefer the 3B model |
| No `pnpm` installed | Install via Corepack (ships with Node 24) |
| No `rustc` | Confirms Electron over Tauri (D-11) |
| Windows path/symlink/line-ending semantics | `.gitattributes` normalisation; Windows CI job; path canonicalisation is a tested control (`11`) |
| WSL2 present | Docker Desktop backend; `[OPEN]` whether a Linux dev path is offered |

`[PROPOSED]` No installation is performed during this planning phase.

---

## 15. Release engineering

- Versioning `[PROPOSED]`: CalVer or SemVer `[OPEN]`; either way, the git SHA is
  the immutable key and human-readable versions are labels on top.
- Artefacts: container images for services; a **signed** Electron installer and
  an auto-update manifest for the desktop runner, with signature verification and
  rollback to the previous version (FR-DEV-09).
- Changelog generated from conventional commits `[PROPOSED]`; breaking changes to
  `@ua/contracts` or the API surface require an explicit note.
- Feature flags (`06`: `feature_flags`) decouple deploy from release; every flag
  has an owner and an expiry `[PROPOSED]` so flags do not become permanent
  branches.
- Rollback: previous image tag redeploy; for the desktop, the update channel can
  hold back a bad version; for the schema, §9 governs.
- Release checklist is enforced by `19-production-readiness-checklist.md`; the
  launch-day runbook in `19` §5 is the operational counterpart to this document.

---

## 16. Phase mapping

| Roadmap phase (see `17`) | DevOps deliverables |
|---|---|
| Phase 0/1 | `git init` + first commit (consent), `.gitignore`, editors/line endings, pnpm + Turbo, Windows CI job, first `docker compose` (PG/Redis/MinIO), `.env.example` validation, secret scanning |
| Phase 2 | Dev/staging cloud environment, Terraform skeleton, managed Postgres/Redis, remote state backend, per-PR environments |
| Phase 3–4 | Image builds, staging deploys, migration gate, OTel collector, basic dashboards, backup snapshots |
| Phase 5–7 | Worker scaling policy on queue depth, DLQ tooling, artifact lifecycle policies, device-gateway deploy path, desktop signing pipeline |
| Phase 8–9 | Cost tagging/budgets, restore-drill cadence, alert-to-runbook links, penetration-test remediation path |
| Phase 10 | Kubernetes on trigger ST-9, HPA/PDB, external secrets, PITR/WAL archiving, multi-AZ |
| Phase 11 | Scheduled load tests in staging with the `13` §6 criteria, soak test, chaos/failure-injection jobs |

---

## 17. Open questions

| # | Question | Impact | Blocks |
|---|---|---|---|
| Q-DEV-1 | Cloud provider and container runtime (Q-T4) | The shape of all Terraform | Phase 2/5 |
| Q-DEV-2 | Managed Postgres/Valkey provider (Q-T2) | Backups, PITR, connection limits | Phase 2 |
| Q-DEV-3 | Per-PR environment feasibility and cost | Review velocity vs. spend | Phase 2 |
| Q-DEV-4 | Kubernetes timing (ST-9) | Cost and complexity | Phase 10 |
| Q-DEV-5 | Desktop signing/notarisation account and update channel | Shipping the runner | Phase 4 |
| Q-DEV-6 | Licence for the repository `[OPEN]` | Legal/OSS posture | Phase 1 |
| Q-DEV-7 | Whether `sandbox`/public trial environment ships in the MVP | Ops load | paid release |
| Q-DEV-8 | Versioning scheme (SemVer vs CalVer) and API versioning policy | Client compatibility | Phase 1/3 |
| Q-DEV-9 | Whether a Linux developer path is supported alongside Windows | Team onboarding | Phase 1 |
| Q-DEV-10 | Terraform vs. CDK/Pulumi `[FACT]` D-12 selects Terraform; revisited only if a concrete pain appears | — | — |

---

## 18. Traceability

| Requirement | Where addressed here |
|---|---|
| NFR-MAINT-01 | §9 migration gates |
| NFR-MAINT-02 | §2 local environment, one-command Compose bring-up |
| NFR-MAINT-03 | §3 line endings, §4 Windows CI, §14 |
| NFR-REL-02 | §5 graceful deploy/drain, §10 |
| NFR-REL-04 | §10 RPO/RTO and drills |
| NFR-SEC-02 | §6 secrets, §11 redaction at source, §12 |
| NFR-SEC-04 | §12 TLS/HSTS |
| NFR-COST-01 | §13 cost tagging and budgets |
| FR-DEV-09 | §15 signed runner update with rollback |
| FR-ORG-05 | §8 verifiable deletion |
| R-05 (dev-machine capacity) | §14 |
| R-08 (premature scale spend) | §1 principle 5, §16 phase mapping |

Labels: `[FACT]` `[ASSUMPTION]` `[PROPOSED]` `[OPEN]`
