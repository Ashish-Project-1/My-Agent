# 13 — Scalability and Capacity Planning

> Part of the Universal AI Agent planning set. Read `00-executive-summary.md`
> first, then `03-system-architecture.md` (deployables, service-split triggers)
> and `06-database-design.md` (entity catalogue) before this document.

**Honesty statement.** `[FACT]` No application code, no queue, no database and
no worker exists in this repository today. Every quantity in this document is a
planning **assumption**, not a measurement. `[ASSUMPTION]` figures are marked
inline and are expected to be replaced by load-test results from Phase 11
(see `14-testing-strategy.md`). Where a number is an *input* to a decision we
state it as an assumption; where a number is a *derived* result we show the
formula and the inputs so a reader can re-run it with better data.

---

## 1. What "scale" means here

The brief targets **100,000+ registered users**. `[FACT]` That is a
registration target, not a concurrency target. `[ASSUMPTION]` Typical
local-first developer/SMB SaaS products convert 5–15% of registrations into
monthly active users, and a small fraction of those are concurrently active.
The plan therefore sizes for the **active and concurrent** numbers, and treats
the 100,000 registration target as a data-volume and identity-management
problem (cheap) rather than a compute problem (expensive).

Three scenarios are used consistently across the plan. They are defined here
once and referenced everywhere else as **S1**, **S2**, **S3**.

| ID | Name | Registered | Monthly active (MAU) | Daily active (DAU) | Peak concurrent tasks `[ASSUMPTION]` |
|---|---|---|---|---|---|
| S1 | Dev / single team | ~10 | ~5 | ~3 | 1–2 |
| S2 | Initial production | 2,000 | 600 | 300 | 15–40 |
| S3 | Target scale | 100,000 | 20,000 | 12,000 | 300–1,200 |

Rationale for the derived columns:

- `MAU = 30% of registered` for S2 and `20%` for S3 — later cohorts are more
  diluted. `[ASSUMPTION]`
- `DAU = 50% of MAU` for S2 and `60%` for S3. `[ASSUMPTION]`
- Peak concurrent tasks ≈ `1–5% of DAU`, because a task runs for seconds to an
  hour and each user runs few tasks per day and the execution is **local**.
  `[ASSUMPTION]`

**The load-bearing consequence of local-first execution.** Because tasks run on
the user's own machine by default (decision D-15, `03`), the cloud control plane
in S3 has to handle concurrency in the *hundreds*, not the *hundreds of
thousands*. The 100,000-registration target scales the **database rows, object
storage, device registry and identity system**, all of which are far cheaper to
grow than live compute. This is the single most important sizing fact in the
plan, and it is the reason cloud GPU inference is explicitly out of the MVP
(`04` ADR on execution location).

---

## 2. Cost model shape (qualitative)

`[FACT]` From `00` §cost: S2 is projected at **USD 150–400 / month** and S3 at
**USD 1,500–6,000 / month**, both `[ASSUMPTION]`, with **no GPU cost** while
execution is local-first. This document does not re-derive those figures; it
explains which cost lines dominate and which are variable.

| Cost line | S2 shape | S3 shape | Dominated by | Control |
|---|---|---|---|---|
| Managed PostgreSQL | `[ASSUMPTION]` 30–50% of cloud spend | 40–60% | storage GB + IOPS + instance size, not CPU | retention windows, partitioning, archival, connection pooling |
| Managed Redis / Valkey | 10–20% | 10–20% | memory for queue data, not instance count | short job retention after ack, avoid unbounded streams |
| API/worker compute | 20–30% | 15–25% | idle replicas more than load | autoscale on queue depth, not CPU |
| Object storage + egress | 5–10% | 10–20% | artifact bytes and retention | artifact TTL, compression, per-org quotas |
| Observability | 5–15% | 10–25% | log/trace volume | sampling, redaction-at-source, metric cardinality discipline |
| Model inference | **0** (local) | **0** unless opted in | — | per-task, per-org opt-in; consent notice |
| Browser/cloud execution | 0 | opt-in only `[OPEN]` Q-T6 | egress + compute | default off |

`[OPEN]` The provider choice (Q-T2 managed PostgreSQL/Valkey, Q-T4 container
runtime) changes these proportions substantially and is not resolved
(`05-technology-stack.md`). This document is provider-agnostic by design: it
prices **shapes**, not SKUs.

---

