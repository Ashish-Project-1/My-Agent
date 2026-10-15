# 19 — Production Readiness Checklist

| | |
|---|---|
| Status | Planning only. **Nothing in this checklist has been executed, tested or verified.** |
| Owner | Architecture + Operations (named role per item, §1.3) |
| Scope | Gate evidence, go/no-go process, launch rehearsal, rollback, post-launch review |
| Honesty rule | Every item in this document is **not-yet-satisfied**. No item may be presented as done until it has an evidence artifact attached. |
| Related | `00` (risks R-01…R-08, M0), `02` (FR/NFR IDs), `05` (stack), `06` (retention, migrations, pooling), `10` (14 required tests), `11` (§9 gates, RR-1…RR-8), `17` (phases and gates), `18`, `20` |

## 1. Purpose, honest status, and how to use this checklist

### 1.1 What this document is

`[PROPOSED]` This is the gate checklist that must be walked, item by item, before
anyone is allowed to call a milestone "ready". It collects, in one place, the
things that must be *proven with an artifact* before M0 is demoed, before the
first external user is let in, before anyone pays, and before an enterprise
contract can be signed.

It is deliberately written as a checklist of **unverified work**, not a report of
achievements. It is also the place where consciously accepted risks are named,
so that "we shipped without X" is always a recorded decision with an owner, never
an accident.

### 1.2 Honest status — read this first

`[FACT]` This repository currently contains **no application code and no deployed
infrastructure**. `00` §2 records that it holds four files (`AGENTS.md`,
`INTEGRATIONS.md`, `opencode.jsonc`, `.env.example`) and is not even a git
repository. There is no `package.json`, no source tree, no CI, no Terraform, no
database, and no environment of any kind.

Therefore:

- **Every row in every table below is marked `not done — [OPEN]`.** None of them is
  satisfied. This is not a hedge; it is the literal state of the repository.
- No item may be flipped to "done" without an attached evidence artifact (§2.2).
- Where a row references a document, it references a *plan*, not an implementation.
- A readiness gate cannot even be *scheduled* until the phases in `01` §G-01…G-15
  and `00` §9/§11 have produced buildable software. The checklist exists so that
  the work is defined before it starts, not so that it can be ticked now.

### 1.3 Readiness-owner roles

`[PROPOSED]` No team exists yet; these are the accountability hats that must be
assigned to real humans before the first gate. Until a name is filled in, the
role is a `[OPEN]`.

| Role | Accountable for | Gate authority |
|---|---|---|
| **Release Owner** | The go/no-go call, launch rehearsal, the launch-day runbook, the rollback decision | Declares a gate ready; single sign-off for M0 and first-external |
| **Security Owner** | §3.2, §3.3, §3.4, §3.10; residual-risk register §4; penetration test | Veto on any security-related gate |
| **Data & Privacy Owner** | §3.6, §3.12; PII inventory, retention/deletion verification, DPA, records of processing | Veto on paid/enterprise gates for privacy items |
| **Local Runtime Owner** | §3.5; sandbox, workspace boundaries, auto-update, revocation, Windows matrix | Sign-off before any mutating tool ships |
| **Ops / Platform Owner** | §3.7, §3.8, §3.13, §3.15; SLOs, on-call, runbooks, DR drills, cost | Owns the alert→runbook link audit |
| **Product Owner** | §3.1; functional completeness against `02` | Confirms scope for each gate |
| **QA / Test Owner** | Evidence completeness; traceability to `21`; §3.9 load evidence | Keeps the evidence index |
| **Accessibility Owner** | §3.11; WCAG 2.2 AA verification for the flows in `12` | Sign-off before paid release |
| **FinOps Owner** | §3.15; budgets, teardown, reserved-capacity decisions | Sign-off before scale spend |
| **Legal / Compliance Owner** | §3.12; policy, DPA, sub-processors, residency, SOC 2 track `[OPEN]` | Veto on enterprise gate for contractual items |

### 1.4 How to use the checklist

`[PROPOSED]`

1. Pick the gate you are aiming at (`M0` → `first-external` → `paid` → `enterprise`).
   A gate is only in scope once the previous gate has been declared ready.
2. Read every row whose **Gate** column is that gate or earlier.
3. For each row, attach the evidence artifact named, or open an entry in §4
   (accepted risk) naming the owner and the revisit trigger.
4. The Release Owner signs the gate only when every row is either evidenced or
   recorded as an accepted risk. A row that is neither is a **no-go**.
5. Do not delete or weaken a row to pass a gate. Change it in a reviewed commit to
   this document, with a reason — this file is the audit trail of the decision.

### 1.5 Where the roadmap is

`[FACT]` This checklist was drafted in parallel with `17-implementation-roadmap.md`
and that document now exists. Phase numbering here follows `17` (phases 0–11),
with the gate names `M0` / `first-external` / `paid` / `enterprise` mapped to the
phase exits in `17` §3 and §15:

| Gate | Roadmap phase exit (`17`) |
|---|---|
| `M0` | Phase 5 |
| `first-external` | Phase 8 |
| `paid` | Phase 9 |
| `enterprise` | Phase 11 |

Where this checklist's gate columns disagree with `17`, `17` is authoritative for
the phase and this document is authoritative for the evidence. Any future change
to either must be made in both, and `Q-PR-9` (resolved below) exists to record
that reconciliation.

## 2. Go / no-go process

### 2.1 Who can declare a gate ready

`[PROPOSED]` A gate is declared ready by the **Release Owner**, after the Security
Owner (and, for paid/enterprise, the Data & Privacy and Legal owners) have given a
recorded sign-off. One person holds the call; the specialists hold a veto within
their domain. No gate is declared by consensus by absence, by a chat message, or
by a passing CI run alone — it is a dated, written decision stored with the
evidence index.

### 2.2 Required evidence for any "done" claim

`[PROPOSED]` The minimum bar for marking any row done:

| Evidence type | Acceptable form |
|---|---|
| Test result | CI job name + run link + green status on the release commit; for security suites, the suite is a **required** check, not advisory |
| Measurement | A recorded number with the method, the environment, and the date (e.g. p95 latency, restore duration, hash cost) |
| Manual verification | A signed-off script with steps, observed result, and who ran it (used only where automation is impossible, e.g. the Windows/antivirus matrix) |
| Configuration assertion | An automated check that reads the live/declared config and fails on drift (e.g. bucket is private, no public DB endpoint) |
| Document | The artifact itself, versioned in the repo (runbook, DPA, PII inventory, records of processing) |

An item with no artifact is `not done`. "It worked on my machine" is not evidence.

### 2.3 Launch rehearsal

