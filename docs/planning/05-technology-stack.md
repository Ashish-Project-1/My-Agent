# 05 — Technology Stack

| | |
|---|---|
| Status | Planning only. **Nothing is installed, and no dependency manifest exists.** |
| Owner | Architecture |
| Evidence rule | Every version below was read on **2026-10-15** from the npm registry (`/-/package/<pkg>/dist-tags` and `/<pkg>/latest`), endoflife.date release-cycle APIs, or the GitHub releases API. Nothing is recalled from memory. |
| Related | `04-architecture-decision-records.md` (the "why"), `15-devops-and-infrastructure.md` (how it is built and shipped) |

## 1. Verified version baseline

### 1.1 Libraries and frameworks (`[FACT]` — npm registry, 2026-10-15)

| Package | `latest` | Notable other tags | `engines.node` | Status |
|---|---|---|---|---|
| `next` | **16.4.1** | `preview` 16.3.0-preview.10, `canary` 16.5.0-canary.12, `backport` 15.5.28 | `>=20.9.0` | Recommended |
| `react` | **19.3.1** | `next` 19.3.0-canary | `>=0.10.0` (in formational) | Recommended |
| `typescript` | **7.0.2** | `beta` 6.0.0-beta, `rc` 7.0.1-rc, `next` 7.1.0-dev | `>=16.20.0` | Provisional (see ADR-015) |
| `tailwindcss` | **4.3.3** | `v3-lts` 3.4.19 | — | Recommended |
| `@nestjs/core` | **12.1.3** | `legacy` 11.2.7, `next` 12.0.0-alpha.7 | `>= 20` | Recommended |
| `@nestjs/bullmq` | **12.0.0** | — | — | Recommended (matches Nest 12 major) |
| `zod` | **4.6.7** | `canary` 4.5.0 | — | Recommended |
| `prisma` (CLI) | **8.0.0-rc.22** | `prev` 7.10.0 | `>=22.18.0` | **Do not use (RC)** — pin 7.10.x |
| `@prisma/client` | **7.10.0** | `dev` 8.1.0-dev.9, `prev` 6.19.3 | `^20.19 \|\| ^22.12 \|\| >=24.0` | Recommended |
| `bullmq` | **6.3.15** | `release-v5.x` 5.81.5 | `>=14.17.0` | Recommended |
| `ioredis` | **6.0.0** | `beta` 6.1.0-beta.1, `release-v4` 4.31.0 | `>=20.0.0` | Recommended |
| `@playwright/test` | **1.64.1** | `next` 1.65.0-alpha | `>=20` | Recommended |
| `electron` | **44.7.2** | `beta` 45.0.0-beta.3 | `>= 22.12.0` | Recommended (ADR-010) |
| `@tauri-apps/cli` | **2.12.3** | — | — | Alternative only (D-11) |
| `pnpm` | **12.11.2** | `next-12` 12.13.0 | `>=18.*` | Recommended |
| `turbo` | **2.11.8** | `canary` | — | Recommended |
| `vitest` | **5.0.4** | `V4` 4.1.11, `V3` 3.2.7 | `^22.12 \|\| ^24 \|\| >=26` | Recommended |
| `@opentelemetry/sdk-node` | **0.223.0** | — | — | Recommended (pairs with the OTel Collector) |
| `@opencode/sdk` | **2.0.29** | `dev` 0.0.0-dev-* | — | Recommended (embedded engine) |
| `@opencode/client` | **2.0.29** | `dev` 0.0.0-dev-* | — | Recommended (attach to an existing server) |
| `@modelcontextprotocol/sdk` | **1.32.1** | — | `>=18` | Recommended (MCP client in the runner) |

`[FACT]` Two traps visible in this table, both avoided:
- **`prisma@latest` is a release candidate (8.0.0-rc.22).** `@prisma/client@latest` is still 7.10.0. Installing "latest everywhere" would produce a mismatched, prerelease ORM in a security-critical product.
- **`typescript@latest` is 7.0.2** while the widest ecosystem tooling may still target the 5.x/6.x line. Pin explicitly and validate in Phase 1.

### 1.2 Runtimes, services and infrastructure (`[FACT]` — endoflife.date / GitHub releases, 2026-10-15)

