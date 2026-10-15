# 04 — Architecture Decision Records

| | |
|---|---|
| Status | Planning only. Every decision below is `[PROPOSED]` unless marked **Final**. |
| Owner | Architecture |
| Format | Context → Decision → Alternatives → Why → Trade-offs (cost, security, migration) → Revisit trigger |
| Version sourcing | All version numbers verified 2026-10-15 from npm `latest`/`dist-tags`, endoflife.date, GitHub releases. Evidence tables in `05-technology-stack.md`. |

Status keys: **Final** (do not revisit without an ADR superseding it) ·
**Provisional** (chosen; revisit at the stated trigger) · **Open** (needs input).

---

## Architecture ADRs

### ADR-001 — Modular monolith backend, not nine microservices
**Status:** Final (per-module extraction allowed by trigger)
**Context:** The brief proposes nine backend apps (`api-gateway`, `identity-service`, `agent-orchestrator`, `task-service`, `approval-service`, `device-service`, `integration-service`, `billing-service`, `notification-service`). There is no code, no traffic, no team scale that justifies nine deployables.
**Decision:** One `api` deployable containing those as NestJS modules behind explicit interfaces, plus four worker deployables chosen by *resource profile and blast radius*.
**Alternatives:** (a) nine microservices; (b) single monolith including workers; (c) serverless functions per endpoint.
**Why:** Module boundaries give isolation of *code*, which is what we need now; network boundaries give isolation of *failure and scale*, which we need later. Transactional integrity across task+step+event+outbox is trivial in one process and painful across nine. Nine services would triple the deployment, tracing, secret-management and on-call surface for zero current benefit.
**Trade-offs:** *Cost:* lowest possible (one service, one image). *Security:* smaller attack surface; but a compromise inside `api` reaches all modules — mitigated by running workers separately and by treating all payloads as untrusted. *Migration:* extraction later is a mechanical move because modules already have interfaces and no cross-module DB access.
**Revisit:** when any trigger in `03-system-architecture.md` §4 is measured.

