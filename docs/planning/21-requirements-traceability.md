# 21 — Requirements Traceability

> Part of the Universal AI Agent planning set. This is the **closing document**:
> it maps every requirement in `02-product-requirements.md` to its design, its
> phase, its acceptance evidence, its test, and its security implication — so
> that no requirement is designed without a home and no design exists without a
> requirement.

**Honesty statement.** `[FACT]` Nothing in this plan is implemented and no test in
it has ever run. The "Test" column references the test identifiers defined in
`14-testing-strategy.md`; those tests are **planned**, not passing. Where a
requirement is intentionally deferred or has no dedicated test, it is marked
`[OPEN]` rather than given a fake one.

---

## 1. How to read this document

- **Requirement IDs** are defined once, in `02-product-requirements.md`, and are
  never renumbered here. `FR-*` = functional requirement, `NFR-*` =
  non-functional requirement.
- **Design docs** are the planning documents that specify the requirement's
  behaviour. A requirement may be specified in more than one.
- **Phase** is the roadmap phase (`17-implementation-roadmap.md`) whose exit
  criteria include this requirement.
- **Acceptance / evidence** is what must be demonstrably true.
- **Test** is the test identifier from `14-testing-strategy.md`. `—` means no
  dedicated test is planned, which is itself a finding.
- **Security note** records the control that keeps the requirement from becoming
  a vulnerability.

Counts: **85 functional requirements** (`FR-*`) and **29 non-functional
requirements** (`NFR-*`), **114 in total**. All 114 appear below.

---

## 2. Authentication (`FR-AUTH-01…09`)

| ID | Requirement | Design docs | Phase | Acceptance / evidence | Test | Security note |
|---|---|---|---|---|---|---|
| FR-AUTH-01 | Email + password sign-up/sign-in, Argon2id, password policy | `06` §2.1, `07`, `11` | 2 | A user signs up and signs in; hash parameters documented | T-CON-02 | Timing-safe comparison; generic errors (no user enumeration) |
| FR-AUTH-02 | Email verification; single-use time-boxed hashed reset tokens | `06`, `11` | 2 | Verification and reset flows work; a reused token fails | T-CON-02 | Tokens hashed at rest, single-use, short TTL |
| FR-AUTH-03 | `HttpOnly`/`Secure`/`SameSite=Lax` sessions, individually revocable | `06`, `07`, `11` | 2 | Cookie flags verified; a revoked session is rejected next request | T-TENANT-02 | CSRF posture documented; server-side session record |
| FR-AUTH-04 | TOTP second factor + recovery codes; enforceable per org | `06`, `07` | 6 | Enrolment, verification, recovery-code use; org can require MFA | — | Step-up for R3; recovery codes single-use |
| FR-AUTH-05 | OIDC/OAuth sign-in with account-linking rules | `06` | 9 `[OPEN]` | Federated sign-in and a documented linking rule | — | Identity linking is a takeover vector — needs state/nonce checks and email-verified linking |
| FR-AUTH-06 | SSO (SAML/OIDC) + SCIM for enterprise | `03` §4, `11` §9 | Post-11 (enterprise) | SSO login and SCIM provisioning against a test IdP | — | Separate credential blast radius; identity-service split trigger |
| FR-AUTH-07 | Device-authorisation flow (short code + browser confirmation) | `06`, `09`, `11` | 4 | A runner joins without typing a password into it | T-WIN-07 | Short code single-use, short TTL, bound to the confirming user |
| FR-AUTH-08 | Short-lived access tokens + rotating refresh with reuse detection | `06`, `07` | 2 | Refresh reuse revokes the whole family | — | Rotation is the control; family revocation limits theft |
| FR-AUTH-09 | Step-up re-auth for R3 and elevate-to-admin | `10`, `11` | 6 | An R3 action without fresh auth is refused | T-APPR-03 | Prevents a stolen session from authorising the worst actions |

---

## 3. Organizations and tenancy (`FR-ORG-01…05`)

