# AGENTS.md

Instructions for AI agents working in this repository.

## Ground rules

- Prefer the smallest change that fully solves the task. No speculative
  abstraction, no "for later" code, no new dependency for a few lines.
- Match the surrounding code's structure, naming and formatting.
- Never invent an API. If a library's current usage matters, look it up (Context7,
  vendor docs) instead of guessing from memory.
- Run the project's formatter, tests and typecheck before calling work done.

## Safety

- Ask before anything destructive or irreversible: `git push`, `git reset --hard`,
  production deploys, database migrations, `terraform apply`, `kubectl delete`.
- Never paste secrets, tokens or connection strings into source, commits or prompts.
  Set them via environment variables (see `.env.example`).

## Reviewing

Use the `reviewer` subagent (`/review`) for a read-only pass. It reports findings
most severe first, each with `file:line` and a one-line fix.

## Tools

- Current framework/library documentation: Context7 (`use context7 for <topic>`).
- Repo architecture questions: the `deepwiki` MCP server.
- Browser verification of UI changes: `playwright` / `chrome-devtools` MCP servers.
- Web research: `exa` MCP server or the built-in websearch.
- Local security scans: `/security`.