### ADR-002 — Local-first execution with opt-in cloud execution
**Status:** Final
**Context:** Users' data and credentials live on their machines; the cloud must scale to 100k+ registered users without GPU spend.
**Decision:** `execution_location` is a per-task attribute defaulting to `device`. Cloud execution requires an org setting **and** per-task opt-in (or the documented "no capable device" path).
**Alternatives:** cloud-only execution; device-only execution.
**Why:** Removes GPU cost from the critical path, makes the privacy claim real, and turns the 100k target into an orchestration-scaling problem.
**Trade-offs:** *Cost:* cloud cost dominated by DB/Redis, not compute. *Security:* user file content stays local by default — but cloud-executed tasks must be marked and audited. *Migration:* both paths exist from Phase 3, so no later rewrite.
**Revisit:** never (this is the product's identity).

### ADR-003 — Outbound-only device channel (WSS), no inbound ports
**Status:** Final
**Decision:** The runner connects out to the cloud over WSS on 443, authenticates with a device key pair, and receives commands on that channel. Long-poll fallback (`GET /v1/devices/:id/commands?cursor=`) when WebSocket is blocked (corporate proxies).
**Alternatives:** inbound HTTPS to the device; mTLS with a device-hosted listener; third-party tunnel (ngrok-style); message broker client on the device.
**Why:** Works behind NAT/CGNAT and corporate firewalls; no certificate or port management on user machines; no listener to attack. Command durability lives in the DB, so the channel is a *delivery mechanism*, not the queue.
**Trade-offs:** *Cost:* one long-lived connection per active device — sizing in `13`. *Security:* a stolen device key lets an attacker receive commands (mitigated by key binding to device + user, revocation, and command digests); it never grants the attacker the ability to *call* the API as the user. *Migration:* adds the long-poll fallback to support locked-down networks.
**Revisit:** if enterprise customers demand on-prem relay or mTLS device certificates.

### ADR-004 — Deterministic, digest-bound approvals
**Status:** Final
**Decision:** Policy evaluation is a pure function of (action, canonicalised arguments, context, policy version). An `ASK` produces an approval request whose grant is a signed token binding `action`, `argumentsDigest`, `targetDigest`, `userId`, `deviceId`, `taskId`, `stepId`, `policyVersion`, `nonce`, `expiresAt`, `useCount`. Execution re-verifies every bound field.
**Alternatives:** "approve the plan once, run everything"; per-tool permanent allow-list; human confirmations inside the prompt; an LLM-as-judge authoriser.
**Why:** The only way to make approvals meaningful: what the user approved is provably what runs. Canonicalisation (normalised paths, sorted JSON, argv array not shell string) makes the digest stable.
**Trade-offs:** *Cost:* one extra row + a notification per sensitive action. *Security:* the core control of the system; also prevents replay and TOCTOU (time-of-check/time-of-use) substitution. *Migration:* none.
**Revisit:** never; extend scopes, don't weaken binding.

### ADR-005 — Durable intent + outbox + idempotency keys
**Status:** Final
**Decision:** Every mutation that must cause an asynchronous effect writes state **and** an outbox row in one transaction; a publisher moves outbox rows to BullMQ; consumers treat delivery as at-least-once and guard side effects with effect keys. HTTP mutations accept `Idempotency-Key`.
**Alternatives:** publish directly to Redis after commit (loses jobs on crash); exactly-once delivery via Redis Streams consumer groups (still needs idempotency at the effect level); transactional queue in Postgres (extra operational surface).
**Why:** Postgres is the source of truth; Redis is a delivery mechanism. This is what makes NFR-REL-02/03 true instead of aspirational.
**Trade-offs:** *Cost:* one table + a poller. *Security:* prevents duplicate external effects (double email, double PR comment). *Migration:* none.
**Revisit:** if outbox volume makes polling expensive (then switch to logical replication/WAL streaming).

### ADR-006 — Append-only task event log with per-task sequence
**Status:** Final
**Decision:** `task_events` is append-only, ordered per task by a monotonic `seq` allocated in the same transaction as the state change. Task `state` is a materialised column; a replay of events must reproduce it (invariant 6).
**Alternatives:** state-only rows (no history); Kafka/event-sourcing framework; log in the client.
**Why:** Gives audit, SSE replay, debugging and recovery from one structure. A Kafka-cluster is disproportionate; Postgres append-only tables with indexes handle this volume for years.
**Trade-offs:** *Cost:* storage growth (mitigated by retention + partitioning, `06`). *Security:* events must be redacted on write. *Migration:* partition by month when a table exceeds ~50 GB `[ASSUMPTION]`.
**Revisit:** at S3 scale if event write throughput approaches DB write limits.

### ADR-007 — Policy as versioned data, evaluated by a deterministic engine
**Status:** Final
**Decision:** Policies are declarative documents (JSON, validated by Zod) with ordered rules; the engine evaluates last-match-wins per action resource, returns `allow|ask|deny` plus the matching rule ID; policies can only tighten the built-in floor. Both device-local and org-level policies compose with documented precedence.
**Alternatives:** OPA/Rego as a service; imperative checks scattered in handlers; LLM-based policy.
**Why:** Reproducibility, auditability and testability. OPA is a fine engine but adds a service dependency and a language for a rule set we can express in ~200 lines; we borrow its ideas, not its deployment.
**Trade-offs:** *Cost:* negligible. *Security:* the control point for the whole approval system; must be pure and heavily tested. *Migration:* if we ever need OPA, the policy document is exportable.
**Revisit:** if policy complexity exceeds nested-condition limits or customers demand Rego.

### ADR-008 — Tenant isolation by `organization_id` + scoped data layer, with RLS as backstop
**Status:** Final
**Decision:** Every tenant table has a non-nullable `organization_id`. All access goes through `TenantScopedDb`, which injects the tenant predicate and *fails closed* if no tenant context is present. Postgres RLS policies are added in Phase 10 as defence in depth. A cross-tenant test suite is a required CI gate.
**Alternatives:** schema-per-tenant; database-per-tenant; application-level filtering by convention only.
**Why:** Schema/DB-per-tenant is operationally expensive at 100k users and complicates migrations; convention-only filtering is how leaks happen. One shared schema + enforced scoping + RLS gives the best cost/risk ratio.
**Trade-offs:** *Cost:* lowest. *Security:* one bug in the scoping layer could leak broadly, hence RLS + tests + review of the scoping layer as security-critical code. *Migration:* enterprise single-tenant deployments become a later deployment variant of the same schema.
**Revisit:** if a customer contractually requires physical isolation (then: dedicated DB with the same schema).

### ADR-009 — Own identity + sessions, with OIDC federation later
**Status:** Provisional
**Context:** Managed IdPs (Clerk, Auth0, Keycloak, Ory) versus building email/password + sessions + device flow.
**Decision:** Build email/password (Argon2id), server-side sessions, short-lived access tokens + rotating refresh tokens, TOTP, and the device-authorisation flow. Add OIDC federation (Google/Microsoft/GitHub) in Phase 9 and SAML/SCIM in the enterprise track.
**Alternatives:** Auth0/Clerk/WorkOS for everything; Keycloak self-hosted; Supabase Auth.
**Why:** The device-authorisation flow and device key binding are product-specific and awkward in managed IdPs; and we control the revocation, audit and step-up semantics the approval system depends on. A managed IdP also adds per-MAU cost that hurts at 100k users.
**Trade-offs:** *Cost:* more code to own and test; no per-MAU auth fee. *Security:* we own credential storage; mitigations: Argon2id with tuned parameters, session revocation list, refresh-token reuse detection, no password in logs, rate limits, breach-password check. *Migration:* OIDC federation can be added as an alternative login; migrating *away* would require a password-reset campaign, so the decision is deliberate.
**Revisit:** if identity becomes the least-reliable part of the system, or if an enterprise deal requires an IdP we cannot federate to.

### ADR-010 — Windows desktop shell: Electron (not Tauri)
**Status:** Provisional
**Context:** `[FACT]` `rustc` is not installed; the local runner is Node/TypeScript and must spawn processes, host Playwright, and manage a Windows service.
**Decision:** Electron 44.x for the desktop shell, hosting or supervising the Node runner in-process/side-by-side.
**Alternatives:** Tauri 2.12 (smaller binaries, Rust toolchain, would need a Node sidecar binary and IPC); a plain MSI + tray-less service with a web UI only; .NET/WPF shell (new language).
**Why:** One language across the stack; direct access to Node APIs, child processes and Playwright; no second toolchain, no sidecar packaging, no IPC bridge to build. Installer size (est. 90–150 MB) is the price.
**Trade-offs:** *Cost:* larger install/download; Electron's own CVE cadence must be tracked and patched. *Security:* Electron hardening is mandatory — `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` in the renderer, CSP, no `remote`, allow-listed `shell.openExternal`, signed updates. *Migration:* a Tauri rewrite is possible later because the runner is a separate process behind an HTTP loopback API.
**Revisit:** if installer size/download complaints are material, or if Electron's security patching becomes a burden — measure before switching.

### ADR-011 — OpenCode V2 embedded via `@opencode/sdk` behind a `CodingEngine` interface
**Status:** Provisional
**Context:** `[FACT]` OpenCode V2 (npm `@opencode/sdk` / `@opencode/client` at 2.0.29) exposes an SDK that hosts the server in-process (`OpenCode.create()`), a network client with `Service.ensure()` for the local background service, a documented HTTP API (`/openapi.json`), plus `permissions` and `policies` semantics.
**Decision:** Define `CodingEngine` with `plan()`, `executeStep()`, `stream()`, `cancel()`, `capabilities()`. Ship three implementations: (1) `OpenCodeEngine` (embedded SDK, default), (2) `OpenCodeRemoteEngine` (client → an OpenCode server the user already runs), (3) `MockEngine` for tests. Map OpenCode's `permissions`/`policies` onto our policy engine: our decisions are translated into OpenCode config/policies for the session, and OpenCode's `ask` prompts are surfaced through *our* approval UI, never a raw tool prompt.
**Alternatives:** write our own agent loop and use nothing; use a different framework (LangChain/LangGraph/Mastra/CrewAI) as the planner; call a provider directly with our own tool-calling loop.
**Why:** OpenCode already solves coding-agent execution, tool hosting, MCP integration and local models — the `INTEGRATIONS.md` catalogue exists precisely because it is the host. Wrapping it behind an interface means a V2 API change (the docs warn the API and plugin API changed between V1 and V2) is an adapter fix, not a product rewrite.
**Trade-offs:** *Cost:* one dependency with a fast release cadence; must pin exact versions. *Security:* OpenCode executes tools on the user's machine — we must configure its permissions *from* our policy, and never let a project-local OpenCode config silently widen permissions (its precedence rules put managed/system/Console config last, which is what we want: our managed config wins). *Migration:* V2 is young; contract tests against the SDK and a mock engine keep us honest.
**Revisit:** on any breaking V2 change, or if the engine's restrictions block the approval semantics we need.

### ADR-012 — One queue framework: BullMQ 6 on Redis 8
**Status:** Final
**Decision:** BullMQ for all asynchronous work: delayed jobs (approval TTLs, device-wait TTLs), retries with backoff, deduplication by `jobId`, flows for step graphs, per-queue concurrency and rate limiting, DLQs per queue.
**Alternatives:** Postgres-based queues (pg-boss/Graphile Worker); SQS; Temporal/Inngest/Trigger.dev; Kafka.
**Why:** The brief specifies it, it is mature, Redis is already required for caching/pub-sub/locks, and its features map exactly to our needs (delays for TTLs, dedupe for idempotency). Adding Temporal would add a whole workflow engine and a second consistency model for a state machine we already model explicitly in Postgres.
**Trade-offs:** *Cost:* Redis is the only always-on stateful dependency besides Postgres; memory sizing in `13`. *Security:* Redis must never be internet-reachable (private subnet, TLS, auth); queue payloads are untrusted input and are re-validated. *Migration:* an outbox-driven design means we could swap the delivery mechanism without touching business logic.
**Revisit:** if job volumes exceed a single Redis instance's practical limit (est. `[ASSUMPTION]` > 100k jobs/hour sustained) or if Redis HA failover creates unacceptable job churn.

### ADR-013 — Object storage: S3-compatible, private, pre-signed URLs only
**Status:** Final
**Decision:** Artifacts live in S3-compatible storage with SSE-KMS, versioning, lifecycle rules and no public access. Clients upload/download via short-lived pre-signed URLs scoped to one object; the API never proxies large payloads.
**Alternatives:** store artifacts in Postgres (bytea); local disk on the API pods; a CDN-fronted public bucket.
**Why:** Cost, durability and offloading. Postgres bytea would bloat the DB and backups; pod-local disk loses data.
**Trade-offs:** *Cost:* the cheapest part of the platform (with lifecycle rules). *Security:* pre-signed URL leakage is the risk — short TTL (≤ 15 min `[ASSUMPTION]`), single object, single method, `Content-MD5`/digest verification, and bucket policy denying non-KMS writes. *Migration:* `StorageAdapter` interface keeps S3/MinIO/Azure swappable.
**Revisit:** if data residency forces a second provider per region.

---

## Technology ADRs

### ADR-014 — Node.js 24 LTS now, Node 26 LTS after it ships
**Status:** Provisional
**Context:** `[FACT]` Node 24.18.0 (Active LTS, EOL 2028-04-30) is already installed. Node 26.12.0 enters LTS on **2026-10-28** — 13 days after this plan was written. `[FACT]` `next` requires ≥ 20.9, `@nestjs/core` ≥ 20, `@prisma/client` `^20.19 || ^22.12 || >= 24`, `vitest` `^22.12 || ^24 || >= 26`, `electron` ≥ 22.12.
**Decision:** Node 24.x LTS for all cloud and device code. Re-evaluate Node 26 LTS 4–6 weeks after its LTS date, once Electron/Vitest/Prisma have validated support.
**Alternatives:** Node 26 immediately (13 days pre-LTS, unproven ecosystem); Node 22 (older LTS, narrower headroom).
**Why:** Node 24 is already on the machine, supported by every dependency in the stack, and LTS until 2028. Migrating to 26 mid-build buys nothing and risks native-module and Electron issues.
**Trade-offs:** *Cost:* none. *Security:* staying on a supported LTS keeps receiving security patches; a pinned `.nvmrc`/`engines` field plus Renovate keeps us current. *Migration:* one runtime bump later, gated by `engines` + CI matrix.
**Revisit:** 2026-12-01, or earlier if a dependency requires 26.

### ADR-015 — TypeScript 7.x with a pinned toolchain
**Status:** Provisional
**Context:** `[FACT]` npm `typescript@latest` is **7.0.2** (with `6.0.0-beta` and a `7.1.0-dev` next tag visible in dist-tags).
**Decision:** Pin an exact TypeScript version in the pnpm catalog for the whole monorepo, and treat a compiler major upgrade as its own change with a typecheck-diff review.
**Alternatives:** stay on 5.x/6.x line for maximum ecosystem tooling compatibility; adopt `tsgo`-based tooling selectively.
**Why:** Consistency matters more than novelty; a monorepo with mixed compilers produces phantom errors. Pinning one version keeps CI deterministic.
**Trade-offs:** *Cost:* none. *Security:* none directly (dev-only dependency) — but unpublished/typosquatted compiler packages are a supply-chain risk, hence exact pins + lockfile + provenance checks. *Migration:* compiler upgrades are their own PR with a typecheck and build-time diff.
**Revisit:** if any required tool (ESLint plugin, NestJS CLI, Next.js, Vitest) does not support 7.x cleanly — then pin the newest supported major instead. `[OPEN]` validate this in Phase 1 before writing substantial code.

### ADR-016 — Next.js 16 + React 19 for web and admin
**Status:** Final
**Context:** `[FACT]` Next 16.4.1 (requires Node ≥ 20.9), React 19.3.1.
**Decision:** App Router, React Server Components for read-heavy pages, client components only where interactivity requires them; streaming SSR for the task workspace shell; SSE (not WebSockets) for task events on the web.
**Alternatives:** Remix/React Router 7; Vite SPA + separate API; Astro for marketing only; tRPC instead of REST.
**Why:** Streaming, caching and RSC fit the task-progress UX; server-side rendering of the dashboard keeps the client thin; SSE needs no special proxy configuration (unlike WSS) and survives reconnects with `Last-Event-ID`.
**Trade-offs:** *Cost:* Node runtime or static export depending on route — no per-route surprise. *Security:* session cookies, no tokens in JS; CSP with nonces; server actions validated by the same contracts (no implicit trust). *Migration:* the API is the product boundary, so a UI framework change later does not touch the backend.
**Revisit:** only if App Router streaming forces a worse UX than a plain SPA for the task workspace.

### ADR-017 — Tailwind CSS 4 + a local component layer
**Status:** Final
**Decision:** Tailwind 4.3.x with design tokens (CSS variables), a small in-repo component set in `@ua/ui`, dark/light from the start, no third-party component library as the primary layer.
**Alternatives:** shadcn/ui (copy-in components — compatible with this choice, may be vendored selectively); MUI; Chakra; Mantine; CSS Modules.
**Why:** Utility-first keeps the design system in one place and avoids fighting a heavy library's opinions; accessibility primitives (focus traps, dialog semantics, combobox behaviour) will be vendored from a copy-in library rather than rewritten.
**Trade-offs:** *Cost:* none (build-time CSS). *Security:* no runtime styling injection. *Migration:* tokens make a later library swap cheap.
**Revisit:** if accessibility debt accumulates that a mature primitive library would have prevented — then vendor primitives, do not adopt a theme system wholesale.

### ADR-018 — NestJS 12 as the API framework
**Status:** Final
**Context:** `[FACT]` `@nestjs/core@12.1.3`, requires Node ≥ 20.
**Decision:** NestJS with explicit modules matching `03` §5.5, global validation pipe bound to `@ua/contracts` schemas, guards for authn/tenant/policy, interceptors for tracing/logging/redaction, and no cross-module direct repository access.
**Alternatives:** Fastify + hand-rolled structure; Express; tRPC; Hono.
**Why:** Requested; its module/DI system directly enables the modular monolith and later extraction; its guard/pipe/interceptor pipeline expresses exactly the security chain we need (authenticated → tenant → role → resource → policy).
**Trade-offs:** *Cost:* slightly heavier cold start and more boilerplate than Fastify alone (acceptable). *Security:* a single, reviewable pipeline for authn/authz is a feature; risk is a guard silently not applied — mitigated by a global-registration test that asserts every non-public route requires auth. *Migration:* it runs on Fastify underneath, so a later downgrade-to-Fastify path exists if DI becomes a burden.
**Revisit:** if framework overhead measurably dominates p95 latency at S2.

### ADR-019 — PostgreSQL 18 (managed) as the single source of truth
**Status:** Final (managed provider choice is Provisional)
**Context:** `[FACT]` PostgreSQL 18.6 current, EOL 2030-11-14; 17.11 also supported.
**Decision:** PostgreSQL as *the* database for identity, tasks, events, approvals, audit, usage. Managed instance, private subnet, encrypted at rest, HA with automated failover, PITR, connection pooling via PgBouncer in transaction mode once replicas exceed ~8.
**Alternatives:** Aurora Serverless v2 (Postgres-compatible, cost profile differs); Neon (serverless Postgres, branching — good for preview environments); Supabase (adds auth/storage we are building ourselves); MySQL; MongoDB; DynamoDB.
**Why:** Relational integrity for the task/step/event/approval graph, mature operational tooling, JSONB where flexibility is needed, RLS for defence in depth, and the widest hiring/tooling familiarity.
**Trade-offs:** *Cost:* the largest single line item; right-sized instance + read replicas on demand; Neon-style branching is attractive for per-PR previews, so `[OPEN]` managed provider (see `20`). *Security:* tenant data in one instance requires the scoping + RLS controls (ADR-008). *Migration:* Prisma + standard SQL keeps us portable between providers; avoid provider-specific extensions beyond `pgcrypto`/`uuid-ossp`-class ones.
**Revisit:** provider choice at Phase 2 start (cost + preview-environment workflow).

### ADR-020 — Prisma 7.10 (stable), not the Prisma 8 release candidate
**Status:** Provisional
**Context:** `[FACT]` `@prisma/client@latest` = **7.10.0**; `prisma@latest` = **8.0.0-rc.22** (a release candidate); engines require Node `^20.19 || ^22.12 || >= 24`.
**Decision:** Pin `prisma` and `@prisma/client` to the 7.10.x stable line, with the `TenantScopedDb` client extension as the data-access entry point. Evaluate Prisma 8 only after its stable release and a migration dry-run.
**Alternatives:** Prisma 8 RC now; Drizzle ORM; Kysely; TypeORM; raw SQL + a query builder.
**Why:** An RC as the ORM for a security-critical multi-tenant product is avoidable risk. Prisma 7 is stable, has the client-extension mechanism we need for tenant scoping, and a documented migration path forward.
**Trade-offs:** *Cost:* none. *Security:* the client extension is a real security control; Prisma's generated SQL must be reviewed for the scoping layer (raw query escape hatches are banned by lint rule). *Migration:* plan a Prisma 8 upgrade as its own phase-gated task with a schema/migration dry run in staging.
**Revisit:** Prisma 8 GA + a green upgrade rehearsal.

### ADR-021 — Redis 8 (or Valkey 9) with a strict separation of responsibilities
**Status:** Final (engine choice Provisional)
**Context:** `[FACT]` Redis 8.10.2 current; Valkey 9.1.2 exists as the licence-clean fork; `ioredis@6.0.0`.
**Decision:** Use Redis for (a) BullMQ queues, (b) SSE/pub-sub fan-out, (c) short-lived distributed locks and rate-limit counters, (d) cache. **Never** as a system of record. No-eviction policy for the queue keyspace; separate logical DBs/indexes per concern; TLS + auth; private subnet only.
**Alternatives:** Valkey (licence/independence); KeyDB; Dragonfly; a managed Redis-compatible service (ElastiCache, Upstash, Redis Cloud, Memorystore).
**Why:** One stateful dependency instead of three. ElastiCache-managed Redis is the default cloud choice; Valkey is the fallback if licensing terms bite.
**Trade-offs:** *Cost:* instance sizing on memory, not CPU. *Security:* Redis compromise equals full data access to cached content — hence no secrets in cache, TLS, auth, private networking, and no `KEYS`/`FLUSHALL` in application code. *Migration:* `ioredis` works with both Redis and Valkey; `[OPEN]` final engine decision at Phase 2.
**Revisit:** when managed-provider pricing or licence terms are known.

### ADR-022 — Ollama for local inference, with a provider abstraction on top
**Status:** Final (model choice per hardware is Provisional)
**Context:** `[FACT]` Ollama 0.40.4 current; the reference dev GPU has **4 GiB VRAM** (not 8) and 23.3 GiB RAM; Ollama is not yet installed.
**Decision:** `ModelProvider` interface with `OllamaProvider` as the local default, plus `OpenAICompatibleProvider`, `AnthropicProvider`, `GoogleProvider`, `OpenRouterProvider`, and a `CustomBaseUrlProvider`. Small quantised models by default (`qwen2.5-coder:3b` class fits 4 GiB comfortably; 7B-class runs only with partial CPU offload). Embeddings local (`nomic-embed-text` class).
**Alternatives:** llama.cpp directly (lower-level, more work, more control); LM Studio (GUI-first, bad for a service); vLLM (server GPU, wrong for a laptop); cloud-only models (breaks the privacy claim).
**Why:** Ollama gives model lifecycle, an HTTP API, GPU acceleration on Windows and a simple install — exactly the 80% we need, and OpenCode already auto-discovers it.
**Trade-offs:** *Cost:* zero marginal cost; local electricity. *Security:* local models cannot exfiltrate data by themselves, but a *remote* provider is data egress — hence per-org provider policy, explicit consent, and an audit event for every remote call. *Migration:* the provider interface means Ollama can be swapped without touching the agent loop.
**Revisit:** if Ollama's Windows GPU support proves unstable, or if the machine gains an 8 GB+ GPU (`[OPEN]` the brief's VRAM assumption is wrong — see `01` §4).

