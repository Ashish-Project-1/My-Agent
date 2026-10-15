# Integrations — what actually plugs into OpenCode, and what doesn't

The task was "integrate all of these". Honest answer: **most of the catalogue is not
an OpenCode integration at all.** An editor/agent host can only absorb a tool in four
ways:

| Mechanism | What it means |
| --- | --- |
| **MCP server** | OpenCode launches/connects it; the model gets its tools. The only true "integration". |
| **Plugin / skill** | An OpenCode extension package (`plugins`) or an instruction bundle (`skills`). |
| **Provider** | A model endpoint OpenCode talks to (`providers`). |
| **CLI / CI** | A binary the agent runs via the shell, or a pipeline step. Nothing to install in OpenCode. |
| **Library** | A dependency in *your* app. OpenCode never sees it. |
| **Built-in** | OpenCode already does this. Adding a tool would be duplication. |

Wiring every SaaS product into `opencode.jsonc` would not work and would not help.
`opencode.jsonc` here therefore contains **every tool that is genuinely an MCP server
or plugin**, plus the safety rules and commands that tie them together. Everything else
is below, with the real mechanism named.

Status legend: ✅ active · ⚙️ in config, disabled until you add credentials · 🧩 plugin/skill · 💻 CLI/CI · 📦 library · 🔌 provider · 🧩 built-in · ➖ API/SDK only (cannot be an OpenCode tool)

---

## 1. AI coding agents and code review

| Tool | How it integrates | Status |
| --- | --- | --- |
| Ponytail | OpenCode **skill** — already installed in this session | 🧩 |
| CodeRabbit | GitHub App / CLI (`coderabbit`). Runs on PRs, not in-session | 💻 |
| Qodo | PR App + IDE plugin; no OpenCode surface | ➖ |
| GitHub Copilot | Separate host. Overlaps OpenCode | ➖ |
| Cursor | Separate host. Overlaps OpenCode | ➖ |
| Claude Code | Separate CLI, run via `shell` if you want a second opinion | 💻 |
| Aider | Separate CLI, run via `shell` | 💻 |
| Cline / Roo Code | VS Code extensions. Overlap OpenCode | ➖ |
| OpenHands / SWE-agent | Autonomous runners; drive them from CI | 💻 |
| Continue / Refact.ai / Tabby / Supermaven | IDE completion extensions; no OpenCode surface | ➖ |

> Running several agents that edit the same files concurrently will corrupt work. Use
> OpenCode subagents (`reviewer`) instead of stacking rival agents.

## 2. Documentation, research and codebase intelligence

| Tool | How it integrates | Status |
| --- | --- | --- |
| Context7 | Official OpenCode **plugin** `@upstash/context7-opencode` (bundles MCP + skill) | 🧩 |
| Exa | MCP server `https://mcp.exa.ai/mcp` | ✅ |
| DeepWiki | MCP server `https://mcp.deepwiki.com/mcp` | ✅ |
| Grep by Vercel | MCP server `https://mcp.grep.app` — add it by hand (see below) | ⚙️ |
| GitHub MCP Server | MCP `https://api.githubcopilot.com/mcp/` (OAuth) | ⚙️ |
| GitLab | MCP `https://gitlab.com/api/v4/mcp` (OAuth) | ⚙️ |
| Serena | MCP `uvx --from git+https://github.com/oraios/serena serena start-mcp-server` | ⚙️ |
| Sourcegraph | Self-hosted GraphQL API / `src` CLI | 💻 |
| Tree-sitter | Parser library used by OpenCode's own tooling | 🧩 built-in |
| Language Server Protocol | OpenCode's `lsp` config — definitions, references, diagnostics | 🧩 built-in |
| Firecrawl | MCP `npx firecrawl-mcp` (now keyless for a free tier) | ⚙️ |
| Tavily | MCP `npx tavily-mcp` | ⚙️ |

## 3. Testing and browser automation

| Tool | How it integrates | Status |
| --- | --- | --- |
| Playwright MCP | MCP `npx @playwright/mcp` | ✅ |
| Playwright | Test runner, via `shell` | 💻 |
| Chrome DevTools MCP | MCP `npx chrome-devtools-mcp` | ✅ |
| Vitest / Jest / Testing Library / Cypress / Storybook | Test runners, via `shell` and the `/verify` command | 💻 |
| Chromatic / Percy | CI visual-diff services | 💻 |
| Postman / Bruno / Newman | HTTP clients; Newman runs in CI | 💻 |
| Pact | Contract tests, via `shell` | 💻 |
| k6 / Artillery / JMeter | Load-test CLIs | 💻 |
| Mailpit | Local SMTP container for email flows | 💻 |
| MCP Inspector | Debugs MCP servers — a dev tool, not an agent tool | 💻 |

## 4. Debugging, monitoring and observability

