# 12 — Frontend and UX Specification

| | |
|---|---|
| Status | Planning only. `[PROPOSED]`. **No page, route, component or token exists.** |
| Owner | Product design + Frontend |
| Applies to | `frontend/web-app`, `frontend/admin-console`, `frontend/desktop-app`, `frontend/ide-extensions/vscode` (`03` §5.1–5.4) |
| Stack | Next.js 16 (App Router, React 19, Tailwind 4, TypeScript 7); Electron 44 on Windows `[FACT]` |
| Depends on | `02` (requirements), `07` (REST + SSE), `09` (runner), `10` (approvals), `11` (threats) |

## 1. Purpose and scope

Fixes the **surfaces, routes, screens, component boundaries, states, tokens and
accessibility rules** before any UI is built, so `07`/`10` are consumed consistently, not per screen.

**Out of scope for the MVP UI** (deliberately):

| Not in the MVP UI | Why |
|---|---|
| Marketing/landing site | Deferred; first users arrive by invitation. `[PROPOSED]` |
| Co-editing a task; chat transcript as the primary surface | Single-author workspace (`02` §7); chat input only types a goal (`03` §11). |
| Task templates/scheduling (`FR-TASK-08/09`), checkout/invoices (`FR-BILL-03`) | `P2`; no screen reserved. Usage/quota **visibility** (`FR-BILL-01/02`) is in scope, payment is not. |
| Marketplace browsing; mobile as a product target | Phase ≥ 11 (`02` §7); mobile must only degrade without breaking. |

## 2. Surfaces inventory

| Surface | Who | Must do | Must NOT do |
|---|---|---|---|
| **Marketing/landing** (deferred) | Prospects | Explain the local-first promise | Ship in the MVP `[PROPOSED]` |
| **Web app** | P-1/P-2/P-3 (`02` §2) | Sign in, create tasks, watch progress, answer approvals, inspect artifacts, manage devices/models/integrations/usage/settings | Hold business logic, a device key, or a token in `localStorage` (`03` §5.1) |
| **Admin console** | P-4; P-5 | Users, orgs, devices, sessions, usage, quota overrides, audit search, integration status, flags, health | Share a session audience/route tree with the user app, or expose secrets to an operator (`11` T-AUTH-09, B-9) |
| **Electron desktop app** | P-1 (Windows) | Tray status, workspace picker, local pending approvals, diagnostics, pause/resume, kill switch, auto-update | Bind beyond `127.0.0.1`, run the agent loop itself, or hold a device key outside the credential store (`09` §2) |
| **CLI / IDE / notifications** | P-1; all | Submit a task about the open repo, show progress inline, surface approvals, open a diff; deliver "approval required" in-app, optionally by email/toast/webhook | Execute cloud commands directly or run in an untrusted VS Code workspace (`03` §5.4); be the only channel for an approval or fire per step (`10` §9) |
| **Local-first honesty** | All | Show a 4 GiB VRAM machine what actually fits (`09` §10.2) | Imply a 7B model is "fast", or hide CPU offload |

## 3. Information architecture and navigation

Task-centric navigation, with devices as the second pillar (a missing runner blocks work).

```
Org switcher (person + org)  [ ⌄ Acme Corp ]
  Tasks        ← default landing; list + New task
  Approvals    ← badge; global inbox across tasks/devices
  Devices      ← list, workspaces, grants, diagnostics
  Models · Integrations · Usage · Settings (org or personal)
  [ Search tasks… ]                  [ 🔔 ]  [ avatar ]
```

- **Org switcher** always visible; every screen is scoped to one organization
  (`FR-ORG-03`); switching replaces the data set and SSE stream, never merges them. `[PROPOSED]`
- **Task-centric entry** — `Tasks` is the landing route, "New task" reachable from
  every task screen; `Devices` is first-class, linked from task creation when no
  device is online. **Approvals** has its own inbox route (`FR-APPR-08`), appears
  inline in the workspace, and also arrives as a tray/OS notification — never
  modal-only.
- **Admin console** has its own navigation (Users, Orgs, Devices, Sessions, Usage,
  Quotas, Audit, Integrations, Flags, Health, Queues, Impersonation), route tree
  and audience (`07` §1: `/admin/v1`).

## 4. Route tables

### 4.1 Web app