| ID | Requirement | Design docs | Phase | Acceptance / evidence | Test | Security note |
|---|---|---|---|---|---|---|
| FR-ORG-01 | Default personal organization on sign-up | `06`, `07` | 2 | Every new user has exactly one org they own | T-TENANT-02 | Guarantees a tenant context always exists (fail-closed) |
| FR-ORG-02 | Orgs, memberships, roles, expiring invitations | `06`, `07` | 2 | Role change and invitation expiry behave as specified | T-TENANT-02 | Role checks server-side only; invitation tokens hashed |
| FR-ORG-03 | Mandatory `organization_id`; every call scoped to exactly one org | `06`, `10`, `11` | 2 | The isolation suite passes with zero findings | T-TENANT-02 | Data layer + RLS backstop (ADR-008) |
| FR-ORG-04 | Per-org settings: default execution location, providers, retention, approval policy | `06`, `10`, `12` | 6 | Settings take effect and are auditable | T-POL-04 | Retention and provider policy are capacity **and** privacy controls |
| FR-ORG-05 | Org deletion and per-user machine-readable export | `06`, `19` | 9 | Export produces a complete machine-readable bundle; delete removes data | T-DATA-01 | Verifiable deletion (NFR-PRIV-02); export must not leak other members' secrets |

---

## 4. Tasks (`FR-TASK-01…10`)

| ID | Requirement | Design docs | Phase | Acceptance / evidence | Test | Security note |
|---|---|---|---|---|---|---|
| FR-TASK-01 | Create a task from goal + attachments + workspace + constraints | `07`, `08` | 3 | Task created with constraints persisted | T-CON-01 | Constraints are validated at admission (trust boundary) |
| FR-TASK-02 | Plan of explicit steps, inspectable before execution | `08` §3 | 5 | Plan validation rejects unknown tools and cycles | T-ARCH-02 | A plan is data; no step executes without a policy decision |
| FR-TASK-03 | Execute steps (sequential or DAG), recording input/output/duration/cost/outcome | `06`, `08` | 3, 5 | `task_steps` rows complete and replayable | T-ARCH-06 | Result digests support tamper detection |
| FR-TASK-04 | Live progress streaming to all attached clients with resumable reconnection | `07` §5, `12` §7 | 3 | SSE reconnect produces no gap or duplicate | T-ARCH-06 | Events are redacted and size-capped (`06`) |
| FR-TASK-05 | Cooperative, bounded cancellation leaving a consistent record | `08` §6 | 5 | Cancel mid-step ends in `CANCELLED` with a consistent log | T-ARCH-07 | Kill switch must not leave orphaned processes (R-06) |
| FR-TASK-06 | Pause/resume across reboot via checkpoints | `06`, `08` | 6 | Suspend, reboot, resume continues from a checkpoint | T-WIN-04 | Checkpoint blobs are encrypted and bounded |
| FR-TASK-07 | Bounded execution (steps/time/tokens/cost/retries) + loop detection | `08` §7 | 5 | Exceeding a budget fails cleanly with a resumable state | T-REL-04 | Budgets bound blast radius and cost (R-06, R-08) |
| FR-TASK-08 | Task templates / saved workflows with parameters | `02` only | Deferred (P2) `[OPEN]` | — | — | Templates must not become a way to pre-bless risky actions |
| FR-TASK-09 | Schedule a task (cron or one-shot) | `02` only | Deferred (P2) `[OPEN]` | — | — | Scheduled tasks need the same approval path, not a bypass |
| FR-TASK-10 | Duplicate submission with an idempotency key returns the original task | `06`, `08` §12 | 3 | Same key + body → original task; different body → `409` | T-REL-01 | Prevents duplicate side effects (NFR-REL-03) |

---

## 5. Code tasks (`FR-CODE-01…04`)

| ID | Requirement | Design docs | Phase | Acceptance / evidence | Test | Security note |
|---|---|---|---|---|---|---|
| FR-CODE-01 | Code tasks run against a chosen workspace with an explicit permission boundary | `09` §5 | 4 | An out-of-workspace path is denied and audited | T-LOC-01 | Canonicalisation is the control; path escapes are tested |
| FR-CODE-02 | Diff shown before applying when policy requires; workspace snapshotted (git) | `08`, `10` §9 | 5 | A rejected diff is not applied; a snapshot allows revert | T-APPR-01 | Snapshot-before-mutate limits the damage of RR-1 |
| FR-CODE-03 | Allow-listed binaries with structured arguments; no shell interpolation by default | `09`, `10` §3 | 4 | A non-allow-listed binary is refused; no shell string is built | T-LOC-01 | Removes the largest command-injection class (R-02) |
| FR-CODE-04 | Coding engine adapter: embedded OpenCode by default, alternative per task | `04` ADR-011, `08` | 5 | Adapter contract tests pass for all three implementations | T-ENG-01 | OpenCode effective policy read back or the session aborts |

---

## 6. Tool registry (`FR-TOOL-01…04`)