`[PROPOSED]` Before first-external and again before paid release, run the full
launch as a dry run in a production-shaped (or staging) environment:

1. Restore the latest backup into staging (§3.8) and run migrations against it.
2. Execute the launch-day sequence in §5 end to end, timed.
3. Deliberately trigger at least one rollback (§5 decision tree) and time the recovery.
4. Trigger a page from a synthetic alert and confirm the on-call reaches the runbook (§3.7).
5. Record every deviation from the runbook; fix the runbook, not the memory of it.

The rehearsal is not optional and its output is the "rehearsal record" evidence
artifact referenced by several rows below.

### 2.4 The rule: unproven is a no-go, or a named accepted risk

`[PROPOSED]` The single operating rule of this document:

> An item that has not been proven is either a **no-go** (the gate does not open),
> or it is an **explicitly accepted risk** with a named owner and a revisit
> trigger recorded in §4.

There is no third state. "We'll watch it" without a name, a control and a trigger
is not a decision.

### 2.5 Gate definitions

`[PROPOSED]`

| Gate | Name | Meaning | Preceded by |
|---|---|---|---|
| `M0` | First end-to-end | Milestone M0 from `00` §9 and `17` §5: one task, one tool, one approval, end to end, on a clean Windows machine. Internal only. | Phase 5 (exit criterion, `17` §5) |
| `first-external` | First external users | A small, invited group outside the team uses the product. | M0 + security floor from `11` §9 |
| `paid` | Paid public release | Money changes hands; self-serve sign-up. | first-external + `11` §9 paid gate |
| `enterprise` | Enterprise readiness | SSO/SCIM, contractual retention/audit, residency option. | paid + `11` §9 enterprise gate |

`[ASSUMPTION]` Availability target at all cloud gates is 99.9% (`NFR-REL-01`).
`[ASSUMPTION]` RPO ≤ 15 min / RTO ≤ 4 h apply from Phase 10 (`NFR-REL-04`); before
that, RPO ≤ 24 h / RTO ≤ 24 h with a documented manual restore.

## 3. Gate checklists

Column meaning: **Gate** = the earliest gate at which the item must be satisfied.
**Status** is uniformly `not done — [OPEN]` because nothing has been built (§1.2).

### 3.1 Functional completeness vs. `02`

| ID | Item | Why it matters | How it is verified | Evidence artifact | Gate | Status |
|---|---|---|---|---|---|---|
| PR-FN-01 | Every **P0** `FR-*` is implemented end to end | M0 is defined by the P0 set in `02` §4 | Per-FR mapping to a passing test in `21-requirements-traceability.md` | Traceability matrix + M0 demo recording | M0 | not done — `[OPEN]` |
| PR-FN-02 | M0 acceptance runs on a **clean Windows machine** | The target platform is Windows; a dev-box demo proves nothing | Rehearsal on a fresh VM using only the signed installer | M0 rehearsal record | M0 | not done — `[OPEN]` |
| PR-FN-03 | The core loop is complete: plan → policy → approval → execute → verify → event log → UI (`FR-TASK-02/03/04`, `FR-APPR-03/04`, `FR-TOOL-03/04`) | This is the spine (`00` §9); everything else is an extension of it | End-to-end Playwright + device-simulator test | E2E test report | M0 | not done — `[OPEN]` |
| PR-FN-04 | All **P1** `FR-*` satisfied before paid release | P1 is the paid scope by definition (`02` §4 priority) | Traceability matrix showing every P1 FR has a passing test | Traceability matrix | paid | not done — `[OPEN]` |
| PR-FN-06 | Success metrics from `02` §9 are instrumented and reported from real data | You cannot manage completion rate, approvals/task or install rate if they are not measured | Metrics dashboards + one week of real numbers | Metrics export | paid | not done — `[OPEN]` |
| PR-FN-07 | No **P2** item leaked into a shipped gate without an explicit scope decision; deliberately out-of-scope items (`02` §7) confirmed absent | Prevents accidental half-support and quiet scope creep | Scope review against `02` §4/§7 and `00` §11 | Scope sign-off | paid | not done — `[OPEN]` |

### 3.2 Multi-tenancy and isolation

| ID | Item | Why it matters | How it is verified | Evidence artifact | Gate | Status |
|---|---|---|---|---|---|---|
| PR-MT-01 | Every tenant-owned table has a non-nullable `organization_id` (`06` §1) | A missing tenant column is the seed of a cross-tenant leak (R-03) | Schema test asserts the column and its nullability on every table | Schema test output | M0 | not done — `[OPEN]` |
| PR-MT-02 | `TenantScopedDb` fails closed: a query without org context throws | The guard must be structural, not a per-route convention | Unit test that a tenantless query fails; lint rule against raw `prisma.<model>` | CI job output | M0 | not done — `[OPEN]` |
| PR-MT-03 | Dedicated cross-tenant test suite is green and is a **required** CI gate (`NFR-SEC-01`, `T-AUTHZ-01`) | This is the single most dangerous bug class (`11` §4.2) | Required check in CI; foreign-id reads/writes return 404 | CI job output | first-external | not done — `[OPEN]` |
| PR-MT-04 | Postgres RLS policies applied as DB-side backstop (`17` Phase 9) | Defence in depth: the DB refuses even if the app is wrong | RLS policies reviewed + a test that bypasses the app layer | RLS test report | paid | not done — `[OPEN]` |
| PR-MT-05 | Every cache key includes `organizationId`; no CDN caching of authenticated responses (`T-DAT-07`) | Cross-tenant cache bleed is silent and hard to notice | Cache-key unit tests + CDN/config assertion | CI + config report | first-external | not done — `[OPEN]` |
| PR-MT-08 | A cross-tenant attempt raises a security event and an alert; the one-writer-per-workspace lock holds (`09` §6) | Detection matters as much as prevention; two tasks mutating one directory corrupts user work | Fault-injection + concurrency tests | Test report | paid | not done — `[OPEN]` |

### 3.3 Authentication, authorisation, sessions, device identity

