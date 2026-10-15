# 14 — Testing Strategy

| | |
|---|---|
| Status | Planning only. **No test, fixture, CI workflow or pipeline exists.** Every proportion, threshold and target below is `[ASSUMPTION]` until measured. |
| Owner | Quality + Architecture |
| Purpose | Define how we know a change is safe: the levels of testing, the tests the architecture *requires*, the CI gates, and the honest limits of each technique |
| Related | `02` (requirements), `03` (architecture + invariants), `07` (contracts), `08` (engine), `09` (Windows runtime), `10` (policy/approvals), `11` (threat model + gates) |
| Label legend | See `00-executive-summary.md` §"Label legend". |
| Not yet available | `12-ux-and-user-flows.md` and `13-scalability-and-capacity-planning.md` do not exist at the time of writing. Where this document needs them (accessibility flows, load scenarios S1–S3) the dependency is marked `[OPEN]`. |

## 1. Purpose and scope

This document turns the architecture's promises into tests. It does not describe
implemented functionality: `[FACT]` the repository contains no application code
and no test infrastructure. It is a plan for the test suite we will build, and
it is deliberately specific about the tests that the other planning documents
declare *required*.

Two rules govern everything here:

1. **A test exists to reduce a named risk.** Every required test below cites the
   document and ID it proves. A test with no reference is a hobby.
2. **We do not claim results we have not measured.** Coverage numbers, latency
   figures and escape rate are `[ASSUMPTION]` or `[OPEN]` until a run exists.

## 2. Testing philosophy and risk-based approach

The tests are weighted by what actually kills this product. From
`03-system-architecture.md` §9 and `18-risk-register.md`, the catastrophic
outcomes are:

- `R-03` **cross-tenant leak** — one missing tenant predicate exposes every
  customer (`T-AUTHZ-01`).
- `R-01`/`R-02` **prompt injection leading to a destructive or exfiltrating
  action, or a sandbox/path escape on Windows** (`T-LLM-01`, `T-LOC-01`,
  `T-LOC-02`).
- `R-06` **lost or duplicated work** — a crash that drops a task or applies a
  side effect twice (`NFR-REL-02`, `NFR-REL-03`, `NFR-REL-05`).

`[PROPOSED]` Therefore:

| Principle | Consequence for the suite |
|---|---|
| Test the *control*, not the demo | The policy engine, tenant scoping, approval binding, path canonicalisation and the reaper get the deepest tests, not the happy-path UI |
| Determinism is testable and must be tested | The policy engine is a pure function (`10` §3.3); its tests are deterministic by construction and run in CI without a database |
| Untrusted input is a first-class test dimension | Every boundary that accepts content (goal, document, web page, repo, queue payload, device report) has a hostile-input corpus |
| Boundary code is where bugs live | Integration tests use a **real** Postgres 18 and **real** Redis 8 (`03` §5.5); mocks of our own infrastructure are discouraged |
| Windows is not an afterthought | The highest-risk runtime code (job objects, reparse points, service lifecycle) runs on real Windows (`ADR-028`), never Linux-emulated |
| Failures are products too | Every failure path (`deny`, `expired`, `budget_exhausted`, `sandbox_violation`, device offline) has a test asserting the *recorded* state and error code, not merely that it threw |

### 2.1 What "done" means for a change

`[PROPOSED]` A change is done when **all** of the following hold:

1. Lint and typecheck pass (`pnpm lint`, `pnpm typecheck`) with no new suppressions.
2. New behaviour has tests at the correct level (§4); a bug fix has a test that
   fails before the fix and passes after.
3. Affected required tests (§5) pass, including the cross-tenant suite if any
   data-access code changed and the path-escape suite if any canonicalisation
   changed.
4. Any change to canonicalisation, digest fields or the policy grammar is
   flagged as a security change, bumps the policy version, and updates the
   digest fixtures (`10` §3.3).
5. If a wire schema changed, `@ua/contracts` is regenerated, the OpenAPI diff
   gate passes, and the client is regenerated (`07` §7).
6. Coverage floors for the touched package are met (§14), which is a floor, not
   a goal.
7. A `shortcut:` comment is present where a known limitation is left untested,
   naming when to upgrade.

## 3. Test pyramid and proportions

`[ASSUMPTION]` Target distribution by count of test cases (not runtime), for the
whole monorepo:

| Layer | Proportion | Rationale at our scale |
|---|---|---|
| Unit | ~65% | The two most security-critical modules — `policy-engine` and path canonicalisation — are pure functions, so their tests must dominate and be fast |
| Integration (real Postgres + Redis, Testcontainers) | ~20% | Tenant scoping, outbox/queue durability, the reaper and migrations can only be proven against real engines |
| Contract / schema | ~5% | One Zod source of truth; the tests are small but catch the most expensive breakages (wire incompatibility) |
| Component / UI | ~5% | The task workspace and approval inbox are where users judge correctness; a browser test per interactive component |
| E2E web + desktop | ~4% | Expensive and flaky-prone, so reserved for the invariant-level flows (M0 spine, approval round-trip, cross-tenant, recovery) |
| Property / fuzz, perf, migration, manual | ~1% | High value per case, run less often; the path/URL fuzz corpora and the Windows manual matrix live here |

The shape is deliberately flatter at the base than a classic pyramid because
integration cost is bounded by containers and because a large share of the risk
sits at real boundaries rather than in pure logic.

## 4. Test levels and tooling

### 4.1 Unit tests