| ID | Requirement | Design docs | Phase | Acceptance / evidence | Test | Security note |
|---|---|---|---|---|---|---|
| FR-TOOL-01 | Declarative tool manifests (schema, risk class, side effects, permissions, idempotency, timeout) | `10` §7 | 5 | A tool without a valid manifest cannot be registered | T-ARCH-10 | The manifest is the contract that makes authorisation possible |
| FR-TOOL-02 | Per-task tool resolution with recorded selection | `08` §3, `10` §7 | 5, 6 | The selected tool and version are recorded per step | T-ARCH-02 | Selection cannot widen permissions (tightening-only) |
| FR-TOOL-03 | Log every invocation with arguments hash, policy decision, approval ref, result digest | `06`, `10` §10 | 5 | Each invocation has a complete audit record | T-ARCH-02 | Audit completeness is the detective control |
| FR-TOOL-04 | Isolation appropriate to class (job object/container/browser context) | `09` §6, `10` | 4, 5 | A tool cannot read another task's context | T-LOC-02 | The last line of defence when policy is bypassed |

---

## 7. Approvals (`FR-APPR-01…08`)

| ID | Requirement | Design docs | Phase | Acceptance / evidence | Test | Security note |
|---|---|---|---|---|---|---|
| FR-APPR-01 | Risk classifier assigns each concrete action to `R0`–`R4` | `10` §2 | 5 | Actions receive a deterministic, recorded risk class | T-POL-01 | Classification failure must be conservative (ask/deny) |
| FR-APPR-02 | R0 no approval; R1 per policy; R2 explicit approval; R3 approval + step-up (+admin); R4 prohibited | `10` §2, §8 | 5, 6 | Each class behaves as specified; `R4` is never executable | T-POL-03 | The floor is unapprovable — no role or grant overrides it |
| FR-APPR-03 | Approval request states action, target, arguments, effect preview, device, policy version, expiry | `10` §5, `12` | 5 | A request contains every field in machine-checkable form | T-APPR-01 | The preview is what makes consent meaningful (RR-1) |
| FR-APPR-04 | Single-use digest-bound grant; any bound-field mutation is rejected | `10` §5.1 | 5 | Mutating one field invalidates the grant | T-APPR-01 | The core anti-replay control |
| FR-APPR-05 | Scopes: once / N minutes / this task / this tool+workspace; persistent grants listed and revocable | `10` §5.3, §9 | 6 | Each scope works and is visible in the UI | T-APPR-01, T-APPR-03 | Scoped grants trade repetition for bounded blast radius (R-07) |
| FR-APPR-06 | Route to the requesting user; org policy can require a second approver or admin for R3 | `10` §5 | 6 | Second-approver requirement is enforced where configured | T-APPR-03 | Four-eyes control; solo-org exception is Q-P3 `[OPEN]` |
| FR-APPR-07 | Denied/expired approvals are terminal with an explicit reason | `08` §4, `10` §5.2 | 5 | The step ends and the reason is user-visible | T-APPR-03 | Expiry returns to *needing approval*, never to allowed |
| FR-APPR-08 | Approval inbox across tasks and devices with age, context and one-click decisions | `12` §5, `10` §9 | 5 | Pending items appear with context and age | T-APPR-01 | The anti-fatigue surface; its absence causes R-07 |

---

## 8. Policy (`FR-POL-01…05`)

| ID | Requirement | Design docs | Phase | Acceptance / evidence | Test | Security note |
|---|---|---|---|---|---|---|
| FR-POL-01 | Policies are declared, versioned data; deterministic engine, no model involvement | `10` §3.1 | 5 | A policy edit produces a new version, not new code paths | T-POL-01 | Model output can never authorise (NFR-SEC-05) |
| FR-POL-02 | Reproducible evaluation for a given (action, context, policy version) | `10` §3.3 | 5 | Identical decision on repeated runs and two hosts | T-POL-01 | Reproducibility is what makes review and audit meaningful |
| FR-POL-03 | Policies can only tighten; no policy grants what the floor forbids | `10` §3.4 | 5 | A broad deny cannot be widened by a narrow allow | T-POL-04 | The floor is the security invariant |
| FR-POL-04 | Local + cloud policy compose with documented precedence; effective policy inspectable per device | `10` §3.4, `07` | 6 | A reviewer can enumerate every effective rule for a device | T-POL-04 | Precedence bugs are authorisation bugs — tested, not assumed |
| FR-POL-05 | Every decision recorded with the matched rule | `06`, `10` §10 | 5 | Each decision row names the rule and policy version | T-ARCH-02 | Enables post-incident explanation |

---

## 9. Devices and local runtime (`FR-DEV-01…09`)