## 3. Capacity model by component

For each component: what grows, what the binding constraint is, the sizing
formula, and the first thing that breaks. All coefficients are `[ASSUMPTION]`
until Phase 11 load tests replace them.

### 3.1 API (NestJS modular monolith)

- **Grows with:** requests/second, which grows with DAU and client polling/SSE.
- **Binding constraint:** database connections and event-loop saturation, not CPU
  (I/O-bound). Postgres connection count is the classic first failure.
- **Sizing formula:**

  ```
  peak_rps   = DAU x req_per_user_per_day / 86400 x burst_factor
  api_replicas = ceil(peak_rps / rps_per_replica)
  db_conns   = api_replicas x pool_per_replica + worker_replicas x pool_per_worker
  ```

  With `[ASSUMPTION]` `req_per_user_per_day = 200` (task polling is replaced by
  SSE, so this is mostly CRUD, not polling), `burst_factor = 5`,
  `rps_per_replica = 150`:
  - S2: `300 x 200 / 86400 = 0.7 rps` steady, `~3.5 rps` burst → **2 replicas**
    (one is HA, not throughput). `[ASSUMPTION]`
  - S3: `12000 x 200 / 86400 = 27.8 rps` steady, `~139 rps` burst →
    **2–4 replicas**. `[ASSUMPTION]`
- **First thing that breaks:** `db_conns`. `[ASSUMPTION]` a pooled budget of
  `~200` connections total must be split between API replicas, 4 worker
  pools, migrations and admin tooling. `06` §pooling already mandates a pooler
  (PgBouncer-class) or a serverless-friendly driver; this document adds the
  rule that **total connection budget is a tracked, alerted metric** so a
  replica-count autoscale cannot silently exhaust Postgres.
- **SSE/event stream** is the special case: long-lived connections, so
  `api_replicas x events_per_replica` is the real limit. `[ASSUMPTION]`
  `events_per_replica = 5,000` → S3 needs **1–2 replicas** for the stream,
  which is why the stream is a separately scalable deployment unit even inside
  the modular monolith (`03` §service-split triggers).

### 3.2 Workers (worker-code, worker-browser, worker-document, worker-maintenance)

- **Grows with:** cloud-executed and cloud-verified work, not with total users.
- **Binding constraint:** per-worker concurrency caps (browser contexts,
  memory) and queue wait time, not CPU on this class of work.
- **Sizing formula:**

  ```
  queue_wait_s = queue_depth / (worker_replicas x concurrency_per_replica x svc_rate)
  worker_replicas = ceil(offered_load / (concurrency_per_replica x svc_rate x target_utilisation))
  ```

  With `[ASSUMPTION]` local-first means **<10% of tasks touch a worker** in S2
  and **<20%** in S3 (verification, artifact processing, cloud-requested
  execution, maintenance):
  - S2: peak `40 x 10% = 4` concurrent cloud jobs → **1–2 replicas per worker
    type**, mostly for isolation between classes. `[ASSUMPTION]`
  - S3: peak `1,200 x 20% = 240` concurrent cloud jobs, skewed heavily to
    browser and document → `worker-browser` **10–25 replicas**,
    `worker-document` **5–10**, `worker-code` **3–6**, `worker-maintenance`
    **1–2**. `[ASSUMPTION]`
- **Per-org fairness is a correctness requirement, not a nicety**
  (NFR-PERF-05). One tenant submitting 1,000 browser tasks must not starve
  everyone else. Design: rate limits at admission plus per-org queue
  partitioning or weighted fair dequeue. This is the single most likely
  production incident at S3.
- **First thing that breaks:** orphaned browser contexts (R-06). Watchdog
  reaper + hard per-task wall-clock are already required (`08` §7, NFR-REL-05).

### 3.3 PostgreSQL

- **Grows with:** registrations and retained content — this is the component the
  100k target actually stresses.