| Route | Screen | Purpose | Key FR IDs |
|---|---|---|---|
| `/sign-in`, `/sign-up`, `/mfa`, `/step-up`, `/verify-email`, `/reset-password(+/confirm)` | Auth | Password + MFA; verify, reset; account + personal org; R3 re-auth | FR-AUTH-01, FR-AUTH-02, FR-AUTH-04, FR-AUTH-09, FR-ORG-01 |
| `/onboarding` | Org onboarding | Name org, install runner, first task | FR-ORG-01, FR-ORG-04 |
| `/pair` | Device pairing | Short code + approve device | FR-AUTH-07, FR-DEV-01 |
| `/devices`, `/devices/{id}`, `/devices/{id}/diagnostics` | Devices / diagnostics | Status, capabilities, effective policy, self-test, revoke | FR-DEV-02, FR-DEV-06, FR-DEV-08 |
| `/workspaces`, `/grants` | Workspaces / grants | Register folders; `external_directory` + standing grants | FR-DEV-05, FR-CODE-01, FR-APPR-05 |
| `/tasks/new`, `/tasks`, `/tasks/{id}` | Tasks | Create; history/search; the task workspace | FR-TASK-01, FR-UI-01, FR-UI-04 |
| `/approvals`, `/approvals/{id}` | Approval inbox / detail | Pending across tasks/devices; preview + bound digest | FR-UI-02, FR-APPR-08 |
| `/models`, `/integrations(/{id})` | Models / integrations | Inventory + fit; connect, data declaration, health | FR-MODEL-03, FR-MODEL-06, FR-INT-02 |
| `/usage`, `/notifications` | Usage / notifications | Meters, quota, hard stop; in-app list | FR-BILL-01/02, FR-NOTIF-01/02 |
| `/settings/org/*`, `/settings/personal/*`, `/sessions` | Settings | Org policy/retention/execution; profile, MFA, sessions | FR-ORG-04, FR-AUTH-03 |

### 4.2 Admin console

| Route | Screen | Purpose | Key FR IDs |
|---|---|---|---|
| `/admin` | Overview | Queue/worker/DB/Redis health at a glance | FR-ADMIN-03 |
| `/admin/users`, `/admin/sessions` | Users / sessions | Search, status, force logout, revoke | FR-ADMIN-01, FR-ADMIN-02 |
| `/admin/orgs`, `/admin/orgs/{id}` | Organizations | List, members, plan, suspend, quota override | FR-ADMIN-01, FR-BILL-02 |
| `/admin/devices` | Devices | All devices, platform force-revoke | FR-ADMIN-01, FR-DEV-08 |
| `/admin/usage`, `/admin/quotas` | Usage / quotas | Cross-org meters; per-org plan override | FR-ADMIN-01, FR-BILL-01/02 |
| `/admin/audit` | Audit search | Actor, action, resource, time, result | FR-ADMIN-01, FR-POL-05 |
| `/admin/integrations`, `/admin/flags`, `/admin/health`, `/admin/queues` | Integrations / flags / health / queues | Provider health, degraded endpoints, tenant flags, liveness, pause/drain | FR-ADMIN-01, FR-ADMIN-03, FR-INT-02 |
| `/admin/impersonation` | Impersonation | Start/stop a time-boxed support session | FR-ADMIN-02 |

## 5. Per-screen specifications

Wireframes (`[PROPOSED]` layouts), primary actions, states and requirements; the
full state matrix is §10.

### 5.1 Sign-in, sign-up, verify, reset, TOTP, step-up

```
Email [__________]  Password [_______] (show)
[ Sign in ]  [Google] [GitHub]  Forgot password?   No account? Create one
--- second factor / step-up ---
Authenticator code [ _ _ _ _ _ _ ]  [ ] Trust 30 days
```
**Actions:** sign in/up, reset, verify email, resume MFA, verify TOTP/recovery,
complete step-up. **States:** inline field errors from `errors[]` (`07` §2); one
uniform `invalid_credentials` message and timing (`11` T-AUTH-06); `429` +
`Retry-After`; lockout; ticket expiry mid-flow. **FRs:** FR-AUTH-01/02/04/05/08/09,
FR-APPR-02.

### 5.2 Organization onboarding

```
Set up your workspace            ( 2 of 4 )
Org name [________________]   Invite teammates [emails…] Skip
Default execution  (o) This device   ( ) Cloud (opt-in)   [ Continue ]
```
**Actions:** name org, set default execution location, invite (skippable), jump to
pairing. **States:** name collision, invite quota, runner not installed
(persistent "finish setup" banner), personal-org path. **FRs:** FR-ORG-01,
FR-ORG-02, FR-ORG-04, FR-DEV-01.

### 5.3 Device pairing (device-authorisation short code, FR-AUTH-07)