- **Tooling** `[PROPOSED]` Vitest. `shared/test-utilities` provides a fake clock and seeded randomness.
- **Uniquely proves** deterministic, single-function behaviour: policy evaluation, risk classification, canonicalisation, digest construction, budget arithmetic, state-transition legality (`08` §4.2).
- **Hard rule** the `policy-engine` unit suite has no clock, no network, no database and no model; it passes on an offline laptop in under a second.

### 4.2 Integration tests

- **Tooling** `[PROPOSED]` Testcontainers launching **PostgreSQL 18** and **Redis 8**, with Prisma 7.10 migrations applied before the suite.
- **Uniquely proves** behaviour that only exists when two real systems interact: transaction+outbox atomicity (`ADR-005`), tenant scoping through `TenantScopedDb`, BullMQ delivery semantics, the reaper's compare-and-set lease recovery (`03` §7.6), and RLS once it exists (Phase 10).
- **Rule** workers and the API talk to real containers here; only `CodingEngine` and model providers are mocked (§4.6, §10).

### 4.3 Contract and schema tests

- **Tooling** Zod 4.6 schemas in `@ua/contracts` as the single source of truth; a generator emits OpenAPI 3.1 and `@ua/client` (`07` §7).
- **Uniquely proves** that no payload crosses a boundary unvalidated and that the API's declared surface matches its implemented one.
- **Three blocking checks:** (1) *generation drift* — `contracts/openapi.json` must byte-match generator output, so a manual edit fails the build; (2) *breaking-change diff* — removing a field, tightening a type, making an optional field required or removing an enum value fails unless a version-bump PR documents it (`07` §1); (3) *round-trip plus negative validation* — valid fixtures parse and invalid fixtures are **rejected**, which is the check that usually does not exist.
- **Also covered** queue-payload and device-command schemas validated at **produce and consume** (`03` invariant 10), and event-payload snapshot tests (`08` §13).

### 4.4 Component and UI tests

- **Tooling** `[PROPOSED]` Vitest + Testing Library, plus axe for accessibility (§15). Visual regression is explicitly deferred.
- **Uniquely proves** the task workspace and approval inbox render every task state (`QUEUED`…`EXPIRED`), that the approval dialog shows the exact argv/diff/host before the user decides, and that no dark pattern exists (`10` §9): no pre-selected "allow always", no dismiss-by-default action.

### 4.5 End-to-end web tests

- **Tooling** Playwright 1.64 against the real web app + API + containers.
- **Uniquely proves** the user-visible spine works across processes: sign in → create task → observe SSE progress → approve → see completion without losing the stream on reconnect.
- **SSE assertions** `Last-Event-ID` replay from `seq+1` and the "resync required" backpressure path (`07` §5) are tested here, because no unit test can prove protocol behaviour.

### 4.6 End-to-end desktop tests (Windows)

- **Tooling** `[PROPOSED]` Playwright driving the Electron shell, plus direct process-level tests of `ua-runner`/`ua-sandbox-host`, on a **real Windows** runner (`ADR-028`).
- **Uniquely proves** the Windows-only semantics Linux CI cannot: job-object kill of a process tree, service install/crash-restart, sleep/resume re-claim, reparse-point canonicalisation, revocation wipe, offline buffering (`09` §14).
- **Not emulated** mocks of Windows process semantics are explicitly rejected for the sandbox and path code (`ADR-028`).

### 4.7 Migration tests (forward-only, expand/contract)

- **Tooling** apply migrations to a scratch Postgres 18 container seeded with the *previous* release's schema and data.
- **Uniquely proves** `NFR-MAINT-01`: migrations are forward-only, reviewed and safe while the previous version is live. Two mandatory scenarios: **old code + new schema** (app version N-1 still reads/writes after migration N — expand) and **new code + old schema** (refused cleanly, never silently wrong).
- A migration that is not expand/contract fails the gate. Rollback is provided only where reversible; the strategy is forward-fix, not down-migration.

### 4.8 Property and fuzz tests

- **Tooling** `[PROPOSED]` fast-check (property-based) plus a corpus-driven runner for fixed hostile inputs.
- **Property 1 — policy engine:** for random valid `(action, resource, context, policyVersion)` inputs, evaluation is total (always returns a decision), deterministic (same input ⇒ same output) and monotone (adding a deny never turns a `deny` into an `allow`).
- **Property 2 — path canonicalisation:** for random path strings including Unicode, mixed case, `..`, trailing dots/spaces, reserved device names, ADS, UNC and 8.3 forms, canonicalisation is idempotent and never maps an out-of-workspace path to an in-workspace one.
- **Fixed corpora** complement the properties: the path-escape, prompt-injection, SSRF and malformed-document corpora (§7) are versioned fixtures, each with an expected decision.

### 4.9 Mutation testing (optional signal)

- **Tooling** a JS mutation runner (Stryker-class); `[OPEN]` whether it is affordable in CI. Proposal: nightly, on `policy-engine`, tenant scoping and log redaction only.
- **Uniquely proves** the tests detect faults rather than merely execute lines.
- **Status** optional, non-blocking; a low mutation score with 100% coverage is a warning about the tests, not a gate.

## 5. Required-test matrix

`[PROPOSED]` Every row is a test that must exist and pass at the stated gate
(`M0` / `Ext` first external users / `Paid` paid public release / `Ent`
enterprise readiness — the gates of `11` §9). Rows 1–14 are the required tests
of `10` §11. Rows 15–44 are required by the architecture invariants (`03` §10),
the reliability and security requirements (`02`) and the Windows matrix
(`09` §14).