| ID | Requirement | Design docs | Phase | Acceptance / evidence | Test | Security note |
|---|---|---|---|---|---|---|
| FR-DEV-01 | Pair a device; store a key pair; private key never transmitted | `06`, `09`, `11` | 4 | Only the public key reaches the server | T-WIN-07 | Removes credential theft from the server as an attack path |
| FR-DEV-02 | Device list with metadata and per-device revocation | `06`, `12` | 4 | A revoked device disappears from usable devices | T-WIN-07 | Revocation is the containment action for a lost device |
| FR-DEV-03 | All device communication outbound-initiated; no inbound port | `03` ADR-003, `07` | 4 | No inbound listening socket except loopback | T-ARCH-09 | Removes an entire attack surface (no port forwarding) |
| FR-DEV-04 | Heartbeat + capability report; offline detection and requeue | `07`, `16` | 4 | Silence past the window marks offline and requeues work | T-WIN-08 | Prevents work silently stuck on a dead device |
| FR-DEV-05 | Workspace registration; anything outside needs an `external_directory` grant | `06`, `09` §5 | 4 | An unregistered path is denied and audited | T-LOC-01 | Grant is explicit, expiring and listed |
| FR-DEV-06 | Local diagnostics: version, model inventory, queue, errors, reachability, self-test | `12` §5, `09` | 4 | The screen reports real state, not a placeholder | T-WIN-06 | Sandbox self-test gates mutating tools until it passes |
| FR-DEV-07 | Offline mode: local tasks run without the cloud; results sync on reconnect | `09` §4.4 | 6 | A task runs with no network and syncs later | T-WIN-08 | Offline approvals re-validated against the current policy version |
| FR-DEV-08 | Revoked device: no new work, no API access, pending approvals invalidated | `06`, `10` | 4 | A revoked device is inert and its approvals are dead | T-WIN-07 | Simultaneous revocation of work, credentials and approvals |
| FR-DEV-09 | Runner auto-update with signature verification and rollback | `15` §15, `03` | 8 | An unsigned update is refused; rollback works | T-WIN-03 | Signature verification is the supply-chain control (RR-8) |

---

## 10. Browser, documents, integrations (`FR-BRW-*`, `FR-DOC-*`, `FR-INT-*`)

| ID | Requirement | Design docs | Phase | Acceptance / evidence | Test | Security note |
|---|---|---|---|---|---|---|
| FR-BRW-01 | Real browser drive with isolated contexts per task; no shared cookies | `09` §7, `04` ADR-023 | 7 | Two tasks cannot see each other's cookies | T-ARCH-02 | Isolation prevents cross-task data bleed |
| FR-BRW-02 | Read-only `R0`; submit/upload/purchase/message/login is `R2+` and always approved | `10` §2 | 7 | A login+submit flow requires approval | T-APPR-01 | The highest-consequence browser actions are always gated |
| FR-BRW-03 | Screenshots, snapshots, network summaries as artifacts | `06`, `07` | 7 | Evidence artifacts are attached to the step | T-DATA-01 | Evidence aids audit; artifact retention is bounded |
| FR-BRW-04 | Domain allow/deny per org, enforced before navigation | `10`, `11` | 7 | A denied domain is never navigated to | T-SEC-03 | Egress control; enforced pre-navigation, not post |
| FR-DOC-01 | Ingest PDF/DOCX/XLSX/CSV/images/text with structure and metadata | `06`, `07` | 7 | Structured extraction from each format | T-SEC-02 | Malformed/oversized inputs handled safely (zip bombs) |
| FR-DOC-02 | Produce artifacts: extracted text/JSON, reports, diffs, archives | `06`, `07` | 7 | Artifacts are produced, stored and downloadable | T-DATA-01 | Artifacts are scanned and size-capped |
| FR-DOC-03 | Untrusted document content cannot grant permissions (injection defence) | `10` §2, `11` T-LLM-01 | 7 | An injected instruction yields ask/deny with visible taint | T-SEC-01, T-SEC-02 | The core prompt-injection control (NFR-SEC-05) |
| FR-INT-01 | Per-provider credentials, encrypted, never returned to a client | `06`, `11` | 7 | No API response or log ever contains a credential | T-SEC-04 | Envelope encryption; never in prompts without consent |
| FR-INT-02 | Integrations: GitHub, Google (read), Slack, Linear/Jira, REST/webhook, SMTP | `05`, `06` | 7 | Each connection authenticates and performs a read action | T-SEC-03 | Least-scope requests; per-integration disclosure (NFR-PRIV-03) |
| FR-INT-03 | Outbound webhooks: signed, retried, replay-protected | `06`, `07` | 7 | A failed delivery retries; a replay is rejected | T-DATA-01 | Signature + replay window protect receivers |
| FR-INT-04 | MCP client support for user-attached MCP servers | `INTEGRATIONS.md`, `03` | 7 (P2) | A user-attached MCP server's tools are policy-gated | T-ARCH-02 | Third-party tools go through the same authorisation path |