```
Pair a device · expires 09:41 · 4 7 K 9 - Q 2 M 3   [Copy] [Cancel]
On the PC: Universal Agent > Pair
Browser approval: DESKTOP-01 · Win11 · r0.1.0 · sha256:8a1f…
  run tasks for Acme as you        [Approve device]   [Deny]
```
**Actions:** create code, copy, approve/deny after the device presents its key,
name the device. **States:** code expired (10 min, single use), already used,
rate-limited (`11` T-AUTH-08), wrong user/org binding, device never appears.
**FRs:** FR-AUTH-07, FR-DEV-01, FR-DEV-03 (`07` §3.6).

### 5.4 Device list and revocation

```
Devices                                              [ + Pair ]
DESKTOP-01 Win11 r0.1.0 GTX1650 * online · 12s · 2 models · 3 workspaces
  [Workspaces][Diagnostics][Rename][Revoke]
LAPTOP Win11 r0.1.0 iGPU · 4m ago [Revoke]     [ ] revoked
```
**Actions:** pair, rename, open workspaces/diagnostics, revoke (a `device.*` R3
action → confirm + step-up). **States:** no devices (empty state → `/pair`),
offline, no GPU in the capability report, revoked shown distinctly. **FRs:**
FR-DEV-02, FR-DEV-04, FR-DEV-08, FR-POL-04.

### 5.5 Workspace registration and external_directory grants

```
Workspaces                                  [ + Register folder ]
F:\My Project\My Agent  read-write  git snapshot  [Grants(1)][Read-only][Remove]
External directory grant (bypasses the workspace boundary)
  Path C:\Users\a\Documents\inbox · Tool fs.read · 7 days · audited  [Grant][Deny]
```
**Actions:** register a folder, set read-only/read-write, unregister, create/revoke
an `external_directory` grant; show the canonical resolved path as authority and
the raw path as display only (`09` §6). **States:** path missing, non-git workspace
(manifest cap warning), workspace locked, path outside any root. **FRs:**
FR-DEV-05, FR-CODE-01, FR-CODE-02, FR-APPR-03.

### 5.6 Task creation

```
Goal [ Upgrade this repo's dependencies and show the diff ]
[ + attach files ]  Workspace [ F:\My Project… v ]
Execution (o) This device (DESKTOP-01)  ( ) Cloud *
Budget $[5] Deadline [2h] Steps [60]  Tools [fs.read×][fs.write×][shell×][+]
[x] Require plan approval  [x] Local models only   ·  max allowed class R2
[ Create task ]
```
**Actions:** write the goal, attach files, choose workspace and execution location,
set budget/deadline/tools, submit. Cloud execution stays disabled unless the org
opted in (`07` `cloud_execution_not_enabled`). **States:** no workspace, no online
device (`WAITING_DEVICE` pre-warning), quota exceeded, `422 goal_ambiguous`,
duplicate idempotency key returns the original task (`FR-TASK-10`). **FRs:**
FR-TASK-01, FR-TASK-07, FR-TASK-10, FR-MODEL-02/06.

### 5.7 Task workspace (primary surface — FR-UI-01)

```
Upgrade dependencies and show the diff  RUNNING · R2 · DESKTOP-01
[Pause] [Cancel]   budget 12/60 steps · $0.31 · 4m12s
Steps  1 fs.read ok R0 · 2 git.snap ok R1 · 3 fs.write ok R1 · 4 shell ask R2
Pane   argv ["npm","ci"] cwd … · net registry.npmjs.org · log > npm ci · +412 pkgs
       [Approve][Deny][Allow 30m][detail]   [Overview][Logs][Diffs][Artifacts]
```
**Actions:** pause/resume, cancel, approve/deny inline, open a step or diff,
download/upload artifacts, open *Explain* (why this decision), retry a step (`07`
§3.3). **States:** §10. The **timeline is the authority**, the log pane is a
convenience; any stream gap triggers a refetch (§7). **FRs:** FR-UI-01,
FR-TASK-02/03/04/05/06, FR-CODE-02, FR-TOOL-03.

### 5.8 Approval inbox (FR-UI-02, FR-APPR-08)

```
Approval inbox (3)             [ task ▾ ] [ risk ▾ ]
R2 shell "npm ci"        DESKTOP-01 age 42s  task Upgrade deps  [Approve][Deny]
R3 git push origin main  DESKTOP-01 age 3m   needs step-up
Bulk (same tool + workspace + class only): [Approve as "this task"]  5/6 used
```
**Actions:** approve with a scope, deny with a reason, open detail, bulk-approve
only when tool + workspace + class match. **Anti-fatigue rules (`10` §9):** correct
defaults (R0/R1 never appear); preview quality (argv, resolved targets, diff,
destination host, one sentence of *why*); scope offers ("once" / "this task" / "this
tool in this workspace 30d"); a visible per-task budget (`maxApprovalsPerTask`,
default 6) that fails the task with `approval_budget_exceeded`; deny is one click;
**no dark patterns** — no pre-selected "allow always", no countdown, no buried risk
detail; escalation reason visible when a step changes class. **States:** nothing
pending, expired item, decided elsewhere, voided by revocation. **FRs:** FR-UI-02,
FR-APPR-05/06/07/08, FR-NOTIF-02.