| ID | Area | What it proves | Level | Doc ref | Gate |
|---|---|---|---|---|---|
| T-POL-01 | Policy determinism | Same action + policy version ⇒ identical decision on repeated runs and on two hosts | Unit + property | `10` §11.1 | M0 |
| T-POL-02 | Rule ordering | Last-match-wins, including "a pattern ending in ` *` also matches the bare command" | Unit | `10` §3.3, §11.2 | M0 |
| T-POL-03 | `R4` unapprovable | No combination of scope, role or standing grant makes an `R4` action executable | Unit + integration | `10` §8, §11.3 | M0 |
| T-POL-04 | Tightening precedence | A broad deny cannot be widened by a narrower allow; floor wins last | Unit | `10` §3.4, §11.4 | M0 |
| T-POL-05 | Scanner failure | An unanalysable shell command returns `ask`/`deny`, never `allow` | Unit | `10` §3.3, §11.10 | Ext |
| T-APPR-01 | Digest binding | Mutating any bound field (one argv char, one path char, one second of expiry, different device, different policy version) invalidates the grant | Unit + integration | `10` §5.1, §11.5 | M0 |
| T-APPR-02 | Replay | A used grant fails; a grant used on a different step/task fails | Integration | `10` §11.6 | M0 |
| T-APPR-03 | Expiry | An expired grant fails and the step returns to *needing approval*, not to allowed | Integration | `10` §11.7 | M0 |
| T-APPR-04 | Approval budget | Exceeding `maxApprovalsPerTask` fails the task with the documented code | Integration | `10` §9, §11.12 | Paid |
| T-APPR-05 | Offline approval vs policy change | An approval decided offline and synced after a policy-version change is rejected | Integration + E2E desktop | `10` §5.4, §11.13 | Ext |
| T-ENG-01 | OpenCode effective policy | The read-back effective policy matches intent, or the session aborts with a security event | Unit (mock) + integration (embedded) | `10` §4, §11.14 | Ext |
| T-TENANT-01 | Policy cross-tenant | Evaluating an action in another org's context fails closed | Unit | `10` §11.11 | M0 |
| T-TENANT-02 | Tenant isolation suite | No API response, query, cache key, SSE event or artifact URL yields another organization's data; foreign id ⇒ 404 | Integration + E2E web | `02` NFR-SEC-01, `11` T-AUTHZ-01 | Ext (RLS backstop: Ent) |
| T-REL-01 | Idempotency / duplicate submission | Same key + same body returns the original task; same key + different body ⇒ `409`; no second execution | Integration | `02` FR-TASK-10 / NFR-REL-03, `08` §12 | M0 |
| T-REL-02 | Task not lost after crash | A task accepted with `201` survives worker crash, deploy and Redis restart (outbox + reconciliation) | Integration + fault injection | `02` NFR-REL-02, `03` §10 inv 7 | M0 |
| T-REL-03 | Worker kill + lease reaper | A step killed mid-execution is recovered: effect-key committed ⇒ `SUCCEEDED`; else requeued from checkpoint | Integration + fault injection | `02` NFR-REL-05, `03` §7.6 | Ext |
| T-REL-04 | Budget exhaustion | Steps/time/tokens/cost limits fail the task cleanly (`budget_exhausted`) with a resumable state and no half-write | Integration | `02` FR-TASK-07 / FR-MODEL-07, `08` §7 | Ext |
| T-LOC-01 | Path-escape decisions | `..`, symlink, junction, case-collision, 8.3 name, ADS and UNC are each *denied and audited* at the policy/decision layer | Unit + property | `10` §11.9, `09` §6 | Ext |
| T-LOC-02 | Sandbox escape corpus (real Windows) | A process attempting to leave the workspace, exceed caps, or reach the host fails, and the failure is reported (expected-failure) | E2E desktop | `09` §8, §14; risk `R-02` | Ext |
| T-LOC-03 | Canonicalisation fuzz | Canonicalisation is idempotent and never maps an outside path to inside (property-based, seeded) | Property | `09` §5–§6, `10` §3.3 | Paid |
| T-SEC-01 | Injection → decision | A document/web page instructing "run this" yields `ask` or `deny`, never execution, and the taint is visible in the decision record | Unit + integration | `10` §11.8, `11` T-LLM-01 | Ext |
| T-SEC-02 | Injection corpus (taint) | The multi-source corpus (document, web page, repo README, issue text, tool output) never escalates privilege; untrusted-only authority cannot produce `R1`+ without approval | Integration | `02` FR-DOC-03 / NFR-SEC-05, `11` §5 | Paid |
| T-SEC-03 | SSRF corpus | `webfetch`/integration calls to localhost, private ranges, link-local metadata IPs, redirects and DNS-rebinding cases are refused | Integration | `11` T-INF-01, §9 | Paid |
| T-SEC-04 | No secret in any sink | No secret value appears in a log line, event payload, artifact, error response or model prompt (assertion over every sink) | Unit + integration | `02` NFR-SEC-02, `11` T-DAT-01 | M0 |
| T-SEC-05 | Injection → approval flow | Injected content that reaches an approval-path action produces a *visible mismatch* between the user's goal and the proposed action; approval binding still holds; no execution without a grant | E2E web + integration | `11` T-LLM-01, `10` §5 | Ext |
| T-DATA-01 | Retention & deletion | A retention sweep deletes task content and artifacts, and verification *proves* both the row and the blob are gone | Integration (`worker-maintenance`) | `02` NFR-PRIV-02, `11` T-DAT-05 | Ext |
| T-PERF-01 | Read latency | p95 server-side read latency under S2 load (see §8) | Perf | `02` NFR-PERF-01 | Ext |
| T-PERF-02 | Event delivery | p95 first event to an attached client < 2 s from production | Perf | `02` NFR-PERF-02 | Ext |
| T-PERF-03 | Approval round-trip | p95 approval-request → device learns decision < 5 s when online | Perf | `02` NFR-PERF-03 | Ext |
| T-PERF-04 | Sizing formula | Measured throughput per replica matches the `13` sizing formula within tolerance | Perf | `02` NFR-PERF-04 | Paid |
| T-PERF-05 | Tenant fairness | One tenant's burst cannot degrade another (per-org rate limits, queue fairness) | Perf | `02` NFR-PERF-05 | Paid |
| T-ARCH-01 | Invariant 1 | No API response or event contains another organization's data | Integration + E2E | `03` §10.1 | M0 |
| T-ARCH-02 | Invariant 2 | No tool executes without a recorded policy decision | Integration | `03` §10.2 | M0 |
| T-ARCH-03 | Invariant 3 | No `R2`/`R3` action executes without a valid, unexpired, single-use grant whose fields match the action | Integration + E2E desktop | `03` §10.3 | M0 |
| T-ARCH-04 | Invariant 4 | No task reaches `COMPLETED` without ≥ 1 verification result | Integration | `03` §10.4 | M0 |
| T-ARCH-05 | Invariant 5 | No external side effect is applied twice for the same idempotency key | Integration + fault injection | `03` §10.5 | Ext |
| T-ARCH-06 | Invariant 6 | Task `state` always equals a replay of its `task_events`; divergence raises an alert | Integration | `03` §10.6, `08` §11 | Ext |
| T-ARCH-07 | Invariant 7 | Killing any single process never leaves a task non-terminal without an owner (lease or TTL) | Fault injection | `03` §10.7 | Ext |
| T-ARCH-08 | Invariant 8 | No secret in a log/event/artifact/prompt except under audited per-use consent | Unit + integration (same runnable as T-SEC-04) | `03` §10.8 | M0 |
| T-ARCH-09 | Invariant 9 | The runner opens no inbound listening socket except loopback | E2E desktop (socket assertion) | `03` §10.9 | Ext |
| T-ARCH-10 | Invariant 10 | Every queue payload is schema-validated at produce *and* consume; a poisoned payload is rejected | Integration | `03` §10.10 | Ext |
| T-MIGR-01 | Migration safety | Old code + new schema works; schema is expand/contract; forward-only | Integration | `02` NFR-MAINT-01, §4.7 | Ext |
| T-CON-01 | OpenAPI drift | Committed `openapi.json` matches generator output; breaking diff is refused | Contract | `07` §7 | M0 |
| T-CON-02 | Route authorisation | Every non-public route denies an unauthenticated request (route enumeration) | Integration | `11` T-AUTHZ-07 | Ext |
| T-A11Y-01 | Accessibility | axe finds no serious/critical violations on the M0 flows and the doc-12 flows | UI + E2E | `02` FR-UI-05 | Ext |
| T-OBS-01 | Trace propagation | One `traceparent` propagates API → queue → worker → device → SSE event | Integration | `02` NFR-OBS-01 | Ext |
| T-WIN-01 | Paths | Traversal, reparse points, 8.3 names, long paths, UNC rejection, case collisions, ADS refusal | E2E desktop | `09` §14 | Ext |
| T-WIN-02 | Process control | Job object kills the whole tree; orphans cleaned on start; graceful stop checkpoints; kill switch leaves nothing running | E2E desktop | `09` §14 | Ext |
| T-WIN-03 | Service lifecycle | Install/uninstall, boot start, bounded crash-restart, upgrade, rollback; upgrade mid-step is refused | E2E desktop | `09` §14 | Ext |
| T-WIN-04 | Sleep/resume | Suspend during a step; resume re-claims work; deadline semantics | E2E desktop | `09` §14 | Paid |
| T-WIN-05 | Model runtime | Inventory, health, load/unload, VRAM behaviour, CPU fallback, missing-model error, digest-mismatch detection | E2E desktop (skipped without GPU) | `09` §14 | Paid |
| T-WIN-06 | Sandbox self-test | The install-time self-test fails closed and disables mutating tools until fixed | E2E desktop | `09` §11, §14 | Ext |
| T-WIN-07 | Revocation | Online and offline revocation paths; cached payloads and tokens wiped | E2E desktop | `09` §13, §14 | Ext |
| T-WIN-08 | Offline operation | Create + run a local task with no network; buffer and replay; approval decided offline then synced | E2E desktop | `09` §4.4, §14 | Paid |
| T-WIN-09 | Antivirus variance | A documented manual matrix (Defender on/off, no exclusions) — acceptance is "works without requiring exclusions" | Manual | `09` §14, `11` T-LOC-12 | Paid |

