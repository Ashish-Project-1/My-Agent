# 09 — Local Runtime Design (Windows)

| | |
|---|---|
| Status | Planning only. `[PROPOSED]`. Nothing is installed on the reference machine. |
| Owner | Local runtime |
| Target | Windows 11 (reference machine: Ryzen 5 5600H, 23.3 GiB RAM, **4 GiB VRAM**, 11.9 GB free on `C:`) |
| Related | `03` §5.10–5.11, `08` (engine), `10` (policy/approval), `11` (threats), `13` (capacity) |

## 1. Purpose and positioning

The local runner is the component that makes the product local-first: it hosts
the agent loop, executes tools under policy, contains them in a sandbox, drives
a browser, runs local models, and talks to the cloud **outbound only**. It must
also work usefully with no cloud at all.

`[FACT]` Relevant environment realities: Ollama, pnpm and `psql` are not
installed; Docker 29.6.1 with WSL2 (`docker-desktop`) is present; `C:` has
11.9 GB free; the GPU is a GTX 1650 with **4096 MiB** VRAM (not the 8 GB the
brief assumed).

## 2. Process and component model

`[PROPOSED]` Four processes, deliberately separated so that a crash in one does
not take down the others:

| Process | Role | Runs as | Lifetime |
|---|---|---|---|
| `ua-runner` (service) | Device session, command channel, task loop orchestration, policy evaluation, event buffering, sandbox supervision | Windows service (LocalSystem is **not** required; a per-user service or scheduled task at logon is preferred — see §5) | Always, starts at boot/logon |
| `ua-tray` (UI shell) | Status, workspace picker, pending approvals, diagnostics, pause/resume, "stop all work" kill switch | Interactive user session (Electron shell or tray app) | While the user is logged in |
| `ua-sandbox-host` | Executes one tool step with resource caps; spawned per step (or one worker pool per workspace) | Child of the service, restricted token / AppContainer / job object | Per step |
| `ua-browser-host` | Playwright driver + browser processes | Child of the service, own job object | Per browser-using task step |

Why a separate sandbox host rather than in-process execution: a tool that
crashes, hangs, allocates without limit, or escapes must not be able to take
the runner down or inherit its privileges. The runner keeps no user secrets in
the sandbox host's environment.

Interfaces:
- Runner ↔ cloud: WSS `wss://api.<domain>/v1/devices/{id}/channel` (or
  long-poll `GET /v1/devices/{id}/commands?cursor=`).
- Runner ↔ tray/IDE: loopback HTTP + WS on `127.0.0.1:<port>` (dynamic port
  written to a per-user file), authenticated with a per-install token stored in
  the OS credential store.
- Runner ↔ sandbox host: a length-prefixed JSON/binary protocol over stdin/stdout,
  plus a control channel for kill/cancel and resource telemetry.