| ID | Item | Why it matters | How it is verified | Evidence artifact | Gate | Status |
|---|---|---|---|---|---|---|
| PR-AU-01 | Argon2id parameters measured at the target cost (`FR-AUTH-01`) | Too cheap is weak; too slow is a DoS | Benchmark on reference hardware (~250 ms `[ASSUMPTION]`) | Hash-cost measurement | M0 | not done — `[OPEN]` |
| PR-AU-02 | Session cookie flags asserted: `HttpOnly`, `Secure`, `SameSite=Lax` (`FR-AUTH-03`) | Baseline session hygiene | Header assertion in CI | CI job output | M0 | not done — `[OPEN]` |
| PR-AU-03 | Session rotation on login and privilege change; per-session revocation works | Fixation and hijack defence (`T-AUTH-02`) | Session lifecycle tests | Test report | first-external | not done — `[OPEN]` |
| PR-AU-04 | Refresh-token rotation with reuse detection revokes the family (`FR-AUTH-08`) | Stolen refresh tokens are a common takeover path (`T-AUTH-03`) | Test replaying an old refresh token | Test report | first-external | not done — `[OPEN]` |
| PR-AU-06 | CSRF protection on unsafe methods (`T-AUTH-04`) | Cookie-auth without CSRF is a live vulnerability | E2E CSRF test | Test report | first-external | not done — `[OPEN]` |
| PR-AU-07 | Device-authorisation code resists brute force: entropy, ≤10 min expiry, single use, rate-limited (`FR-AUTH-07`, `T-AUTH-08`) | This code is an authentication primitive | Brute-force simulation test | Test report | first-external | not done — `[OPEN]` |
| PR-AU-08 | Device private key is non-exportable on Windows (`FR-DEV-01`, `T-AUTH-07`) | Exportable keys turn device theft into cloud access | Windows test asserting export fails | Manual test record | first-external | not done — `[OPEN]` |
| PR-AU-09 | Device revocation cascades: grants revoked, commands expired, channel closed, tokens invalidated (`FR-DEV-08`) | Revocation that is partial is not revocation | Online + offline revocation tests | Test report | first-external | not done — `[OPEN]` |
| PR-AU-10 | TOTP with recovery codes, enforceable per org (`FR-AUTH-04`) | Second factor is table stakes for team/paid gates | Enrollment/recovery tests | Test report | paid | not done — `[OPEN]` |
| PR-AU-13 | Role changes cannot be mass-assigned, and OIDC federation has documented account-linking rules (`T-AUTHZ-03`, `FR-AUTH-05`) | Both are privilege-escalation / takeover paths | Mass-assignment + linking/conflict tests | Test report | paid | not done — `[OPEN]` |

### 3.4 Approvals and policy engine correctness

`[FACT]` `10` §11 defines **14 required tests**. `[PROPOSED]` All 14 are rows below
(PR-AP-01…PR-AP-14) and all 14 are blocking for `M0` or `first-external` as marked;
none may be waived without a §4 record.

| ID | Item | Why it matters | How it is verified | Evidence artifact | Gate | Status |
|---|---|---|---|---|---|---|
| PR-AP-01 | **Determinism**: same action + policy version ⇒ same decision, on repeated runs and two hosts (`10` §11.1) | The engine is the safety spine; non-determinism makes it unauditable | Property/repeat test across hosts | Test report | M0 | not done — `[OPEN]` |
| PR-AP-02 | **Last-match-wins** ordering, including pattern ending in ` *` matching the bare command (`10` §11.2) | An ordering bug silently widens permissions | Table-driven rule tests | Test report | M0 | not done — `[OPEN]` |
| PR-AP-03 | **R4 unapprovable**: no scope, role or standing grant allows it (`10` §11.3) | The prohibited floor must be absolute | Exhaustive attempt test | Test report | M0 | not done — `[OPEN]` |
| PR-AP-04 | **Tightening precedence**: a broader deny cannot be widened by a narrower allow (`10` §11.4) | Enterprise policy guarantees depend on it | Precedence test matrix | Test report | first-external | not done — `[OPEN]` |
| PR-AP-05 | **Digest binding**: mutating any bound field (argv char, path letter, second, device, policy version) invalidates the grant (`10` §11.5) | Approval must bind to an exact action, not a vibe (`FR-APPR-04`) | Field-by-field mutation test | Test report | M0 | not done — `[OPEN]` |
| PR-AP-06 | **Replay**: reusing a used grant, or using it on another step, fails (`10` §11.6) | Single-use is the default promise | Replay test | Test report | M0 | not done — `[OPEN]` |
| PR-AP-07 | **Expiry**: expired grant fails and the step returns to *needs approval*, never to allowed (`10` §11.7) | Expiry must not default to allow | Expiry test | Test report | first-external | not done — `[OPEN]` |
| PR-AP-08 | **Prompt injection**: a document/page instructing "run this" yields ask or deny, never execution, and taint is visible in the decision record (`10` §11.8) | Primary agent risk (R-01, T-LLM-01) | Injection corpus test | Test report | first-external | not done — `[OPEN]` |
| PR-AP-09 | **Path escapes** (`..`, symlink, junction, case collision, 8.3, ADS, UNC) each denied and audited (`10` §11.9) | Escape = host compromise (R-02) | Path-escape matrix on real Windows | Test report | first-external | not done — `[OPEN]` |
| PR-AP-10 | **Scanner failure ⇒ ask** (or deny for R3), never allow (`10` §11.10) | An unparseable command must not become a permitted one | Fault-injection on the scanner | Test report | first-external | not done — `[OPEN]` |
| PR-AP-11 | **Cross-tenant evaluation fails closed** (`10` §11.11) | Policy must not leak across tenants | Cross-tenant policy test | Test report | first-external | not done — `[OPEN]` |
| PR-AP-12 | **Budget**: exceeding `maxApprovalsPerTask` fails the task with the documented code (`10` §11.12) | Prevents unbounded prompting and fatigue (R-07) | Budget test | Test report | first-external | not done — `[OPEN]` |
| PR-AP-13 | **Offline approval synced after a policy change is rejected** (`10` §11.13) | Late sync must re-validate against current policy | Offline-sync test | Test report | paid | not done — `[OPEN]` |
| PR-AP-14 | **OpenCode effective-policy readback matches intent**, or the session aborts (`10` §11.14, §4) | Guards against a wider-than-intended effective config | Readback test | Test report | first-external | not done — `[OPEN]` |
| PR-AP-15 | The 13-step pre-execution control sequence (`10` §6) runs in order and each failure code is observable | The controls, not just the decision, must be right | Each failure code exercised by a test | Test report | paid | not done — `[OPEN]` |
| PR-AP-16 | Approval fatigue is measured against target (median approvals/task ≤ 2) (`02` §9, R-07) | The control fails if users rubber-stamp | Real-usage metric after first-external | Metrics export | paid | not done — `[OPEN]` |

### 3.5 Local runner: sandbox, workspace boundaries, auto-update, revocation, Windows matrix

