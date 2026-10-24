import type {
  ApprovalDecisionRequest,
  ApprovalListQuery,
  ApprovalListResponse,
  ApprovalRequestSummary,
  ApproveDeviceRequest,
  CreateTaskRequest,
  CreateWorkspaceGrantRequest,
  DeviceCommandSummary,
  DeviceListResponse,
  LoginRequest,
  PairingCodeResponse,
  RegisterRequest,
  RegisterWorkspaceRequest,
  RevokeDeviceRequest,
  TaskEventListResponse,
  TaskListResponse,
  TaskStepListResponse,
  TaskSummary,
  UpdateWorkspaceRequest,
  WorkspaceGrantListResponse,
  WorkspaceListResponse,
  WorkspaceSummary,
} from "@ua/contracts";
import { CSRF_COOKIE, CSRF_HEADER } from "@ua/contracts";

/**
 * The browser's only route to the API (docs/planning/03 §5.1).
 *
 * Every call goes through this app's own origin and is forwarded by the rewrite
 * in `next.config.ts`, so requests are same-origin, the HttpOnly session cookie
 * travels automatically and the API needs no CORS. Nothing here caches or
 * reshapes: the API is the authority and the pages render what it returns.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
  ) {
    super(`${status} ${title}`);
  }
}

/** Double-submit CSRF: a readable cookie goes out, the same value comes back
 * as a header (docs/planning/11 §5). Absent when there is no session. */
function csrfToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const prefix = `${CSRF_COOKIE}=`;
  return document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);
}

/** Reads an RFC 9457 problem, falling back to the status line so a proxy error
 * page still produces a sentence a person can act on. */
async function toApiError(response: Response): Promise<ApiError> {
  const fallback = response.statusText || `request failed with status ${response.status}`;
  try {
    const problem: unknown = await response.json();
    const title =
      typeof problem === "object" && problem !== null
        ? (problem as { title?: unknown }).title
        : undefined;
    return new ApiError(
      response.status,
      typeof title === "string" && title !== "" ? title : fallback,
    );
  } catch {
    return new ApiError(response.status, fallback);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && init.body !== null)
    headers.set("content-type", "application/json");
  const token = csrfToken();
  if (token !== undefined) headers.set(CSRF_HEADER, token);

  const response = await fetch(path, { ...init, headers });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}

export function listTasks(): Promise<TaskListResponse> {
  return request("/v1/tasks");
}

export function getTask(taskId: string): Promise<TaskSummary> {
  return request(`/v1/tasks/${taskId}`);
}

export function getTaskSteps(taskId: string): Promise<TaskStepListResponse> {
  return request(`/v1/tasks/${taskId}/steps`);
}

export function getTaskEvents(taskId: string): Promise<TaskEventListResponse> {
  return request(`/v1/tasks/${taskId}/events`);
}

/**
 * Idempotency is mandatory for a task creation (FR-TASK-10): a retried submit —
 * a double click, a flaky connection, an offline retry — must produce one task,
 * so the caller generates a key that survives the retry.
 */
export function createTask(body: CreateTaskRequest, idempotencyKey: string): Promise<TaskSummary> {
  return request("/v1/tasks", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "idempotency-key": idempotencyKey },
  });
}

/** Signs in. The API sets the session, refresh and CSRF cookies itself; the page
 * never holds a credential (docs/planning/12 §4 "Security boundary"). */
export function login(body: LoginRequest): Promise<unknown> {
  return request("/v1/auth/login", { method: "POST", body: JSON.stringify(body) });
}

// --- Devices (docs/planning/07 §3.6, `12` §5.3) ------------------------------
//
// Pairing is a two-step handshake and the browser only drives the first: it
// mints a code, the person types it into the runner, and the device registers
// itself with a key the browser never sees. Approval is the human half.

/** Mints a code the runner will present. Returned once — nothing stores it. */
export function createPairingCode(): Promise<PairingCodeResponse> {
  return request("/v1/devices/pairing-codes", { method: "POST", body: "{}" });
}

