# 01 — Repository Audit

| | |
|---|---|
| Status | Planning only. Audit performed 2026-10-15. |
| Owner | Architecture |
| Method | Direct inspection of the working directory, `git` probes, package-manager probes, `Win32_*` CIM queries, `nvidia-smi`. |
| Truth rule | Every statement below is either verified (`[FACT]`, with how it was verified) or explicitly flagged as an assumption. Nothing is inferred from the roadmap. |

## 1. Method

Commands run (read-only, no side effects):

- `Get-ChildItem -Force -Recurse` on the working directory
- `git rev-parse --is-inside-work-tree`, `git status --short`
- `node -v`, `npm -v`, `pnpm -v`, `git --version`, `docker --version`,
  `ollama --version`, `python --version`, `uv --version`, `rustc --version`,
  `code --version`, `psql --version`
- `nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv`
- `Get-CimInstance Win32_OperatingSystem | Win32_Processor | Win32_VideoController`
- `Get-PSDrive -PSProvider FileSystem`, `wsl --status`
- Reads of `AGENTS.md`, `INTEGRATIONS.md`, `opencode.jsonc`, `.env.example`
- Official documentation reads: OpenCode V2 docs (SDK, client, API,
  permissions, policies, network), npm registry `latest`/`dist-tags`,
  endoflife.date release-cycle APIs, GitHub releases API

No file was created, modified or deleted during the audit. No package was
installed. No model was downloaded. No container was started.

## 2. Verified inventory — what exists

`[FACT]` The working directory `F:\My Project\My Agent` contains exactly four
files and zero directories:

| Path | Bytes | What it is |
|---|---:|---|
| `AGENTS.md` | 1,311 | Working rules for AI agents in this repo: smallest-change rule, safety gates (ask before `git push`, `terraform apply`, migrations), review/verification commands, tool preferences (Context7, deepwiki, playwright/chrome-devtools, exa). |
| `INTEGRATIONS.md` | 12,576 | An honest catalogue of ~150 external tools and *which mechanism* each one actually uses with OpenCode (MCP server / plugin / provider / CLI / library / API-only / built-in). Includes a "verify before you trust" list of entries written from docs but never executed. |
| `opencode.jsonc` | 10,344 | OpenCode V2 project configuration: `permissions` (destructive-command gates), a read-only `reviewer` subagent, `/review` `/security` `/verify` commands, 4 active MCP servers (deepwiki, exa, playwright, chrome-devtools) and 24 more written-but-`disabled`, plus a comment block on local Ollama models. |
| `.env.example` | 694 | Names of the environment variables the disabled MCP servers expect (`CONTEXT7_API_KEY`, `NEON_API_KEY`, `MDB_MCP_CONNECTION_STRING`, `SEMGREP_APP_TOKEN`, `TFE_TOKEN`, `GRAFANA_URL`, `GRAFANA_API_KEY`, `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`). All values empty. |

### 2.1 Categories the brief asks about

| Area | Finding |
|---|---|
| Existing applications and packages | `[FACT]` **None.** No `package.json`, no `pnpm-workspace.yaml`, no `src/`, no workspaces. |
| Language and framework choices | `[FACT]` **None made by the repository.** `opencode.jsonc` configures an *editor/agent host*, not an application. Its `$schema` points at `https://opencode.ai/config.json`. |
| Backend / frontend boundaries | `[FACT]` **None.** |
| Database implementation | `[FACT]` **None.** No schema, no migrations, no ORM. `.env.example` contains a MongoDB connection string *for a disabled MCP server*, which is not an application database decision. |
| Authentication | `[FACT]` **None.** No auth library, no key material, no session code. |
| AI model and tool integrations | `[FACT]` Present only as *host configuration*: 4 active MCP servers, 24 disabled, a `/models`-adjacent comment about Ollama, and `INTEGRATIONS.md`'s catalogue. There is no application-level model abstraction. |
| Tests | `[FACT]` **None.** No test runner, no config, no test files. |
| Deployment configuration | `[FACT]` **None.** No Dockerfile, no compose file, no CI workflow, no Terraform, no Kubernetes manifest. |
| Git history | `[FACT]` **Not a git repository.** `git rev-parse --is-inside-work-tree` → `fatal: not a git repository`. There is no history, no branches, no remotes, and therefore no rollback point. |