### 5.9 Approval detail — effect preview and bound digest

```
Approve: shell                Where F:\My Project\My Agent (read-write)
What runs  npm ci             Runs on DESKTOP-01 (this PC)
Network    registry.npmjs.org (allow-listed)   Why asked  rule "ask-any-shell"
Effect     412 packages → node_modules; git snapshot first, so revertible
Bound to   action sha256:9f2c…  args sha256:41a0…  policy v7 · user a@b.com ·
           DESKTOP-01 · step 4 · nonce 3f9a… · exp 09:45
Scope (o) Once  ( ) This task  ( ) This tool + workspace 30d   [Approve][Deny]
```
**Actions:** approve with scope, deny, view the full `argv`, view the effect
preview, copy digests for support. **Bound-digest explanation:** the screen states
plainly that the approval is bound to these exact values and that any change — one
argument, one path, a newer policy, a different device — invalidates it and asks
again (`10` §5.1, FR-APPR-04); this explains a security property, it does not let
the UI soften it. **States:** `410 approval_expired`, `409
approval_already_decided`, `409 digest_mismatch`, `422 step_up_required`, `403
not_eligible_approver`. **FRs:** FR-APPR-03, FR-APPR-04, FR-APPR-07, FR-AUTH-09.

### 5.10 Task history and search (FR-UI-04)

```
Tasks                    [ + New task ]   [ filter ▾ ]
RUNNING   Upgrade deps     R2 $0.31   4m   2×
COMPLETED Build the report R1 $0.02  18m
FAILED    Fill the form    R2 $0.10   3m  denied
```
**Actions:** search, filter (state · tool · workspace · device · date · outcome),
sort, open, re-run with the same goal (creates a new task; never mutates the old). **States:** no tasks ever (empty state links to
`/tasks/new` and `/pair`), no results for a filter, cursor-paged list, viewer role
seeing a redacted summary. **FRs:** FR-UI-04, FR-TASK-01, FR-ORG-03.

### 5.11 Models page (local fit honesty + remote consent)

```
Models — DESKTOP-01              [Refresh] [ + Pull ]
qwen2.5-coder:3b  2.0 GB  fits 4 GiB          ready
qwen2.5-coder:7b  4.7 GB  PARTIAL OFFLOAD, slower
nomic-embed-text  0.3 GB  fits                ready
! GTX1650 4 GiB · 7B uses CPU offload · no speed measured (09 §10.2)
Remote providers  LOCAL ONLY · OpenAI disabled  [Enable]
```
**Actions:** pull/remove a local model, health check, set default, enable/disable a
remote provider (admin), enable per-call consent — the enable flow shows exactly
what leaves the device and to which provider. **States:** Ollama absent, model
`unavailable` after a failed probe, VRAM insufficient (offer a smaller tier, never
a false promise), provider disabled by policy, key missing. **FRs:**
FR-MODEL-01/02/03/06, FR-DEV-04.

### 5.12 Integrations page

```
Integrations                [ catalog ▾ ] [ + Add ]
GitHub  connected read:repo  health ok   [Manage]
Google  not connected                    [Connect]
Slack   connected post:msg   degraded    [Fix]
Each card states what data is shared, with whom, and why; credentials are never shown.
```
**Actions:** browse catalog with the data-sharing declaration, connect (admin),
test, disconnect, rotate a webhook secret, view the delivery log. **States:** not
connected, failing health check, token expired, scope missing, provider forbidden
by policy. **FRs:** FR-INT-01/02/03, NFR-PRIV-03, `11` B-10.

### 5.13 Usage and quota (FR-BILL-01/02)

```
Usage — October        plan Free · quota 60% used
[Tasks][Steps][Tokens][Artifacts][Cloud-sec][Browser-min]
chart + table, group by day / task / member · soft warn 80%, hard stop 100% → 429
```
**Actions:** change range, group by member/task, export CSV, (admin) request an
override. **States:** no usage yet, quota exhausted (clear banner — not a silent
failure), viewer role, metric not yet metered (`[OPEN]`). **FRs:** FR-BILL-01,
FR-BILL-02, FR-MODEL-05, NFR-COST-01.

### 5.14 Notification centre (FR-NOTIF-01/02)