| Tool | How it integrates | Status |
| --- | --- | --- |
| Sentry | MCP `https://mcp.sentry.dev/mcp` (OAuth) | ⚙️ |
| PostHog | MCP `https://mcp.posthog.com/mcp` (OAuth) | ⚙️ |
| Grafana | MCP `uvx mcp-grafana` (+ `GRAFANA_URL`, `GRAFANA_API_KEY`) | ⚙️ |
| OpenTelemetry | Instrumentation **library** in your app | 📦 |
| Prometheus / Loki / Jaeger / SigNoz / Highlight.io | Services; queried via CLI or their own HTTP APIs | 💻 |
| Better Stack / Axiom / Bugsnag / Datadog | Hosted APIs/SDKs; Datadog has a separate community MCP | ➖ |

## 5. Code quality, security and vulnerability scanning

| Tool | How it integrates | Status |
| --- | --- | --- |
| Prettier / Biome / ESLint | OpenCode `formatter` (built-in) + `shell` | 🧩 built-in |
| TypeScript Compiler | `tsc --noEmit` via `shell` / `/verify` | 💻 |
| Semgrep | MCP `uvx semgrep-mcp`, plus `semgrep scan` | ⚙️ |
| Trivy | MCP `trivy mcp` (needs `trivy plugin install mcp`) | ⚙️ |
| Gitleaks / TruffleHog | `shell` — add to `/security` | 💻 |
| npm audit / OSV-Scanner / Grype | `shell` — wired into `/security` | 💻 |
| Snyk / Socket | Snyk CLI; Socket has a community MCP | 💻 |
| CodeQL / SonarQube / Checkov | CI scanners | 💻 |
| OWASP ZAP / Nuclei | Run against your **own** authorized targets only | 💻 |
| Dependabot / Renovate | GitHub config / bot, not an agent tool | 💻 |

## 6. Database, API and backend development

| Tool | How it integrates | Status |
| --- | --- | --- |
| Prisma | MCP `npx prisma mcp` + Prisma Studio via `shell` | ⚙️ |
| Neon | MCP `npx @neondatabase/mcp-server-neon start $NEON_API_KEY` | ⚙️ |
| Supabase | MCP `https://mcp.supabase.com/mcp` (OAuth) | ⚙️ |
| MongoDB MCP | MCP `npx mongodb-mcp-server` | ⚙️ |
| Drizzle ORM | npm **library**; no MCP | 📦 |
| PostgreSQL / Redis / SQLite | Client binaries (`psql`, `redis-cli`, `sqlite3`) via `shell` | 💻 |
| DBeaver | GUI client; use `psql` from the agent instead | 💻 |
| Hasura / GraphQL Inspector / Swagger UI / Scalar / Stoplight | API tooling — CLI or hosted | 💻 |
| pgTAP / Testcontainers | Test libraries; Testcontainers starts real Postgres/Redis in Docker | 📦 |

> Never give an agent unrestricted write access to production data. Restrict the DB
> connection string used by any MCP server to a development database.

## 7. Git, collaboration and project management

| Tool | How it integrates | Status |
| --- | --- | --- |
| GitHub | MCP server (above) | ⚙️ |
| GitHub CLI | `gh` via `shell` — issues, PRs, releases | 💻 |
| GitHub Actions | CI/CD YAML in the repo | 💻 |
| GitLab / GitLab Runner / Bitbucket / Gitea | GitLab MCP above; the rest via CLI/CI | 💻 |
| Linear | MCP `https://mcp.linear.app/mcp` (OAuth) | ⚙️ |
| Jira / Atlassian | MCP `https://mcp.atlassian.com/v2/mcp` (OAuth) | ⚙️ |
| Notion | MCP `https://mcp.notion.com/mcp` (OAuth) | ⚙️ |
| Plane / YouTrack | Self-hosted trackers; REST APIs | ➖ |
| Slack / Discord | Incoming webhooks from CI | 💻 |
| Conventional Commits | Convention + `commitlint` in the repo | 💻 |
| Lefthook / Husky / lint-staged | Git hooks in the repo | 💻 |

## 8. Deployment, infrastructure and DevOps

| Tool | How it integrates | Status |
| --- | --- | --- |
| Vercel CLI | `vercel` via `shell`; hosted MCP `https://mcp.vercel.com` | ⚙️ |
| Railway CLI | `railway mcp` — bundled into the CLI, `railway login` first | ⚙️ |
| Docker / Docker Compose | `shell`. The Docker MCP Gateway/toolkit can front many MCP servers | 💻 |
| Kubernetes | MCP `npx mcp-server-kubernetes`; `kubectl` guarded by permissions | ⚙️ |
| Terraform | MCP `npx terraform-mcp-server`; `apply`/`destroy` are `ask`-gated | ⚙️ |
| OpenTofu / Ansible / Pulumi | CLIs via `shell` | 💻 |
| Helm / Argo CD / Flux CD | CLIs via `shell` | 💻 |
| Cloudflare Wrangler / AWS CLI / gcloud / az | CLIs via `shell` | 💻 |
| Coolify / Caddy / Nginx | Self-hosted; config in the repo | 💻 |
| Pulumi ESC | Env config service | 💻 |