## 3. Toolchain and environment (verified)

`[FACT]`

| Tool | Result | Relevant to |
|---|---|---|
| OS | Windows 11 Pro, version 10.0.26300, 64-bit | Everything; Windows-first design is mandatory, not a preference |
| CPU | AMD Ryzen 5 5600H, 6 cores / 12 threads, 3.3 GHz | Local model inference (CPU offload), local builds |
| RAM | 24,479,584 KB total visible ≈ **23.3 GiB**; 5,160,164 KB free ≈ **4.9 GiB** at inspection | Local stack sizing. The brief said 16 GB; the machine has more. Free-memory figure shows how tight a "run everything" session is. |
| GPU 1 | **NVIDIA GeForce GTX 1650, 4096 MiB VRAM**, driver 617.14, Turing (compute 7.5) | Local inference budget. The brief said 8 GB VRAM; **it is 4 GB**. |
| GPU 2 | AMD Radeon integrated, 536,870,912 B reported (WMI cap) | Ignore for inference |
| Disks | `C:` 278.5 GB used / **11.9 GB free**; `F:` 50.9 GB used / **133.9 GB free** | Real blocker for pnpm store, Docker images, model weights on `C:` |
| WSL | WSL2, default distribution `docker-desktop` | Docker works; a Linux distro is *not* installed for general dev |
| Node.js | **v24.18.0** (Active LTS) | Matches the recommended baseline; nothing to install |
| npm | 11.16.0 | Bootstrap only |
| pnpm | **not installed** | Phase 1 prerequisite |
| git | 2.56.0.windows.2 | Available, but the project is not initialised as a repo |
| Docker Engine | 29.6.1 (Desktop, WSL2) | Local Postgres/Redis via Compose |
| Ollama | **not installed** | Phase 4 prerequisite |
| Python | 3.14.6 | Not needed by the plan; some MCP servers use it |
| uv / rustc | **not installed** | `uv` affects several MCP servers; `rustc` absence informs the desktop-shell decision (D-11) |
| VS Code | 1.130.0 | Host for the planned extension |
| psql | **not installed** | DB work goes through Docker/Prisma Studio or a managed endpoint |

## 4. Discrepancies between the brief and reality

These are corrections, not opinions. Each one changes a design decision.

| # | Brief assumed | Verified | Impact |
|---|---|---|---|
| C-01 | 16 GB RAM | 23.3 GiB | Fewer RAM constraints than feared for local dev; still not a server. |
| C-02 | 8 GB VRAM | **4 GiB** (GTX 1650, 4096 MiB) | 7B models only with partial CPU offload. Model selection in `09-local-runtime-design.md` is sized for 4 GiB, not 8. |
| C-03 | (unstated) | C: has 11.9 GB free | Dev setup in Phase 1 must redirect pnpm store, Docker data-root and Ollama models to `F:`. A hard prerequisite, not a nicety. |
| C-04 | (unstated) | Not a git repository | Phase 1 task: `git init` + first commit *of the existing four files*, so later work is reviewable and revertible. Requires the owner's consent. |
| C-05 | (unstated) | `rustc` absent, `pnpm` absent, `ollama` absent | Phase 1/4 prerequisites; documented in the roadmap. |

## 5. Assessment of existing material (what is genuinely reusable)

`[FACT]`/`[PROPOSED]`

