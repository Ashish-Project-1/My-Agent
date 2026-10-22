import { Injectable } from "@nestjs/common";
import {
  type CreateWorkspaceGrantRequest,
  type DeviceWorkspacePolicy,
  type RegisterWorkspaceRequest,
  type UpdateWorkspaceRequest,
  type WorkspaceGrantSummary,
  type WorkspaceSummary,
} from "@ua/contracts";
import { AppError } from "@ua/error-handling";
import {
  canonicalisePath,
  flavourForOs,
  type PathFlavour,
  type PathRejectReason,
} from "@ua/sandbox-manager";
import { AuditService } from "../audit/audit.service.js";
import { AUDIT_ACTIONS } from "../audit/audit-actions.js";
import type { Principal } from "../common/principal.js";
import { isUniqueViolationOn } from "../common/prisma-errors.js";
import type { RequestMeta } from "../common/request-meta.js";
import type { DevicePrincipal } from "../devices/device-principal.js";
import { DevicesService } from "../devices/devices.service.js";
import { WorkspacesRepository } from "./workspaces.repository.js";

/**
 * Why a path was refused, in a sentence the person who typed it can act on
 * (docs/planning/07 §2: `detail` is written for the user, and it is never a path
 * from anywhere but the caller's own request).
 */
const PATH_REFUSAL: Record<PathRejectReason, string> = {
  empty: "A workspace path is required.",
  too_long: "That path is too long to be a real one.",
  control_character: "That path contains a control character.",
  not_absolute: "A workspace must be an absolute path, such as F:\\Projects\\app.",
  unc_path: "A network share cannot be a workspace: register a local directory.",
  device_path: "A device or verbatim path (\\\\?\\, \\\\.\\) cannot be a workspace.",
  alternate_data_stream: "A path with an alternate data stream is not a workspace.",
  traversal: "That path walks above its own root, so it does not name one directory.",
  reserved_name: "That path names a Windows device rather than a directory.",
  trailing_dot_or_space: "A Windows path cannot end a component with a dot or a space.",
};

function labelFrom(path: string, flavour: PathFlavour): string {
  const separator = flavour === "win32" ? "\\" : "/";
  const segments = path.split(separator).filter((segment) => segment !== "");
  return segments[segments.length - 1] ?? path;
}

/**
 * Workspaces and their `external_directory` grants (FR-DEV-05, docs/planning/09
 * §6, `12` §5.5).
 *
 * The one thing this service must get right is *when* a path becomes a root. A
 * root the runner honours is a directory the agent may write to, so a path is
 * canonicalised and refused here, at the registry, before it ever reaches a
 * machine — an unvalidated root would be honoured by the runner precisely
 * because it was registered.
 *
 * The policy itself (`@ua/sandbox-manager`) is shared with the runner, which
 * applies it a second time against the real filesystem. The API can only judge
 * the string; the runner is the side that can resolve it.
 */
@Injectable()
export class WorkspacesService {
  constructor(
    private readonly repository: WorkspacesRepository,
    private readonly devices: DevicesService,
    private readonly audit: AuditService,
  ) {}

  private refusal(reason: PathRejectReason): never {
    throw new AppError(
      "invalid_request",
      PATH_REFUSAL[reason] ?? "That path cannot be a workspace.",
    );
  }

  /**
   * The grammar is the *device's*, not the API's (docs/planning/06 §2.2): a
   * Windows runner must not be handed a path validated as if it were POSIX.
   */
  private flavourOf(os: string): PathFlavour {
    return flavourForOs(os);
  }