---

## 11. Models and inference (`FR-MODEL-01…07`)

| ID | Requirement | Design docs | Phase | Acceptance / evidence | Test | Security note |
|---|---|---|---|---|---|---|
| FR-MODEL-01 | Provider abstraction: local (Ollama) and remote behind one interface | `05` ADR-022, `08` §10 | 5 | Two providers satisfy one interface | T-REL-04 | The abstraction is the swap/exit path (R-04, R-13) |
| FR-MODEL-02 | Per-org provider policy; local-only mode is first-class | `06`, `10` | 5, 8 | An org can forbid remote providers and it is enforced | T-POL-04 | Privacy default; policy cannot be widened by a device |
| FR-MODEL-03 | Model inventory discovery with health checks | `09` §14, `12` | 4 | Unusable models are not offered | T-WIN-05 | Prevents a misleading "available" model |
| FR-MODEL-04 | Per-task model selection (planner/executor/embedding) with defaults | `08` §10 | 6 | Selection is recorded per task | — | Model choice cannot alter permissions |
| FR-MODEL-05 | Token and cost accounting per task/model/provider/org | `06` §2.6 | 8 | Immutable usage records reconcile with task totals | T-DATA-01 | Metering is also an abuse-detection signal |
| FR-MODEL-06 | Consent + visible notice whenever content leaves the device | `12` §12, `11` §7 | 10 | No remote call happens without recorded acknowledgement | — | The privacy promise's enforcement point (NFR-PRIV-01) |
| FR-MODEL-07 | Graceful degradation on unavailable/exhausted models: clean failure, resumable | `08` §7 | 5 | Exhaustion fails with `budget_exhausted` and no half-write | T-REL-04 | Prevents corrupt partial state (a data-integrity control) |

---

## 12. Billing, notifications, admin, UI

| ID | Requirement | Design docs | Phase | Acceptance / evidence | Test | Security note |
|---|---|---|---|---|---|---|
| FR-BILL-01 | Metered usage records (tasks, minutes, tokens, artifacts, cloud/browser time) | `06` §2.6 | 8 | Usage records are immutable and reconcile | T-DATA-01 | Meters drive hard stops; correctness is a revenue control |
| FR-BILL-02 | Plans and quotas with soft warning and hard stop; visible to members | `13` §5 | 8 | Hitting a quota produces a clear error, not silent failure | T-PERF-05 | Enforced at admission; per-org so one tenant cannot starve others |
| FR-BILL-03 | Subscription with payment provider, invoices, self-serve change | `06` §2.6 | 8, 9 | Upgrade/downgrade and invoice generation work | — | Payment data never stored by us `[OPEN]` scope |
| FR-NOTIF-01 | In-app notification centre, optional email, per-user preferences | `12`, `06` §2.7 | 8 | Preferences are honoured | — | Notification content is minimised (no secrets) |
| FR-NOTIF-02 | "Approval required" reaches the user promptly; never silently waiting | `12`, `16` §8 | 8 | An approval request alerts within the target window | T-OBS-01 | A silent approval wait is both a UX and a safety failure |
| FR-ADMIN-01 | Admin console: users, orgs, devices, sessions, usage, quota overrides, audit search, integrations, flags | `12`, `06` | 8 | Each admin function is present and audited | T-TENANT-02 | Admin actions are audited; no cross-tenant data exposure |
| FR-ADMIN-02 | Impersonation for support: audited, user-visible notice, no secret access | `12` §5, `11` RR-7 | 9 (P2) | An impersonation session cannot read secrets and is visible | — | Time-boxed, audited, four-eyes `[OPEN]` |
| FR-ADMIN-03 | Service health page: queue depths, worker liveness, error rates, DB/Redis status | `12`, `16` §12 | 8 | The page reflects real health signals | T-OBS-01 | Read-only view; no privileged actions from it |
| FR-UI-01 | Task workspace: plan, timeline, live logs, artifacts, approvals, cost | `12` §5 | 3 (min), 5 | The workspace shows all six and streams live | T-ARCH-06 | Displays exactly what was authorised — no implied authority |
| FR-UI-02 | Approval inbox with risk context and effect preview | `12` §5, `10` §9 | 5 | Pending approvals show risk and effect before decision | T-APPR-01 | The consent surface (RR-1) |
| FR-UI-03 | Devices, models, integrations, settings, usage pages | `12` §4 | 8 | Each page lists real state and supports the required actions | — | Revocation and grant management must be reachable here |
| FR-UI-04 | Task history with search/filter (state, tool, workspace, date, outcome) | `12` §4 | 8 | Filters return correct, tenant-scoped results | T-TENANT-02 | Search must never span tenants |
| FR-UI-05 | Keyboard navigation, screen-reader labels, visible focus, WCAG 2.2 AA, dark/light | `12` §11 | 9 | Accessibility checks pass on the core flows | T-A11Y-01 | Approval flows must be operable by keyboard only |