Notes:

- `T-ARCH-08` and `T-SEC-04` are one runnable assertion set with two reasons to
  exist; both are cited so neither requirement loses its trace.
- `T-WIN-05` is skipped, not failed, on machines without a GPU: model tests must
  never block CI on hardware `09` §10.3 says is optional.
- The M0 column is intentionally short. M0 proves the spine
  (`00` §9) and the floor it must not violate; everything else is earned at the
  gate that `11` §9 assigns it.

## 6. Security testing

`[PROPOSED]` Each tool below maps to a gate in `11` §9. Rows are cumulative: a
later gate inherits every earlier row.

| Technique | Tooling `[PROPOSED]` | What it catches | Gate | Doc ref |
|---|---|---|---|---|
| SAST | semgrep (repo rules + security pack) | Injection sinks, missing tenant predicate in a query, `eval`, raw SQL escape hatches | Ext | `11` §9, ADR-027 |
| Dependency / SCA | osv-scanner + `npm audit` (pnpm audit), lockfile required | Known-CVE dependencies, typosquatting, dependency confusion | Ext | `11` T-INF-03 |
| Secret scanning | gitleaks (pre-commit + CI) | Committed keys, tokens, connection strings, `.env` leakage | Ext | `11` T-INF-05 |
| SBOM | syft per build, stored with the release | Knowing what shipped when a CVE lands | Paid | `11` §9, ADR-027 |
| Container / image scan | trivy on every built image; image signing policy | Base-image CVEs, embedded secrets, misconfigured rootfs | Paid | `11` T-INF-02 |
| IaC / config checks | tfsec-class + bucket-policy and network assertions in CI | Public buckets, public Redis/DB endpoints, over-broad IAM | Paid | `11` T-INF-06, `ADR-013` |
| DAST | authenticated scan of staging (ZAP-baseline class) | Runtime misconfiguration, missing headers, error leakage | Paid | `11` §9 |
| Penetration test | third-party, scope `[OPEN]` | Cross-tenant, approval bypass, sandbox escape, device-channel forgery | Paid (scope `[OPEN]`) | `11` §9 |
| Adversarial corpora | in-repo fixtures (§7) | Injection, path escape, SSRF, malformed input | Ext→Paid | `10` §11, `11` §6 |