```
Notifications            [ unread only ]  [Prefs]
● Approval required — shell "npm ci"     2m  [Open]   Upgrade deps · DESKTOP-01
○ Task completed — Build the report     18m
○ Device offline — LAPTOP                1h
```
**Actions:** open the referenced task/approval/device, mark read, mark all read,
edit per-channel preferences. **States:** empty, unread badge sync, resource
deleted (`410 gone` → remove), email disabled, push unavailable. **FRs:**
FR-NOTIF-01/02, and the escalation-promptness rule (`07` §4): a task never sits
silently in `WAITING_APPROVAL`.

### 5.15 Settings (org + personal)

```
Organisation (admin/owner only)
  General · Members · Security (TOTP) · Policy · Retention · Billing · Danger zone
Personal  Profile · Notifications · Sessions · MFA · Appearance
Danger-zone actions show an effect preview and need step-up.
```
**Actions:** edit org settings, members/roles, enforce TOTP, edit policy **by
version reference** (never free text in the browser), set retention, revoke own
sessions, enable MFA, switch theme/density. **States:** insufficient role
(read-only view with an explanation — never a hidden control), last-owner guard,
`409 state_conflict` on policy version. **FRs:** FR-ORG-02/04/05, FR-AUTH-03/04,
FR-POL-01, NFR-PRIV-02.

### 5.16 Local runner diagnostics (FR-DEV-06)

```
Runner diagnostics — DESKTOP-01          [Run self-test]
Version 0.1.0 (latest) · WSS connected · heartbeat ok 12s · queue 2 claimed, 0 pending
ollama 0.40.x up · VRAM 2.1/4.0 GiB · api 42 ms · sandbox self-test PASS 09:05
Last error 09:12 denied   [Export bundle] [Open logs] [Stop all work]
```
**Actions:** run the sandbox self-test, open a redacted log tail, export a bundle
the user previews first, pause all work (kill switch), check/roll back an update.
**States:** offline, self-test **failed** (mutating tools disabled until fixed —
`09` §11), model runtime down, model drive low on space, update staged awaiting
idle, device revoked by the cloud (a distinct final state — `09` §13). **FRs:**
FR-DEV-06, FR-DEV-04/08/09.

### 5.17 Admin console screens

One layout everywhere: filter bar, keyset-paged table, detail drawer, and a
permanent audit footer naming the action that will be recorded.

```
/admin  [Overview][Users][Orgs][Devices][Sessions][Usage][Quotas][Audit]
        [Integrations][Flags][Health][Queues][Impersonate]
  search + filters ...  table ...  detail drawer
Destructive: confirm → effect preview → step-up → audit row, one transaction.
```
- **Users / Orgs / Devices / Sessions:** search, inspect, force logout, suspend org,
  force-revoke a device, revoke a session; no operator action exposes secrets
  (`11` B-9, T-AUTH-09).
- **Usage / Quotas:** cross-org meters; per-org plan/quota override with the reason
  recorded (`FR-BILL-02`). **Audit search:** actor, action, resource, time, result;
  immutable; links to the trace ID. **Integrations / Flags / Health / Queues:**
  provider health, tenant-targeted flags, queue depth, worker liveness, pause/drain
  with step-up. **Impersonation:** an unmissable banner in the user's own app while
  active, a hard time box, audit rows at start and stop.
- **FRs:** FR-ADMIN-01/02/03, FR-BILL-02, FR-POL-05, NFR-OBS-01.

## 6. Component boundary tree

```
frontend/
  web-app/  Next.js 16 App Router
    app/(auth)/ public no-session · app/(app)/ session-guarded shell
    app/(app)/tasks/[id]/ the workspace route
    features/  tasks · approvals · devices · models · integrations ·
               usage · notifications · settings · auth
    components/ presentation only, from @ua/ui · lib/ sse client, keys
  admin-console/  separate route tree; same @ua/ui components
packages/  @ua/ui · @ua/client (typed fetch + SSE) · @ua/contracts
           (Zod) · @ua/telemetry (trace propagation)
```

`[PROPOSED]` Split rationale: **server components** fetch first paint (task
list/detail, device list) and render the shell, so the session cookie never reaches
the client bundle; **client components** exist only for interactivity (SSE
subscription, live timeline, approval scope picker, forms, theme toggle). **No
business logic in components** — authorisation, risk classification and digests are
server-side (`03` §5.1). `[OPEN]` admin console as a route group or a second app (`03` §5.2).

## 7. Live progress UI (consuming `07` §5)

The task workspace, approval inbox and device detail consume SSE the same way. `[PROPOSED]`