- **Row-growth estimates** `[ASSUMPTION]`, using `06` retention defaults
  (task content 90 d, task metadata 400 d, audit 400 d, `task_events` 30 d):

  | Table | Rows/user/day | Retained rows @ S3 | Note |
  |---|---|---|---|
  | `tasks` | 2 | 12,000 DAU x 2 x 400 d ≈ **9.6M** | metadata retained 400 d |
  | `task_steps` | ~15 per task | ≈ **144M** | the biggest table by far |
  | `task_events` | ~10 per step | 30 d window ≈ **43M** | partitioned daily/weekly |
  | `audit_events` | ~5 | 400 d ≈ **24M** | append-only, partitioned |
  | `usage_records` | ~10 | 25 months ≈ **109M** | immutable, roll-up driven |
  | `policy_decisions` | ~15 per task | 400 d ≈ **72M** | audit-critical, partitioned |
  | `context_chunks` | rebuildable | **rebuildable, not retained** | never counted as growth |

  `[ASSUMPTION]` At these row counts, total storage is **tens of GB to low
  hundreds of GB** for the relational data — entirely ordinary for managed
  Postgres. The problem is not size; it is **partition maintenance, index
  bloat and vacuum on the hot append-only tables**.
- **Partitioning triggers (measured, not guessed):**
  - `task_events`, `audit_events`, `policy_decisions` → partition by month when
    the table exceeds `[ASSUMPTION]` 50 GB or when a retention sweep exceeds
    `[ASSUMPTION]` 5 minutes.
  - Archive older-than-retention partitions to object storage rather than
    deleting row-by-row.
- **Read scaling:** not needed at S3 for the read path; the read path is
  tenant-scoped and index-covered (`06` §4). Read replicas are introduced only
  if a measured trigger fires (§7).
- **First thing that breaks:** a missing tenant-leading index on a hot query, or
  a retention sweep that locks. Both are detectable in Phase 11.
- **Connection budget** is shared with §3.1 and is the top-ranked scaling
  signal.
- `[OPEN]` Whether `pgvector` in the primary database suffices for
  `context_chunks` embeddings at S3 (Q-T7). If not, retrieval moves out of the
  primary database; until measured, assume it does **not** scale past
  `[ASSUMPTION]` a few million chunks per tenant.

### 3.4 Redis / BullMQ

- **Grows with:** in-flight job count, delayed jobs, and the retained history of
  completed/failed jobs.
- **Binding constraint:** memory. Job payloads and results must be small;
  anything large lives in object storage and is referenced by key.
- **Rules (design, not tuning):**
  - Remove completed jobs promptly (`[ASSUMPTION]` keep 24 h / last N per
    queue) — retention is the usual cause of Redis OOM.
  - Cap job payload size and refuse oversized payloads at admission.
  - One queue family per work class, with a DLQ per class.
  - `task_events` live in Postgres, **never** in Redis as the system of record,
    so a Redis loss cannot lose task history.
- **First thing that breaks:** memory from retained completed jobs. Mitigation
  is a retention setting, not more RAM.
- `maxmemory-policy` must never be `noeviction`-default carelessness: with
  BullMQ, eviction of queue keys silently loses work. `[FACT]` This is a known
  BullMQ/Redis footgun; the plan requires an explicit, documented policy and a
  monitor on `evicted_keys` (feeds `16`).

### 3.5 Object storage

- **Grows with:** artifacts (diffs, reports, screenshots, datasets, snapshots)
  and partition archives.
- **Sizing formula:**

  ```
  bytes = MAU x artifacts_per_user_per_day x avg_artifact_bytes x retention_days
  ```

  With `[ASSUMPTION]` `artifacts_per_user_per_day = 5`,
  `avg_artifact_bytes = 2 MB`, retention 90 d:
  - S2: `600 x 5 x 2 MB x 90 ≈ 540 GB` `[ASSUMPTION]`
  - S3: `20,000 x 5 x 2 MB x 90 ≈ 18 TB` `[ASSUMPTION]`

  This is the largest *variable* cost line and the one most sensitive to the
  average-artifact assumption. Controls: per-org artifact quotas, lifecycle
  tiering, compression, and a hard rule that agent logs are capped and never
  stored as unbounded artifacts.
- **First thing that breaks:** egress charges, not capacity — for example a user
  repeatedly downloading a large dataset. Lifecycle policies and quota
  accounting address this.

### 3.6 Device channel (outbound WSS)

- **Grows with:** online devices and heartbeats.
- **Sizing formula:**

  ```
  conns = online_devices x conns_per_device(1, plus reconnects)
  msg_rate = conns x (heartbeat_rate + event_rate)
  ```

  With `[ASSUMPTION]` 1.5 devices per DAU and a 30 s heartbeat:
  - S2: `450 conns`, `~15 msg/s` — trivial.
  - S3: `18,000 conns`, `~600 msg/s + task-event relay` — a real, but modest,
    load. `[ASSUMPTION]`