Rules for security tests:

1. A security test that fails **blocks the merge**. It is never quarantined
   (§12); if it is flaky, the *test* is wrong and is fixed the same day.
2. Every security-critical module (`policy-engine`, `backend/database` tenant
   scoping, `shared/logger` redaction, `runtime/sandbox-manager`) has a
   `CODEOWNERS` entry requiring a security-owner review.
3. The DAST and penetration scopes are `[OPEN]`; the penetration test is a
   *paid-release* gate, not a v1 blocker, because the surface it would attack
   does not exist yet.

## 7. Untrusted input strategy

`[PROPOSED]` Every input below is hostile by default (`11` §6). Each has a
versioned corpus fixture with an expected decision, and each runs at the level
that can actually observe the control.

| Input class | Threat | Control under test | Corpus assertions |
|---|---|---|---|
| Prompt injection (document) | `T-LLM-01`, FR-DOC-03 | Taint labels; untrusted-only authority cannot authorise `R1`+ | Injected instructions yield `ask`/`deny`; taint recorded |
| Prompt injection (web page) | `T-LLM-01` | Same, plus egress policy on any resulting call | No navigation→action without approval |
| Prompt injection (repo/issue/CI config, `.opencode`-style agent config) | `T-LLM-06` | Repo content never widens permissions | Config never raises the effective policy |
| Hostile web page (SSRF) | `T-INF-01` | Resolve-then-allow-list; private/metadata ranges blocked; no redirect to unlisted host; DNS-rebind pinned | Request refused, audited |
| Malformed documents | `T-LOC-06` | Parse in the document worker/sandbox with caps; macros never executed | Worker returns a typed error, never crashes the pool |
| Oversized payloads | `T-INF-07` | Body ≤ 1 MB, per-artifact and per-task size caps, bounded streams | `413 payload_too_large`; no memory growth |
| Zip bombs / ZIP-slip | `T-LOC-02` | Extraction ratio and total-size caps; entry paths canonicalised | Extraction aborts; no file written outside the temp dir |
| Unicode / path trickery | `T-LOC-02` | Canonicalisation, case-folding, reserved device names, ADS, trailing dots/spaces | Normalised form is inside the workspace or denied |
| Dev/script output (`Read`-like content) | `T-LLM-01` | Tool output is untrusted taint | Cannot justify an action |
| Queue payload | `T-INF-04` | Schema validation at produce and consume | Poisoned payload rejected, job dead-lettered |
| Device report | `B-4` | Results are *claims*; verification engine checks artifacts | Forged result does not satisfy verification |

The posture is structural, not wording-based: the defence is the policy engine
and approval binding (`10`), not a sentence in the system prompt.

## 8. Performance and load testing

`[OPEN]` **Tooling is undecided (`Q-T5`).** Candidate runners: k6 (scriptable,
cheap) or Artillery; browser-heavy scenarios need Playwright-driven load, which
neither does well, so browser load may use a bespoke runner from `scripts/`.
Because `13-scalability-and-capacity-planning.md` does not exist yet, the
scenario *interfaces* are described here and the numbers will be imported from
`13` when written.

| Scenario | Definition (as referenced in `00` §7 and `13`) | Load mix |
|---|---|---|
| **S1** | Reference developer machine (single user, 4 GiB VRAM, local execution) | 1 device, 1–2 concurrent tasks, local models only |
| **S2** | Initial production — `[ASSUMPTION]` 2,000 registered, ~300 DAU | API reads/writes, SSE fan-out, device heartbeats, moderate queue depth |
| **S3** | Scale target — `[ASSUMPTION]` 100,000 registered, ~12,000 DAU | Same mix, sized by the `13` formula; execution stays device-dominant |

Pass/fail criteria map to `02` §5:

