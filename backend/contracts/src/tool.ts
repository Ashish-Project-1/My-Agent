import { z } from "zod";
import { Timestamp, Uuid } from "./common.js";

/**
 * Tools the engine may call (docs/planning/10 §3, FR-TOOL-01).
 *
 * A tool is named here before it may appear in a plan, so a model cannot invent
 * one: an unknown name fails to parse at the queue boundary. The executable
 * side of each manifest lives in `@ua/agent-engine`; this package owns only
 * what travels on the wire.
 */
export const TOOL_NAMES = ["workspace.write_file"] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
export const ToolName = z.enum(TOOL_NAMES);

export const ToolVersion = z.string().trim().min(1).max(40);

export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
export const Sha256Hex = z.string().regex(SHA256_HEX_PATTERN, "must be a lowercase sha256 hex");

/** The M0 tool writes text, not a repository: one call is bounded. */
export const WORKSPACE_WRITE_MAX_BYTES = 256 * 1024;

/**
 * The one real tool (`workspace.write_file`).
 *
 * The path is workspace-relative; the runner is the side that resolves it
 * against a registered root and refuses anything that escapes. Rejecting `..`
 * and absolute paths here is a cheap early refusal, not the boundary.
 */
export const WorkspaceWriteArguments = z
  .object({
    path: z.string().trim().min(1).max(1024),
    content: z.string().max(WORKSPACE_WRITE_MAX_BYTES),
  })
  .strict();
export type WorkspaceWriteArguments = z.infer<typeof WorkspaceWriteArguments>;

/**
 * A workspace path is relative and already free of structure the runner would
 * otherwise have to fold. Both the worker (before accepting a plan) and the
 * device (before touching the filesystem) apply it; the device is still what
 * resolves the path for real.
 */
export function validateWorkspacePath(raw: string): string | null {
  if (raw.startsWith("/") || raw.startsWith("\\") || /^[A-Za-z]:/.test(raw)) {
    return "must be relative to the workspace";
  }
  const segments = raw.split(/[\\/]/);
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return "must not contain empty, '.' or '..' segments";
  }
  return null;
}

/**
 * JSON with sorted keys and no whitespace, so two processes hash the same
 * bytes for the same value. `JSON.stringify` alone preserves insertion order,
 * which is not something a wire contract can promise.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(",")}}`;
}

/**
 * The exact bytes an approval binds (docs/planning/10 §4, FR-APPR-03).
 *
 * Every field a user is approving is inside this string, and expiry is bound
 * too, so a grant for this action cannot be replayed against a later one. The
 * digest itself is computed where crypto lives (worker and runner), the same
 * way `canonicalDeviceCommand` leaves the hashing to its callers.
 */
export function canonicalToolAction(input: {
  tool: string;
  toolVersion: string;
  arguments: Record<string, unknown>;
  deviceId: string;
  workspaceId: string;
  policyVersion: string;
  expiresAt: string;
}): string {
  return canonicalJson({
    v: 1,
    tool: input.tool,
    toolVersion: input.toolVersion,
    arguments: input.arguments,
    deviceId: input.deviceId,
    workspaceId: input.workspaceId,
    policyVersion: input.policyVersion,
    expiresAt: input.expiresAt,
  });
}

/**
 * What the API queues for a device to execute one approved step
 * (docs/planning/09 §5.2, Phase 5).
 *
 * `approvalExpiresAt` is part of the action digest, so the runner can recompute
 * it from the payload and refuse a command whose approval has been repointed.
 */
export const ToolExecuteCommandPayload = z
  .object({
    taskId: Uuid,
    stepId: Uuid,
    approvalId: Uuid.nullish(),
    tool: ToolName,
    toolVersion: ToolVersion,
    arguments: z.record(z.string(), z.unknown()),
    actionDigest: Sha256Hex,
    policyVersion: z.string().trim().min(1).max(40),
    approvalExpiresAt: Timestamp,
    deviceId: Uuid,
    workspaceId: Uuid,
  })
  .strict();
export type ToolExecuteCommandPayload = z.infer<typeof ToolExecuteCommandPayload>;

/** What the device reports back for a successful tool call. */
export const WorkspaceWriteResult = z
  .object({
    path: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    sha256: Sha256Hex,
  })
  .strict();
export type WorkspaceWriteResult = z.infer<typeof WorkspaceWriteResult>;