| Concern | UI behaviour |
|---|---|
| Transport | Same-origin browser: `EventSource` with the session cookie. Native/desktop/IDE: `POST /v1/tasks/{id}/stream-ticket` → `fetch` + `ReadableStream`. Never a long-lived token in a URL (`07` §5). |
| Ordering | Apply by per-task `seq`; a non-consecutive `seq` triggers a refetch instead of an out-of-order apply. |
| Resume (FR-TASK-04) | Keep the last event `id` (`{taskId}:{seq}`) in memory; send `Last-Event-ID` on reconnect. |
| Gap | `event: resync` (backpressure drop) → stop patching, refetch `GET /v1/tasks/{id}` + `…/events?after={seq}`. |
| Heartbeat / terminal | `:hb` only resets the stale timer (15 s nominal; degrade after 45 s). `event: done` → stop reconnecting. After 3 failed reconnects, poll every 10 s and show "live updates paused" (`07` §5). |

| Rule | Detail |
|---|---|
| State beats stream | The `GET /v1/tasks/{id}` row is authoritative; events are an optimisation. Conflicts resolve to the fetched row. |
| Optimistic is labelled, not final | Approve/pause/cancel with no response render "pending"; the inline approve button is disabled from click to the `approval.*` event, and its state is re-derived from the fetched approval row, not the click. |
| Revert is loud | A rejected optimistic action reverts **and** shows the `07` §2 error with `requestId` — never a silent snap-back. |
| No fabricated progress | The UI never interpolates a percentage events do not carry. "Running" is honest; an invented progress bar is not. |

## 8. Design tokens and theming

`[PROPOSED]` Tokens are defined once in `@ua/ui` and exposed to Tailwind 4 via
`@theme`. No screen invents a colour.

| Token group | Examples | Notes |
|---|---|---|
| Surface | `bg`, `bg-raised`, `bg-sunken`, `border`, `border-strong` | Dark and light values differ; contrast checked in both. |
| Text | `text`, `text-muted`, `text-subtle`, `text-on-accent` | ≥ 4.5:1 body, ≥ 3:1 large text (WCAG 2.2 AA). |
| Spacing / radius / elevation | 4/8 px rhythm (`space-1…space-10`), `radius-sm/md/lg`, `shadow-1/2/3` | Density mode compresses one step, never below the 24 px target. |
| Motion | `duration-fast/base`, `ease-standard` | Honours `prefers-reduced-motion`. |
| Density / theme | `comfortable` \| `compact`; `light` \| `dark` \| `system` | `system` follows `prefers-color-scheme`. |

**Risk-class colour** — each class carries its letter and an icon, never colour
alone: R0 neutral · R1 green + "reversible" · R2 amber + "needs approval" + lock ·
R3 red + "needs approval + step-up" + shield · R4 dark red, struck through +
"never allowed". **Task states** likewise use badge + label + icon: active
(`QUEUED`, `PLANNING`, `RUNNING`, `VERIFYING`) are informational; waiting
(`WAITING_APPROVAL`, `WAITING_DEVICE`, `PAUSED`) are attention-seeking; terminal
(`COMPLETED`, `CANCELLED`, `EXPIRED`) are neutral and `FAILED` is negative — never
alarm-red for anything else.

## 9. Responsive and adaptive rules

| Breakpoint | Web app `[PROPOSED]` |
|---|---|
| `< 768 px` | Supported, not a product target (`02` §7): single column, nav collapses, tables become cards, timeline becomes an accordion. No feature removed. |
| `768–1280 px` | Collapsible sidebar; timeline stacks above the log pane. |
| `≥ 1280 px` | Two-pane workspace; full tables. |

**Desktop app (Windows) `[PROPOSED]`:**

| Concern | Behaviour |
|---|---|
| Window / panels | Minimum 900×600, remembers size/position per user; panels for status, pending approvals, running tasks and the workspace picker; opening a task deep-links into the web app rather than duplicating the workspace. |
| Tray / OS notifications | Icon reflects aggregate state (idle / working / needs-approval / offline); menu: Open, Pause all work, Stop all work, Diagnostics, Quit. Native Windows toast for approval-required and terminal events only — never per step. |
| Silent operation / update | Closing the window keeps the runner alive; quitting offers "also stop the runner". Updates never interrupt a running step (`09` §11), install at idle, and roll back in one click. |
| Deep links / Windows | `universalagent://task/{id}`, `universalagent://approval/{id}`; per-monitor DPI, no elevation, single instance, `127.0.0.1` only (`09` §5). |

## 10. State-handling matrix

`[PROPOSED]`. Every screen defines all nine states; "partial" (some data loaded,
some failed) is a real state, not an edge case.