| ID | Item | Why it matters | How it is verified | Evidence artifact | Gate | Status |
|---|---|---|---|---|---|---|
| PR-LR-01 | Sandbox self-test passes at install and on demand; a failing self-test **disables mutating tools** (`09` §11) | Fail-closed is the only acceptable default | Expected-failure escape tests | Self-test report | M0 | not done — `[OPEN]` |
| PR-LR-02 | Workspace enforcement: a write outside a registered root fails (`FR-CODE-01`, `NFR-SEC-06`) | The foundational local guarantee | Test attempting an out-of-root write | Test report | M0 | not done — `[OPEN]` |
| PR-LR-03 | Full path-escape matrix denied (see `09` §6, §14) | Windows reparse points are the classic escape (T-LOC-02) | Path matrix on real Windows | Test report | first-external | not done — `[OPEN]` |
| PR-LR-04 | Job object kills the entire process tree; orphans cleaned on service start (`09` §5) | Runaway children exhaust the machine (R-06) | Process-control tests | Test report | first-external | not done — `[OPEN]` |
| PR-LR-06 | Auto-update verifies signature, supports rollback, and never updates mid-step (`FR-DEV-09`, `09` §11) | A bad update is a fleet-wide outage or a supply-chain hole | Update/rollback tests | Test report | paid | not done — `[OPEN]` |
| PR-LR-07 | Device revocation wipes cached task payloads and tokens, online and offline (`09` §13) | A revoked device must stop being a data source | Revocation wipe tests | Test report | first-external | not done — `[OPEN]` |
| PR-LR-08 | Documented Windows matrix (Win 11 build(s), Defender on/off) with **no required exclusions** | Antivirus interference causes silent failures (T-LOC-12) | Manual matrix execution | Matrix record | first-external | not done — `[OPEN]` |
| PR-LR-10 | The runner opens **no inbound socket except loopback** (`FR-DEV-03`, invariant 9) | Outbound-only is a hard architectural promise (A-6) | Socket-exposure assertion on a running runner | Test report | first-external | not done — `[OPEN]` |
| PR-LR-11 | Offline buffer bounded; replay idempotent (`09` §4) | Replays must not duplicate effects | Buffer/replay tests | Test report | paid | not done — `[OPEN]` |
| PR-LR-12 | Shell steps use an argv allow-list, with no shell string interpolation (`FR-CODE-03`) | Interpolation is the injection door | Argument-hygiene tests | Test report | M0 | not done — `[OPEN]` |

### 3.6 Data protection: encryption, secrets, retention, export, PII inventory

| ID | Item | Why it matters | How it is verified | Evidence artifact | Gate | Status |
|---|---|---|---|---|---|---|
| PR-DP-01 | Envelope encryption (KMS-wrapped DEKs) for every `*_enc` field (`06` §6, `NFR-SEC-02`) | Secrets at rest must be useless if the DB leaks | Key-use test + config assertion | Test report | first-external | not done — `[OPEN]` |
| PR-DP-02 | "No secret in any sink": logs, events, artifacts, prompts (`T-DAT-01`, invariant 8) | A leaked secret in a log is a breach | Sink-scanning test suite | Test report | first-external | not done — `[OPEN]` |
| PR-DP-04 | Retention sweep deletes rows **and** blobs, with verification (`T-DAT-05`, `NFR-PRIV-02`) | "Deleted" must be provably deleted | Deletion test (row + blob gone) | Test report | paid | not done — `[OPEN]` |
| PR-DP-06 | Data export is a tested first-class flow, not a script (`FR-ORG-05`, `T-DAT-09`) | Subject-rights and portability depend on it | E2E export test | Test report | paid | not done — `[OPEN]` |
| PR-DP-07 | PII inventory exists for every table/field (`06` §6) and matches reality | You cannot protect what you have not catalogued | Inventory reviewed against schema | PII inventory doc | paid | not done — `[OPEN]` |
| PR-DP-08 | Artifact bucket is private, SSE-KMS-encrypted, pre-signed short-TTL (`T-DAT-03`) | Public buckets are a recurring sector-wide incident | Config assertion in CI + URL-expiry test | CI job output | paid | not done — `[OPEN]` |
| PR-DP-09 | `local_only` mode fails closed: remote-provider egress is refused (`NFR-PRIV-01`, `T-DAT-06`) | The core privacy promise must be enforced, not documented | Egress test with `local_only` | Test report | first-external | not done — `[OPEN]` |
| PR-DP-10 | Remote calls carry per-call consent and write an audit row (provider/model/tokens, never content) (`11` §7) | Consent must be visible and recorded | Consent-flow + audit tests | Test report | paid | not done — `[OPEN]` |
| PR-DP-11 | Diagnostics bundle is redacted and user-previewed before send (`T-DAT-02`) | Support tooling must not leak secrets | Bundle redaction test | Test report | paid | not done — `[OPEN]` |

### 3.7 Observability and alerting readiness

| ID | Item | Why it matters | How it is verified | Evidence artifact | Gate | Status |
|---|---|---|---|---|---|---|
| PR-OB-01 | Correlation/trace ID propagated API → queue → worker → device → client (`NFR-OBS-01`) | Without it, cross-boundary incidents are undebuggable | Trace-propagation test | Test report | M0 | not done — `[OPEN]` |
| PR-OB-02 | SLOs defined with error budgets; alerts tied to burn rate (`NFR-OBS-02`) | Alerting on symptoms, not noise | SLO definitions reviewed + alert rules | SLO doc + alert rules | first-external | not done — `[OPEN]` |
| PR-OB-03 | Dashboards as code for API, queues, workers, devices, Postgres, Redis | Dashboards must be reviewable artifacts, not hand-built | `infrastructure/observability` reviewed | Dashboard-as-code PR | first-external | not done — `[OPEN]` |
| PR-OB-04 | **Every alert links to a runbook** (`NFR-OBS-03`) | An alert with no procedure is just anxiety | Alert→runbook link audit (100% coverage) | Audit report | first-external | not done — `[OPEN]` |
| PR-OB-05 | Security-event stream (R4 attempts, digest mismatch, cross-tenant attempt, auth abuse) is alertable (`10` §10, `11` §4) | Detection closes the loop on prevention | Fault-injection raises the right alert | Test report | paid | not done — `[OPEN]` |
| PR-OB-07 | On-call rotation, paging and escalation are live and tested | A page nobody receives is not on-call | Game-day page test | Game-day record | first-external | not done — `[OPEN]` |

### 3.8 Reliability and DR

