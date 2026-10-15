# 10 — Tool Permissions and Approvals

| | |
|---|---|
| Status | Planning only. `[PROPOSED]`. No policy engine, guard, or approval handler exists. |
| Owner | Security architecture |
| Purpose | Make authorisation **deterministic, inspectable, digest-bound and testable** — the control that lets an AI agent touch a real machine safely |
| Related | `08` (engine), `09` (local runtime), `11` (threat model), `06` (tables), `07` (endpoints) |

## 1. Core principles

| # | Principle | Meaning in practice |
|---|---|---|
| P-1 | **The model proposes; the engine disposes.** | No tool invocation is authorised by model output, a prompt, a document, a web page, or a plugin. Only the policy engine's decision plus (if required) a user grant authorises execution |
| P-2 | **Binary, reproducible decisions.** | Given the same canonical action and policy version, the decision is identical, every time, on every host |
| P-3 | **Policies only tighten.** | A policy can deny or escalate; it can never grant what the built-in floor forbids |
| P-4 | **Approval binds to an exact action, not a vibe.** | The grant covers a digest over the action, canonical arguments, target, user, device, task, step, policy version, nonce and expiry |
| P-5 | **Single use unless explicitly scoped.** | The default grant is one action, one time |
| P-6 | **Fail closed.** | Unknown action, unparseable arguments, unevaluable policy, scanner error, or missing context ⇒ `deny` (or, where a human is present and the action is low-risk, `ask`) — never a silent allow |
| P-7 | **Everything is recorded.** | Every evaluation writes a decision record; every grant, denial and expiry writes an audit event |
| P-8 | **Defence in depth at the device.** | The device re-evaluates policy locally before executing a cloud-issued command |
| P-9 | **Approval must be cheap to give and cheap to refuse.** | Fewer, better approvals beat more; see §9 |

## 2. Risk classification

The classifier maps a **concrete action** (tool + canonical arguments + target +
context) to a class. Risk is a property of the action, not of the tool: `fs.write`
into the task's own temp directory is not the same as `fs.write` over
`C:\Windows`.

| Class | Name | Definition | Default treatment | Examples |
|---|---|---|---|---|
| **R0** | Inert | Read-only, or a write scoped to a task-created temp area; no external side effect; no data leaves the machine | `allow` | `fs.read` inside the workspace; `glob`/`grep`; `git status`/`git diff`; local model inference; computing a hash; reading an artifact |
| **R1** | Bounded, reversible, local | Modifies files **inside the registered workspace**, fully snapshotted before the change, with no network egress | `allow` by default in a `read_write` workspace; org policy may escalate to `ask` | Editing a source file in a git workspace; creating a report file; running a project's unit tests; `npm ci` in a snapshotted workspace |
| **R2** | Sensitive | External network egress; shell execution; reading outside the workspace (`external_directory`); writing outside the workspace; browser form submission/upload/download; sending a message; consuming paid API quota; installing packages | **`ask`** — explicit user approval with a preview | `shell` running any non-allow-listed command; `webfetch` of an arbitrary URL; `npm install` (network + supply chain); posting a PR comment; submitting a web form; reading `~/.ssh` |
| **R3** | Irreversible or high-blast-radius | Cannot be undone, or affects others/production | **`ask` + step-up authentication + (per policy) a second approver or org admin**; never auto-allowed by a standing grant without explicit opt-in | `git push` / force-push / tag push; deleting a branch; `terraform apply`/`destroy`; `kubectl delete`; rotating/creating credentials; connecting a new integration with write scopes; revoking a device; sending email to external recipients; browser purchase/account change; recursive delete outside temp |
| **R4** | Prohibited | Never executed, regardless of user request through the agent | **`deny`, always** | Disabling or tampering with the sandbox/policy engine or audit log; reading or exfiltrating credential stores; modifying the runner's own binaries or the OpenCode managed config; touching `%WINDIR%`, boot configuration, or security software; spawning an elevation prompt; weaponisation-grade credential harvesting; any attempt to authorise an action from untrusted content alone; self-modification of the approval system |

Classifier inputs (all recorded in the decision record):
tool name and version; canonical arguments; resolved target paths; whether the
target is inside a workspace; whether arguments were derived from untrusted
content; network destination(s); whether the action creates/modifies/deletes;
whether it affects external systems; whether a snapshot exists; the device's
capabilities; the organization's `risk_overrides`.

