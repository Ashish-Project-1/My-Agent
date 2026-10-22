import { z } from "zod";
import { Timestamp, Uuid } from "./common.js";

/**
 * Workspace registration and `external_directory` grants (docs/planning/07 §3.6,
 * `06` §2.2, FR-DEV-05).
 *
 * A workspace is the answer to "what may the agent touch on my machine". It is
 * registered by a member, stored as its canonical path, and enforced by the
 * runner — which is why the path here is validated as data and never used as a
 * path by the API itself (docs/planning/09 §6).
 *
 * The path policy lives in `@ua/sandbox-manager`; this package owns only what
 * travels on the wire.
 */

/** What the user allowed, not what a tool would like (docs/planning/09 §6). */
export const WorkspaceMode = z.enum(["read_only", "read_write"]);
export type WorkspaceMode = z.infer<typeof WorkspaceMode>;

/**
 * `allow` reaches outside a workspace; `deny` vetoes a path that is inside one.
 * A deny always beats an allow, so a new rule can never widen access
 * (`@ua/sandbox-manager`).
 */
export const WorkspaceGrantEffect = z.enum(["allow", "deny"]);
export type WorkspaceGrantEffect = z.infer<typeof WorkspaceGrantEffect>;

export const WorkspaceLabel = z.string().trim().min(1).max(120);

/**
 * A path as someone typed it, before canonicalisation. Bounded here rather than
 * left to the column, and canonicalised by the API before it is stored.
 *
 * Deliberately not `.trim()`ed, unlike `WorkspaceLabel`: trimming would turn
 * `F:\code ` into `F:\code` and hide the stray space from the user, and the
 * refusal it earns says what is actually wrong with the path.
 */
export const WorkspacePath = z.string().min(1).max(4096);

export const WorkspaceSummary = z
  .object({
    id: Uuid,
    deviceId: Uuid,
    /** The canonical path — the authority for every later comparison. */
    path: z.string().min(1).max(4096),
    /** What was typed. Display only: never compared against anything. */
    rawPath: WorkspacePath,
    label: WorkspaceLabel,
    mode: WorkspaceMode,
    createdByUserId: Uuid,
    lastUsedAt: Timestamp.nullable(),
    createdAt: Timestamp,
  })
  .strict();
export type WorkspaceSummary = z.infer<typeof WorkspaceSummary>;

export const WorkspaceListResponse = z.object({ workspaces: z.array(WorkspaceSummary) }).strict();
export type WorkspaceListResponse = z.infer<typeof WorkspaceListResponse>;

/** Narrows the list to one device's roots; absent means the whole organization. */
export const WorkspaceListQuery = z.object({ deviceId: Uuid.optional() }).strict();
export type WorkspaceListQuery = z.infer<typeof WorkspaceListQuery>;

export const RegisterWorkspaceRequest = z
  .object({
    deviceId: Uuid,
    path: WorkspacePath,
    /** Defaults to the last segment of the canonical path. */
    label: WorkspaceLabel.optional(),
    mode: WorkspaceMode,
  })
  .strict();
export type RegisterWorkspaceRequest = z.infer<typeof RegisterWorkspaceRequest>;

/**
 * Either field alone is a valid change; neither is not. That is checked in the
 * service rather than with `.refine`, so the schema stays a plain object the
 * OpenAPI generator can walk.
 */
export const UpdateWorkspaceRequest = z
  .object({
    label: WorkspaceLabel.optional(),
    mode: WorkspaceMode.optional(),
  })
  .strict();
export type UpdateWorkspaceRequest = z.infer<typeof UpdateWorkspaceRequest>;

export const WorkspaceGrantSummary = z
  .object({
    id: Uuid,
    workspaceId: Uuid,
    /** A canonical directory. It covers itself and everything below it. */
    pathPattern: z.string().min(1).max(4096),
    effect: WorkspaceGrantEffect,
    /** Null means standing until revoked. */
    expiresAt: Timestamp.nullable(),
    grantedByUserId: Uuid,
    policyVersion: z.number().int().positive(),
    createdAt: Timestamp,
  })
  .strict();
export type WorkspaceGrantSummary = z.infer<typeof WorkspaceGrantSummary>;

export const CreateWorkspaceGrantRequest = z
  .object({
    pathPattern: WorkspacePath,
    effect: WorkspaceGrantEffect,
    expiresAt: Timestamp.nullish(),
  })
  .strict();
export type CreateWorkspaceGrantRequest = z.infer<typeof CreateWorkspaceGrantRequest>;

export const WorkspaceGrantListResponse = z
  .object({ grants: z.array(WorkspaceGrantSummary) })
  .strict();
export type WorkspaceGrantListResponse = z.infer<typeof WorkspaceGrantListResponse>;

/**
 * What the device must enforce (FR-DEV-05).
 *
 * The runner gets roots and grants in one answer because each is useless without
 * the other: roots alone would let it allow a path a deny grant covers, and
 * grants alone would let it allow anything outside a root.
 */
export const DeviceWorkspacePolicy = z
  .object({
    workspaces: z.array(WorkspaceSummary),
    grants: z.array(WorkspaceGrantSummary),
  })
  .strict();
export type DeviceWorkspacePolicy = z.infer<typeof DeviceWorkspacePolicy>;