### ADR-023 — Playwright 1.64 for browser automation (device and cloud)
**Status:** Final
**Context:** `[FACT]` Playwright 1.64.1, requires Node ≥ 20; the repo already enables Playwright MCP for development.
**Decision:** Playwright with Chromium by default, one isolated browser context per task, downloads quarantined, a network policy hook (allow/deny lists, egress audit), and artifact capture (screenshot, DOM snapshot, console log, request summary). Browser runs on the device by default; the cloud browser worker is for users without a device.
**Alternatives:** Selenium; Puppeteer (Chromium-only, thinner tooling); CDP directly; a managed browser cloud (Browserbase/Steel) — `[OPEN]` for the cloud path if cost beats running our own browser pods.
**Why:** Trace/video/artifact support, strong selectors, first-class context isolation, and it is already the ecosystem default.
**Trade-offs:** *Cost:* device-side free; cloud-side memory-heavy pods (~`[ASSUMPTION]` 400–800 MB per concurrent context). *Security:* the primary prompt-injection surface — hence read-vs-write risk classes (FR-BRW-02), no credential persistence, quarantine on download, and DOM content treated as tainted. *Migration:* abstracted behind `BrowserRuntime` so a managed provider can replace the cloud path.
**Revisit:** cloud browser economics at S3, or if a competitor's stealth/anti-bot requirements are needed (not planned).