## 9. AI models, local inference and model routing

| Tool | How it integrates | Status |
| --- | --- | --- |
| Ollama | Provider `ollama` — auto-discovered at `127.0.0.1:11434` | 🔌 |
| LM Studio | Provider `lmstudio` — auto-discovered at `127.0.0.1:1234` | 🔌 |
| vLLM | Provider `vllm` — auto-discovered at `127.0.0.1:8000` | 🔌 |
| LiteLLM | OpenAI-compatible provider entry (see models doc) | 🔌 |
| OpenRouter / Anthropic / OpenAI / Google / Mistral / Hugging Face | `providers` config + API key | 🔌 |
| llama.cpp | OpenAI-compatible server behind any of the above | 🔌 |

Local-first for a 16 GB / 8 GB-VRAM Windows machine:

```sh
ollama pull qwen2.5-coder:7b     # then set "model": "ollama/qwen2.5-coder:7b"
```

## 10. UI/UX, design and frontend development

| Tool | How it integrates | Status |
| --- | --- | --- |
| Figma MCP | MCP `https://mcp.figma.com/mcp` (OAuth; needs a Dev/Full seat) | ⚙️ |
| v0 / 21st.dev / Magic UI | Generate/copy components; hosted | ➖ |
| shadcn/ui / Tailwind CSS / Framer Motion / GSAP | npm packages in your app | 📦 |
| Three.js / React Three Fiber | npm packages | 📦 |
| Lighthouse / Unlighthouse | CLIs; or use Chrome DevTools MCP's performance tools | 💻 |
| axe-core / Pa11y | npm packages / CLI; add to `/verify` | 💻 |

## 11. File management, terminal and local developer utilities

| Tool | How it integrates | Status |
| --- | --- | --- |
| ripgrep | OpenCode's `grep` tool is built on ripgrep | 🧩 built-in |
| fd / fzf / jq / yq / delta | CLIs the agent calls via `shell` | 💻 |
| Git | OpenCode's snapshots + the `shell` tool | 🧩 built-in |
| Windows Terminal / PowerShell | Already the shell on this machine | 💻 |
| WSL 2 / Dev Containers | Environment setup, not an agent tool | 💻 |
| MCP Inspector | `npx @modelcontextprotocol/inspector` to debug your MCP servers | 💻 |

## 12. AI agent frameworks and orchestration

| Tool | How it integrates | Status |
| --- | --- | --- |
| OpenCode subagents | `agents` config — the `reviewer` subagent is defined here | 🧩 built-in |
| Vercel AI SDK / Mastra / LangChain / LangGraph / PydanticAI / AutoGen / CrewAI | **Libraries** for building *other* agents. They don't extend OpenCode | 📦 |
| Temporal / Inngest / BullMQ / Trigger.dev | Backend job queues in your app | 📦 |
| n8n | External workflow host; can call the OpenCode API | 💻 |

> Use one orchestration framework. OpenCode + one job queue is usually enough.

## 13. Secrets, identity and permissions

| Tool | How it integrates | Status |
| --- | --- | --- |
| OpenCode `permissions` / `policies` | Enforced in `opencode.jsonc` | 🧩 built-in |
| 1Password CLI / Doppler / Infisical / Vault | CLIs that inject env vars before you start OpenCode | 💻 |
| Keycloak / Auth.js / Clerk / Ory | Auth libraries in your app | 📦 |
| Open Policy Agent | Policy engine in your infra; for the agent use OpenCode `policies` | 💻 |

> Secrets belong in environment variables (`{env:NAME}`), never in prompts, source or
> Git history.

## 14. MCP references

- OpenCode MCP docs — <https://opencode.ai/v2/docs/mcp-servers>
- Context7 OpenCode guide — <https://context7.com/docs/clients/opencode>
- Playwright MCP — <https://github.com/microsoft/playwright-mcp>
- MCP server registry — <https://github.com/modelcontextprotocol/servers>

---

## Enabling a server

1. Add the credential to your environment (see `.env.example`).
2. Delete the `"disabled": true` line for that server in `opencode.jsonc`.
3. `opencode mcp list` to check it connected. For OAuth servers, run `/mcps` in
   OpenCode and sign in when it says `needs authentication`.

Keep the list short. Every connected server adds tools to the model's context, which
costs tokens and can degrade tool selection.

## Verify before you trust

A handful of entries were written from vendor documentation but not executed on this
machine — confirm the command against the vendor's page before relying on them:
`grafana` (`uvx mcp-grafana`), `tavily`/`firecrawl` (npm package names), `terraform`
(`terraform-mcp-server`), `neon` (CLI arguments), `gitlab` (beta endpoint), and the
Figure `grep.app` URL if you add it.

**Confirm these locally:** `npx` on Windows sometimes needs `["cmd", "/c", "npx", ...]`
(noted in `opencode.jsonc`), and Context7's plugin needs one `opencode mcp auth context7`.