| ID | Item | Why it matters | How it is verified | Evidence artifact | Gate | Status |
|---|---|---|---|---|---|---|
| PR-RL-02 | **Restore drill executed** into an isolated environment with a smoke test (`06` §11, `T-DAT-04`) | A backup never restored is not a backup | Monthly restore drill log | Drill log | first-external | not done — `[OPEN]` |
| PR-RL-03 | RPO/RTO demonstrated: ≤ 15 min / ≤ 4 h from Phase 10; manual restore documented before that (`NFR-REL-04`) | Recovery targets must be measured, not hoped | Timed restore exercise | Drill timing record | paid | not done — `[OPEN]` |
| PR-RL-04 | Failure injection: kill worker mid-step → recovered; duplicate delivery; poison payload (`03` §7.6) | The recovery path is the product's promise (R-06) | Fault-injection suite | Test report | first-external | not done — `[OPEN]` |
| PR-RL-05 | Redis down: tasks are still accepted into the DB; outbox replays (`NFR-REL-06`) | Redis is not the system of record | Chaos test with Redis stopped | Test report | first-external | not done — `[OPEN]` |
| PR-RL-06 | DB down: API returns 503 with a health signal; the runner keeps working locally (`NFR-REL-06`) | Local-first means the cloud can fail without stopping work | Chaos test with DB stopped | Test report | first-external | not done — `[OPEN]` |
| PR-RL-01 | Encrypted, cross-AZ backups with continuous WAL/PITR; device offline → `WAITING_DEVICE` with TTL, no data loss (`06` §11, `03` §9) | Backups are the last line of defence; laptops are offline constantly | Config assertion + offline-device test | Test report | paid | not done — `[OPEN]` |
| PR-RL-08 | Task durability: after HTTP 201, a worker crash or Redis restart does not lose the task (`NFR-REL-02`) | Acceptance must mean something | Durability test | Test report | first-external | not done — `[OPEN]` |
| PR-RL-09 | No duplicate externally visible effect for the same idempotency key (`NFR-REL-03`, invariant 5) | Double-posted PRs/emails/invoices destroy trust | Effect-key tests | Test report | paid | not done — `[OPEN]` |
| PR-RL-10 | Degraded mode documented and tested (SSE falls back to DB polling by cursor; "state beats stream") | Degradation must be designed, not improvised | Degraded-mode test | Test report | paid | not done — `[OPEN]` |

### 3.9 Performance and capacity

| ID | Item | Why it matters | How it is verified | Evidence artifact | Gate | Status |
|---|---|---|---|---|---|---|
| PR-PC-01 | Load test executed against the **S2** scenario; p95 read latency < 300 ms (`NFR-PERF-01`) | Every capacity number in `13` is an assumption until measured | Load test against a production-shaped stack | Load-test report | paid | not done — `[OPEN]` |
| PR-PC-02 | Event-delivery and approval-propagation SLOs measured (`NFR-PERF-02/03`) | Approval latency is the UX's heartbeat | Load test + dashboards | Load-test report | paid | not done — `[OPEN]` |
| PR-PC-04 | Quota enforcement: soft warning then hard stop; state visible to members (`FR-BILL-02`) | Prevents runaway cost and abuse | Quota boundary tests | Test report | paid | not done — `[OPEN]` |
| PR-PC-05 | Noisy-neighbour test: one org cannot degrade another (`NFR-PERF-05`) | Fairness is a security property here | Multi-tenant load test | Load-test report | paid | not done — `[OPEN]` |
| PR-PC-06 | Cost per active user measured and alerted (`NFR-COST-01`) | Cost is a tracked metric, not a surprise | Cost dashboard + alert | Cost report | paid | not done — `[OPEN]` |
| PR-PC-07 | Load-test tool selected (`Q-T5` `[OPEN]`) and drivers live in `scripts/` | You cannot run PR-PC-01 without it | Tool decision + driver code | Decision record | paid | not done — `[OPEN]` |

### 3.10 Security

| ID | Item | Why it matters | How it is verified | Evidence artifact | Gate | Status |
|---|---|---|---|---|---|---|
| PR-SE-01 | SAST, dependency scan and secret scan are green and **required** in CI | Catches the cheap classes early (`T-INF-03/05`) | Required CI checks | CI job output | first-external | not done — `[OPEN]` |
| PR-SE-02 | Container images scanned, non-root, read-only rootfs where possible (`T-INF-02`) | Blast-radius reduction | Image-hardening scan | Scan report | paid | not done — `[OPEN]` |
| PR-SE-03 | SBOM produced per build; provenance verified | Traceability for a compromised dependency (`T-INF-03`) | SBOM + attestation check in CI | SBOM artifact | paid | not done — `[OPEN]` |
| PR-SE-04 | Licence review for all dependencies (no AGPL/copyleft in distributed code without review) (`05` §3.8) | Legal exposure is a launch blocker | Licence scan + review | Licence report | paid | not done — `[OPEN]` |
| PR-SE-05 | Penetration test executed against the agreed scope (`[OPEN]`) and findings triaged | Independent verification of the model | Third-party report | Pen-test report | paid | not done — `[OPEN]` |
| PR-SE-06 | SSRF corpus green: metadata IP, localhost, redirects, DNS rebinding (`T-INF-01`) | `webfetch`/integrations are SSRF-shaped | SSRF test corpus | Test report | paid | not done — `[OPEN]` |
| PR-SE-07 | Injection corpus green: documents, web pages, repo content (`T-LLM-01`, `11` §5) | The defining agentic risk | Injection test corpus | Test report | paid | not done — `[OPEN]` |
| PR-SE-08 | Vulnerability response process: severity SLAs, owners, disclosure route | An unpatched CVE is a live incident | Documented process + a drill | Process doc | first-external | not done — `[OPEN]` |
| PR-SE-10 | Runner verifies its own binary/config hashes at start-up; WAF rules and edge rate limits configured (`T-LOC-05`, `B-1`, `T-INF-07`) | Self-tampering must be detected; the edge is the first line against abuse | Tamper test + config/abuse test | Test report | first-external | not done — `[OPEN]` |

### 3.11 Accessibility and UX quality

| ID | Item | Why it matters | How it is verified | Evidence artifact | Gate | Status |
|---|---|---|---|---|---|---|
| PR-AX-01 | **WCAG 2.2 AA audit** of the flows in `12` (sign-in, task creation, task workspace, approval inbox, devices, settings) (`FR-UI-05`) | Accessibility is a requirement, not a nice-to-have | Manual audit + axe results | Audit report | paid | not done — `[OPEN]` |
| PR-AX-02 | Full keyboard navigation and visible focus on every interactive element | Blocks keyboard-only users entirely if missing | Keyboard-only walkthrough | Audit report | paid | not done — `[OPEN]` |
| PR-AX-04 | No `dangerouslySetInnerHTML` on model output; markdown sanitised (`T-AUTH-05`, `T-LLM-03`) | XSS via LLM output is a real attack (`11` §4.1) | XSS payload suite + CSP review | Test report | first-external | not done — `[OPEN]` |