| Artefact | Verdict | Use in the platform |
|---|---|---|
| `opencode.jsonc` | **Keep unchanged.** It is the *developer's* configuration, not the product's. | Its `permissions` block is a working example of the risk-gating our policy engine needs; its `$schema` and field names are the authoritative V2 config shape for the `local-runner` config template. |
| `INTEGRATIONS.md` | **Keep unchanged.** Verify-before-trust list is honest and still valid. | Becomes the source list for the integration registry's *initial* catalogue (which tools are MCP-servable vs CLI-only). Its "six mechanisms" taxonomy is reused as our integration taxonomy. |
| `AGENTS.md` | **Keep unchanged.** | Its rules (smallest change, ask before destructive, `/review`, `/verify`) become the default *agent profile* shipped with the local runner. |
| `.env.example` | **Keep unchanged.** | Name list seeds our own `.env.example` conventions in Phase 1 (never commit values). |
| MCP server definitions | Reuse the *shape* | The local runner's tool registry needs the same MCP client semantics (stdio + remote, `cmd /c npx` shim on Windows). |

Nothing in the repository is "existing functionality" in the product sense. There
is **no feature to preserve, no test to keep green, no migration to perform.**

## 6. Missing capabilities (everything the product needs)

`[PROPOSED]` Gap list, each with the document that owns it:

| # | Missing capability | Owned by |
|---|---|---|
| G-01 | Workspace/monorepo scaffolding, TS config, lint, format, CI | `15-devops-and-infrastructure.md`, Phase 1 |
| G-02 | Identity, sessions, organizations, membership, RBAC | `03`, `06`, `07`, Phase 2 |
| G-03 | Tenant-isolated persistence + migrations + seeds | `06`, Phase 2 |
| G-04 | Task engine, state machine, event log | `08-agent-engine-design.md`, Phase 3 |
| G-05 | Deterministic approval system bound to action digests | `10-tool-permissions-and-approvals.md`, Phase 3 |
| G-06 | Local runner: device registration, outbound channel, sandbox, workspace permissions | `09-local-runtime-design.md`, Phase 4 |
| G-07 | Local model runtime and provider abstraction | `09`, Phase 4 |
| G-08 | Web dashboard (auth, tasks, approvals, devices, artifacts) | `12-frontend-ux-specification.md`, Phase 5 |
| G-09 | Tool registry, tool adapters, isolated execution | `08`, `10`, Phase 6 |
| G-10 | Browser worker and document worker | `03`, Phase 7 |
| G-11 | Desktop app shell and VS Code extension | `12`, Phase 8 |
| G-12 | Integrations, usage metering, quotas, billing, admin console | `03`, `07`, Phase 9 |
| G-13 | Infrastructure, security hardening, observability, DR | `15`, `16`, Phase 10 |
| G-14 | Load, fault-injection and recovery testing | `13`, `14`, Phase 11 |
| G-15 | Verification engine (claim checking, artifact validation) | `08`, Phase 6 |

## 7. Technical debt and architectural inconsistencies already present

`[FACT]`/`[PROPOSED]` There is no code, so there is no code debt. What exists is
**documentation and configuration debt**, which matters because it will be
copied:

| # | Observation | Action |
|---|---|---|
| T-01 | `INTEGRATIONS.md` §"Verify before you trust" lists entries (grafana, tavily, firecrawl, terraform, neon, gitlab) written from vendor docs but never executed. | `[FACT]` Treat those as unverified. The integration registry must record a `verified_at` per integration and refuse to advertise an unverified one as ready. |
| T-02 | `opencode.jsonc` uses `npx -y <pkg>@latest` for two MCP servers. | `[PROPOSED]` Any *product* dependency on `@latest` is prohibited (supply-chain + reproducibility). Pin exact versions; the dev config may stay as-is. |
| T-03 | The dev config pins nothing: no lockfile, no version manifest. | Phase 1 introduces the lockfile, `engines`, and the pinning policy in `05-technology-stack.md`. |
| T-04 | No `.gitignore`, no license, no README, no CONTRIBUTING. | Phase 1 deliverables. |
| T-05 | Security-relevant gating exists only for the *developer's* shell, with literal patterns (`rm -rf /*`). Not a product control and not a model to copy. | The product's policy engine uses canonicalised, structured actions — see `10`. |

## 8. Security concerns observable before any code exists

`[FACT]`/`[ASSUMPTION]`

