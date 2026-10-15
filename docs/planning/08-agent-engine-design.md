# 08 — Agent Engine Design

| | |
|---|---|
| Status | Planning only. `[PROPOSED]` throughout. |
| Owner | Agent platform |
| Covers | Planning/execution loop, task state machine, step lifecycle, context, retrieval, model selection, budgets, verification, recovery, idempotency |
| Related | `03` (components), `06` (tables), `07` (contracts), `09` (local execution), `10` (policy/approval), `13` (capacity) |

## 1. The loop in one paragraph

A **task** is created with a goal and constraints, durably persisted and
enqueued. A planner turns the goal into a **plan** of ordered/dependent
**steps**. Each step is either a model turn or a tool call. Before any step
executes, the **policy engine** classifies its concrete risk and returns
`allow`, `ask` or `deny`. `ask` suspends the task in `WAITING_APPROVAL` until a
**digest-bound grant** arrives. Execution happens in a sandbox — on the user's
device by default, in the cloud when the user opts in. Every step's result is
recorded, cost is metered, and the **verification engine** checks the outcome
against declared assertions before the task can complete. Everything is
replayable from an append-only **event log**, and every side effect is guarded
by an **idempotency key** so that a crash, a duplicate delivery or a resumed
task cannot apply the same effect twice.

## 2. Conceptual contracts

### 2.1 Task

| Field | Meaning |
|---|---|
| `id` | UUIDv7 |
| `organizationId`, `createdBy`, `agentSessionId` | Ownership and grouping |
| `goal` | The user's natural-language objective (the only free-text input that steers planning) |
| `constraints` | `maxSteps`, `maxWallClockSeconds`, `maxTokens`, `maxCostMinor`, `deadline`, `requirePlanApproval`, `allowedTools[]`, `deniedTools[]` |
| `executionLocation` | `device` \| `cloud` (policy-controlled, consent-recorded) |
| `deviceId` / `workspaceId` | Where device-located work runs, and inside which boundary |
| `state` | The state machine value (§4) |
| `plan` | Latest plan snapshot (steps with kinds, tools, risk classes, dependency edges) |
| `budgetUsed` | `{ steps, wallClockSeconds, tokensIn, tokensOut, costMinor }` |
| `riskClass` | Highest class observed so far (drives UI warnings) |
| `policyVersion` | Policy version pinned at creation; diagests bind to it |
| `resultSummary`, `error` | Terminal outcome |
| `lease` | `owner` + `expiresAt` (who is currently advancing this task) |

Invariants: `state` is terminal ⇒ `finishedAt` is set and `lease` is released.
`executionLocation = device` ⇒ `deviceId` is set. `state = COMPLETED` ⇒ at least
one verification result exists.

### 2.2 Task step

| Field | Meaning |
|---|---|
| `id`, `taskId`, `seq` | Identity and per-task ordering |
| `kind` | `model` \| `tool` \| `approval` \| `verify` |
| `toolName`, `toolVersion` | Which capability executes it |
| `arguments`, `argumentsDigest` | Canonicalised arguments and their stable digest |
| `riskClass` | `R0`–`R4`, assigned by the risk classifier |
| `state` | §5 |
| `dependsOn[]` | Step `seq` values that must succeed first |
| `attempts`, `maxAttempts` | Retry accounting |
| `leaseId`, `leaseOwner`, `heartbeatAt` | Single-owner execution + reaper visibility |
| `result`, `resultDigest` | Capped, redacted outcome |
| `idempotencyKey` | Effect guard: `sha256(taskId:seq:toolName:argumentsDigest)` |
| `costMinor`, `tokensIn/Out` | Metering |

### 2.3 Approval (see `10` for the full design)

`approval_request` = the question, with a `digest` over
`(action, canonical arguments, target, user, device, task, step, policyVersion,
expiry, nonce)`. `approval_grant` = the answer, single-use, bound to the same
digest, with an expiry and a use counter. Execution re-verifies the digest.

### 2.4 Event