- **Binding constraint:** per-node connection count and reconnect storms after a
  deploy. Design: jittered reconnect backoff, sticky-free design (any node can
  serve any device), and `device_commands` durability in Postgres so a node
  restart never loses an approval decision (`06`).
- **First thing that breaks:** a synchronized reconnect storm. The jitter rule is
  a requirement, not an optimisation.

### 3.7 Local runner (the user's machine)

- `[FACT]` The reference development machine has **23.3 GiB RAM**, a **GTX 1650
  with 4,096 MiB VRAM**, and only **11.9 GB free on `C:`** (`00`, `01`, `09`).
  This is not a full production capacity profile; it is the *floor* the product
  must work on.
- **Capacity of one runner** `[ASSUMPTION]`: **1–2 concurrent tasks** on the
  reference machine, with a small quantised local model. The product must
  therefore enforce a local concurrency limit and queue locally beyond it,
  rather than starting tasks that will thrash VRAM.
- `[FACT]` A 4 GiB VRAM GPU cannot host 7B-class models at useful context
  without partial CPU offload (`00`, `09`). The UI must present model fit
  honestly (`12`) — a capacity decision with UX consequences.
- **First thing that breaks:** VRAM exhaustion when a user starts three browser
  tasks and a local model load simultaneously. Mitigation: local admission
  control + a runner-side resource gate.

---

## 4. Scaling-unit map

`[FACT]` `03-system-architecture.md` defines documented service-split triggers;
this table only states which unit scales independently at each scenario. It is
**not** an authorisation to split services early — D-01 holds until a trigger
fires.

| Deployable | S2 | S3 | Scale signal | Notes |
|---|---|---|---|---|
| `api` (HTTP) | 2 | 2–4 | p95 latency, RPS, conn pool | HA minimum 2 |
| `api` (SSE stream) | 1 | 1–2 | open connections, delivery lag | separate unit |
| `worker-code` | 1 | 3–6 | queue wait | isolation-driven early |
| `worker-browser` | 1 | 10–25 | queue wait, browser contexts | first to need real scaling |
| `worker-document` | 1 | 5–10 | queue wait | OCR/parse bound |
| `worker-maintenance` | 1 | 1–2 | cron jitter | never scale-to-zero in prod |
| Postgres | 1 primary | 1 primary (+ replica only on trigger) | conns, storage, IOPS | partition on row-count trigger |
| Redis | 1 | 1–2 (+ HA) | memory, evicted_keys | never evict queue keys |
| Device gateway | in-process | in-process or split | conns/node, reconnect rate | split only if a trigger fires |
| Object storage | managed | managed | bytes, egress | lifecycle policies first |

---

## 5. Admission control and fairness (why capacity is also a product rule)

Capacity is not only "add replicas". The following are **requirements**, and
they are the cheapest way to keep S3 affordable:

1. **Per-org rate limits** at the API edge, sized so one tenant cannot consume a
   meaningful share of a shared queue (NFR-PERF-05).
2. **Per-org quotas** with soft warning and hard stop (FR-BILL-02); the hard
   stop must be enforced at admission, not after the work is done.
3. **Local-first default** (NFR-COST-02, D-15) — the cheapest possible capacity
   decision is the one that does not consume our capacity at all.
4. **Task budgets** (`08` §7: steps, wall-clock, tokens, cost, retries) bound the
   worst-case work per task, so one runaway task cannot pin a worker.
5. **Queue-depth-based autoscaling**, not CPU-based — this class of work is
   I/O-bound and CPU signals lag the real bottleneck.
6. **Backpressure before saturation** — refuse new cloud execution with a clear
   error rather than degrading every tenant's latency (NFR-REL-06).

---

## 6. Load-test plan (Phase 11)

`[OPEN]` The load-testing tool is unresolved (Q-T5: k6 vs Artillery vs Locust).
The plan below is tool-agnostic.

### 6.1 Workloads to simulate

| Load shape | What it models | Target scenario |
|---|---|---|
| Auth + CRUD sweep | Sign-in, list tasks, open task, page history | S2 and S3 |
| SSE fan-out | N clients streaming task events | S3 |
| Task admission burst | Thousands of task creates in a short window | S3 |
| Approval round-trip | Approval request → device decision → resume, at volume | S3 |
| Device fleet heartbeat | Many simulated devices online, reconnect storm after a synthetic deploy | S3 |
| Worker queue saturation | Cloud-executed jobs far exceeding capacity | S3 |
| Cost/retention soak | 72 h of steady traffic with sweeps running | S2 |