### 3.12 Legal, compliance, contractual

| ID | Item | Why it matters | How it is verified | Evidence artifact | Gate | Status |
|---|---|---|---|---|---|---|
| PR-LC-01 | Privacy policy published and consistent with the `11` §7 statements | The product makes specific privacy promises; they must be documented | Policy vs `11` §7 review | Policy doc | first-external | not done — `[OPEN]` |
| PR-LC-02 | DPA template available for team/paid customers | Enterprise and EU customers require it | Legal review | DPA template | paid | not done — `[OPEN]` |
| PR-LC-03 | Sub-processor list maintained and published | Transparency and contractual requirement | List maintained as config/doc | Sub-processor list | paid | not done — `[OPEN]` |
| PR-LC-04 | Records of processing produced (`NFR-PRIV-04`, `11` §5) | GDPR-shaped posture requires it | Document reviewed against data flows | RoP document | paid | not done — `[OPEN]` |
| PR-LC-05 | Data residency decision recorded (`[OPEN]`; one region at launch `[ASSUMPTION]`) | Determines architecture and contract terms | Decision record | Decision record | paid | not done — `[OPEN]` |
| PR-LC-06 | SOC 2 timing decided (`[OPEN]`; business track, not engineered in Phase 1–9) | Enterprises ask; wrong timing wastes money | Business-track decision | Decision record | enterprise | not done — `[OPEN]` |
| PR-LC-07 | Terms of service / acceptable use cover agent actions and support impersonation; OSS licence NOTICE generated | Users must know what the agent may be asked to do; OSS obligations | Legal review + automated NOTICE generation | ToS/AUP + NOTICE | paid | not done — `[OPEN]` |
| PR-LC-09 | Legal-hold position decided (`06` §10 `[OPEN]`) | Affects retention sweeps | Decision record | Decision record | enterprise | not done — `[OPEN]` |

### 3.13 Operations

| ID | Item | Why it matters | How it is verified | Evidence artifact | Gate | Status |
|---|---|---|---|---|---|---|
| PR-OP-01 | A runbook exists for every production alert and incident class (`NFR-OBS-03`) | See PR-OB-04; this is the human side | Runbook inventory audit | Runbook index | first-external | not done — `[OPEN]` |
| PR-OP-02 | On-call rotation, escalation and paging tested via a game day | Untested paging fails exactly when needed | Game-day execution | Game-day record | first-external | not done — `[OPEN]` |
| PR-OP-03 | Incident process (severity, comms, blameless postmortem) documented and rehearsed | Recovery is a process, not a hero | Document + one rehearsal | Incident doc | first-external | not done — `[OPEN]` |
| PR-OP-04 | Access reviews: operator/human access is least-privilege; no long-lived decrypt (`T-INF-10`) | Insider risk is on the register (RR-7) | IAM review | Access-review record | paid | not done — `[OPEN]` |
| PR-OP-05 | Secret rotation schedule and procedure for KMS, DB, signing keys (`06` §11) | Rotation without a procedure is a future outage | Rotation drill | Drill record | paid | not done — `[OPEN]` |
| PR-OP-06 | Change management: production changes go through CI only; no manual edits | Untracked production changes break reproducibility | Pipeline audit | Audit record | paid | not done — `[OPEN]` |
| PR-OP-08 | DR runbook with exact commands, owner and expected duration (`06` §11) | During an incident nobody reads prose | Runbook review + rehearsal | DR runbook | paid | not done — `[OPEN]` |

### 3.14 Release engineering

| ID | Item | Why it matters | How it is verified | Evidence artifact | Gate | Status |
|---|---|---|---|---|---|---|
| PR-RE-01 | CI gates green: typecheck, lint, unit, integration, contract/OpenAPI diff, cross-tenant, build, image scan, SBOM, migration dry-run (`04`) | One pipeline is the only reproducible release path | Required-checks configuration | CI config + run | M0 | not done — `[OPEN]` |
| PR-RE-02 | A breaking contract change **fails the build** (OpenAPI diff gate) | Contracts are the trust boundary (`03` §5.8) | Deliberate-breaking-change test | CI job output | first-external | not done — `[OPEN]` |
| PR-RE-03 | Migration safety: forward-only, expand/contract, gated pre-deploy, advisory lock (`06` §9, `NFR-MAINT-01`) | A bad migration takes down the whole product | Migration dry-run on a restored copy | Migration rehearsal record | first-external | not done — `[OPEN]` |
| PR-RE-04 | Every release has a rollback plan (code rollback + forward migration), rehearsed | Unplanned rollback is how to make an incident worse | Rollback rehearsal (§2.3 step 3) | Rehearsal record | first-external | not done — `[OPEN]` |
| PR-RE-05 | Feature flags exist for staged rollout, with a flag-removal policy | Flags left in place become permanent complexity | Flag inventory + removal policy | Flag inventory | paid | not done — `[OPEN]` |
| PR-RE-06 | Canary / percentage rollout with auto-abort on SLO burn | Limits blast radius of a bad release | Canary config + abort test | Canary config | paid | not done — `[OPEN]` |
| PR-RE-07 | Version and changelog policy defined; contracts/tool manifests versioned (`10` §7) | Tool/manifest versions are part of approval binding | Policy doc + version check | Policy doc | first-external | not done — `[OPEN]` |

### 3.15 Cost and FinOps

| ID | Item | Why it matters | How it is verified | Evidence artifact | Gate | Status |
|---|---|---|---|---|---|---|
| PR-CO-01 | Budgets and budget alerts per account and environment | Runaway spend is a preventable incident | Billing config review | Budget config | first-external | not done — `[OPEN]` |
| PR-CO-02 | Cost-per-active-user metric and alert threshold live (`NFR-COST-01`) | Cost is a first-class operational signal | Dashboard + alert | Cost report | paid | not done — `[OPEN]` |
| PR-CO-03 | Non-production teardown schedule (dev/staging) to stop idle spend | Idle environments are pure waste | Schedule + evidence of teardown | Teardown log | paid | not done — `[OPEN]` |
| PR-CO-04 | Reserved-capacity / savings-plan decision documented with a break-even point | Committing early to save late is a real loss | Decision record with numbers | Decision record | paid | not done — `[OPEN]` |
| PR-CO-06 | S3 cost model re-validated before any scale spend (R-08) | Prevents premature scale spend | Re-measurement vs `13` | Cost review | enterprise | not done — `[OPEN]` |
| PR-CO-05 | No GPU spend at MVP (cloud execution opt-in only); object-storage lifecycle rules expire artifacts (`NFR-COST-02`, D-14, `06` §11) | `00` §7 assumes zero GPU cost; unbounded storage is an unbounded bill | Cost report + config assertion | Cost report | paid | not done — `[OPEN]` |