`task_event` = `{ taskId, seq, type, data (redacted, capped), actor, actorId, traceId, createdAt }`.
Append-only. `seq` is allocated inside the same transaction as the state
change, so the log and the state can never disagree about ordering. The event
log is the *explanation*; the task row is the *state*.

## 3. Planning

| Concern | Design |
|---|---|
| Planner input | Goal, constraints, workspace inventory (file tree summary, repo signals), available tool manifests, prior context, budget |
| Planner output | A plan: steps with `kind`, `toolName`, intended `arguments` (may be partial), `dependsOn`, expected effect, and a short rationale. Validated against a Zod schema; an invalid plan fails the task with `plan_invalid` rather than executing partially |
| Plan validation | Every referenced tool must exist in the registry and be in `allowedTools`; the graph must be acyclic; step count ≤ `maxSteps`; estimated cost ≤ remaining budget; each step's arguments must be validatable (missing arguments become a *deferred* step to be resolved at execution time) |
| Re-planning | Allowed when (a) the user rejects a plan, (b) a step fails in a way marked `recoverable`, (c) new information invalidates a later step. Re-planning is itself a recorded event, keeps the same task id, and consumes budget. `[ASSUMPTION]` max 3 re-plans per task by default |
| Plan approval | If `requirePlanApproval` is set (or policy demands it), the task waits in `WAITING_APPROVAL` with the plan digest bound, not each step |
| Model choice for planning | Larger/context-rich model by default (`planner`), smaller model for mechanical steps. Both are configurable per task; local models are the default |

Design note: the plan is a *hypothesis*, not a contract. The engine must
tolerate a wrong plan without corrupting state, which is why each step is
independently validated and independently idempotent.

## 4. Task state machine

States: `QUEUED`, `PLANNING`, `RUNNING`, `WAITING_APPROVAL`, `WAITING_DEVICE`,
`PAUSED`, `VERIFYING`, `COMPLETED`, `FAILED`, `CANCELLED`, `EXPIRED`.
Terminal: `COMPLETED`, `FAILED`, `CANCELLED`, `EXPIRED`.

### 4.1 Legal transitions

| From | To | Trigger | Guards | Effects |
|---|---|---|---|---|
| — | `QUEUED` | `POST /v1/tasks` | quota available; workspace/device visible; policy version resolved | insert task + event + outbox (one tx) |
| `QUEUED` | `PLANNING` | planner claims lease | lease acquired (compare-and-set); state still `QUEUED` | `lease.owner`, `lease.expiresAt`, event |
| `QUEUED` | `CANCELLED` | user cancel | actor is member+ | event; outbox `task.cancelled` |
| `QUEUED` | `EXPIRED` | queue-wait TTL exceeded | `[ASSUMPTION]` default 24 h | event |
| `PLANNING` | `RUNNING` | valid plan persisted | plan schema valid; steps created; budget > 0 | insert steps; set `plan`; event |
| `PLANNING` | `FAILED` | plan invalid / no capable tool / budget 0 | — | error code; event |
| `PLANNING` | `CANCELLED` | user cancel | — | terminate planner cooperatively |
| `RUNNING` | `WAITING_APPROVAL` | policy returns `ask` | approval request created with digest + expiry | insert request; notify; event; release step lease |
| `RUNNING` | `WAITING_DEVICE` | target device offline or lacks capability | device row exists; retry budget left | event; device-wait TTL set |
| `RUNNING` | `PAUSED` | user pause or budget-pause policy | — | release leases; event |
| `RUNNING` | `VERIFYING` | all non-verify steps succeeded | verification configured (default: at least one assertion) | enqueue verify job; event |
| `RUNNING` | `FAILED` | unrecoverable step failure, or budget exhausted | retries exhausted | error code; event; artifacts preserved |
| `RUNNING` | `CANCELLED` | user cancel | — | cooperative stop; running step marked cancelled; event |
| `RUNNING` | `EXPIRED` | wall-clock/deadline exceeded | deadline passed | event; partial artifacts retained |
| `WAITING_APPROVAL` | `RUNNING` | grant received | grant digest matches request; unexpired; unused; approver eligible | mark request granted; event; re-enqueue step |
| `WAITING_APPROVAL` | `FAILED` | denial | reason recorded | event |
| `WAITING_APPROVAL` | `EXPIRED` | approval TTL elapsed | `[ASSUMPTION]` default 24 h | event; request marked expired |
| `WAITING_APPROVAL` | `CANCELLED` | user cancel | — | pending requests cancelled |
| `WAITING_DEVICE` | `RUNNING` | device heartbeat / reconnect | capability satisfied | drain queued commands; event |
| `WAITING_DEVICE` | `EXPIRED` | device-wait TTL elapsed | `[ASSUMPTION]` default 72 h | event; user notified |
| `WAITING_DEVICE` | `CANCELLED` | user cancel | — | event |
| `PAUSED` | `RUNNING` | user resume | budget remains | re-enqueue from checkpoint; event |
| `PAUSED` | `CANCELLED` | user cancel | — | event |
| `VERIFYING` | `RUNNING` | verification failed, retry budget remains | attempts < max | event; re-enqueue failing step (or re-plan) |
| `VERIFYING` | `COMPLETED` | assertions satisfied | ≥ 1 verification result recorded | `finishedAt`; event; artifacts finalised; usage roll-up |
| `VERIFYING` | `FAILED` | assertions unsatisfiable | retries exhausted | error code; event |
| `VERIFYING` | `CANCELLED` | user cancel | — | event |
| any non-terminal | `FAILED` | system fault / invariant violation (failsafe) | — | event; alert if unexpected |