### 6.2 Pass/fail criteria

Criteria are tied to requirement IDs so the test has a definition of success
beyond "it did not crash":

| # | Criterion | Requirement | Threshold |
|---|---|---|---|
| C1 | p95 API read latency | NFR-PERF-01 | < 300 ms server-side |
| C2 | p95 event delivery to attached client | NFR-PERF-02 | < 2 s |
| C3 | p95 approval→device decision latency | NFR-PERF-03 | < 5 s when device online |
| C4 | Task acceptance durability under worker kill / Redis restart | NFR-REL-02 | 0 lost accepted tasks |
| C5 | No duplicate side effects under retries and replays | NFR-REL-03 | 0 duplicates |
| C6 | Worker crash recovery | NFR-REL-05 | 100% of leased work resumes or re-queues within `[ASSUMPTION]` 60 s |
| C7 | Zero cross-tenant leakage under concurrent multi-tenant load | NFR-SEC-01 | 0 findings |
| C8 | Graceful degradation behaviour | NFR-REL-06 | documented responses, no cascade |
| C9 | Fairness under a hostile tenant | NFR-PERF-05 | other tenants' p95 within `[ASSUMPTION]` 2x of their steady-state p95 |
| C10 | Cost per active user within projection | NFR-COST-01 | within the S2/S3 bands in §2 |

A run that fails any criterion is not "a slow test" — it is a **defect with an
owner**, and the criterion is re-run after the fix.

### 6.3 Explicit non-goals

Load testing does **not** attempt to prove the 100,000-registration target as
concurrency. It proves the S2 and S3 **active** profiles in §1. Conflating the
two is the most common way to over-spend on capacity.

---

## 7. Measured scaling triggers

`[FACT]` `03` §service-split triggers already exist; `cloud-execution-only`
work never justifies an early split. The triggers below are **capacity** triggers
and are deliberately measured, not modelled. Until a trigger fires, do not scale
the corresponding unit.

| # | Trigger (measured) | Action | Reversible? |
|---|---|---|---|
| ST-1 | Total DB connections approach `[ASSUMPTION]` 70% of the plan limit | add a pooler / raise budget; if sustained, split read path | yes |
| ST-2 | API p95 sustained above target with healthy DB | add API replica; verify conn budget first | yes |
| ST-3 | Queue wait time exceeds `[ASSUMPTION]` 30 s p95 for a work class with idle capacity elsewhere | add replica of that worker class | yes |
| ST-4 | A hot append-only table exceeds `[ASSUMPTION]` 50 GB or its retention sweep exceeds 5 min | partition by month | yes |
| ST-5 | Redis memory above 70% with completed-job retention already reduced | add HA/replica or shard by queue family | yes |
| ST-6 | Object storage egress or bytes exceed budget | tighten lifecycle/quota; tier cold data | yes |
| ST-7 | Device reconnect storm causes delivery lag after deploy | add gateway node; re-tune jitter | yes |
| ST-8 | One tenant's load measurably degrades another's p95 despite limits | isolate that workload class into its own pool | yes |
| ST-9 | Only at S3 with sustained demand for **cloud** execution | introduce Kubernetes and cloud execution capacity (Phase 10) | **costly** |
| ST-10 | Local model fit blocks a paid feature for a large user segment | evaluate a managed inference option `[OPEN]` | **costly** |

ST-9 and ST-10 are the two irreversible-cost decisions; both require an explicit
recorded decision (ADR) and a budget approval, never an implicit "just scale it".

---

## 8. Data lifecycle and retention as capacity policy

Retention (`06`) is the primary lever on database and object-storage growth, and
therefore on cost. Rules:

- Defaults: task content **90 d**, task metadata **400 d**, `task_events`
  **30 d**, audit **400 d** (contract-up to 7 y), usage **25 months**.
  All `[ASSUMPTION]`.
- Deletion must be **verifiable** (NFR-PRIV-02): a sweep records what it deleted,
  and a per-org export/delete request is testable (see `14-testing-strategy.md`
  retention tests).
- Archived partitions move to object storage with lifecycle expiry rather than
  row-by-row deletion, so the sweep cost is O(partitions), not O(rows).
