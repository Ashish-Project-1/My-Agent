# Security policy

## Reporting a vulnerability

`[OPEN]` No public reporting channel exists yet (Q-DEV-6 /
`docs/planning/20-open-questions-and-assumptions.md`). Until one is configured,
email the repository owner directly rather than opening a public issue. Do not
disclose details in an issue, pull request, or discussion.

| | |
|---|---|
| Acknowledgement target | 3 business days |
| Triage and remediation target | 14 days for a confirmed issue, scaled by severity |
| Safe harbour | Good-faith research on a system you own or are authorised to test |

Replace this section with a real address and, when the platform ships, a
GitHub Security Advisories (private vulnerability reporting) channel. Nothing in
this repository is published to npm, so there are no downstream consumers to
notify before a fix lands.

## Scope

In scope: code in this repository, the published Docker images, the hosted cloud
control plane (once it exists), and the Windows device agent (once it exists).

Out of scope: dependency advisories already flagged by the toolchain, social
engineering, and denial-of-service against development machines.

## Security posture

Controls that already exist:

- **Secret scanning** runs on every commit (`scripts/scan-secrets.mjs` via
  `.githooks/pre-commit`) and again in CI on all tracked files. Test fixtures
  that intentionally contain secret-shaped strings are opted out per-file with a
  `scan-secrets:allow-file` marker.
- **`.env.example` is checked, not trusted** (`scripts/check-env-example.mjs`):
  it must keep its structure and must never contain a live credential. `.env*`
  is gitignored, `.env.example` is the only tracked env file.
- **Redaction deny-list** in `shared/logger` strips credential- and
  authentication-shaped fields before anything is logged. This is treated as a
  security control, so it is covered by tests that assert each pattern is
  actually redacted.
- **CI is least-privilege**: `permissions: contents: read`, no cloud credentials,
  no long-lived tokens.

Controls that do not exist yet, because the code that needs them does not exist
yet — see `docs/planning/11-security-threat-model.md` §9 for the full set:

- Authentication, sessions, and tenant isolation (Phase 2).
- Approval digests and the policy engine (Phases 5–6).
- Prompt-injection defences, egress controls, and sandboxing (Phases 4, 7, 8).

## Supported versions

Only the `main` branch receives security fixes. There are no releases and no
versioned support windows yet.