| # | Concern | Note |
|---|---|---|
| S-01 | `.env.example` documents `NEON_API_KEY`, `SEMGREP_APP_TOKEN`, `TFE_TOKEN`, `GRAFANA_API_KEY` — all high-value credentials. | `[FACT]` No secret is present in the repo today (all values empty). `[PROPOSED]` Phase 1 adds `.gitignore`, a secret-scanning CI gate (gitleaks/osv-scanner), and a rule that no secret value ever enters the repo or a prompt. |
| S-02 | The planned architecture has a *dual* trust problem: the cloud must not trust the device, and the device must not trust the cloud's commands blindly. | Threat-modelled in `11-security-threat-model.md` (T-DEV-*, T-ORCH-*). |
| S-03 | Agentic execution on a Windows desktop with a shell is the highest-severity risk in the whole system. | `10` and `11`; containment strategy: no shell string construction, allow-listed binaries, job-object containment, workspace root enforcement, per-action approval. |
| S-04 | Unauthenticated MCP/remote endpoints (`deepwiki`, `exa` are used with `oauth: false`) mean a *product* feature could silently forward user content to a third party. | `[PROPOSED]` Every outbound integration is registered with a data-sharing declaration and is off by default for organizations; egress is audited. |
| S-05 | There is no git history, so a bad automated edit cannot be recovered. | Phase 1 initialises git before any code is written. |

## 9. Migration risks

`[FACT]` There is no legacy system, so "migration" means: migrating from *nothing*
to a running platform, plus migrating the developer's existing habits.

| # | Risk | Mitigation |
|---|---|---|
| M-01 | The four existing files get overwritten by scaffolding (`opencode.jsonc` especially). | `[PROPOSED]` Explicitly preserve; the roadmap marks them read-only; `00` records them as untouched. |
| M-02 | Introducing pnpm/Turborepo into an already-configured OpenCode project changes how the host discovers config (nested `opencode.jsonc` per package). | Keep one root config; adopt per-package `opencode.jsonc` only if a package genuinely needs different permissions. |
| M-03 | Model weights, Docker images and package stores filling `C:` (11.9 GB free). | Redirect `PNPM_HOME`/store, Docker data-root, `OLLAMA_MODELS` to `F:`. |
| M-04 | Choosing RC/prerelease versions (Prisma 8, TypeScript 7 tooling) and being forced to migrate mid-build. | Pin stable releases; contract-test the risky boundaries; keep adapters. |
| M-05 | Local-first execution later becoming cloud-first, invalidating capacity and security assumptions. | Architecture keeps execution location a per-task, policy-controlled attribute; both paths exist from Phase 3. |

## 10. Facts vs. assumptions — explicit separation

**Verified now (`[FACT]`):** the four files and their contents; the absence of
any application code, tests, CI, infrastructure and git history; the machine
and toolchain figures in §3; the version numbers in `05-technology-stack.md`
(npm registry, endoflife.date, GitHub releases); the OpenCode V2 surfaces in
`03`, `09` and `10` (official docs: `/build/sdk`, `/build/client`, `/api`,
`/permissions`, `/policies`, `/network`).

**Assumed (`[ASSUMPTION]`):** every load, cost and latency number; user
behaviour (approval rates, task durations, DAU ratios); that Ollama on this
GPU yields usable token rates; that OpenCode V2's permission model is stable
enough to bind to; that the target users own machines comparable to this one.

**Unresolved (`[OPEN]`):** see
[`20-open-questions-and-assumptions.md`](20-open-questions-and-assumptions.md)
— notably the cloud provider choice, the billing/payment provider, whether a
managed model gateway is permitted for regulated customers, and the acceptable
installer size for the desktop app.

## 11. Conclusion of the audit

The repository is a **greenfield project with a well-configured developer
environment and no application**. Planning can therefore choose architecture
freely, but must be honest that no architecture exists yet. The only real
constraints are environmental and I/O-bound: 4 GiB VRAM, 11.9 GB free on `C:`,
no ability to host the production service locally, and a Windows-first
execution environment that is simultaneously the platform's main value and its
main security surface.

Labels: `[FACT]` `[ASSUMPTION]` `[PROPOSED]` `[OPEN]`