### 4.2 Invalid transitions (must be rejected and logged if attempted)

- Any transition out of a terminal state. (`COMPLETED`/`FAILED`/`CANCELLED`/`EXPIRED` are final; retrying creates a **new task** linked by `retryOf`.)
- `QUEUED → RUNNING` (skipping planning) — only permitted if `requirePlanApproval = false` **and** the plan is produced by the same transaction that claims the lease; otherwise invalid.
- `WAITING_APPROVAL → VERIFYING` / `→ COMPLETED` (a grant must return the task to `RUNNING`).
- `RUNNING → COMPLETED` (verification cannot be skipped; a task with no verification is a bug, not an optimisation).
- `PLANNING → WAITING_APPROVAL` (plan approval is modelled as a *step*, not a task-level jump).
- Any transition where `organizationId` of the actor, task and step disagree.
- `PAUSED → VERIFYING` (resume must pass through `RUNNING`).
- Legal-transition check is centralised in **one** function; every write path calls it. There is no second place where `state` is assigned.

## 5. Step lifecycle

States: `PENDING`, `READY` (dependencies satisfied), `AWAITING_APPROVAL`,
`RUNNING`, `SUCCEEDED`, `FAILED`, `SKIPPED`, `CANCELLED`.

1. **Ready:** dependencies succeeded and budget remains. A step whose
   dependencies cannot succeed is `SKIPPED`, not failed (so the task error
   points at the real cause).
2. **Pre-flight:** schema-validate arguments; canonicalise paths and argv;
   re-check policy with the *concrete* arguments (the plan's decision is not
   binding, because arguments may have been resolved at execution time);
   classify risk; check budgets and egress rules.
3. **Approval:** if `ask`, transition as in §4.
4. **Claim:** compare-and-set a `leaseId`; a lost race means another worker won
   and this delivery is dropped (safe, atomic).
5. **Execute:** bounded by the step's timeout (default `[ASSUMPTION]` 10 min per
   tool step, 5 min per model turn; overridable per tool manifest) and by the
   sandbox's resource caps.
6. **Record:** result (capped, redacted), `resultDigest`, cost, tokens, event;
   the effect idempotency key is written **in the same transaction** as the
   step's terminal state. This is what makes recovery safe.
7. **Heartbeat:** while running, the executor writes `heartbeat_at` every 15 s
   `[ASSUMPTION]`. A missing heartbeat beyond the lease TTL makes the step
   claimable by the reaper.

## 6. Retries, timeouts, cancellation