| Component | Current | Recommendation | Support horizon | Note |
|---|---|---|---|---|
| Node.js | 26.12.0 (LTS date **2026-10-28**) · 24.22.0 · 22.23.3 | **Node 24 LTS** (`[FACT]` v24.18.0 already installed) | 24: EOL 2028-04-30 · 26: EOL 2029-04-30 | ADR-014; revisit Node 26 LTS after its LTS date + ~4 weeks of ecosystem validation |
| PostgreSQL | 18.6 · 17.11 · 16.15 | **18.x** | 18: EOL 2030-11-14 | ADR-019 |
| Redis | 8.10.2 · 8.2.10 | **8.x** (managed) | 8.0: EOL 2026-12-01 — use ≥ 8.2 | ADR-021 |
| Valkey | 9.1.2 | Alternative to Redis | — | Licence-clean fallback |
| Kubernetes | 1.37.1 · 1.36.5 · 1.35.9 | **1.36.x** at Phase 10 | 1.36: EOL 2027-06-28 | Not before Phase 10 (ADR-024) |
| Terraform | 1.16.6 · 1.15.9 | **1.16.x** | 1.14 EOL 2026-08-26 (past) | ADR-025; OpenTofu is the fallback |
| Docker Engine | 29.9.1 · 28.5.2 | **29.x** (matches local 29.6.1) | 28: EOL 2026-05-13 | Local + CI builds |
| Ollama | 0.40.4 | **0.40.x** | active | ADR-022; not yet installed |
| OpenSearch (optional log store) | 3.9.0 | only if self-hosting logs | — | Grafana Loki is the default, this is an alternative |

### 1.3 Environment facts that constrain the stack (`[FACT]`, `01` §3)

| Fact | Consequence |
|---|---|
| Windows 11 Pro, VS Code 1.130.0, Node 24.18.0, npm 11.16.0, git 2.56.0, Docker 29.6.1, Python 3.14.6 | Base toolchain is ready. |
| **pnpm, Ollama, psql, uv, rustc are NOT installed** | Phase 1 installs pnpm; Phase 4 installs Ollama; `rustc`/`uv` are not on the critical path (the `rustc` absence is what makes Tauri the wrong desktop choice). |
| **C: has 11.9 GB free; F: has 133.9 GB free** | Mandatory: redirect the pnpm store, Docker data-root, and `OLLAMA_MODELS` to `F:`. |
| GTX 1650, **4096 MiB VRAM**, 23.3 GiB RAM | Local model tier is 3B-class comfortable, 7B-class only with partial CPU offload. |
| 6 cores / 12 threads | Compile and test parallelism must be capped (`turbo --concurrency=4` class) to keep the machine usable. |

## 2. Recommended stack, end to end

| Layer | Choice | Version pin | Status |
|---|---|---|---|
| Runtime | Node.js LTS | 24.x (exact via `.nvmrc` + `engines`) | Provisional |
| Package manager | pnpm workspaces | 12.11.x | Final |
| Monorepo task runner | Turborepo | 2.11.x | Final |
| Language | TypeScript | exact (7.0.x, validated in Phase 1) | Provisional |
| Lint/format | ESLint + a single formatter (Prettier or Biome — pick one in Phase 1, driven by Nest/Next plugin support) | exact | Provisional |
| Web UI | Next.js (App Router) | 16.4.x | Final |
| UI library | React | 19.3.x | Final |
| Styling | Tailwind CSS + tokens in `@ua/ui` | 4.3.x | Final |
| Contracts | Zod schemas in `@ua/contracts` → OpenAPI + generated client | 4.6.x | Final |
| API | NestJS (Fastify adapter) | 12.1.x | Final |
| ORM | Prisma | 7.10.x (client + CLI aligned) | Provisional |
| Database | PostgreSQL (managed) | 18.x | Final |
| Cache/queue/locks | Redis (managed) + `ioredis` | 8.x / 6.0.x | Final |
| Jobs | BullMQ | 6.3.x | Final |
| Object storage | S3-compatible, private, pre-signed URLs | — | Final |
| Local models | Ollama + `OllamaProvider` | 0.40.x | Final |
| Remote models | OpenAI-compatible / Anthropic / Google / OpenRouter adapters | — | Final |
| Coding engine | `@opencode/sdk` embedded, behind `CodingEngine` | 2.0.29 (exact) | Provisional |
| Browser automation | Playwright (Chromium) | 1.64.x | Final |
| Desktop shell | Electron | 44.7.x | Provisional |
| IDE extension | VS Code extension (TS) | target VS Code 1.130+ | Provisional |
| Containers | Docker multi-stage, non-root | 29.x | Final |
| Orchestration | Managed container runtime now; Kubernetes 1.36 at Phase 10 | — | Provisional |
| IaC | Terraform | 1.16.x | Provisional |
| Observability | OpenTelemetry → Collector → Grafana LGTM (managed first) | sdk-node 0.223.x | Provisional |
| CI/CD | GitHub Actions, actions pinned by SHA, OIDC to cloud | — | Final |
| Tests | Vitest (unit/integration), Playwright (E2E), Testcontainers (real PG/Redis), k6-class load tool `[OPEN]` | 5.0.x | Provisional |