| ID | Criterion | Data source |
|---|---|---|
| NFR-PERF-01 | p95 read latency < 300 ms (server-side, excl. client network) | k6-style runner + OTel |
| NFR-PERF-02 | p95 first event to attached client < 2 s | stream timing (SSE + DB `seq` write) |
| NFR-PERF-03 | p95 approval→device decision < 5 s when online | command durability timestamps |
| NFR-PERF-04 | Measured throughput matches the `13` sizing formula within tolerance | per-replica saturation point |
| NFR-PERF-05 | One tenant's burst does not degrade another beyond the agreed budget | two-tenant A/B load |

Soak test: `[PROPOSED]` run S2-equivalent load for **24 h** `[ASSUMPTION]` to
surface leaks that a 15-minute run hides: connection-pool exhaustion, Redis
memory growth, orphaned browser processes, unbounded event growth, lease drift
and SSE socket leaks. Success is not a latency number; it is "no growth trend
in RSS, connections, queue depth or orphaned processes".

Rules:

1. Perf tests never run on the shared CI VM as a merge gate; they run in a
   dedicated environment on demand and on a schedule (`13` owns sizing).
2. A perf result is recorded with the commit, the machine class and the dataset;
   an unlabelled number is not evidence.
3. The S1 profile is also a *product* test, not only a perf test: if the runner
   cannot hold the task within 4 GiB VRAM headroom, the model tier is wrong
   (`09` §10.2).

## 9. Reliability and failure-injection testing

`[PROPOSED]` Each fault is injected deliberately; `tests/fault-injection` owns
them. The assertion is always the *recorded* state and the user-visible outcome.

| Fault | Injection | Expected outcome |
|---|---|---|
| Worker killed mid-task | SIGKILL the process holding a lease | Reaper recovers: effect committed ⇒ `SUCCEEDED`; else requeued from checkpoint (`03` §7.6) |
| Redis restart | Restart the container mid-run | Tasks durable in Postgres; outbox republishes; no lost/duplicate effect |
| DB failover | Promote a replica / drop connections | API returns 503 with a health signal; runner keeps executing claimed work and buffers events (`NFR-REL-06`) |
| Device disconnect mid-approval | Drop the device channel while a grant is pending | Grant persists; on reconnect the command is drained by cursor; no double execution |
| Clock skew on digest expiry | Shift a clock past `expiresAt` / skew device vs cloud | Server-authoritative time wins; expired grant rejected; skew surfaced as a warning (`11` T-INF-12) |
| Queue backlog | Fill the queue beyond a fair share | Per-org fairness holds; depth caps and 429/503 with `Retry-After`; no starvation (`NFR-PERF-05`) |
| Deploy during in-flight tasks | Rolling deploy with running steps | Lease survives; old and new versions both use the single transition function; no task orphaned (`03` inv 7) |
| Poisoned queue payload | Produce schema-invalid job | Dead-lettered, rejected at consume, alert raised (`T-ARCH-10`) |
| Device reboot | Kill the runner mid-step | Task moves to `WAITING_DEVICE`; commands durable; resume from checkpoint (`08` §11) |
| Approval TTL sweep | Let a request expire | Task → `EXPIRED` with a clear reason; sweeper idempotent (`08` §11) |

## 10. Test data and fixture strategy

- **Factories** `[PROPOSED]` typed builders in `shared/test-utilities` for
  `Organization`, `User`, `Device`, `Workspace`, `Task`, `Step`,
  `ApprovalRequest`, `PolicyDocument`. Factories produce valid objects by
  default and take explicit overrides; a test never hand-writes a wire payload.
- **Tenant seed sets** every integration and E2E suite is seeded with **at least
  two organizations** (`O-A`, `O-B`) plus `O-A`'s and `O-B`'s users, devices,
  workspaces and tasks. Cross-tenant assertions require a *foreign* object to
  exist, otherwise the "not visible" test proves nothing.
- **Anonymised fixtures** real-looking but synthetic documents, screenshots and
  repos. **No real user data, ever** (§13). Fixtures containing personal data are
  banned by review.
- **Fake model and embedding providers** `MockProvider` with deterministic
  fixtures (`09` §10.3) and a fake embedder returning stable vectors. A real
  Ollama run is behind an env flag and is skipped otherwise.
- **`MockEngine`** the third `CodingEngine` implementation (`ADR-011`) is the key
  testability seam: unit and integration tests exercise the whole agent loop
  without a real OpenCode process. Contract tests additionally run against the
  embedded SDK.
- **Determinism** all randomness is seeded; all time comes from an injected
  clock (`shared/test-utilities` fake clock). Tests that must not depend on
  ordering assert on sorted sets, not on iteration order.
- **Fixtures for corpora** the injection, SSRF, path-escape and malformed-document
  corpora live as versioned files with an adjacent expected-decision manifest, so
  adding a case is a data change, not a code change.

## 11. CI pipeline

`[PROPOSED]` GitHub Actions (`ADR-027`), one pipeline, staged so cheap checks
fail first. "Blocks merge" means a required status check under branch
protection.