| Screen | Empty | Loading | Partial | Error | Offline | Stale | Permission denied | Revoked device |
|---|---|---|---|---|---|---|---|---|
| Sign-in | n/a | button spinner | n/a | inline field errors, `429` countdown | offline banner + retry | n/a | `403 account_suspended` | n/a |
| Task list | "No tasks yet" + New task + Pair | table skeleton | rows failed → banner + retry | `problem+json` + `requestId` | cached list, "read-only offline" | last-synced stamp | viewer sees redacted summary | n/a |
| Task workspace | n/a (404 → list) | skeleton shell, timeline spinner | row ok, events failed → "live updates paused" | error panel + retry | buffered log + degraded banner | refetch on gap; stale badge | `404` for a foreign tenant id | owning device revoked → tasks move to `WAITING_DEVICE` |
| New task | form defaults | submit spinner, button locked | n/a | field errors; `429 quota_exceeded` | "device offline" warning, allow local queue | n/a | `403 insufficient_role` | no selectable device |
| Approval inbox | "You're all caught up" | list skeleton | some items failed → per-row retry | banner + retry | "can't reach server" | age keeps counting | non-eligible items hidden | items invalidated with reason |
| Approval detail | n/a | skeleton | preview ok, log failed | `409/410/422` as plain explanations | read-only, approve disabled | re-verify on focus | `403 not_eligible_approver` | "device revoked — this approval is void" |
| Devices / workspaces | "No devices" / "No folders" + Pair | card skeleton | one device unreachable, grant failed | error + `requestId` / inline error | last-seen from cache; "cannot create a grant offline" | last-seen ageing | read-only for viewer | revoked shown; grants for that device void |
| Models / integrations / usage | "No local models" / "No usage yet" | probe or chart skeleton | inventory ok, health or metrics failed | `ollama_unavailable` explained / error + retry | cached inventory, last-known figures + timestamp | probe age / stale data stamped | admin-only actions hidden; viewer sees own usage | n/a |
| Diagnostics | n/a | self-test running | section-level failures | section error + export bundle | "runner unreachable" (loopback down) | last-run stamp | n/a | final "device revoked" screen (`09` §13) |
| Admin tables | "No rows for this filter" | table skeleton | partial page (cursor) | error + retry, audited | n/a | cache age | `403` for non-operator | device row shows revoked |

**No silent failure rule `[PROPOSED]`:** no spinner that resolves into nothing — a
failed load becomes a visible error with a retry and the `requestId` (`07` §2); no
optimistic action fails without a visible revert (§7); `WAITING_APPROVAL`/
`WAITING_DEVICE` always have a notification and an inbox entry (`FR-NOTIF-02`); a
revoked device is shown as the reason work stopped; stopped polling says "live updates paused".

## 11. Accessibility

`[PROPOSED]` Target **WCAG 2.2 AA** (`FR-UI-05`).

| Area | Rule |
|---|---|
| Keyboard-only | Every flow (sign-in, task creation, approvals, scope picker, device revoke, settings) is completable by keyboard; tab order follows visual order; escape closes overlays; skip-to-content is first in the DOM. |
| Streamed updates: focus + announcements | Logs and step updates never steal focus; panels update in place with a "new items" affordance; `aria-live="polite"` for state/progress, `assertive` only for a new approval or a policy denial/security event, one announcement per event — never per log chunk. |
| Approval semantics | Labelled dialog, focus moved to the heading (not the Approve button), scope defaulting to "Once", deny given equal prominence. |
| Contrast, target size, focus | Risk class and task state carry text + icon (§8); charts use patterns and labels. Body ≥ 4.5:1, large text/boundaries ≥ 3:1, focus ≥ 3:1 in both themes. Targets ≥ 24×24 px (SC 2.5.8), with a large approve/deny pair; sticky headers/trays must not cover a focused element (SC 2.4.11). |
| Reduced motion, zoom, errors | `prefers-reduced-motion` disables timeline animation, spinner morph and toast slide while state still changes; usable at 200 % zoom and 320 px width with no two-axis scrolling. Errors are text-based and tied to the field with `aria-describedby`, never colour-only; tray menu and webview content are keyboard reachable; OS toasts are never the only path to an approval. |

## 12. Trust and consent UX

`[PROPOSED]` The UI's job is to make consent *informed* and *visible*. It cannot
make consent safe — that is `10`'s job — and it must not pretend otherwise.

**Before content leaves the device:**

| Trigger | What the user is told | Requirement |
|---|---|---|
| Enabling a remote provider | Exactly what is sent, to which provider, under what retention, and that output returns locally | FR-MODEL-06, NFR-PRIV-01 |
| First remote call per session | A per-call consent prompt; a persistent "remote inference active" chip in the task workspace | FR-MODEL-06, `09` §12 |
| Choosing cloud execution | The exact file list uploaded, the retention that applies, and that it is opt-in per task on top of the org opt-in | `11` §7.3, T-DAT-10 |
| Connecting an integration | The provider, the scopes requested, and a plain sentence of what data it receives and why | FR-INT-02, NFR-PRIV-03 |