### ADR-024 — Docker for images; Kubernetes only when it pays
**Status:** Provisional
**Context:** `[FACT]` Docker 29.6.1 present locally via WSL2. No Kubernetes locally and none should be.
**Decision:** Phase 1–9: local `docker compose` for Postgres/Redis/MinIO; production on a managed container service with HPA-equivalent autoscaling (ECS/Fargate-class or a managed Kubernetes). Phase 10: adopt Kubernetes 1.36 only if we need per-workload autoscaling, network policies, and multi-team isolation beyond what the simpler runtime gives.
**Alternatives:** Kubernetes from day one; serverless functions for the API; bare VMs + systemd.
**Why:** Kubernetes operational cost (control plane, upgrades, ingress, secrets, observability wiring, on-call) is real and buys nothing at S2 scale. Docker images and 12-factor configuration keep the migration path open.
**Trade-offs:** *Cost:* managed container service is cheaper and simpler at S2; K8s later costs a migration but a small one (same images, same env config). *Security:* K8s network policies and per-workload identity are a genuine gain at scale; before that, security groups and per-service IAM roles suffice. *Migration:* avoid proprietary primitives (no vendor-specific task definitions in app code); all config via env.
**Revisit:** at S3 sizing (§13) or when the first enterprise security review demands workload isolation.