| Concern | Design |
|---|---|
| Classification | Every failure gets a class: `transient` (network, rate limit, device offline), `invalid_input`, `policy_denied`, `approval_expired`, `budget_exhausted`, `tool_bug`, `model_unavailable`, `verification_failed`, `cancelled`, `timeout`, `sandbox_violation`, `unknown` |
| Retryable | `transient`, `model_unavailable`, `verification_failed` (bounded). Never retried: `policy_denied`, `approval_expired` (a new approval is a new decision), `invalid_input`, `cancelled` |
| Backoff | Exponential with jitter: 2 s, 8 s, 30 s, 2 min, 5 min; `maxAttempts` per step default 3 `[ASSUMPTION]` (tools may declare their own) |
| Non-idempotent tools | A tool declares its idempotency semantics (`idempotent`, `keyed`, `non_idempotent`). **`non_idempotent` tools are never automatically retried after execution started** — they fail with `needs_manual_retry` and the user decides, because retrying could double-post or double-pay |
| Task-level retry | `POST /v1/tasks/{id}/retry` creates a **new task** that starts from a chosen step, reusing the previous task's inputs and workspace checkpoint; it does not mutate the finished task |
| Timeouts | Per step, per task wall clock, per model call (streaming idle timeout), per approval, per device wait, per whole task deadline. Each has a distinct error code so the UI can explain it |
| Cancellation | Cooperative: a cancel request sets a flag and emits an event; the executor checks it between sub-operations and at each streaming chunk boundary; the sandbox kill signal is issued after a grace period (default 10 s `[ASSUMPTION]`); the step is marked `CANCELLED` and the task transits to `CANCELLED`; artifacts produced so far are kept |
| Cancellation of a device step | A `device.command` of kind `cancel` is queued (durable) and also pushed live; if the device is offline the step is cancelled server-side and the device is told to discard the command on reconnect (`expired`) |
| Idempotent cancellation | Cancelling twice is a no-op returning the current state |

## 7. Budgets and loop prevention

| Budget | Default `[ASSUMPTION]` | Enforcement |
|---|---|---|
| Steps | 60 | Planner clamps; runtime refuses to exceed |
| Wall clock | 1 h | Checked at every step boundary; kill at the deadline |
| Tokens | 400k in+out | Counted per model call; on exhaustion the task fails with `budget_exhausted` (checkpoint retained) |
| Cost | plan-dependent | Same as tokens, with a warning threshold at 80% |
| Re-plans | 3 | Hard stop |
| Retries per step | 3 | Hard stop |
| Repeated tool calls | — | Loop detector (§ below) |

**Loop detection** (three independent checks, all recorded as
`loop_detected` events):
1. **Identical action repetition:** the same `(toolName, argumentsDigest)`
   executed ≥ 3 times with equivalent results within one task `[ASSUMPTION]`.
2. **No-progress window:** N consecutive steps where the workspace digest, the
   task's stated sub-goals and the artifact set are all unchanged.
3. **Oscillation:** two actions alternating ≥ 3 times (A, B, A, B, A, B) with no
   net workspace change.

On detection the engine pauses the task, surfaces the loop to the user with the
offending steps, and offers: continue with a raised budget, re-plan with the
loop context, or cancel. It never silently loops forever.

## 8. Verification

`[PROPOSED]` Verification is not optional; a task cannot reach `COMPLETED`
without at least one verification result (invariant 4 in `03` §10).