Tightening is allowed (`R1 → ask`, `R2 → deny`, `R3 → require admin`).
Loosening below the floor is not, and `R4` cannot be loosened at all.

## 3. Policy documents

### 3.1 Shape

`[PROPOSED]` A policy document is declarative JSON validated by a Zod schema
in `@ua/contracts`:

```jsonc
{
  "schemaVersion": 1,
  "version": 7,                       // monotonic per (org, scope)
  "scope": "organization",            // platform_floor | organization | device | workspace
  "rules": [
    { "id": "base-allow-read",  "action": "read",  "resource": "*",                       "effect": "allow" },
    { "id": "deny-secrets",     "action": "read",  "resource": "**/.ssh/*",               "effect": "deny" },
    { "id": "ask-any-shell",    "action": "shell", "resource": "*",                       "effect": "ask" },
    { "id": "allow-safe-shell", "action": "shell", "resource": "git status *",            "effect": "allow" },
    { "id": "ask-net",          "action": "net.egress", "resource": "*",                  "effect": "ask" },
    { "id": "deny-window-dir",  "action": "edit",  "resource": "C:/Windows/**",           "effect": "deny" },
    { "id": "ask-external",     "action": "external_directory", "resource": "*",          "effect": "ask" }
  ],
  "riskOverrides": [ { "action": "shell", "resource": "git push *", "class": "R3", "requiresStepUp": true } ],
  "budgets": { "maxApprovalsPerTask": 6, "approvalTtlSeconds": 86400 },
  "createdBy": "018f…", "createdAt": "2026-10-15T09:00:00Z", "note": "Tightened shell use"
}
```

### 3.2 Actions and resources

Actions follow the same vocabulary the repository's existing OpenCode
configuration already uses `[FACT]`, extended for platform-level concerns:

| Action | Resource format | Notes |
|---|---|---|
| `read`, `edit`, `glob`, `grep` | Path pattern (`*`, `?`, `**` semantics defined by us) | Paths are canonicalised before matching; matching is case-insensitive on Windows |
| `shell` | Command pattern, matched against the **argv array joined canonically** | A compound command is split by the scanner and each part evaluated (worst decision wins) |
| `external_directory` | Directory boundary pattern | Evaluated *before* `read`/`edit` for targets outside a registered workspace |
| `net.egress` | `host` or `host:port` pattern | New action; not present in OpenCode, needed for org egress policy |
| `webfetch`, `websearch` | URL or query pattern | Inherited naming from the existing config's vocabulary |
| `browser.*` (`navigate`, `click`, `type`, `submit`, `upload`, `download`) | Domain pattern (+ element descriptor for submit) | Write-ish browser actions are `R2`+ |
| `integration.use` | `provider` or `provider:scope` | Connecting/using an external service |
| `model.use` | `local:<model>` or `<provider>:<model>` | Remote model use is `R2` (egress) by default |
| `code.engine` | Engine id | Which coding engine may be invoked |
| `git.*` (`push`, `commit`, `branch.delete`, `tag`) | Remote/ref pattern | Push-class actions are `R3` |
| `device.*` (`revoke`, `grant.revoke`, `policy.update`) | Device id pattern | `R3` |

### 3.3 Evaluation algorithm (deterministic)

```
evaluate(action, resource, context) -> { decision, matchedRuleId, policyVersion, reasons[] }

1. Reject if the action or resource is malformed or unresolvable (schema-invalid) -> DENY (invalid_action)
2. Compute the concrete risk class: base class from the tool manifest, escalated by
   context flags (outside workspace, network egress, destructive, external effect,
   untrusted-derived arguments) and by riskOverrides -> class
3. If class == R4 -> DENY (prohibited), regardless of any rule
4. Merge the policy chain in precedence order (5.4), collecting rules with their scope
5. Walk the merged rule list; the LAST matching rule decides
   (broad rules first, exceptions after — matching the documented OpenCode semantics)
6. If no rule matched: use the class default (R0/R1 -> allow, R2/R3 -> ask, R4 -> deny)
7. Apply the R3 augmentation: ask + step-up + (if configured) second approver
8. Apply the hard floor: if the floor denies, the result is DENY even if a rule allowed
9. Record: decision, matchedRuleId, class, policyVersion, contextDigest, reasons
```

Rules that keep this testable:
- The engine is a **pure function**; no clock, no network, no model, no random
  values (the nonce is generated by the caller and passed in).