---

## 13. Reliability and performance (`NFR-REL-*`, `NFR-PERF-*`)

| ID | Requirement | Design docs | Phase | Acceptance / evidence | Test | Security note |
|---|---|---|---|---|---|---|
| NFR-REL-01 | 99.9% monthly availability for API + event stream `[ASSUMPTION]` | `16` §7 | 8 | SLO met over a rolling window with error budget | — | Availability budget forces explicit trade-offs |
| NFR-REL-02 | Task acceptance durability: a 201 task is never lost | `03` inv 7, `06`, `08` | 3 | Worker crash / deploy / Redis restart lose no accepted task | T-REL-02 | Durability is a data-integrity control |
| NFR-REL-03 | No duplicate side effects; every effect idempotent | `06`, `08` §12 | 3 | No duplicate effects under retries and replays | T-REL-01, T-ARCH-05 | Duplicate external effects can be financial or destructive |
| NFR-REL-04 | RPO ≤ 15 min / RTO ≤ 4 h from Phase 10 (weaker before) `[ASSUMPTION]` | `15` §10, `16` §13 | 8, 10 | A restore drill meets the target and is logged | — | Unproven until a drill succeeds (R-22) |
| NFR-REL-05 | Worker killed mid-task is recoverable: leases, heartbeats, bounded retries, checkpoints, reaper | `08` §11, `06` | 5 | A killed step resumes or requeues within the bound | T-REL-03 | Prevents stuck work and orphaned resources (R-06) |
| NFR-REL-06 | Graceful degradation (Redis down ⇒ accept in DB; DB down ⇒ 503 + local works) | `03`, `16` §11 | 3, 8 | Each degraded mode behaves as documented, no cascade | T-REL-02 | Fail-closed by default at trust boundaries |
| NFR-PERF-01 | p95 API read latency < 300 ms at S2 `[ASSUMPTION]` | `13` §3.1 | 11 | Measured under load | T-PERF-01 | — |
| NFR-PERF-02 | p95 first task event < 2 s to an attached client `[ASSUMPTION]` | `13` §3.1, `07` §5 | 11 | Measured under load | T-PERF-02 | — |
| NFR-PERF-03 | p95 approval request → device decision < 5 s online `[ASSUMPTION]` | `13` §3.6 | 11 | Measured under load | T-PERF-03 | Latency here directly affects safety behaviour |
| NFR-PERF-04 | Sizing by formula for S1/S2/S3, not guesswork | `13` §3 | 11 | The formula's predicted throughput matches measurement | T-PERF-04 | — |
| NFR-PERF-05 | Throughput bounded so one tenant cannot degrade another | `13` §5 | 8, 11 | A hostile-tenant load run leaves others within tolerance | T-PERF-05 | Fairness is also an availability control for everyone else |

---

## 14. Security and privacy (`NFR-SEC-*`, `NFR-PRIV-*`)