export function listDevices(): Promise<DeviceListResponse> {
  return request("/v1/devices");
}

export function approveDevice(deviceId: string, body: ApproveDeviceRequest): Promise<unknown> {
  return request(`/v1/devices/${deviceId}/approve`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function denyDevice(deviceId: string): Promise<unknown> {
  return request(`/v1/devices/${deviceId}/deny`, { method: "POST", body: "{}" });
}

export function revokeDevice(deviceId: string, body: RevokeDeviceRequest): Promise<unknown> {
  return request(`/v1/devices/${deviceId}/revoke`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Asks the runner for a health report (FR-DEV-02). The answer travels back as
 * a command ack, not as a response here — this only says it was queued. */
export function runDeviceDiagnostics(deviceId: string): Promise<DeviceCommandSummary> {
  return request<{ command: DeviceCommandSummary }>(`/v1/devices/${deviceId}/commands`, {
    method: "POST",
    body: JSON.stringify({ kind: "diagnostics_ping" }),
  }).then((response) => response.command);
}

// --- Workspaces (docs/planning/07 §3.6, `12` §5.5) --------------------------

export function listWorkspaces(deviceId?: string): Promise<WorkspaceListResponse> {
  const query = deviceId === undefined ? "" : `?deviceId=${encodeURIComponent(deviceId)}`;
  return request(`/v1/workspaces${query}`);
}

export function getWorkspace(workspaceId: string): Promise<WorkspaceSummary> {
  return request(`/v1/workspaces/${workspaceId}`);
}

export function registerWorkspace(body: RegisterWorkspaceRequest): Promise<WorkspaceSummary> {
  return request("/v1/workspaces", { method: "POST", body: JSON.stringify(body) });
}

export function updateWorkspace(
  workspaceId: string,
  body: UpdateWorkspaceRequest,
): Promise<WorkspaceSummary> {
  return request(`/v1/workspaces/${workspaceId}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function removeWorkspace(workspaceId: string): Promise<unknown> {
  return request(`/v1/workspaces/${workspaceId}`, { method: "DELETE" });
}

export function listWorkspaceGrants(workspaceId: string): Promise<WorkspaceGrantListResponse> {
  return request(`/v1/workspaces/${workspaceId}/grants`);
}

export function createWorkspaceGrant(
  workspaceId: string,
  body: CreateWorkspaceGrantRequest,
): Promise<unknown> {
  return request(`/v1/workspaces/${workspaceId}/grants`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function revokeWorkspaceGrant(grantId: string): Promise<unknown> {
  return request(`/v1/grants/${grantId}`, { method: "DELETE" });
}

// --- Approvals (docs/planning/07 §3.4, 10 §4) --------------------------------
//
// A decision always sends back the digest the page was shown, so an inbox left
// open while the action changed cannot approve the newer one (FR-APPR-03).

export function listApprovals(query: ApprovalListQuery = {}): Promise<ApprovalListResponse> {
  const params = new URLSearchParams();
  if (query.state !== undefined) params.set("state", query.state);
  const suffix = params.size === 0 ? "" : `?${params.toString()}`;
  return request(`/v1/approvals${suffix}`);
}

export function grantApproval(
  approvalId: string,
  body: ApprovalDecisionRequest,
): Promise<ApprovalRequestSummary> {
  return request(`/v1/approvals/${approvalId}/grant`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function denyApproval(
  approvalId: string,
  body: ApprovalDecisionRequest,
): Promise<ApprovalRequestSummary> {
  return request(`/v1/approvals/${approvalId}/deny`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// --- Auth ------------------------------------------------------------------

/** Creates the account and signs in on the same response (docs/planning/07 §3.1). */
export function register(body: RegisterRequest): Promise<unknown> {
  return request("/v1/auth/register", { method: "POST", body: JSON.stringify(body) });
}

/** One sentence a person can act on, whatever went wrong. */
export function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.title;
  return error instanceof Error ? error.message : String(error);
}

/** The API is saying "there is no session here" — the one failure worth
 * interrupting a page for, because the answer is to sign in. */
export function isSignedOut(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
