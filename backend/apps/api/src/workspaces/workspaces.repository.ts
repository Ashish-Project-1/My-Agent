import { Injectable } from "@nestjs/common";
import type { WorkspaceGrantSummary, WorkspaceSummary } from "@ua/contracts";
import { forOrganization } from "@ua/database";
// Value import: Nest emits the constructor's token from runtime metadata.
import { UnscopedDatabase } from "../database/unscoped-database.js";
import type { DbWriter } from "../database/writer.js";

/**
 * Workspaces, grants and the tables behind them (docs/planning/06 §2.2).
 *
 * Reads go through `forOrganization`, so a workspace is only ever reachable
 * inside the organization the session is scoped to. Writes take a transaction,
 * because registering a directory and writing its audit row commit together or
 * not at all — and `forOrganization` cannot wrap a transaction client, so the
 * writes below bind `organization_id` from the authenticated caller by hand.
 */

const WORKSPACE_SELECT = {
  id: true,
  device_id: true,
  path: true,
  raw_path: true,
  label: true,
  mode: true,
  created_by: true,
  last_used_at: true,
  created_at: true,
} as const;

const GRANT_SELECT = {
  id: true,
  workspace_id: true,
  path_pattern: true,
  effect: true,
  expires_at: true,
  granted_by: true,
  policy_version: true,
  created_at: true,
} as const;

type RawWorkspace = {
  id: string;
  device_id: string;
  path: string;
  raw_path: string;
  label: string;
  mode: WorkspaceSummary["mode"];
  created_by: string;
  last_used_at: Date | null;
  created_at: Date;
};

type RawGrant = {
  id: string;
  workspace_id: string;
  path_pattern: string;
  effect: WorkspaceGrantSummary["effect"];
  expires_at: Date | null;
  granted_by: string;
  policy_version: number;
  created_at: Date;
};

function toWorkspace(row: RawWorkspace): WorkspaceSummary {
  return {
    id: row.id,
    deviceId: row.device_id,
    path: row.path,
    rawPath: row.raw_path,
    label: row.label,
    mode: row.mode,
    createdByUserId: row.created_by,
    lastUsedAt: row.last_used_at === null ? null : row.last_used_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

function toGrant(row: RawGrant): WorkspaceGrantSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    pathPattern: row.path_pattern,
    effect: row.effect,
    expiresAt: row.expires_at === null ? null : row.expires_at.toISOString(),
    grantedByUserId: row.granted_by,
    policyVersion: row.policy_version,
    createdAt: row.created_at.toISOString(),
  };
}

@Injectable()
export class WorkspacesRepository {
  constructor(private readonly database: UnscopedDatabase) {}

  /** Registering a directory and writing its audit row land together (docs/planning/07 §1). */
  transaction<T>(work: (writer: DbWriter) => Promise<T>): Promise<T> {
    return this.database.client.$transaction(work);
  }

  async listWorkspaces(organizationId: string, deviceId?: string): Promise<WorkspaceSummary[]> {
    const db = forOrganization(this.database.client, organizationId);
    const rows = await db.workspaces.findMany({
      where: deviceId === undefined ? {} : { device_id: deviceId },
      select: WORKSPACE_SELECT,
      orderBy: { created_at: "asc" },
    });
    return rows.map(toWorkspace);
  }

  async getWorkspace(
    organizationId: string,
    workspaceId: string,
  ): Promise<WorkspaceSummary | null> {
    const db = forOrganization(this.database.client, organizationId);
    const row = await db.workspaces.findFirst({
      where: { id: workspaceId },
      select: WORKSPACE_SELECT,
    });
    return row === null ? null : toWorkspace(row);
  }

  async createWorkspace(
    writer: DbWriter,
    input: {
      organizationId: string;
      deviceId: string;
      path: string;
      rawPath: string;
      label: string;
      mode: WorkspaceSummary["mode"];
      createdBy: string;
    },
  ): Promise<WorkspaceSummary> {
    const row = await writer.workspaces.create({
      data: {
        organization_id: input.organizationId,
        device_id: input.deviceId,
        path: input.path,
        raw_path: input.rawPath,
        label: input.label,
        mode: input.mode,
        created_by: input.createdBy,
      },
      select: WORKSPACE_SELECT,
    });
    return toWorkspace(row);
  }