## 3. Version pinning and upgrade policy

`[PROPOSED]`

1. **Exact versions, one place.** pnpm's catalog feature (`catalog:` in `pnpm-workspace.yaml`) holds one version per dependency for the whole monorepo. No package declares a version directly.
2. **Committed lockfile.** `pnpm-lock.yaml` is committed; CI runs `--frozen-lockfile` and fails on drift.
3. **No `@latest`, ever, in product code.** `[FACT]` `INTEGRATIONS.md`/`opencode.jsonc` use `npx -y <pkg>@latest` for development MCP servers; that pattern is explicitly banned for anything the product ships (reproducibility + supply chain).
4. **Range policy:**
   - Runtime and risky framework dependencies: exact pins (`24.18.0`, `16.4.1`).
   - Library dependencies: exact pins in the catalog, upgraded deliberately.
   - Never `^`/`~` on anything security-relevant (auth, crypto, parsing, shell, sandbox).
5. **Prereleases are prohibited** in shipped paths: no `rc`, `beta`, `canary`, `next`, `dev` tags. Prisma 8-RC is the concrete example.
6. **Upgrade cadence:** Renovate-style automated PRs weekly; security patches within 7 days `[ASSUMPTION]`; majors planned as their own phase-gated task with a typecheck/build diff, migration dry-run, and rollback plan.
7. **Provenance:** enable npm provenance/attestation verification in CI; fail the build on a missing or mismatched attestation for dependencies flagged `critical-dependency`. `[OPEN]` whether the registry used supports this for all packages.
8. **Adding a dependency requires:** a stated need, a check that no existing dependency covers it, licence check (no AGPL/copyleft in distributed code without review), maintenance signal (recent releases, multiple maintainers where possible), install size, and an SBOM delta.

## 4. Dependency and compatibility checks performed

`[FACT]` Verified constraints that must hold together:

| Constraint | Verified value | Consequence |
|---|---|---|
| Node floor across the stack | Next ≥ 20.9, Nest ≥ 20, Playwright ≥ 20, ioredis ≥ 20, Prisma client `^20.19‖^22.12‖>=24`, Vitest `^22.12‖^24‖>=26`, Electron ≥ 22.12 | **Node 24 satisfies every one.** Node 22 would satisfy all but Vitest's `^22.12` floor is met by 22.12+; Node 26 is not yet LTS-in-time. |
| Prisma CLI vs client | CLI `latest` = 8.0.0-rc.22 (requires Node ≥ 22.18); client `latest` = 7.10.0 | Pin **both** to 7.10.x; never mix majors. |
| Nest 12 + BullMQ | `@nestjs/bullmq@12.0.0` exists and matches the Nest 12 major | Use the official integration rather than hand-rolling the worker bootstrap. |
| Electron 44 | requires Node ≥ 22.12 for its build toolchain | Node 24 fine. |
| OpenCode V2 | `@opencode/sdk` and `@opencode/client` both at 2.0.29 | Pin exact; treat as a fast-moving dependency (ADR-011). |
| Tailwind 4 | v4 is a new engine/config model vs v3 | Its own migration notes apply; do not copy v3 config snippets. |

`[OPEN]` Not yet verified because it requires an install: exact peer-dependency resolution of NestJS 12 + Zod 4 integration (`nestjs-zod`-class packages), the ESLint flat-config plugin set under TypeScript 7, and whether Next 16 + Tailwind 4 have any PostCSS integration surprise. **Phase 1 task 1.1 must resolve these before substantial code is written** (see `17` Phase 1).

## 5. Recommended local development setup (this machine, today)