| Stage | Runs | Blocks merge? | Notes |
|---|---|---|---|
| Install + cache | `pnpm install --frozen-lockfile`, restore Turborepo cache | Yes (on failure) | Lockfile required; no `:latest` anywhere |
| Lint | ESLint across the monorepo | Yes | No new suppressions without justification |
| Typecheck | `tsc` per package | Yes | Compiler upgrades are their own PR (`ADR-015`) |
| Unit | Vitest, affected packages | Yes | Fast; the policy suite must stay sub-second |
| Contract | Zod snapshots, OpenAPI drift, generated client match | Yes | `T-CON-01` |
| Integration | Testcontainers Postgres 18 + Redis 8 | Yes | Affected packages on PR; full suite on `main` |
| Migration dry-run | Apply migrations to a scratch DB with old-schema seed | Yes | `T-MIGR-01`, `NFR-MAINT-01` |
| Security scans | semgrep, osv-scanner, gitleaks | Yes (high/critical) | SBOM and image scan at the build stage |
| Build | Build all packages, build images | Yes | Deterministic, pinned bases |
| E2E web | Playwright, sharded, containers | Yes on `main`; on PR for UI/task paths | `T-ARCH-01/03` spine |
| E2E desktop | Playwright/Electron on **real Windows** runner | Yes on `main` and release tags | Windows-only semantics (`ADR-028`) |
| SBOM + image scan | syft + trivy per image | Yes (high/critical) | Gate: Paid |
| Artifact publish | Publish `@ua/contracts`, client, signed images | On tag only | Provenance recorded |

Turborepo caching: tasks are content-addressed by declared inputs and env; the
cache is shared in CI. **Never** cache a task whose result depends on a container
version or on wall-clock behaviour (integration, perf, E2E), because a stale
green is worse than a slow run.

Windows CI runner: `ADR-028` requires a real Windows runner (self-hosted or
on-demand VM) for the `T-WIN-*` rows. Emulating Windows process semantics in
Linux CI is explicitly rejected for the sandbox and path code. The runner holds
no production credentials and tests are hermetic.

Branch protection: required checks above, linear history, one review minimum,
no force-push to protected branches, `CODEOWNERS` review for
`backend/database`, `backend/modules/policy-engine`, `shared/logger` and
`runtime/sandbox-manager`, and signed commits encouraged. Secrets are never
available to fork PRs; deploys use OIDC short-lived credentials (`ADR-027`).

## 12. Flake policy, quarantine and retries

- **Default: no retries.** A retrying suite hides real failures, which is the
  opposite of what this document is for.
- **Allowed retries** only for a test whose flakiness is caused by an *external*
  process we do not control (a network call to a real provider) and which is
  tagged `flaky` with a linked issue. Such a test must not be a gate-bearing
  test.
- **Quarantine** when a required test is genuinely nondeterministic: it moves to
  a non-blocking `quarantine` job, gets an owner and a deadline of **10 working
  days** `[ASSUMPTION]`, and a tracking issue. Quarantine is visible: the count
  of quarantined required tests is a tracked metric and should trend to zero.
- **Security tests are never quarantined** (§6 rule 1). If a security test is
  flaky, the tests or the code are wrong and it is fixed, not silenced.
- **Retry semantics that do not hide failures** a retried pass is reported
  distinctly from a first-attempt pass; the CI summary shows "passed after N
  retries" so a degrading suite is visible even while green.
- **Test ownership** every test file has an owner from `CODEOWNERS` matching the
  code it tests. An owner is expected to fix a broken test within one working
  day or quarantine it with a reason — leaving `main` red is not an option.

## 13. Environments

| Environment | Purpose | Data rules |
|---|---|---|
| Local | Developer loop, `docker compose up` for Postgres + Redis (`NFR-MAINT-02`) | Synthetic factories only; no cloud credentials |
| Ephemeral per-PR | Full stack in CI + preview web app | Seeded, disposable; torn down after the run |
| Staging | Production-shaped, DAST target, migration rehearsal, restore drills | Synthetic or anonymised data only; never production user data |
| Production | Real users | Smoke tests only: unauthenticated health endpoints (`07` §3.7) and a synthetic canary org |

Hard rules: **no real user data in any test environment.** Backups restored into
test environments are restored into an isolated account and scrubbed (`T-DAT-04`
policy). Test machines hold no production secrets. Production smoke tests never
write tenant data and never touch a real user's task.

## 14. Coverage and quality targets

`[ASSUMPTION]` Coverage floors per package. These are floors to prevent
regression, not goals to chase.

| Package | Line/branch floor `[ASSUMPTION]` | Why |
|---|---|---|
| `backend/modules/policy-engine` | 95% branch | The control point of the whole safety model; pure and cheap to test |
| `backend/contracts` | 90% | One schema source of truth; validation branches matter |
| `backend/database` (tenant scoping) | 95% branch | A missing predicate is the catastrophic bug |
| `runtime/sandbox-manager`, path canonicalisation | 90% branch | The escape surface |
| `backend/apps/api` | 80% | Guards, pipes, controllers |
| `backend/apps/workers/*` | 75% | Job handlers; the hard parts are integration-tested |
| `runtime/local-runner` (non-Windows-specific) | 80% | Behaviour tested through Windows E2E separately |
| `runtime/model-runtime` | 70% | Provider adapters; real-provider behaviour is contract-tested |
| `frontend/web-app`, `frontend/admin-console` | 70% | Interactive paths plus a11y |
| `shared/*` | 80% | Logger redaction counts here |
| Monorepo global | 80% lines | A blunt backstop |

**What coverage does NOT measure, and is therefore tested by other means:**

- Cross-tenant isolation (T-TENANT-02) — coverage cannot see a missing predicate.
- Determinism (T-POL-01) — a line can run and still be nondeterministic.
- Windows semantics (T-WIN-*) — untested on Linux means untested (`ADR-028`).
- Prompt-injection resistance (T-SEC-02) — execution is not resistance.
- Migration safety (T-MIGR-01) — running a migration says nothing about old code.
- Resource caps and DoS behaviour (T-PERF-05, T-WIN-02) — a passing test does not
  mean a bounded process.