- Canonicalisation is centralised (one module): path resolution and case
  folding; argv normalisation (no shell string when argv is available); JSON
  key sorting; number/whitespace normalisation.
- Any change to canonicalisation is a security change: it invalidates existing
  digests and grants and must be released with a policy version bump.
- A scanner that cannot analyse a shell command returns `scanner_error`, which
  is treated as `ask` (never `allow`).

### 3.4 Precedence (narrowest wins for settings; broadest wins for tightening)

| Order (later overrides earlier) | Source |
|---|---|
| 1 | Platform floor (hard-coded, R4 list, security controls) — cannot be overridden downward |
| 2 | Organization policy |
| 3 | Device/profile policy |
| 4 | Workspace policy |
| 5 | Task-level constraints (`allowedTools`, `deniedTools`) |
| 6 | Saved standing grants (a *permission*, not a policy: applies only where policy says `ask`) |

Note the deliberate asymmetry: configuration around behaviour is nearest-wins,
but *tightening* is applied last, so a broad org policy that says "deny shell for
everyone" cannot be widened by a workspace file. This mirrors the documented
behaviour of OpenCode V2 `policies`, where broader configuration is evaluated
later and managed configuration has the final say `[FACT]`.

## 4. Mapping to OpenCode V2 (our engine adapter)

`[FACT]` Verified from the OpenCode V2 documentation on 2026-10-15:
- `permissions` are ordered per-agent rules with `action`/`resource`/`effect`
  (`allow|deny|ask`), **last match wins**, `*` and `?` wildcards, `ask` is the
  default when nothing matches, and `external_directory` is checked before
  `read`/`edit` for paths outside the Location/worktree.
- `policies` are binary (`allow|deny`), never prompt, only ever **tighten**,
  use `provider.use` / `tool.use` (`<action>:<value>`) / `integration.use`
  (`mcp:<server>`, `skill:<id>`, `plugin:<target>`), and take precedence from
  broader sources: a connected OpenCode Console workspace wins over managed
  preferences, which win over system, global and direct project config.

Our adapter (`ADR-011`) does the following:

| Our concept | OpenCode mapping | Rule |
|---|---|---|
| Risk class + policy decision | Generated `permissions` entries for the session | We never ship an OpenCode config that is *more permissive* than our decision |
| `R4` and hard denials | `policies` with `tool.use` deny | Binary denial, not a prompt — so it cannot be clicked away |
| Provider restrictions (`model.use`, org allow-lists) | `policies` with `provider.use` | Local-only mode is expressed as `provider.use: * -> deny` except local providers |
| MCP/tool/skill availability | `policies` with `integration.use` | A denied integration is never loaded, so its tools never enter the model's context |
| `ask` decisions | **We do not use OpenCode's `ask` prompts as the UI.** Our adapter intercepts them and routes them to our approval system | Two approval UIs would be an audit hole and a UX disaster |
| Managed configuration | Rendered into the highest-precedence location available (managed/system config) so a project-local or user-edited OpenCode config cannot widen permissions | The adapter **verifies** the effective policy after start-up and fails the session if the effective policy is wider than intended |

`[PROPOSED]` A startup verification step calls the OpenCode API to read back the
effective agent/tool configuration and compares it to the intended policy. A
mismatch aborts the session with a security event rather than running with
unknown permissions.

## 5. Approval binding

### 5.1 What the digest covers

`actionDigest = sha256(canonicalJson({ … }))` over **all** of:

| Field | Why it is bound |
|---|---|
| `action` + `actionVersion` | The semantics of the operation |
| `toolName`, `toolVersion` | A tool upgrade must not silently reuse an old approval |
| `argumentsDigest` (canonical JSON of argv/args) | The exact command/parameters |
| `targetDigests[]` (canonical resolved paths / URLs / refs) | The exact object(s) affected |
| `effectPreviewDigest` | What the user was shown (diff/summary) matches what runs |
| `userId` | The approving human |
| `deviceId` | The machine the action runs on |
| `organizationId` | Tenant |
| `taskId`, `stepId` | The exact execution slot |
| `policyVersion` | The rules in force at approval time |
| `riskClass` | The classification the user saw |
| `nonce` | Uniqueness; prevents replay across identical actions |
| `issuedAt`, `expiresAt` | Time-boxed validity |
| `maxUses` | Single-use by default |