| Assertion kind | What it proves | Typical source |
|---|---|---|
| `exit_code` | A command succeeded | `npm test`, build, linter |
| `schema` | A produced artifact parses against a declared schema | JSON/CSV/report outputs |
| `digest` | The artifact on disk matches what the step claimed | Workspace integrity |
| `diff_scope` | Only intended paths changed, and they are inside the workspace | Code tasks |
| `file_exists` / `content_match` | The expected change is actually present | Document tasks |
| `test_suite` | Project tests still pass (delegated to the project's own runner) | Code tasks |
| `claim_check` | The model's stated claims are each backed by a step result or an artifact (no unsupported claims in `resultSummary`) | All tasks |
| `policy_conformance` | No side effect occurred without a recorded policy decision | Security check |

Failure handling: verification failure returns to `RUNNING` for bounded
repair attempts; if the same assertion fails twice, the task fails with the
assertion named. Verification never edits the workspace silently — a repair is
a new, policy-checked step.

Honest limitation: `claim_check` is a heuristic, not a proof. It is documented
as such, and the UI shows which claims were verified and which were merely
asserted.

## 9. Context management and retrieval

| Concern | Design |
|---|---|
| Context tiers | (1) system/policy instructions, (2) task goal + constraints, (3) plan and recent step results, (4) workspace/repo index hits, (5) attachments/documents |
| Assembler | `context-engine` builds a bounded prompt: reserve output tokens first, then include tier 1+2 always, then an evidence budget for tiers 3–5 selected by relevance and recency |
| Compaction | When the running context exceeds ~60% `[ASSUMPTION]` of the window, older step results are replaced by their summaries (model-generated, stored as artifacts so nothing is lost) |
| Retrieval | Local index per workspace: chunking (structure-aware for code, paragraph-aware for documents) + embeddings (`nomic-embed-text` class locally), stored in `pgvector` at the cloud or in a local store on the device. Lexical search (ripgrep-style) is a first-class fallback because it is cheap and often better for code |
| Taint tracking | Every chunk carries `taint: trusted | untrusted`. Untrusted content (web pages, third-party documents, tool outputs from external systems) is labelled in the prompt and **cannot** be the sole basis for a `R1`+ action; the policy engine refuses actions whose arguments were derived only from untrusted content unless the user approves |
| Prompt injection posture | The system prompt states that content wrapped in untrusted markers is data, never instructions. Enforcement is not the prompt but the policy engine + approval binding (`10`, `11`) |
| Index freshness | Indexed per workspace with a content-hash ledger; re-index incrementally on change; the index is rebuildable and disposable |
| Privacy | Indexes live on the device by default (so file contents do not have to be uploaded). Cloud-side indexing only for cloud-executed tasks or user-approved uploads |

## 10. Model selection and provider policy

| Concern | Design |
|---|---|
| Roles | `planner` (strong reasoning, larger context), `executor` (tool-calling reliability), `summariser` (cheap, fast), `embedder` (local only by default), `verifier` (can be the planner) |
| Defaults | Local-first: planner = a 7B-class coder model with partial GPU offload if the device can, else 3B-class; executor = 3B-class; summariser = smallest available; embedder = local embeddings model |
| Selection | Per-task override → per-org model policy → platform default. Selection is recorded on the task and on each step so a result is attributable |
| Capability checks | A model must advertise tool-calling and context length before being offered for a role. Unsupported combinations are rejected at task creation (`422 model_capability_mismatch`) |
| Provider policy | `provider.use` style rules (`ADR-007`): an org can deny remote providers, allow-list specific models, cap tokens per task, and require consent per remote call. Local-only is a supported first-class mode (FR-MODEL-02) |
| Failure handling | Provider circuit breaker, timeouts, fallback chain (local → remote if permitted), and a clean failure state rather than a silent retry storm. Fallback that changes execution location requires consent (it is data egress) |
| Cost accounting | Every call records provider, model, tokens in/out and an estimated cost; local calls record zero monetary cost plus compute time |

## 11. Devices, leases and recovery (how state stays consistent)

| Problem | Mechanism |
|---|---|
| Lost job | Durability is in Postgres: the task/step row plus an outbox entry are written **before** the queue sees anything. If Redis loses the job, the outbox republishes, and a periodic reconciliation query finds `QUEUED`/`READY` rows with no live lease and re-enqueues them |
| Duplicate delivery | At-least-once delivery is assumed. The step's `leaseId` compare-and-set makes a duplicate a no-op. Effect keys make re-execution safe |
| Duplicate side effect | `idempotencyKey` per step + tool-declared idempotency semantics. Non-idempotent tools are never auto-retried (§6) |
| Worker crash mid-step | Reaper (`03` §7.6) finds expired leases, checks whether the effect key was committed, and either marks the step succeeded (recovery) or requeues it |
| Device crash / reboot | The task moves to `WAITING_DEVICE`; commands are durable in `device_commands`; on reconnect the device drains by cursor, resuming from the last checkpoint |
| Inconsistent state after restart | `state` is only ever assigned through the single transition function, inside a transaction that also appends the event; a startup check verifies `state` matches the replayed event log for tasks touched since the last check and raises an alert on divergence |
| Zombie running steps | Lease TTL (`[ASSUMPTION]` 3× heartbeat interval) plus the reaper |
| Stuck approval | Approval TTL sweeper expires requests and moves the task to `EXPIRED` with a clear reason |
| Unbounded growth | Budgets (§7), max artifact size, max events per task, and the loop detector |
| Clock skew between device and cloud | All authoritative timestamps are server-generated; device timestamps are recorded as *claims* only. Expiries are computed from server time |
| Split brain between two API replicas | All transitions are DB compare-and-set operations with constraints; no in-memory ownership |

## 12. Duplicate task submission

`[PROPOSED]`

1. `POST /v1/tasks` with an `Idempotency-Key` → identical key + identical body
   digest returns the original task and `Idempotency-Replayed: true`.
2. Same key, different body → `409 idempotency_conflict` (never silently
   substitute).
3. No key provided → the API refuses the create with `400 idempotency_key_required`
   for this endpoint specifically, because task creation is expensive and
   non-idempotent by nature.
4. A *semantic* duplicate (a user clicking twice with different keys) is not
   prevented, but the dashboard shows "a similar task is already running for
   this workspace" as a warning, and per-org concurrency limits cap the blast
   radius.

## 13. Event model summary

| Property | Guarantee |
|---|---|
| Ordering | Strictly monotonic per task (`seq`); no cross-task ordering promise |
| Delivery to clients | SSE with `Last-Event-ID` replay from `task_events`; state is always refetchable, so a dropped stream is never fatal |
| Internal publication | Outbox → publisher → queue/Redis pub-sub; at-least-once, consumers idempotent |
| Persistence | Append-only, redacted on write, size-capped per event (`[ASSUMPTION]` 32 KB) with larger payloads moved to artifacts |
| Retention | Shorter than the task itself (default 30 days `[ASSUMPTION]`), then compacted while the task's `resultSummary` and artifacts remain |
| Types | Listed in `07` §6. Each has a contract and a snapshot test |
| Auditability | Security-relevant transitions additionally write `audit_events` (approval decisions, device revocation, policy changes, operator actions) |

## 14. Worked example (keeps the design honest)

Goal: *"Upgrade this repo's dependencies and show me the diff."*
Execution location: device.

1. `POST /v1/tasks` → `QUEUED`, outbox → `task.plan`.
2. `PLANNING`: planner reads the repo summary, proposes: (1) `fs.read package.json`,
   (2) `shell npm outdated`, (3) `shell npm ci`, (4) `shell npm test`,
   (5) `git diff`, (6) produce artifact.
3. `RUNNING`. Step 1 is `R0` → allowed. Step 2 is a read-only shell command →
   `R0` (allow-listed, non-mutating) → allowed. Step 3 mutates
   `node_modules` and touches the lockfile → `R2` → `WAITING_APPROVAL`; the user
   sees the exact command (`npm ci`, argv array, cwd, workspace) and approves
   for this task.
4. Step 4 runs the test suite. If tests fail, verification returns the task to
   `RUNNING` with the failing output summarized; the planner proposes a bounded
   repair (max 2 attempts) or the task fails with the assertion named.
5. Step 5 `git diff` → `R0`, produces a `diff` artifact.
6. `VERIFYING`: `exit_code` on the test run, `diff_scope` (only the lockfile and
   `package.json` changed), `digest` on the artifact.
7. `COMPLETED`. Usage records written exactly once; events replayable; a
   standing grant "allow `npm ci` in this workspace for 30 days" is offered so
   the user is not asked again on the next upgrade.

Labels: `[FACT]` `[ASSUMPTION]` `[PROPOSED]` `[OPEN]`