**Before a destructive action,** the approval detail (§5.9) shows the effect
preview, resolved targets, exact `argv`, and the snapshot/reversibility statement;
if no snapshot was possible, the screen says so and the class escalates (`10` §6
no. 11). R3 adds step-up and, per policy, a second approver; the notice states these
cannot be skipped — no countdown, no pre-selected "always allow", never a primary
button that means the risky thing. **After an approval is used,** the workspace
shows a receipt (approval, time, actor, device, digest, result) and a standing grant
appears on `/grants` with scope, use count and expiry, one click to revoke (`FR-APPR-05`).

**The honest limit.** Per `11` §8 **RR-1**: a user with `read-write` access can
approve destructive work. The system prevents *unauthorised* destruction; it cannot
prevent *authorised* mistakes. The UI therefore keeps the effect preview prominent,
keeps an undo affordance within reach, never implies an undo that does not exist,
and says *why* when a step's class escalates (`10` §9).

## 13. Open questions

| # | Question | Impact |
|---|---|---|
| Q-UI-1 | Admin console as a route group in the web app, or a second Next app? (`03` §5.2) | Deploy topology, bundle size, auth-audience isolation |
| Q-UI-2 | Does the MVP ship a landing page, or only invitation-based sign-up? | First-run funnel; `02` §9 "time to first useful action" |
| Q-UI-3 | Is progress SSE-only, or is a WebSocket needed for low-latency pause/cancel? | Transport complexity; `07` §5 assumes SSE + REST |
| Q-UI-4/5 | Do the desktop shell and IDE extension embed the full workspace, or deep-link / render a minimal progress view? | Duplicated UI surface vs. window-switching friction; `@ua/ui` reuse vs. webview constraints |
| Q-UI-6 | Which `FR-BILL-01` metrics are actually metered at which phase? | How honest the usage page can be at launch |
| Q-UI-7 | Per-task approval budget: hard failure first, or an advisory nudge? (`10` §9, Q-P2) | Needs real usage data before fixing the number |
| Q-UI-8 | Does the MVP include any third-party analytics? (`11` §7.7) | Privacy promise vs. product learning |
| Q-UI-9 | Light-only MVP theme, or dark + light from day one? | `FR-UI-05` lists both; scope vs. accessibility commitment |
| Q-UI-10 | How are long artifact lists and large logs virtualised without breaking screen-reader reading order? | Performance vs. accessibility correctness |

## 14. Traceability note

This document is the UI-side source for the IDs below; the authoritative matrix is
`21-requirements-traceability.md`.

| Group | IDs covered here | Sections |
|---|---|---|
| FR-UI-* | FR-UI-01, -02, -04, -05 (screens); FR-UI-03 (devices, models, integrations, usage, settings) | §5.7, §5.8, §5.9, §5.10, §11, §5.4, §5.11, §5.12, §5.13, §5.15 |
| FR-AUTH-* / FR-ORG-* | FR-AUTH-01…09, FR-ORG-01…05 | §3, §5.1, §5.2, §5.3, §5.15 |
| FR-TASK-* / FR-CODE-* / FR-TOOL-* | FR-TASK-01…07, -10; FR-CODE-01/02; FR-TOOL-03 | §5.5, §5.6, §5.7, §7 |
| FR-APPR-* | FR-APPR-03…08 | §5.8, §5.9, §12 |
| FR-POL-* / FR-DEV-* | FR-POL-01, -04, -05; FR-DEV-02, -04…06, -08, -09 | §5.4, §5.15, §5.16, §5.17, §9 |
| FR-MODEL-* / FR-INT-* / FR-BILL-* | FR-MODEL-01…03, -05, -06; FR-INT-01…03; FR-BILL-01/02 | §5.6, §5.11, §5.12, §5.13, §5.17, §12 |
| FR-NOTIF-* / FR-ADMIN-* / NFR-* | FR-NOTIF-01/02; FR-ADMIN-01…03; NFR-PRIV-01…03, NFR-COST-01, NFR-OBS-01 | §4.2, §5.8, §5.13, §5.14, §5.17, §12 |
| `10` / `11` | risk classes and the policy engine; the honest limit on consent (`11` §8 RR-1) | §8, §12 |

Owned elsewhere: risk classification and the policy engine (`10`), the threat
catalogue and control matrix (`11`), the SSE wire format (`07` §5), the runner (`09`), tests (`14`).

Labels: `[FACT]` `[ASSUMPTION]` `[PROPOSED]` `[OPEN]`