## 4. Residual-risk acceptance table

`[PROPOSED]` These are the risks we knowingly carry. Each must be accepted by a
named human before the relevant gate opens. Because no team is assigned yet, the
"accepted by" column names the **accountability role** (§1.3); the individual name
is `[OPEN]`.

| ID | Risk (short) | Accepted by whom | Mitigating control | Revisit trigger |
|---|---|---|---|---|
| RR-1 | A user with `read_write` access approves destructive work (`11` §8) | Release Owner + Product Owner | Snapshot-before-mutate, prominent diff previews, undo affordances | Any real destructive-approval incident |
| RR-2 | Windows desktop confinement is not VM-grade (`11` §8) | Security Owner | L1/L2 containment, least privilege; L3 containers / cloud execution for the riskiest work | A demonstrated escape beyond L1/L2 |
| RR-3 | A local model can be socially engineered to propose terrible actions | Security Owner | Policy engine + approvals; the model has no authority | Any case where model output alone changed a decision |
| RR-4 | A compromised device with a valid credential can report false results | Security Owner | Verification engine checks artifacts; anomaly detection; per-device revocation | Detected forged results |
| RR-5 | A compromised cloud could command devices | Security Owner | Device-side policy re-check, signed commands, visible action log, kill switch | Any forged/replayed command that executes |
| RR-6 | Supply-chain compromise of a dependency we did not write | Security Owner | Pins, provenance, SBOM, scanners, fast patching, minimal dependencies | A high-severity advisory in a shipped dependency |
| RR-7 | Operator misuse of support access | Ops Owner + Security Owner | Time-boxing, audit, no secret access; four-eyes `[OPEN]` | Any impersonation audit anomaly |
| RR-8 | Zero-day in Chromium/Ollama/Electron | Security Owner | Fast patch cadence, layering, least privilege, no auto-open of downloads | A relevant active-exploitation advisory |
| R-01 | Model/prompt injection tricks the agent into a destructive action (`00` §8) | Release Owner + Security Owner | Deterministic policy + argument-bound approvals | Any R-01-shaped near-miss or incident |
| R-02 | Local sandbox escape on Windows | Security Owner + Local Runtime Owner | Job-object/AppContainer containment, canonicalisation, argv allow-list | Successful escape in testing or the field |
| R-03 | Cross-tenant leak via a missing tenant filter | Security Owner | Tenant-scoped layer + RLS + cross-tenant CI gate | Any cross-tenant test failure in production |
| R-04 | Model/agent architecture is version-churning (OpenCode V2, TS 7) | Architecture Owner | Exact pins, adapter interfaces, contract tests | A breaking change in a pinned dependency |
| R-05 | Dev machine cannot run the full stack (`00` §3) | Local Runtime Owner | Lean dev profile, artifacts on `F:`, cloud dev DB option | Developer productivity measurably degraded |
| R-06 | Long-running tasks leak resources | Ops Owner + Local Runtime Owner | Hard budgets, watchdog reaper, lease + heartbeat, checkpoints | A stuck/orphaned resource incident |
| R-07 | Approval fatigue (users rubber-stamp) | Product Owner + Security Owner | Risk-tiered defaults, scoped grants, no approval for R0 | Median approvals/task exceeds target (`02` §9) |
| R-08 | 100k target drives premature scale spend | FinOps Owner + Release Owner | Local-first execution, staged scenarios with measured triggers | Any spend before a measured trigger is hit |

## 5. Launch-day runbook summary

`[PROPOSED]` The full sequence is rehearsed at least once (§2.3). Times are
relative to the intended go-live (`T-0`).

| Time | Step | Owner | Exit condition |
|---|---|---|---|
| T-24h | **Freeze + final review.** Cut the release candidate; walk §7 "must not launch without" and confirm each has an artifact or a §4 record; confirm the latest backup is intact and note the restore point | Release Owner + Ops Owner | Branch frozen; evidence index complete; restore point recorded |
| T-2h | **Go/no-go call + readiness.** Read Security/Data/Legal sign-offs aloud (any unproven blocking item is a no-go); confirm on-call; confirm the previous version and rollback procedure are ready | Release Owner + Ops Owner | Written go, or abort with reason; on-call acked; rollback rehearsed within 24 h |
| T-0 | **Migrate.** Run the gated pre-deploy migration job; abort on failure (`06` §9) | Ops Owner | Migration job green; schema-version smoke passes |
| T-0 | **Deploy.** API → workers → web, rolling; new code behind flags OFF | Release Owner | Health checks green; error rate flat |
| T-0 | **Enable.** Turn flags on for a small cohort first (canary); watch SLO burn | Release Owner | No auto-abort triggered |
| T+1h | **Verify.** Smoke a full M0-style task end to end in production; check p95 latency, error budget, queue depths | Ops Owner | Smoke passes; metrics within SLO |
| T+1h | **Watch window.** Log, trace and cost dashboards on a shared screen; anyone may call rollback | Whole team | No critical alerts; error budget healthy |
| T+24h | **First-day review.** Compare to §6 agenda; decide continue / hotfix / rollback | Release Owner | Decision recorded |

### 5.1 Rollback decision tree

`[PROPOSED]`

```
Is a critical SLO breached, or is data being corrupted/lost/exposed?
├─ YES -> ROLL BACK NOW (code rollback; forward migration if needed); open an incident.
└─ NO
   ├─ Is the failure isolated to a feature behind a flag?
   │   ├─ YES -> FEATURE ROLLBACK: flag off; keep the release.
   │   └─ NO
   │      ├─ Security event (R4 bypass, cross-tenant, secret leak)?
   │      │   ├─ YES -> ROLL BACK + incident (Security Owner leads).
   │      │   └─ NO -> Within error budget and not corrupting? YES -> hotfix forward.
   │      │            NO -> observe 30 min; unchanged -> hotfix; worsening -> roll back.
```

## 6. Post-launch

### 6.1 First-week review agenda

`[PROPOSED]` Review at T+7d, with data, not impressions:

1. **SLO review** — availability vs 99.9% `[ASSUMPTION]`, p95 latencies, error-budget burn.
2. **Task health** — completion rate, crash-free task rate, median approvals/task, approval response time (`02` §9).
3. **Reliability and security** — any lost task (should be zero, `NFR-REL-02`), any duplicate effect, reaper activity; security-event stream volume, any R4/cross-tenant attempt or digest mismatch.
4. **Privacy and onboarding** — retention sweeps on time, export/delete handled, any unexpected egress; runner install success rate, time-to-first-useful-action.
5. **Cost and support** — cost per active user vs projection, budget-alert noise; top-5 issues and whether each has a runbook entry.
6. **Decisions** — open `[OPEN]` items that are now blocking the next gate.