  /** Null when the row is gone or belongs elsewhere: the caller decides which answer that is. */
  async updateWorkspace(
    writer: DbWriter,
    input: { organizationId: string; workspaceId: string; label?: string; mode?: string },
  ): Promise<WorkspaceSummary | null> {
    const rows = await writer.workspaces.updateManyAndReturn({
      where: { id: input.workspaceId, organization_id: input.organizationId },
      data: {
        ...(input.label === undefined ? {} : { label: input.label }),
        ...(input.mode === undefined ? {} : { mode: input.mode as WorkspaceSummary["mode"] }),
      },
      select: WORKSPACE_SELECT,
    });
    return rows.length === 0 ? null : toWorkspace(rows[0] as RawWorkspace);
  }

  /** Deleting a workspace takes its grants with it (the foreign key cascades). */
  async deleteWorkspace(
    writer: DbWriter,
    input: { organizationId: string; workspaceId: string },
  ): Promise<boolean> {
    const result = await writer.workspaces.deleteMany({
      where: { id: input.workspaceId, organization_id: input.organizationId },
    });
    return result.count > 0;
  }

  async listGrants(organizationId: string, workspaceId?: string): Promise<WorkspaceGrantSummary[]> {
    const db = forOrganization(this.database.client, organizationId);
    const rows = await db.workspace_grants.findMany({
      where: workspaceId === undefined ? {} : { workspace_id: workspaceId },
      select: GRANT_SELECT,
      orderBy: { created_at: "asc" },
    });
    return rows.map(toGrant);
  }

  /**
   * Every *live* grant that applies to one device's workspaces (FR-DEV-05).
   *
   * Filtered by the workspace ids the caller just read, rather than by a relation
   * filter, so the tenant scope stays the only thing widening the query. Expired
   * grants are omitted here and only here: the member's list still shows them,
   * labelled, because a rule that has lapsed is something a person should be able
   * to see — but the side that enforces must never be handed one.
   */
  async listGrantsForWorkspaces(
    organizationId: string,
    workspaceIds: readonly string[],
    now: Date,
  ): Promise<WorkspaceGrantSummary[]> {
    if (workspaceIds.length === 0) {
      return [];
    }
    const db = forOrganization(this.database.client, organizationId);
    const rows = await db.workspace_grants.findMany({
      where: {
        workspace_id: { in: [...workspaceIds] },
        OR: [{ expires_at: null }, { expires_at: { gt: now } }],
      },
      select: GRANT_SELECT,
      orderBy: { created_at: "asc" },
    });
    return rows.map(toGrant);
  }

  async getGrant(organizationId: string, grantId: string): Promise<WorkspaceGrantSummary | null> {
    const db = forOrganization(this.database.client, organizationId);
    const row = await db.workspace_grants.findFirst({
      where: { id: grantId },
      select: GRANT_SELECT,
    });
    return row === null ? null : toGrant(row);
  }

  async createGrant(
    writer: DbWriter,
    input: {
      organizationId: string;
      workspaceId: string;
      pathPattern: string;
      effect: WorkspaceGrantSummary["effect"];
      expiresAt: Date | null;
      grantedBy: string;
    },
  ): Promise<WorkspaceGrantSummary> {
    const row = await writer.workspace_grants.create({
      data: {
        organization_id: input.organizationId,
        workspace_id: input.workspaceId,
        path_pattern: input.pathPattern,
        effect: input.effect,
        expires_at: input.expiresAt,
        granted_by: input.grantedBy,
      },
      select: GRANT_SELECT,
    });
    return toGrant(row);
  }

  async deleteGrant(
    writer: DbWriter,
    input: { organizationId: string; grantId: string },
  ): Promise<boolean> {
    const result = await writer.workspace_grants.deleteMany({
      where: { id: input.grantId, organization_id: input.organizationId },
    });
    return result.count > 0;
  }
}