`[PROPOSED]` No installation is performed in this planning phase.

| Step | What | Where | Why |
|---|---|---|---|
| 1 | `git init` + first commit of the existing four files | `F:\My Project\My Agent` | There is no history today (`[FACT]`); without it nothing is revertible. **Requires owner consent.** |
| 2 | Install pnpm 12 (`corepack enable pnpm` or a standalone install) | system | `[FACT]` pnpm is absent; Corepack ships with Node 24. |
| 3 | Set `PNPM_HOME`/store dir to `F:` | user env | `[FACT]` C: has 11.9 GB free |
| 4 | Set Docker Desktop data-root to `F:` | Docker settings | Images are multi-GB |
| 5 | `docker compose up postgres redis minio` | local | The only stateful services needed for development |
| 6 | Phase 4: install Ollama, set `OLLAMA_MODELS=F:\ollama-models` | local | `[FACT]` Ollama absent; weights are GB-scale |
| 7 | Pull `qwen2.5-coder:3b` (fits 4 GiB VRAM) then optionally `qwen2.5-coder:7b` for partial-offload testing | local | ADR-022; the 7B model is the realistic ceiling and should be *tested*, not assumed |
| 8 | Optional cloud dev database for integration tests | cloud | `[FACT]` Free RAM is ~4.9 GiB; running PG+Redis+MinIO+Ollama+Next+Nest+Vitest locally will thrash. A remote dev database is the pragmatic relief valve. |

Resource discipline for development `[ASSUMPTION]`: cap Turbo concurrency at 4, keep Ollama models unloaded when unused (`ollama stop`), prefer the 3B model for iteration, and never run the browser worker locally while compiling.

## 6. Explicitly rejected / deferred technologies

| Technology | Verdict | Reason |
|---|---|---|
| GraphQL | Rejected | REST + OpenAPI + generated client is sufficient; GraphQL widens the authorisation surface |
| gRPC between our services | Deferred | Only worth it after a real service split (ADR-001) |
| Kafka / NATS | Rejected for now | BullMQ covers our needs; a second broker is a second failure mode |
| Temporal | Rejected | Our task state machine is explicit in Postgres; Temporal would duplicate it |
| LangChain/LangGraph/Mastra/CrewAI | Rejected | `[FACT]` `INTEGRATIONS.md` already notes these "don't extend OpenCode"; they would add a second orchestration model next to OpenCode's |
| MongoDB | Rejected | `.env.example` mentions it only for a disabled MCP server; our data is relational |
| Tauri (now) | Deferred | No `rustc`; would need a Node sidecar (ADR-010) |
| Kubernetes (now) | Deferred | ADR-024 |
| Self-hosted model serving (vLLM) | Deferred | ADR-002/022; no GPU budget on the cloud, 4 GiB VRAM locally |
| Managed browser cloud | Open | Cost comparison at S3 (ADR-023) |
| Vector database (Pinecone/Weaviate) | Deferred | Start with Postgres + `pgvector`; a separate vector DB is unearned until index size or QPS demands it |
| Redis as a primary datastore | Rejected | Violates the single-source-of-truth rule (ADR-021) |
| A second queue/ORM/HTTP framework | Rejected | One of each, by policy |

## 7. Open technology questions

Tracked in full in `20-open-questions-and-assumptions.md`; technology-relevant subset:

| # | Question | Blocks |
|---|---|---|
| Q-T1 | TypeScript 7.x compatibility with the chosen lint/ORM/framework plugin set | Phase 1 code style and build |
| Q-T2 | Managed PostgreSQL/Valkey provider (Neon vs RDS vs Aurora vs ElastiCache) | Phase 2 and cost model |
| Q-T3 | Formatter/linter choice (Biome vs ESLint+Prettier) | Phase 1 |
| Q-T4 | Cloud container runtime (ECS/Fargate-class vs managed K8s vs serverless) | Phase 5 deploy |
| Q-T5 | Load-testing tool (k6 vs Artillery vs Locust) | Phase 11 |
| Q-T6 | Managed browser provider for cloud-side browsing vs self-hosted Playwright pods | Phase 7 cost |
| Q-T7 | Whether `pgvector` in the primary database is sufficient for project indexing at S3 | Phase 6/7 |

Labels: `[FACT]` `[ASSUMPTION]` `[PROPOSED]` `[OPEN]`