### 6.2 Success metrics (from `02` §9, targets `[ASSUMPTION]`)

| Metric | Target | Where read |
|---|---|---|
| Task completion rate (excluding model failures) | ≥ 95% | Task metrics |
| Median time-to-first-useful-action | < 10 min | Onboarding funnel |
| Crash-free task rate | ≥ 99% | State-machine monitor |
| Median approvals per task | ≤ 2 | Approval metrics |
| Approval response time (p50) | < 60 s | Notification path metrics |
| Runner install success rate | ≥ 95% | Install telemetry |

### 6.3 Rollback triggers (post-launch)

`[PROPOSED]` Any of the following triggers a rollback or feature rollback decision:

- Cross-tenant read/write of any kind, or a secret found in a log/event/artifact → **immediate rollback + incident**.
- Data loss or corruption (a task lost after 201, or a duplicated side effect) → rollback or forward hotfix with an incident.
- Availability below the SLO for a sustained window that burns the error budget faster than plan → rollback.
- An R4 action executing, or an approval executing with mismatched bound fields → rollback + incident.
- Approval path broken so tasks sit silently waiting (`FR-NOTIF-02`), or a migration that cannot be safely reversed forward within the RTO (`NFR-REL-04`) → feature rollback or forward-fix schema.

## 7. Must not launch without

`[PROPOSED]` The genuinely non-negotiable short list. Each is the *first* thing a
gate cannot open without. (This is a subset of §3; it exists so that a tired team
at T-2h does not have to read 15 tables.)

| # | Item | Reference |
|---|---|---|
| 1 | Tenant scoping + fail-closed tenant layer, proven | PR-MT-01, PR-MT-02 |
| 2 | Cross-tenant test suite green **and required** in CI | PR-MT-03 |
| 3 | Approval digest binding: any mutated bound field invalidates the grant | PR-AP-05 |
| 4 | R4 is unapprovable by any scope, role or grant | PR-AP-03 |
| 5 | Path-escape matrix denied and audited on real Windows | PR-LR-03, PR-AP-09 |
| 6 | Shell uses argv allow-list; no shell string interpolation | PR-LR-12 |
| 7 | Sandbox self-test passes; a failing self-test disables mutating tools | PR-LR-01 |
| 8 | "No secret in any sink" test green (logs/events/artifacts/prompts) | PR-DP-02 |
| 9 | `local_only` fails closed — no remote egress without consent | PR-DP-09 |
| 10 | Backup **restored** at least once into an isolated environment | PR-RL-02 |
| 11 | A runbook exists and is linked for every production alert | PR-OB-04, PR-OP-01 |
| 12 | A rehearsed rollback path exists for the release | PR-RE-04 |
| 13 | Device revocation cascades completely | PR-AU-09 |
| 14 | Dependency/secret scans green and required in CI | PR-SE-01 |
| 15 | The privacy policy matches the promises in `11` §7 | PR-LC-01 |

## 8. Open questions

| # | Question | Impact | Owner |
|---|---|---|---|
| Q-PR-1 | Who is the named Release Owner, and do they hold the veto? | The go/no-go call cannot exist without one accountable person | Product / leadership `[OPEN]` |
| Q-PR-2 | Exact penetration-test scope, and who funds it before paid release? | `PR-SE-05` is a paid blocker (`11` §9 `[OPEN]`) | Security Owner `[OPEN]` |
| Q-PR-3 | Which managed Postgres/Redis provider is assumed by the backup/restore evidence (Q-T2)? | `PR-RL-02/03` cannot be evidenced without it | Architecture `[OPEN]` |
| Q-PR-4 | Which container runtime runs `api` and the four workers (Q-T4)? | Determines rollback, canary and migration-gating mechanics | Ops Owner `[OPEN]` |
| Q-PR-5 | What SLO/error-budget policy defines "not met" for rollback (window, burn rate)? | §6.3 depends on it; otherwise the trigger is subjective | Ops Owner `[OPEN]` |
| Q-PR-6 | Is a second approver required for solo/personal orgs, or skipped (Q-P3)? | Affects the R3 approval tests and readiness criteria | Security Owner `[OPEN]` |
| Q-PR-7 | What data-residency stance do we take for early EU users? | Affects `PR-LC-05` and the deployment topology | Legal + Architecture `[OPEN]` |
| Q-PR-8 | When is SOC 2 started (`11` §9 `[OPEN]`)? | Enterprise gate timing and cost | Legal `[OPEN]` |
| Q-PR-9 | Is the `17` roadmap's phase→gate mapping consistent with the Gate columns here? | If not, the gate columns must be re-dated | Release Owner — **resolved**: aligned to `17` §1.5 of this document (M0=Phase 5, first-external=Phase 8, paid=Phase 9, enterprise=Phase 11) |

## 9. Items blocked on decisions already recorded as `[OPEN]` elsewhere

`[PROPOSED]` Several readiness items cannot be evidenced until a decision
currently recorded as `[OPEN]` elsewhere in `docs/planning/` is made. These are not
new problems; they are the dependencies of this checklist.

| Blocked item(s) here | Blocked on | Recorded in |
|---|---|---|
| PR-RL-02/03, PR-CO-04/06 | Managed PostgreSQL/Valkey provider (Neon vs RDS vs Aurora vs ElastiCache) | Q-T2, `05` §7 |
| PR-RE-01/03/04/06, PR-SE-02 | Cloud container runtime (ECS/Fargate-class vs managed K8s vs serverless) | Q-T4, `05` §7 |
| PR-SE-05, PR-LC-06 | Penetration-test scope and SOC 2 timing | `11` §9 `[OPEN]` |
| PR-PC-01/02/05, PR-PC-07 | Load-testing tool; managed browser provider; `pgvector` sufficiency at S3 | Q-T5/T6/T7, `05` §7 |
| PR-LC-05, PR-LC-09 | Data-residency stance and legal-hold requirement | `06` §10 `[OPEN]` |
| PR-OP-04, PR-LR-07, PR-LC-01/04, PR-OB-05 | Four-eyes admin controls; remote wipe; whether third-party analytics is permitted at all | `11` §4.1, `09` §13, `11` §7 `[OPEN]` |
| PR-FN-01, PR-FN-04 | Phase→deliverable mapping | Q-PR-9 (resolved), `17` §3/§15 |

Labels: `[FACT]` `[ASSUMPTION]` `[PROPOSED]` `[OPEN]`