### ADR-025 — Terraform 1.16 as the infrastructure definition
**Status:** Provisional
**Decision:** Terraform for all cloud resources, remote state with locking, per-environment workspaces/states, no manual console changes, `terraform plan` review required on every change, destructive operations gated (matching the repo's own `ask` rules in `opencode.jsonc`).
**Alternatives:** OpenTofu (licence-clean fork, drop-in compatible); Pulumi (real language, different state model); AWS CDK; Ansible; cloud-native IaC.
**Why:** The most widely understood, provider-agnostic, reviewable option, and the repo's existing configuration already gates `terraform apply`/`destroy` — an established convention.
**Trade-offs:** *Cost:* state storage + CI minutes. *Security:* state can contain sensitive values → encrypted remote state, restricted IAM, no secrets in variables (use the secret manager with `data` references). *Migration:* OpenTofu is a compatible escape hatch; keep modules provider-neutral where practical.
**Revisit:** if licence terms or provider coverage change, migrate to OpenTofu (deliberately cheap by design).

### ADR-026 — OpenTelemetry (0.223.x) as the single instrumentation, Grafana-stack backend
**Status:** Provisional
**Decision:** All services emit OTel traces, metrics and logs to an OTel Collector; the default backend is the Grafana stack (Prometheus-compatible metrics, Tempo for traces, Loki for logs) with a managed option first and self-hosting later. No vendor SDK in application code.
**Alternatives:** Datadog/New Relic (best-in-class UX, highest cost, vendor lock-in); self-hosted Elastic/OpenSearch; Axiom/Better Stack (cheap logs); Sentry for errors only.
**Why:** OpenTelemetry keeps the backend swappable, and the Grafana stack is the cheapest credible option at our scale, with a migration path to a paid backend when the team can afford it.
**Trade-offs:** *Cost:* managed Grafana Cloud free/entry tier is affordable at S1/S2; self-hosting adds operational load. *Security:* logs must be redacted before export; OTel attributes must never carry secrets, file contents or model prompts. *Migration:* collector-level routing makes swapping backends a config change.
**Revisit:** if query performance or alerting quality becomes the bottleneck, or if a customer demands log export to their system.

### ADR-027 — GitHub Actions for CI/CD
**Status:** Final (Provisional if the repo moves hosts)
**Decision:** GitHub Actions with a required-checks pipeline: typecheck, lint, unit, integration, contract/OpenAPI diff, cross-tenant tests, build, image scan, SBOM, migration dry-run, then environment-gated deploys (staging auto, production manual approval). Scheduled jobs: dependency audit, container scan, secret scan, restore drill.
**Alternatives:** GitLab CI; Buildkite; CircleCI; Jenkins; Vercel-only deploys.
**Why:** Zero infrastructure to run, free minutes on a private repo's tier, and the ecosystem's widest marketplace for the security scanners already referenced in the repo's `/security` command (semgrep, gitleaks, osv-scanner, trivy).
**Trade-offs:** *Cost:* free/cheap. *Security:* third-party actions are a supply-chain risk → pin actions **by commit SHA**, not tags; least-privilege `GITHUB_TOKEN`; no secrets available to fork PRs; OIDC to the cloud instead of long-lived keys. *Migration:* the pipeline is YAML in the repo; moving is cheap.
**Revisit:** if build minutes become a real cost or self-hosted runners are needed for Windows device tests (likely — schedule that decision in Phase 8).

### ADR-028 — Windows device testing on real hardware, not only emulation
**Status:** Provisional
**Decision:** Keep a Windows test matrix: a self-hosted runner (or an on-demand Windows VM) runs the runner's packaging, service lifecycle, sandbox and path-handling tests; the reference development machine is a secondary target. Mocking Windows process semantics in Linux CI is explicitly rejected for the sandbox and path canonicalisation code.
**Alternatives:** Linux-only CI with unit tests for platform code (insufficient); a cloud Windows VM matrix only (slow, expensive); manual testing (unreliable).
**Why:** The product's highest-risk code is Windows-specific (job objects, process trees, reparse points, service restarts). Untested on Windows means untested.
**Trade-offs:** *Cost:* a self-hosted runner or VM minutes. *Security:* test machines must not hold production credentials; tests must be hermetic. *Migration:* n/a.
**Revisit:** when macOS/Linux runners are added to the product (`[OPEN]` scope decision).

---

## Superseded / rejected ideas (recorded so they are not revisited by accident)

| Idea | Why rejected |
|---|---|
| Nine microservices per the brief's tree | Unearned complexity (ADR-001); replaced by module + trigger model |
| GraphQL as the primary API | REST + OpenAPI + generated client covers the surfaces; GraphQL adds authorisation complexity for cross-tenant data |
| Event sourcing as the task model | Append-only events **plus** a materialised state column gives the benefits without the replay infrastructure |
| Kubernetes in local development | 4 GiB VRAM / 11.9 GB free on `C:` / no benefit (`ADR-024`) |
| Tauri without a Node sidecar | Would need a second language and an IPC bridge (`ADR-010`) |
| A second queue (SQS/Kafka) alongside BullMQ | Two delivery semantics, two failure modes (`ADR-012`) |
| Storing artifacts in Postgres | Backup and bloat cost (`ADR-013`) |
| Cloud-first execution to "simplify" the runner | Destroys the privacy claim and the unit economics (ADR-002) |
| LLM-based policy decisions | Non-deterministic, unauditable, injectable (`ADR-004`, `ADR-007`) |
| Approving a whole plan once | Bypasses digest binding; the substitute is scoped grants (FR-APPR-05) |

Labels: `[FACT]` `[ASSUMPTION]` `[PROPOSED]` `[OPEN]`