- Retention changes are **per-org settings** (FR-ORG-04) and therefore a
  capacity variable the product exposes — the plan must not assume a single
  global retention.

---

## 9. Cost-awareness guardrails

1. **No GPU spend in the MVP** (D-14). Cloud inference is a separate, opt-in
   capability with its own budget.
2. **Cost per active user is a tracked metric with an alert threshold**
   (NFR-COST-01) — see `16-observability-and-reliability.md` for the metric.
3. **Autoscale on the right signal** (queue depth, connection pressure) so idle
   replicas are not paid for.
4. **Non-production teardown** is a checklist item (`19`), because forgotten
   staging databases are a real S3-era cost leak.
5. **Observability volume is a first-class cost line** — sampling and
   redaction-at-source are cheaper than paying to store what we should not have
   logged.
6. **Every "scale it" decision is recorded** with the trigger that fired
   (§7), so cost growth is explainable and reversible.

---

## 10. What would falsify this plan

Stated openly, because a capacity plan that cannot fail is not a plan:

- **If local-first adoption is low** — i.e. most users configure a remote
  provider and push execution to the cloud — then S3 concurrency is 10–50x
  higher than assumed and the compute line dominates. `[OPEN]` This is the
  largest unvalidated assumption in the entire plan.
- **If average artifact size is far above 2 MB** — e.g. users attach large
  datasets — object storage becomes the dominant cost.
- **If per-task step counts are far above the assumed ~15** — the largest table
  (`task_steps`) grows super-linearly and partitioning/archival must move
  earlier.
- **If remote-provider latency dominates** the planner/executor loop, more
  retries and re-plans occur, inflating both `task_steps` and cost.

Each of these is dictionary-tracked in `20-open-questions-and-assumptions.md`
and monitored via the metrics in `16`.

---

## 11. Open questions

| # | Question | Impact | Revisit |
|---|---|---|---|
| Q-SC-1 | Real DAU:registered ratio for this product category | Sizes everything | after 90 days of S2 data |
| Q-SC-2 | Real share of tasks that require cloud execution | The dominant cost variable | after S2 usage data |
| Q-SC-3 | Managed Postgres/Valkey provider and its exact IOPS/connection limits (Q-T2) | Connection budget and cost shape | Phase 2 |
| Q-SC-4 | Whether `pgvector` in the primary DB suffices (Q-T7) | Retrieval architecture and DB growth | Phase 6/7 |
| Q-SC-5 | Real average artifact size and artifact TTL tolerance | Storage cost | after S2 usage data |
| Q-SC-6 | Whether per-org queue partitioning or weighted fair dequeue is required for fairness | Architecture of the queue layer | Phase 5 |
| Q-SC-7 | Load-testing tool (Q-T5) and whether ephemeral per-PR environments can host S2-scale runs | Cost and realism of Phase 11 | Phase 11 |
| Q-SC-8 | Whether a cloud-execution paid tier is worth its cost and complexity | ST-9/ST-10 decision | after S2 revenue data |
| Q-SC-9 | BullMQ retention defaults that keep Redis bounded without losing DLQ evidence | Reliability vs. memory | Phase 5 |
| Q-SC-10 | Whether S3 needs a read replica at all | Cost | on ST-1/ST-2 firing |

---

## 12. Traceability

| Requirement | Where addressed here |
|---|---|
| NFR-PERF-01 | §3.1 sizing, §6.2 C1 |
| NFR-PERF-02 | §3.1 SSE unit, §6.2 C2 |
| NFR-PERF-03 | §3.6 device channel, §6.2 C3 |
| NFR-PERF-04 | This document is the sizing model for the three scenarios |
| NFR-PERF-05 | §3.2, §5, §6.2 C9 |
| NFR-REL-02/03/05/06 | §3.3, §3.4, §6.2 C4/C5/C6/C8 |
| NFR-SEC-01 | §6.2 C7 (multi-tenant load) |
| NFR-COST-01/02 | §2, §5, §9, §6.2 C10 |
| FR-BILL-01/02 | §5 admission control, §9 |
| FR-DEV-04 | §3.6 reconnect/offline handling |
| FR-TASK-07 | §5 budget bounds |
| NFR-MAINT-03 | §3.7 Windows runner floor |

Labels: `[FACT]` `[ASSUMPTION]` `[PROPOSED]` `[OPEN]`