### 5.2 Grant lifecycle

1. Policy returns `ask` → create `approval_requests` (state `pending`) with the
   digest, an effect preview, an expiry (default 24 h `[ASSUMPTION]`), and a
   notification to the requester (and any additional approver the policy names).
2. The step transitions to `AWAITING_APPROVAL`; its lease is released so no
   worker is blocked.
3. The user sees the exact action (`argv` array, cwd, resolved targets, diff
   preview, destination host, risk reasoning) and chooses approve/deny, with an
   optional scope.
4. On approve, the server issues an `approval_grants` row plus a **signed token**
   (HMAC with a server-held key, or an asymmetric signature so the device can
   verify offline) and publishes `approval.granted`.
5. The executor, immediately before acting, verifies: signature, expiry,
   `useCount < maxUses`, **all bound fields match the action about to run**, and
   that the device/user/task/step are the ones in the grant. Any mismatch ⇒
   reject with a security audit event.
6. The grant is consumed (`useCount++`) inside the same transaction that records
   the step's terminal state and its effect idempotency key.
7. Denial ⇒ step fails with `approval_denied`; expiry ⇒ `approval_expired` and
   the task expires with a clear reason.

### 5.3 Scopes

| Scope | Covers | Constraints |
|---|---|---|
| `once` (default) | Exactly one action, one time | `maxUses = 1` |
| `minutes(n)` | The same action repeated within `n` minutes | `n ≤ 60` `[ASSUMPTION]`; still digest-bound |
| `task` | The same action within this task | Same digest fields except `stepId`; useful for repeated test runs |
| `standing` | A tool/pattern within a workspace until an expiry | Example: `shell` with an argv allow-list inside workspace `W`, expires in 30 days; listed in the UI; revocable; **never available for `R3` unless the org explicitly enables it** |
| `plan` | Approving a plan (not individual steps) | Only when `requirePlanApproval` is set and the plan's step digests are bound together; any step whose concrete arguments deviate from the plan requires its own approval |

Persistent grants are org-scoped data (`approval_grants` with `maxUses > 1`),
visible in `GET /v1/orgs/{orgId}/grants`, and revocable. They are *permissions*,
never policies: if the policy says `deny`, a standing grant does nothing.

### 5.4 Offline approvals

If the local tray UI answers an approval while offline, the decision is written
locally with the server-provided (and locally verified) digest, then synced. The
synced record preserves the original decision time and is marked `synced_at`.
The grant is validated on sync against the current policy version; if the policy
changed in the meantime, the grant is rejected and the step must be re-approved
(a policy version is part of the digest, so this is automatic).

## 6. Immediately before executing a sensitive operation

`[PROPOSED]` A mandatory pre-execution control sequence, in order, for every
step with class ≥ `R1` (and stricter checks for `R2`/`R3`):

| # | Control | Failure behaviour |
|---|---|---|
| 1 | **Re-parse and re-validate** arguments against the tool manifest schema | Reject `invalid_arguments` |
| 2 | **Re-canonicalise** paths and recompute `argumentsDigest`/`targetDigests` | Mismatch ⇒ `digest_mismatch` security event |
| 3 | **Re-check the workspace boundary** on the *resolved* path (after following reparse points) | Outside ⇒ require `external_directory` grant ⇒ else deny |
| 4 | **Sanity-check the target** still exists and is what was approved (inode/path/ref identity, TOCTOU window minimised by opening handles before acting where the platform allows) | Drift ⇒ re-request approval |
| 5 | **Verify the grant** (signature, expiry, use count, every bound field) | Reject `grant_invalid` |
| 6 | **Re-evaluate policy** with the concrete arguments and current policy version | Deny/ask wins over the earlier decision |
| 7 | **Re-check budgets** (steps, time, tokens, cost) and quota | Fail with `budget_exhausted`/`quota_exceeded` |
| 8 | **Enforce the egress policy** for the destination host(s), including redirects | Deny with `egress_denied` |
| 9 | **Scrub secrets** from the environment and from any argument that would be echoed into logs/prompts | Strip + audit `secret_scrubbed` |
| 10 | **Confirm the sandbox profile** matches the step's needs (network, resources, workspace mounts) | Refuse to run unsandboxed for ≥ `R1` |
| 11 | **Create the snapshot/checkpoint** required for reversibility (for mutating steps in a workspace) | No snapshot ⇒ escalate to `ask` |
| 12 | **Claim the lease** (compare-and-set) so exactly one executor runs this | Lost race ⇒ drop delivery |
| 13 | **Write the decision record + audit event** *before* the effect | Audit failure ⇒ refuse to execute (fail closed) |