  async register(
    principal: Principal,
    input: RegisterWorkspaceRequest,
    meta: RequestMeta,
  ): Promise<WorkspaceSummary> {
    // Control, not just visibility: a workspace is authority over a machine, and
    // a colleague's machine is not the caller's to hand to an agent.
    const device = await this.devices.requireDeviceControl(principal, input.deviceId);
    const flavour = this.flavourOf(device.os);

    const canonical = canonicalisePath(input.path, flavour);
    if (!canonical.ok) {
      this.refusal(canonical.reason);
    }
    const path = canonical.canonicalPath;

    try {
      return await this.repository.transaction(async (writer) => {
        const row = await this.repository.createWorkspace(writer, {
          organizationId: principal.organizationId,
          deviceId: input.deviceId,
          path,
          rawPath: input.path,
          label: input.label ?? labelFrom(path, flavour),
          mode: input.mode,
          createdBy: principal.userId,
        });

        await this.audit.record(
          {
            organizationId: principal.organizationId,
            actorType: "user",
            actorId: principal.userId,
            action: AUDIT_ACTIONS.workspaceCreate,
            resourceType: "workspace",
            resourceId: row.id,
            ipHash: meta.ipHash,
            userAgentDigest: meta.userAgentDigest,
            traceId: meta.traceId,
            metadata: { device_id: input.deviceId, path, mode: input.mode },
          },
          writer,
        );

        return row;
      });
    } catch (error) {
      // One directory, one registration: a second one would be a root that can be
      // edited apart from the first, and the runner would see whichever it read.
      if (isUniqueViolationOn(error, "path")) {
        throw new AppError("conflict", "That directory is already registered on this device.");
      }
      throw error;
    }
  }

  async list(organizationId: string, deviceId?: string): Promise<WorkspaceSummary[]> {
    return this.repository.listWorkspaces(organizationId, deviceId);
  }

  /** Another tenant's workspace is `not_found`, not `forbidden` (docs/planning/06 §5). */
  async get(organizationId: string, workspaceId: string): Promise<WorkspaceSummary> {
    const workspace = await this.repository.getWorkspace(organizationId, workspaceId);
    if (workspace === null) {
      throw new AppError("not_found", "That workspace was not found.");
    }
    return workspace;
  }

  async update(
    principal: Principal,
    workspaceId: string,
    input: UpdateWorkspaceRequest,
    meta: RequestMeta,
  ): Promise<WorkspaceSummary> {
    if (input.label === undefined && input.mode === undefined) {
      throw new AppError("invalid_request", "Give a label, a mode, or both.");
    }

    const workspace = await this.get(principal.organizationId, workspaceId);
    await this.devices.requireDeviceControl(principal, workspace.deviceId);

    return this.repository.transaction(async (writer) => {
      const row = await this.repository.updateWorkspace(writer, {
        organizationId: principal.organizationId,
        workspaceId,
        ...(input.label === undefined ? {} : { label: input.label }),
        ...(input.mode === undefined ? {} : { mode: input.mode }),
      });
      if (row === null) {
        throw new AppError("not_found", "That workspace was not found.");
      }

      await this.audit.record(
        {
          organizationId: principal.organizationId,
          actorType: "user",
          actorId: principal.userId,
          action: AUDIT_ACTIONS.workspaceUpdate,
          resourceType: "workspace",
          resourceId: workspaceId,
          ipHash: meta.ipHash,
          userAgentDigest: meta.userAgentDigest,
          traceId: meta.traceId,
          metadata: { mode: row.mode, label: row.label },
        },
        writer,
      );

      return row;
    });
  }

  /**
   * Removing a workspace is a hard delete: the path stops being a root, and the
   * grants that hung off it go with it. Re-registering the same directory is then
   * an ordinary registration, which is what "Remove" should mean.
   */
  async remove(principal: Principal, workspaceId: string, meta: RequestMeta): Promise<void> {
    const workspace = await this.get(principal.organizationId, workspaceId);
    await this.devices.requireDeviceControl(principal, workspace.deviceId);

    await this.repository.transaction(async (writer) => {
      const removed = await this.repository.deleteWorkspace(writer, {
        organizationId: principal.organizationId,
        workspaceId,
      });
      if (!removed) {
        throw new AppError("not_found", "That workspace was not found.");
      }

      await this.audit.record(
        {
          organizationId: principal.organizationId,
          actorType: "user",
          actorId: principal.userId,
          action: AUDIT_ACTIONS.workspaceRemove,
          resourceType: "workspace",
          resourceId: workspaceId,
          ipHash: meta.ipHash,
          userAgentDigest: meta.userAgentDigest,
          traceId: meta.traceId,
          metadata: { device_id: workspace.deviceId, path: workspace.path },
        },
        writer,
      );
    });
  }