| ID | Requirement | Design docs | Phase | Acceptance / evidence | Test | Security note |
|---|---|---|---|---|---|---|
| NFR-SEC-01 | Zero cross-tenant reads or writes, enforced in code and DB, proven by a suite | `06`, `10`, `11` | 2, 9 | The isolation suite has zero findings; RLS is live | T-TENANT-02 | The single most important control for a multi-tenant product |
| NFR-SEC-02 | Secrets encrypted at rest, never logged, never returned, never prompted without consent | `05`, `11`, `16` §4 | 1–5 | No secret in any sink assertion | T-SEC-04, T-ARCH-08 | Redaction failure fails closed |
| NFR-SEC-03 | Every state-changing request authenticated and authorised and audited | `07`, `10` | 2, 5 | Route enumeration denies unauthenticated; audit rows written | T-CON-02 | Deny-by-default route protection |
| NFR-SEC-04 | TLS 1.2+ (1.3 preferred) with HSTS; no cert pinning | `15` §12, `11` | 2, 9 | TLS configuration verified externally | — | Pinning rejected for operational risk (documented) |
| NFR-SEC-05 | Prompt injection cannot escalate privilege; no tool call authorised by model output alone | `10` §2, `11` T-LLM-01 | 6 | The injection corpus never yields execution | T-SEC-01, T-SEC-02 | The central safety claim of the product |
| NFR-SEC-06 | The sandbox prevents reads/writes outside declared workspaces and escape to the host | `09` §6 | 4 | The sandbox-escape corpus fails safely on real Windows | T-LOC-02 | Windows confinement is not VM-grade (RR-2) |
| NFR-PRIV-01 | Local-first default: with no remote provider, no content leaves the device | `03`, `09` §4.4 | 4, 5 | Network observation shows no egress in local-only mode | T-WIN-08 | Verified behaviour, not a promise |
| NFR-PRIV-02 | Configurable retention (default 90 d content / 400 d audit `[ASSUMPTION]`); verifiable deletion | `06`, `19` | 8 | A sweep proves both row and blob are gone | T-DATA-01 | Deletion must be provable, not asserted |
| NFR-PRIV-03 | Per-integration disclosure of shared data; org-level egress auditing | `11` §7, `12` §12 | 7 | Each connection shows what it shares; egress is audited | T-SEC-03 | Makes data movement visible to the user |
| NFR-PRIV-04 | GDPR-shaped posture (export, delete, restrict processing, records of processing); certification `[OPEN]` | `11` §7, `19` | 9 | Export/delete/restrict flows work and are documented | T-DATA-01 | Certification scope is `[OPEN]` (R-21) |

---

## 15. Observability, cost, maintainability

| ID | Requirement | Design docs | Phase | Acceptance / evidence | Test | Security note |
|---|---|---|---|---|---|---|
| NFR-OBS-01 | Correlation/trace ID propagated API → queue → worker → device → client | `16` §3 | 1, 8 | One `traceparent` spans the whole path | T-OBS-01 | Enables post-incident reconstruction |
| NFR-OBS-02 | OTel metrics/logs/traces; SLOs with error budgets; alerts tied to burn | `16` §6–§8 | 8 | A synthetic fault fires the correct alert with a runbook link | T-OBS-01 | Alert content must respect redaction |
| NFR-OBS-03 | Every incident has a runbook; every alert links to one | `16` §10 | 8 | Every alert entry has a linked runbook | — | An unactionable alert is an outage multiplier |
| NFR-COST-01 | Cloud cost per active user is a tracked metric with an alert threshold | `13` §9, `16` §6 | 8 | The metric exists and alerts at the threshold | — | Guards R-08 |
| NFR-COST-02 | Default execution location is the device; cloud compute is opt-in | `04` D-15, `03` | 0, 4 | A default-configured task never uses cloud compute | — | Keeps GPU cost at zero and privacy intact |
| NFR-MAINT-01 | Forward-only, reviewed migrations safe to run while the previous version is live | `15` §9 | 1, 9 | Old code + new schema works; expand/contract enforced in CI | T-MIGR-01 | A bad migration is a data-loss risk, so it is gated |
| NFR-MAINT-02 | One-command local bring-up; no Kubernetes for development | `15` §2 | 1 | `docker compose up` yields Postgres + Redis (+ MinIO) | — | Keeps the developer loop honest and cheap (R-05) |
| NFR-MAINT-03 | Windows is a first-class dev and runtime target | `09`, `15` §14 | 1 | The Windows test matrix passes | T-WIN-01…09 | Windows-specific path/process semantics are a security surface |

---

## 16. Coverage findings

Stated honestly rather than glossed over:

| Finding | Requirements | Consequence |
|---|---|---|
| Requirements with **no dedicated test** planned | FR-AUTH-04/05/06, FR-TASK-08/09, FR-MODEL-04/06, FR-BILL-03, FR-NOTIF-01, FR-ADMIN-02, FR-UI-03, NFR-REL-01, NFR-REL-04, NFR-PERF-01…05 (measured by load runs, not unit tests), NFR-SEC-04 | These are either covered indirectly, deferred, verified operationally, or need a test added in the phase that implements them. Review at each phase gate. |
| Requirements explicitly **deferred** | FR-TASK-08, FR-TASK-09 (P2), FR-AUTH-05 (Phase 9 `[OPEN]`), FR-AUTH-06 (enterprise), FR-ADMIN-02 (P2), FR-INT-04 (P2) | Deferred by priority, not forgotten; each has a phase or an enterprise milestone. |
| Requirements whose **test is the load test itself** | NFR-PERF-01…05 | They cannot be proven by unit tests; `13` §6.2 defines the pass/fail criteria. |
| Requirements where the **control is a human process** | NFR-OBS-03, NFR-REL-04 (drills), FR-ADMIN-02, NFR-PRIV-04 | Documented in `16`/`19`; process controls are verified by drills and reviews, not CI. |
| Requirement pairs that **must be tested together** | NFR-SEC-01 + FR-ORG-03; NFR-SEC-05 + FR-DOC-03; FR-APPR-04 + FR-POL-02; NFR-REL-02 + FR-TASK-10 | Testing either alone gives false confidence. |
| The **safety core** (must never regress) | FR-APPR-02/04, FR-POL-01/02/03, NFR-SEC-05, NFR-SEC-06, NFR-SEC-01 | These are blocking CI gates at every milestone (`11` §9). |

---

## 17. Security-implication summary by milestone gate

Maps the requirement-level security work to the gates in
`11-security-threat-model.md` §9 (and the milestone names in
`17-implementation-roadmap.md`).

| Gate | Requirements that must be demonstrably satisfied |
|---|---|
| **M0** (end of Phase 5) | FR-AUTH-01/03, FR-ORG-03, FR-TASK-10, FR-TOOL-01/03, FR-APPR-02/03/04/07/08, FR-POL-01/02/03/05, FR-DEV-01/03, NFR-REL-02/03/05, NFR-SEC-02/03, NFR-SEC-05 (first tools) |
| **First external users** (end of Phase 8) | + FR-AUTH-04/07, FR-DEV-02/05/06/08, FR-UI-01/02/03/04, FR-NOTIF-02, FR-MODEL-05/07, FR-BILL-01/02, FR-ADMIN-01/03, NFR-SEC-01 (suite green), NFR-SEC-06, NFR-PRIV-01/02, NFR-REL-01/06, NFR-OBS-01/02/03, NFR-MAINT-01/03, NFR-PERF-05 |
| **Paid public release** (end of Phase 9) | + FR-CODE-02, FR-APPR-05/06 (scopes, second approver), FR-POL-04, FR-DOC-01/02/03, FR-BRW-01/02/03/04, FR-INT-01/02/03, FR-ORG-04/05, FR-UI-05, NFR-SEC-04, NFR-PRIV-03, NFR-REL-04 (drill), NFR-COST-01, NFR-MAINT-02 |
| **Enterprise readiness** (after Phase 11) | + FR-AUTH-06, FR-ADMIN-02, FR-MODEL-06, NFR-PRIV-04 (certification scope), plus the load/DR/chaos evidence in `13` §6.2 and `19` §4 |

---

## 18. Traceability completeness check

| Check | Result |
|---|---|
| Every `FR-*` in `02` appears in this document | `[FACT]` Yes — 85 of 85 |
| Every `NFR-*` in `02` appears in this document | `[FACT]` Yes — 29 of 29 |
| Every requirement maps to at least one design document | Yes, except `FR-TASK-08/09`, which are deferred and specified only in `02` (recorded above) |
| Every requirement maps to a roadmap phase or an explicit deferral | Yes |
| Every requirement has acceptance evidence | Yes |
| Every requirement has a test | **No** — the gaps are listed in §16 rather than hidden |
| Every safety-critical requirement is a blocking gate | Yes (§16, §17) |
| Requirements with no owner of their security note | None identified `[OPEN]` for further review at Phase 9 |

**Rule for the future.** When a new requirement is added to `02`, it must be added
to this document in the same change, with a design doc, a phase, acceptance
evidence, a test (or an explicit "no test" entry), and a security note. A
requirement that exists only in `02` is an unfinished design.

---

## 19. Open questions

| # | Question | Impact |
|---|---|---|
| Q-TR-1 | Which of the §16 untested requirements get real tests in their implementation phase? | Test debt; false confidence |
| Q-TR-2 | Should deferred P2 functional requirements (templates, scheduling) stay in v1 scope at all? | Roadmap length |
| Q-TR-3 | Does every requirement need a security note, or only trust-boundary ones? | Documentation effort vs. completeness |
| Q-TR-4 | How are requirement changes versioned once implementation starts (a requirements changelog)? | Drift between plan and product |
| Q-TR-5 | Which requirements are contractual for an enterprise customer, and therefore gated differently? | Enterprise gate scope |

Labels: `[FACT]` `[ASSUMPTION]` `[PROPOSED]` `[OPEN]`
