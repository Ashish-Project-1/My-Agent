# Universal Agent

A local-first agent platform: you submit a goal, it plans, executes it with tools
across code / files / browser / data / APIs / local models, asks for approval
before anything risky, verifies the result, and keeps a replayable record of what
happened.

Two deployment shapes, one product:

- **Local-first** — the agent loop, tools and models run on the user's Windows
  machine. Nothing leaves it unless the user configures a remote provider.
- **Cloud control plane (optional)** — identity, tenancy, task records, policy,
  approval routing, audit and usage metering.

> **Status: early.** Phases 0 and 1 of
> [`docs/planning/17-implementation-roadmap.md`](docs/planning/17-implementation-roadmap.md)
> are complete — repo foundation, toolchain, shared contracts and CI. No product
> functionality exists yet. See
> [`docs/implementation-status.md`](docs/implementation-status.md) for what is
> built, what is not, and the open decisions.

## Prerequisites

| | Version | Notes |
|---|---|---|
| Node.js | 24 LTS (`>=24 <25`) | `engines` is enforced with `engine-strict=true` |
| pnpm | 12 (via Corepack) | `packageManager` is pinned; do not use npm or yarn |
| Git | any recent | run `pnpm hooks:install` once after cloning |
| Docker Desktop | any recent | only for `postgres` and `redis` |

## Getting started

```sh
pnpm install
pnpm hooks:install     # installs .githooks/pre-commit (secret scan + env check)
pnpm verify            # lint, env check, build, typecheck, test
```

Local services (optional — nothing in Phase 1 needs them yet):

```sh
docker compose -f infrastructure/docker/docker-compose.yml up -d postgres redis
```

## Commands

| Command | What it does |
|---|---|
| `pnpm build` | Compile every package to `dist/` |
| `pnpm typecheck` | `tsc --noEmit` across `src/` and `test/` |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm lint` / `pnpm format` | Biome check / check with fixes |
| `pnpm generate:openapi` | Regenerate `backend/contracts/openapi.json` from Zod schemas |
| `pnpm scan:secrets` | Scan tracked files for leaked credentials |
| `pnpm check:env` | Assert `.env.example` is intact and secret-free |
| `pnpm verify` | Everything CI runs locally |

## Layout

```
backend/
  contracts/     Zod 4 schemas — single source of truth for API types, OpenAPI, validation
  apps/          api + the four workers (code, browser, document, maintenance)
  modules/       agent-engine, tool-registry, context-engine, policy-engine,
                 verification-engine, event-engine
  database/      Prisma schema and migrations
frontend/        web-app, admin-console, desktop-app, ide-extensions/vscode
runtime/         local-runner, model-runtime, sandbox-manager, browser-runtime
shared/          logger, error-handling, telemetry, test-utilities, typescript-config
infrastructure/  docker compose for local development
docs/planning/   the 22 planning documents; read 00-executive-summary.md first
scripts/         repo-wide checks (secret scan, env drift)
```

Most packages are placeholders at this stage: they exist because
[`docs/planning/03-system-architecture.md`](docs/planning/03-system-architecture.md) §5
places them, and they hold no speculative code.

## Contributing

Run `pnpm verify` before opening a PR — it is exactly what CI runs. Commit
messages are short and imperative. The pre-commit hook runs the secret scan and
the `.env.example` check on every commit; do not bypass it with `--no-verify`.

Security issues go through [`SECURITY.md`](SECURITY.md), not a public issue.