- Runner ↔ Ollama: `http://127.0.0.1:11434` (Ollama's default), loopback only.

## 3. Device identity and registration

| Step | Design |
|---|---|
| 1. Generate keys | On first run, generate an **Ed25519** key pair into the Windows credential store (or DPAPI-protected file under `%LOCALAPPDATA%`). The private key never leaves the machine and is never uploaded or logged |
| 2. User initiates | The user creates a pairing code in the web app (`POST /v1/devices/pairing-codes`) and sees a short code + expiry (`[ASSUMPTION]` 10 minutes, single use) |
| 3. Device registers | `POST /v1/devices` with the pairing code, public key, fingerprint, OS, runner version and a capability report. Server stores the key and returns the device id |
| 4. Channel authentication | The device proves possession: the server sends a nonce, the device signs `nonce ‖ deviceId ‖ timestamp ‖ channelId`; the server verifies against the stored public key. Session is short-lived and re-proven on reconnect with a fresh nonce (replay protection) |
| 5. User-bound authority | The device acts **only** within the organization and user that approved it, and only for tasks assigned to it. A device token cannot call user endpoints (no `user:*` scopes) |
| 6. Revocation | `POST /v1/devices/{id}/revoke` → status `revoked`, all pending grants for that device revoked, all `device_commands` expired, the live channel is closed, and subsequent channel auth fails. The device learns of revocation on its next attempt and wipes cached task payloads + tokens |

`[OPEN]` Whether enterprise deployments need per-device certificates (mTLS)
in addition to the key pair. Proposal: not in v1; revisit for on-prem.

## 4. Communication protocol

| Aspect | Design |
|---|---|
| Transport | WSS (TLS 1.2+, 1.3 preferred) on 443; long-poll fallback when a proxy blocks WebSockets |
| Envelope | Every server→device command: `{ commandId, taskId, stepId, kind, payload, payloadDigest, policyVersion, issuedAt, expiresAt, traceId }`. Every device→server message: `{ messageId, commandId, kind, payload, payloadDigest, sentAt, traceId }` |
| Integrity | `payloadDigest = sha256(canonicalJson(payload))`. The device verifies the digest before acting and rejects a mismatch as a security event |
| Commands | `task.assign`, `step.execute`, `step.cancel`, `policy.update`, `device.revoke`, `config.update`, `upgrade.request`, `diagnostics.request` |
| Durability | Commands are persisted in `device_commands` with a monotonic `seq`; the device stores its cursor and drains on every (re)connect. The channel is a courier, never the queue |
| Idempotency | Device-executed steps are idempotent by `stepId` + `idempotencyKey`; results are reported with `commandId` so duplicates are dropped |
| Offline buffer | Device-reported events/results are buffered locally (bounded, `[ASSUMPTION]` 50 MB / 7 days) and replayed on reconnect; each has a stable id so replays are safe |
| Heartbeat | Every 30 s `[ASSUMPTION]` with a capability + resource summary; the cloud marks a device offline after 90 s of silence and re-checks after 5 min before moving tasks to `WAITING_DEVICE` |
| Reconnect | Exponential backoff 1 s → 60 s with full jitter; resume by cursor; never tight-loop |
| Bandwidth discipline | Large payloads never travel over the channel: artifacts/results > 64 KB `[ASSUMPTION]` go directly to/from object storage via pre-signed, single-object, short-TTL URLs |
| Clock trust | The device never trusts its own clock for authorisation decisions; expiries are re-validated with server-provided times, and a large skew is surfaced as a warning |

`[PROPOSED]` Every server→device command is an *advisory intent*: the device
re-evaluates policy locally before executing (defence against a compromised
control plane or a replayed/forged command). A step the local policy denies is
reported as `policy_denied`, not silently executed.

## 5. Windows service and process management

| Concern | Design |
|---|---|
| Service install | A signed installer registers the iservice (node-windows-style wrapper or WinSW). Runs as the interactive user's context where the agent must see user files; a separate privileged helper is **not** planned because the product must not require admin rights for routine work |
| Startup | Boot/logon start with auto-restart on crash (bounded: 5 restarts in 10 min, then pause with a tray notification `[ASSUMPTION]`) |
| Process trees | Spawn sandbox hosts inside a **Job Object** with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, memory/CPU limits, and a child-process cap. Killing the job kills the whole tree (Windows' equivalent of a process group) |
| Orphan cleanup | On service start, kill any orphaned `ua-sandbox-host`/browser processes from a previous run (tracked in a PID/journal file), and clean stale temp dirs |
| Graceful stop | On stop/suspend, finish or checkpoint the current step within 10 s `[ASSUMPTION]`, report `interrupted`, release leases, then exit. On resume, re-claim and continue |
| Sleep/hibernate | Detect `WM_POWERBROADCAST` suspend/resume; on resume, re-establish the channel, re-validate the device session, and re-claim work. Tasks that exceeded their deadline while asleep fail with a clear `deadline_exceeded_while_suspended` reason |
| Crash reporting | Local structured log (rotating, redacted) + an opt-in crash bundle the user can inspect before sending |
| Antivirus interference | Defender can slow or quarantine downloaded tool binaries and browser drivers. Mitigation: use signed, versioned binaries; place caches under an approved directory; document the exclusions users may choose; never require an exclusion to function |
| Path/symlink semantics | Windows path comparison is case-insensitive and case-preserving; reparse points (junctions/symlinks) and 8.3 short names are the classic escape vectors. All paths are canonicalised (`GetFinalPathNameByHandle` semantics) before the workspace check, and comparison is case-insensitive but case-preserving |
| Long paths / UNC | `\\?\` prefixing for > 260 characters; explicit rejection of UNC paths unless a workspace was registered as a share `[OPEN]` |
| Elevation | The runner never elevates. A step that requires elevation is refused with `requires_elevation` and is reported as `R3` for an explicit user decision outside the agent |

## 6. Workspace and filesystem permissions

| Rule | Design |
|---|---|
| Workspace registry | Users register directories (`mode`: read-only or read-write). The canonical (resolved) path is stored; the raw path is display-only |
| Enforcement point | The sandbox host receives only the workspace roots it needs for the step; every file operation is checked against the resolved path **after** canonicalisation and **before** the syscall |
| Escape vectors explicitly handled | `..` traversal; symlinks/junctions/reparse points; hard links; 8.3 short names; case-insensitive collisions; ADS (alternate data streams) refused; device paths (`\\.\`, `CON`, `NUL`); ZIP-slip on archive extraction; mount points |
| Deny list (always) | `%WINDIR%`, `%PROGRAMFILES%`, `%PROGRAMDATA%\opencode`, the credential store, `~/.ssh`, `~/.aws`, `.env*` (unless the workspace explicitly grants it), browser profile stores, and the runner's own config |
| External directories | Anything outside the workspace requires an `external_directory` grant (same model as the repository's existing OpenCode permission configuration `[FACT]`), which is a separate, explicit, expiring approval |
| Deletion semantics | Destructive filesystem operations (`delete`, `move`, truncate, mass-rename) are at least `R2`; recursive delete outside a task-created temp dir is `R3` |
| Snapshots | Code workspaces are git-snapshotted (commit or stash-ref) before the first mutating step, so every change is revertible. Non-git directories get a cheap file manifest + a content-addressed copy of changed files into the task's artifact area (`[ASSUMPTION]` cap 500 MB, beyond which the task is refused with `workspace_too_large`) |
| Network shares / removable media | Not a workspace by default; if allowed, marked `R2` and never snapshotted implicitly `[OPEN]` |
| Concurrency | One writer per workspace: a workspace lock prevents two tasks mutating the same directory simultaneously `[ASSUMPTION]` lock TTL 1 h with heartbeat; read-only tasks may share |

## 7. Shell and process execution

| Rule | Design |
|---|---|
| No shell strings | Commands are executed as an **argv array** with an explicit executable path. A shell is used only when a task explicitly needs one, which raises the risk class and shows the user the exact command line |
| Allow-list | The tool manifest declares permitted executables (`npm`, `node`, `git`, `python`, `pytest`, `docker`, …) with an org/device override. Anything else is denied by default |
| Argument hygiene | No interpolation of model output into argv without validation; argument values are passed as separate argv entries; patterns that enable command substitution are rejected (`;`, `&&`, `|`, backticks, `$()`, `%VAR%`, `^`, `&`) when a true shell is unavoidable |
| Environment | A minimal, explicitly constructed environment (no inherited tokens); secrets are injected only for the specific step that declared a need, then discarded |
| Working directory | Always inside the workspace; the cwd is canonicalised and re-checked |
| Resource caps | Job object: memory cap (default `[ASSUMPTION]` 2 GB per step), CPU rate limit, child-process cap, wall-clock timeout, and stdout/stderr byte caps (beyond which output is truncated with an artifact holding the full text) |
| Interactivity | No interactive stdin; a process that blocks on input hits the timeout and is reported clearly |
| Network | Per-step network policy: `none`, `loopback`, `allow_list`, `any`. Default for shell steps: `allow_list` (package registries, git hosts). `any` is `R2` |
| Elevation / UAC | Never; see §5 |
| Output capture | stdout/stderr to bounded buffers; binary output redirected to artifacts; secrets scrubbed by the redaction pass before storage |

## 8. Sandbox technology (and its honest limits)

`[PROPOSED]` Layered, with a default that requires nothing installed:

| Layer | Technology | Availability | Notes |
|---|---|---|---|
| L1 (default) | Restricted token + **Job Object** + explicit environment + argv allow-list + workspace path enforcement + resource caps | Always available (no extra install) | Blocks the "agent does something dumb or malicious-by-prompt" class; not a defence against a determined kernel-level attacker |
| L2 (opt-in, stronger) | Windows **AppContainer** / low-integrity token with capability grants, plus per-workspace filesystem ACLs | Always available, more setup | Used for untrusted third-party tool binaries |
| L3 (opt-in) | Container isolation (Docker/WSL2) for cloud parity or risky toolchains | Requires Docker (present on the reference machine, absent on many customer machines) | Must never be *required*, because it is not universally installable |
| L4 (cloud) | Separate pods/VM per tenant for cloud execution | Managed | Only for cloud-executed tasks |

Honest statement: **Windows desktop confinement is not a security boundary
equivalent to a VM.** The design compensates with (a) policy and approval at the
action level, (b) argv allow-lists instead of shell strings, (c) workspace
canonicalisation, (d) least privilege, and (e) full audit. Documentation must say
this plainly rather than implying VM-grade isolation.

## 9. Browser runtime

| Concern | Design |
|---|---|
| Engine | Playwright 1.64 with Chromium; the browser is installed with the runner (pinned, checksum-verified) |
| Isolation | One browser context per task; no profile sharing; ephemeral storage per context; downloads into a quarantine dir and never auto-opened |
| Credentials | The runner does **not** import the user's browser profile by default. "Use my signed-in session" is an explicit, `R3`, per-domain opt-in with a visible indicator, and the profile is copied, never the live one `[OPEN]` whether to support this at all in v1 — proposal: local-only, opt-in, per-domain |
| Risk classes | Navigation and reading = `R0`. Typing into a form, clicking submit/apply/delete/accept, uploading, downloading, changing settings, or logging in = `R2`+ with a preview of the exact action. Purchases, irreversible submissions, and credential entry = `R3` |
| Network policy | Per-org domain allow/deny lists enforced before navigation, plus per-step egress rules |
| Injection surface | Page content is `untrusted` taint. The agent may read it; it may never take an action justified *only* by page content without approval |
| Artifacts | Screenshot, DOM/HTML snapshot, console log, request/response summary (URL, status, method, timing — not bodies by default), and a trace on failure |
| Headless vs headed | Headless by default; a "watch it work" headed mode for debugging and for user trust; headed mode is never a security difference |
| Resource caps | Max concurrent contexts (`[ASSUMPTION]` 2 per device by default), memory cap, idle timeout that closes contexts, and forced cleanup of orphaned browser processes |
| Anti-bot realities | Some sites block automation. The product must fail honestly (`site_blocked_automation`) rather than promise evasion; stealth features are not planned |

## 10. Local model runtime (Ollama) — sized for this machine

`[FACT]` Ollama 0.40.4 is current and is **not installed** here. The GPU is a
GTX 1650 with **4096 MiB VRAM**; RAM is 23.3 GiB with ~4.9 GiB free during a
typical desktop session.

### 10.1 Install, storage and isolation

| Concern | Plan |
|---|---|
| Install | Ship Ollama as an optional, user-approved component of the runner install (not silently bundled). Detect an existing installation and reuse it |
| Storage | Set `OLLAMA_MODELS` to a drive with space — `[FACT]` `F:` has 133.9 GB free while `C:` has 11.9 GB. Surface a clear error if the drive is nearly full before pulling |
| Loopback only | Ollama binds `127.0.0.1:11434`; the runner refuses to talk to a non-loopback Ollama endpoint |
| Version pin | Pin a known-good Ollama version; auto-upgrading the user's existing Ollama is not planned unless they opt in |
| Integrity | Model pulls are verified by Ollama's own manifest digests; the runner records the model digest and re-verifies on use, so a swapped model file is detectable |

### 10.2 Model selection for 4 GiB VRAM (corrected from the brief's 8 GB)

| Tier | Example | Approx. size (Q4-class) | Fit on 4 GiB | Intended role |
|---|---|---|---|---|
| Tiny | `qwen2.5-coder:1.5b`-class | ~1 GB | Comfortable, high headroom | Summariser, smoke tests, CI fixture |
| **Small (default)** | `qwen2.5-coder:3b`-class | ~2 GB | **Comfortable** — the recommended default | Executor for mechanical steps; planning when the user has nothing bigger |
| Medium | `qwen2.5-coder:7b`-class | ~4.7 GB | **Partial offload only** (some layers on CPU) | Better planning/tool-calling, slower; must be *measured*, not assumed |
| Embeddings | `nomic-embed-text`-class | ~0.3 GB | Comfortable | Local retrieval |
| Vision (optional) | small VLM | 1–3 GB | Tight | Screenshot understanding `[OPEN]` — probably Phase 8+ |

`[ASSUMPTION]` With 4 GiB VRAM and 23 GiB RAM: the 3B class is fully
GPU-resident with an 8k context; the 7B class runs with partial offload at a
usable but noticeably slower rate. **No token-per-second figure is claimed here**
because no measurement has been taken — the first Phase 4 task is to measure
prompt-eval and generation rates for both, and record the results in this
document.

### 10.3 Context and concurrency

| Concern | Plan |
|---|---|
| Context window | 8k tokens default for the 3B model (keeps VRAM headroom); 16k only if measured to fit; the context engine sizes prompts to the *effective* window, reserving output tokens |
| Concurrency | `[ASSUMPTION]` 1 in-flight generation per GPU; a small queue with a per-task budget. Parallel generations thrash VRAM and are slower in aggregate |
| Keep-alive | Models unload after `[ASSUMPTION]` 5 idle minutes (`keep_alive`) to return VRAM to the desktop — important on a 4 GiB card also driving a display |
| Warm-up | Optional pre-warm for the default model at task start, with a visible "loading model" state rather than an unexplained delay |
| Health checks | `GET /api/tags` for inventory; a trivial generation call (bounded, e.g. "reply OK") as a liveness probe before a task; failures mark the model `unavailable` and remove it from selection |
| Windows process management | Supervise the `ollama serve` process (start if absent, restart if wedged with bounded attempts), and stop it on "pause all work" |
| GPU fallback | If CUDA is unavailable or VRAM is insufficient, fall back to CPU with a clear performance warning, and prefer a smaller model rather than thrashing |
| WSL2 fallback | If Windows-native GPU acceleration is broken, an optional WSL2 path can run Ollama (and heavier toolchains) — documented, **not** required, and not the default because it adds a second filesystem/network boundary and users may not have a distro installed (`[FACT]` only `docker-desktop` is present here) |
| Model adapter tests | A `MockProvider` with deterministic fixtures for unit tests; contract tests that run against a real Ollama only when a flag/env is set (skipped otherwise). Model tests must never be a CI blocker on machines without a GPU |

### 10.4 Offline operation

- Model inference is fully local; no cloud needed.
- Tasks whose steps are all device-executable can be created and completed
  offline if they were queued locally, or if the user runs the runner in
  standalone mode (`ua-runner run --goal "..."`).
- Approvals cannot be answered offline *from another device*; the local tray UI
  can answer its own pending approvals, and the decision is synced later (the
  grant is bound to the task/step/action digest, so a late sync is safe and
  auditable — it is recorded with the true decision time and a `synced_at`).
- Events buffer locally (bounded) and replay on reconnect.

## 11. Configuration and diagnostics

| Concern | Design |
|---|---|
| Config file | `%APPDATA%\UniversalAgent\config.json` (schema-validated, no secrets — secrets live in the credential store). Contains: cloud endpoint, device id, workspace roots, model preferences, sandbox profile, egress policy, log level |
| Local API | Loopback HTTP/WS for the tray and IDE: `/status`, `/tasks`, `/approvals`, `/models`, `/workspaces`, `/diagnostics`, `/logs?tail=`, `/stop-all` |
| Diagnostics bundle | A single command produces a redacted bundle: versions, config (secrets removed), last N log lines, model inventory, sandbox self-test result, network reachability, pending command count. Redaction is applied by the runner, and the user can preview the bundle before sending |
| Sandbox self-test | Verifies: workspace enforcement (a write outside the workspace must fail), argv validation, job-object kill works, symlink traversal is blocked, resource caps engage, temp dirs clean up. Run at install and on demand; **a failing self-test disables mutating tools** until fixed |
| Logs | JSON lines, rotating, `%LOCALAPPDATA%\UniversalAgent\logs`, redaction by a central allow-list; never log file contents or prompts by default (`--debug` enables content logging locally with a visible warning) |
| Kill switch | A tray "stop all work" that cancels tasks, kills job objects, unloads models, and refuses new commands until re-enabled |
| Update | Signed update feed; verify signature; staged rollout; keep the previous version for one-click rollback; never update in the middle of a running step |

## 12. Privacy: local vs remote inference

| Mode | What leaves the machine | Controls |
|---|---|---|
| Local-only (default) | Nothing except task metadata, events and artifacts the user shares; **no file contents** | Org setting `local_only`; the runner refuses remote providers when set |
| Remote provider allowed | The specific prompt/context sent to that provider, and the response | Per-org allow-list of providers; per-call consent flag (default: explicit consent for the first call per provider per session, or a documented org-level standing consent); an `audit_events` row per remote call with provider, model and token counts (never content); a visible indicator in the UI whenever remote inference is active |
| Cloud execution of a task | The task inputs and the workspace fragments the step needs | Requires org opt-in **and** per-task opt-in; the device tells the user exactly which files are uploaded; retention of uploaded content follows the org's retention setting and is deletable |

**Distributed vs centralised inference (explicit):**

- *Distributed:* each user's machine runs its own models. Our platform cost for
  inference is **zero**; throughput scales with the user base; privacy is
  structurally better; the limit is the user's hardware (here: 4 GiB VRAM).
- *Centralised:* we host GPUs and serve inference. Cost is per-GPU-hour
  (order-of-magnitude `[ASSUMPTION]` USD 0.5–2.50 per GPU-hour for a
  16–24 GB card class), latency is uniform, users with weak machines get a
  good experience, but we inherit data-residency, cost and capacity risk.
- Our plan: **distributed by default, centralised never in the MVP**. If it is
  ever offered, it is a metered, opt-in per-task feature with its own
  cost/quota model (`13`), and the small reference machine is proof of why it
  cannot be the default.

## 13. Device revocation and lost/stolen devices

| Scenario | Behaviour |
|---|---|
| User revokes a device | Immediate: channel closed, grants revoked, commands expired, tokens invalidated, tasks moved to `WAITING_DEVICE` or failed per policy |
| Device offline when revoked | On next connect, auth fails with `device_revoked`; the runner wipes cached task payloads, tokens and the device session, and shows a clear "this device was revoked" state |
| Device lost | Revocation is the control. Because the private key is non-exportable (credential store) and task content is not cached in plaintext beyond the local cache, remote wipe is **not** promised. `[OPEN]` whether to add remote-wipe support |
| Cloud-side suspicion | The cloud can force-expire all grants and demand re-authentication before the device resumes work |

## 14. Testing requirements specific to Windows

`[PROPOSED]` These run on a real Windows runner, not emulated Linux

| Area | Tests |
|---|---|
| Paths | Traversal, symlink/junction reparse points, 8.3 names, long paths, UNC rejection, case-insensitive collisions, ADS refusal |
| Process control | Job object kills the whole tree; orphans cleaned on start; graceful stop checkpoints; kill switch leaves no processes |
| Service lifecycle | Install/uninstall, boot start, crash restart (bounded), upgrade, rollback, upgrade mid-step is refused |
| Sleep/resume | Suspend during a step; resume re-claims work; deadline semantics |
| Model runtime | Inventory, health, load/unload, VRAM behaviour, CPU fallback, missing-model error, digest mismatch detection |
| Sandbox self-test | A process that tries to escape fails, and the failure is reported (expected-failure tests) |
| Revocation | Online and offline revocation paths |
| Offline | Create+run a local task with no network; buffer and replay; approval decided offline then synced |
| Antivirus/driver variance | A documented manual matrix (Defender on/off, exclusions absent) — acceptance is "works without requiring exclusions" |

Labels: `[FACT]` `[ASSUMPTION]` `[PROPOSED]` `[OPEN]`