  /** Any member may see the org's roots; only a device's owner or an admin may change them. */
  async listGrants(organizationId: string, workspaceId: string): Promise<WorkspaceGrantSummary[]> {
    await this.get(organizationId, workspaceId);
    return this.repository.listGrants(organizationId, workspaceId);
  }

  async createGrant(
    principal: Principal,
    workspaceId: string,
    input: CreateWorkspaceGrantRequest,
    meta: RequestMeta,
  ): Promise<WorkspaceGrantSummary> {
    const workspace = await this.get(principal.organizationId, workspaceId);
    const device = await this.devices.requireDeviceControl(principal, workspace.deviceId);

    // A grant is a path too, and it is compared against canonical paths, so it
    // gets the same canonicalisation as a root.
    const canonical = canonicalisePath(input.pathPattern, this.flavourOf(device.os));
    if (!canonical.ok) {
      this.refusal(canonical.reason);
    }
    const pathPattern = canonical.canonicalPath;

    return this.repository.transaction(async (writer) => {
      const row = await this.repository.createGrant(writer, {
        organizationId: principal.organizationId,
        workspaceId,
        pathPattern,
        effect: input.effect,
        expiresAt: input.expiresAt == null ? null : new Date(input.expiresAt),
        grantedBy: principal.userId,
      });

      await this.audit.record(
        {
          organizationId: principal.organizationId,
          actorType: "user",
          actorId: principal.userId,
          action: AUDIT_ACTIONS.workspaceGrantCreate,
          resourceType: "workspace_grant",
          resourceId: row.id,
          ipHash: meta.ipHash,
          userAgentDigest: meta.userAgentDigest,
          traceId: meta.traceId,
          metadata: {
            workspace_id: workspaceId,
            path_pattern: pathPattern,
            effect: input.effect,
          },
        },
        writer,
      );

      return row;
    });
  }

  async revokeGrant(principal: Principal, grantId: string, meta: RequestMeta): Promise<void> {
    const grant = await this.repository.getGrant(principal.organizationId, grantId);
    if (grant === null) {
      throw new AppError("not_found", "That grant was not found.");
    }
    const workspace = await this.get(principal.organizationId, grant.workspaceId);
    await this.devices.requireDeviceControl(principal, workspace.deviceId);

    await this.repository.transaction(async (writer) => {
      const removed = await this.repository.deleteGrant(writer, {
        organizationId: principal.organizationId,
        grantId,
      });
      if (!removed) {
        throw new AppError("not_found", "That grant was not found.");
      }

      await this.audit.record(
        {
          organizationId: principal.organizationId,
          actorType: "user",
          actorId: principal.userId,
          action: AUDIT_ACTIONS.workspaceGrantRevoke,
          resourceType: "workspace_grant",
          resourceId: grantId,
          ipHash: meta.ipHash,
          userAgentDigest: meta.userAgentDigest,
          traceId: meta.traceId,
          metadata: { workspace_id: grant.workspaceId, path_pattern: grant.pathPattern },
        },
        writer,
      );
    });
  }

  /**
   * What the device itself must enforce (FR-DEV-05).
   *
   * The caller is the device, and the guard resolved it from its own signature,
   * so this can only ever answer with the rows belonging to the device asking.
   */
  async policyForDevice(device: DevicePrincipal): Promise<DeviceWorkspacePolicy> {
    const workspaces = await this.repository.listWorkspaces(device.organizationId, device.deviceId);
    const grants = await this.repository.listGrantsForWorkspaces(
      device.organizationId,
      workspaces.map((workspace) => workspace.id),
      new Date(),
    );
    return { workspaces, grants };
  }
}