After execution: record the result digest, the effect idempotency key, the
artifact metadata and the step's terminal state **in one transaction**, then
report to the model a redacted, size-capped result.

For the highest-risk classes the local runner repeats controls 2, 3, 5, 6 and 10
independently, because it does not fully trust the cloud's evaluation.

## 7. Tool manifest (the contract that makes the above possible)

`[PROPOSED]` Every tool declares, and the registry validates:

```jsonc
{
  "name": "shell", "version": "1.0.0",
  "description": "Run an allow-listed executable with an explicit argument vector",
  "inputSchema": { /* Zod-generated JSON Schema */ },
  "risk": { "baseClass": "R2",
            "escalateWhen": ["egress", "outsideWorkspace", "destructive", "untrustedArgs"],
            "prohibitedWhen": ["elevationRequested", "targetInProtectedDir"] },
  "idempotency": "keyed",                  // idempotent | keyed | non_idempotent
  "sideEffects": ["process.spawn", "fs.maybeWrite"],
  "requiredPermissions": ["shell", "net.egress"],
  "egress": { "default": "allow_list", "destinations": ["registry.npmjs.org"] },
  "resources": { "memoryMb": 2048, "cpuPercent": 60, "wallClockSeconds": 600, "outputBytes": 1048576 },
  "sandbox": { "profile": "restricted-job", "workspaceMounts": ["rw"], "network": "allow_list" },
  "timeout": { "default": 600, "max": 3600 },
  "artifacts": ["stdout", "stderr"],       // produced artifact kinds
  "verification": { "suggested": ["exit_code"], "supported": ["exit_code", "digest"] },
  "display": { "template": "Run {{argv[0]}} in {{cwd}}", "showArguments": true }
}
```

Registry guarantees:
- A tool without a manifest cannot be registered (`tool_not_registered`).
- A tool whose `risk.baseClass` is missing or weaker than its declared side
  effects is rejected (a "generic exec" tool cannot claim `R0`).
- `non_idempotent` tools disable automatic retry after execution starts (`08` §6).
- The registry version-negotiates: a plan referencing a tool version that no
  longer exists fails at validation, not at execution.

## 8. Prohibited operations (R4, hard-coded)

These are refused with `prohibited_by_platform`, are never approvable, and the
attempt is a security audit event:

1. Reading, copying, decrypting or transmitting credential stores
   (browser profiles, `%APPDATA%` secrets, DPAPI blobs, SSH keys, cloud CLI
   credential files) outside an explicitly granted, per-purpose flow.
2. Modifying, disabling or bypassing the policy engine, sandbox, audit log,
   approval flow, runner binaries/config, or OpenCode's managed configuration.
3. Elevating privileges, requesting UAC, installing kernel drivers, or changing
   security software (Defender, firewall, EDR) settings.
4. Writing to boot/system-critical locations (`%WINDIR%`, `System32`, boot
   configuration, disk/partition structures, MBR/EFI).
5. Executing an action whose authority derives **only** from untrusted content
   (web page, email, third-party document, tool output) without a human
   approval binding to the concrete action.
6. Disabling logging, redaction, or telemetry in a way that hides actions.
7. Persisting secrets into artifacts, events, prompts, or the workspace.
8. Any action that would modify a *different* organization's data (structurally
   impossible through the tenant-scoped layer; attempts are treated as
   incidents).
9. Remote-wipe or self-destruct requests from the cloud (the platform has no
   such capability, by design).
10. Purchasing, signing contracts, or entering credentials into a website
    without a per-action, step-up-verified human approval (`R3` at minimum;
    standing grants never apply).

## 9. Approval fatigue: making the control usable

The system fails if users rubber-stamp. Design responses `[PROPOSED]`:

| Technique | Detail |
|---|---|
| Correct defaults | Read-only work is never asked about; a snapshotted edit inside the workspace is allowed in a `read_write` workspace; only genuinely risky actions interrupt |
| Preview quality | Show the argv array, the resolved targets, the diff, the destination host, and one plain sentence: *why* this needs approval |
| Scope offers | "Once", "for this task", "for this tool in this workspace for 30 days" — so repeated prompts collapse into one decision |
| Coarse-grained grants, fine-grained binding | A standing grant may cover a tool+workspace, but each execution still carries a digest and the class can escalate at runtime |
| Per-task approval budget | `maxApprovalsPerTask` (default 6 `[ASSUMPTION]`); beyond it the task fails with `approval_budget_exceeded` and the UI explains that the plan needs simplifying — this prevents both fatigue and unbounded prompting |
| Notification quality | Approvals reach the user promptly: in-app + desktop/tray notification + optional push/webhook (FR-NOTIF-02). Pending approvals appear in a single inbox across tasks and devices |
| Deny is a first-class action | Denial is one click, records a reason optionally, and the planner gets the denial as structured feedback so it can propose an alternative instead of re-asking the same thing |
| No dark patterns | The approval dialog never pre-selects "allow always", never buries the risky detail, uses no countdown, and cannot be dismissed by pressing the value the agent wants |
| Escalation visibility | If a step escalates (`R1 → R2`) mid-task, the user sees *why* the classification changed |

## 10. Decision and audit records

| Record | Content | Retention |
|---|---|---|
| `policy_decisions` | Every evaluation: action, resource, class, decision, matched rule, policy version, context digest, timestamp | 400 days `[ASSUMPTION]` |
| `audit_events` | Approvals requested/granted/denied/expired, grant revoked, policy changed, device revoked, R4 attempt, digest mismatch, sandbox violation, secret scrubbed, operator action, impersonation | 400 days default, longer by contract |
| `task_events` | The user-facing narrative (approval requested, granted, step succeeded) | 30 days `[ASSUMPTION]` |
| Security-event stream | A separate high-signal stream (R4 attempts, digest mismatches, sandbox violations, cross-tenant attempt, auth abuse) feeding alerting | 400 days |

`[PROPOSED]` Security events are alertable per organization (email/webhook) and
in-platform, because a user needs to know if their agent tried to do something
prohibited.

## 11. Testability requirements (each of these is a required test)

1. Determinism: the same action + policy version yields the same decision on
   repeated runs and on two different hosts.
2. Last-match-wins ordering, including the "pattern ending in ` *` also matches
   the bare command" behaviour.
3. `R4` is unapprovable: no combination of scope, role or standing grant allows it.
4. Policy tightening precedence: a broader deny cannot be widened by a narrower allow.
5. Digest binding: mutating any single bound field (one argv character, one
   letter of a path, one second of expiry, a different device, a different
   policy version) invalidates the grant.
6. Replay: reusing a used grant fails; using it on a different step fails.
7. Expiry: an expired grant fails; the step returns to needing approval, not to allowed.
8. Prompt-injection: a document/web page instructing "run this command" produces
   either an `ask` or a `deny` — never an execution — and the taint is visible in
   the decision record.
9. Path escapes: `..`, symlink, junction, case-collision, 8.3 name, ADS,
   UNC — each must be denied and audited.
10. Scanner failure ⇒ `ask` (or `deny` for `R3`), never `allow`.
11. Cross-tenant: evaluating an action in another org's context fails closed.
12. Budget: exceeding `maxApprovalsPerTask` fails the task with the documented code.
13. Offline approval synced after a policy change is rejected.
14. OpenCode effective-policy readback matches the intended policy, or the
    session aborts.

## 12. Open questions

| # | Question | Impact |
|---|---|---|
| Q-P1 | Should `R3` standing grants ever be allowed (e.g. `git push` in one repo for 7 days)? Proposal: opt-in per org, admin-set, with a mandatory notification per use. | Usability vs. blast radius |
| Q-P2 | Default `maxApprovalsPerTask` and approval TTL values | UX and safety tuning; needs real usage data |
| Q-P3 | Does the second-approver requirement for `R3` apply to solo/personal orgs (where it is impossible)? | Cannot require two humans for a team of one |
| Q-P4 | Can a *device* hold a policy of its own that an admin cannot override? Proposal: yes for tightening, never for loosening. | Enterprise MDM-style control |
| Q-P5 | How much shell parsing do we own vs. delegate to OpenCode's scanner (`experimental.portable_shell_scanner`)? | Correctness + maintenance of the highest-risk classifier |

Labels: `[FACT]` `[ASSUMPTION]` `[PROPOSED]` `[OPEN]`