- Test quality (mutation, §4.9) and accessibility (automated axe finds ~a third
  of issues; the manual checklist covers the rest).

Coverage is reported per package and must not go *down* without an explicit
reason in the PR. A coverage increase produced by assertion-free tests is a
regression in disguise.

## 15. Accessibility testing

`[PROPOSED]` Two halves, because automation is necessary but not sufficient.

**Automated (axe):** run in component tests and in the Playwright E2E suite.
Fails on **serious** and **critical** violations; warns (non-blocking, tracked)
on moderate. Targets `02` FR-UI-05 (WCAG 2.2 AA).

**Manual checklist** for the primary flows — paired with
`12-ux-and-user-flows.md`, which does not exist yet, so the flow list is
`[OPEN]` pending that document. The checklist per flow:

1. Keyboard only: reach and operate every control; visible focus at all times;
   no keyboard trap; a sensible tab order; Escape closes dialogs.
2. Screen reader: the approval dialog announces the action, the target, the diff
   preview and the risk class; live task progress is announced without being
   chatty; errors are announced.
3. Motion and contrast: `prefers-reduced-motion` honoured; text and the risk
   indicators meet AA contrast; state is never conveyed by colour alone.
4. Zoom/reflow: 200% zoom and 320 px width without loss of function.
5. The approval dialog specifically: the risky detail is not hidden behind a
   disclosure, the default focus is not "approve", and no countdown exists
   (`10` §9 — an accessibility and an anti-dark-pattern requirement at once).

## 16. Open questions

| # | Question | Impact | Proposal / default |
|---|---|---|---|
| Q-TEST-1 | Which per-PR integration subset is small enough to stay under the merge-time budget without losing the cross-tenant gate? | Merge latency vs. safety | Run the cross-tenant and policy suites always; everything else on affected-package detection |
| Q-TEST-2 | Is `12-ux-and-user-flows.md` the canonical flow list for the manual a11y checklist? | a11y coverage completeness | Yes, once written; until then the M0 flows are the list |
| Q-TEST-3 | Exact load-test tooling (`Q-T5` in `13`) and where browser load runs | Perf gate credibility | k6 for API/queue; a bespoke Playwright runner for browser; decide before the S2 gate |
| Q-TEST-4 | Is mutation testing affordable in CI, or nightly only? | Test-quality signal vs. cost | Nightly on three packages only, non-blocking |
| Q-TEST-5 | Do we stand up the Windows runner now or at Phase 8 (`ADR-027`)? | Windows coverage timing | As early as the first Windows-only code lands; waiting guarantees untested path code |
| Q-TEST-6 | Penetration-test scope and vendor for the paid-release gate | Release timing, confidence | `[OPEN]`; scope must include cross-tenant, approval bypass, sandbox escape and device-channel forgery |
| Q-TEST-7 | Visual regression testing: adopt now or later? | UI drift detection | Later; explicit non-goal for v1 (`03` §5.1) |
| Q-TEST-8 | How are RLS policies tested — through the app layer only, or with a direct SQL connection that bypasses the app? | Proof of the Phase-10 backstop | Both: app-layer suite plus a direct-connection suite asserting RLS denies a foreign tenant |
| Q-TEST-9 | Do we test the `OpenCodeRemoteEngine` against a real user-run OpenCode server in CI, or only contract-test the client? | Engine-adapter confidence | Contract tests only in CI; a manual matrix on Windows |
| Q-TEST-10 | Data-lake for test result history and flake trending? | Flake visibility | Start with CI summary + a tracked quarantine count; revisit at S2 |

## 17. Traceability

This strategy is the evidence mechanism for the following requirement IDs.

**Reliability:** `NFR-REL-02` (`T-REL-02`), `NFR-REL-03` (`T-REL-01`, `T-ARCH-05`), `NFR-REL-05` (`T-REL-03`), `NFR-REL-06` (fault injection §9).
**Performance and capacity:** `NFR-PERF-01`–`NFR-PERF-05` (`T-PERF-01`–`T-PERF-05`, §8).
**Security and privacy:** `NFR-SEC-01` (`T-TENANT-02`), `NFR-SEC-02` (`T-SEC-04`, `T-ARCH-08`), `NFR-SEC-05` (`T-SEC-01`, `T-SEC-02`), `NFR-SEC-06` (`T-LOC-01`–`T-LOC-03`, `T-WIN-01`), `NFR-PRIV-02` (`T-DATA-01`).
**Observability/operability/maintenance:** `NFR-OBS-01` (`T-OBS-01`), `NFR-MAINT-01` (`T-MIGR-01`), `NFR-MAINT-02` (§13), `NFR-MAINT-03` (`T-WIN-01`–`T-WIN-09`, `ADR-028`).
**Functional:** `FR-TASK-07`, `FR-MODEL-07` (`T-REL-04`), `FR-TASK-10` (`T-REL-01`), `FR-DOC-03` (`T-SEC-01`, `T-SEC-02`), `FR-UI-05` (`T-A11Y-01`).
**Architecture invariants:** all ten `03` §10 mapped to `T-ARCH-01`–`T-ARCH-10`.
**Threat-model controls:** `11` §6 validation methods map to §5; `11` §9 gates to the matrix.

Requirements deliberately **not** automated: manual antivirus matrix (`T-WIN-09`), manual a11y checklist (§15), the penetration test (§6) and the backup restore drill (`T-DAT-04` in `11` §6). These require human sign-off.

Labels: `[FACT]` `[ASSUMPTION]` `[PROPOSED]` `[OPEN]`
