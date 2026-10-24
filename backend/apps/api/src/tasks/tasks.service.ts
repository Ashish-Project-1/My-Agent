import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { CreateTaskRequest, TaskSummary } from "@ua/contracts";
import { AppError } from "@ua/error-handling";
// Value imports for injected classes: Nest resolves dependencies from decorator
// metadata, which a type-only import erases.
import { AuditService } from "../audit/audit.service.js";
import { AUDIT_ACTIONS } from "../audit/audit-actions.js";
import type { Principal } from "../common/principal.js";
import type { RequestMeta } from "../common/request-meta.js";
import { DevicesService } from "../devices/devices.service.js";
import { WorkspacesService } from "../workspaces/workspaces.service.js";
import { TasksRepository } from "./tasks.repository.js";

/** The idempotency scope: one route, so a key cannot collide across routes. */
const TASK_CREATE_SCOPE = "POST /v1/tasks";

/** Keys live 24 h (docs/planning/06 §8 `[ASSUMPTION]`). */
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const IDEMPOTENCY_CONFLICT =
  "This Idempotency-Key was already used with a different request, or is still being processed.";

/** A stable digest of the request body, so a replay with a different body is rejected. */
function requestDigest(input: CreateTaskRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        goal: input.goal,
        agentSessionId: input.agentSessionId ?? null,
        deviceId: input.deviceId ?? null,
        workspaceId: input.workspaceId ?? null,
      }),
    )
    .digest("hex");
}

/**
 * Tasks (docs/planning/06 §2.3, 08, 07 §3.3).
 *
 * Creation is the durable-intent slice: a task row, its first `task.created`
 * event, its `task.created` outbox row and its idempotency key are written in a
 * single transaction, so a task exists if and only if the work is queued
 * (NFR-REL-02, FR-TASK-10).
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly repository: TasksRepository,
    private readonly audit: AuditService,
    private readonly devices: DevicesService,
    private readonly workspaces: WorkspacesService,
  ) {}

  list(organizationId: string) {
    return this.repository.listTasks(organizationId);
  }

  get(organizationId: string, taskId: string) {
    return this.repository.getTask(organizationId, taskId);
  }

  events(organizationId: string, taskId: string) {
    return this.repository.listTaskEvents(organizationId, taskId);
  }

  steps(organizationId: string, taskId: string) {
    return this.repository.listTaskSteps(organizationId, taskId);
  }

  /**
   * Create a task. A replay of the same `Idempotency-Key` with the same body
   * returns the original task instead of creating a second one; a replay with a
   * different body is a `409 idempotency_conflict` (FR-TASK-10).
   */
  async create(
    principal: Principal,
    input: CreateTaskRequest,
    meta: RequestMeta,
    idempotencyKey: string | null,
  ): Promise<TaskSummary> {
    const organizationId = principal.organizationId;
    const digest = requestDigest(input);

    // A device task needs both halves of the pair, and the caller must control
    // the machine: handing a colleague's workspace to an agent is not theirs to
    // do (docs/planning/09 §6). Both checks read through their own module.
    if (((input.deviceId ?? null) === null) !== ((input.workspaceId ?? null) === null)) {
      throw new AppError(
        "validation_failed",
        "deviceId and workspaceId must be supplied together.",
      );
    }
    const device =
      input.deviceId == null
        ? null
        : await this.devices.requireDeviceControl(principal, input.deviceId);
    if (device !== null && device.status !== "active") {
      throw new AppError("state_conflict", "That device is not active.");
    }
    if (input.workspaceId != null) {
      const workspace = await this.workspaces.get(organizationId, input.workspaceId);
      if (workspace.deviceId !== input.deviceId) {
        throw new AppError("validation_failed", "That workspace is not registered on that device.");
      }
    }

    return this.repository.transaction(async (writer) => {
      let idempotencyId: string | null = null;

      if (idempotencyKey !== null) {
        const existing = await this.repository.findIdempotencyRecord(writer, {
          organizationId,
          scope: TASK_CREATE_SCOPE,
          key: idempotencyKey,
        });
        if (existing !== null) {
          if (existing.request_digest !== digest) {
            throw new AppError("idempotency_conflict", IDEMPOTENCY_CONFLICT);
          }
          if (existing.state === "completed" && existing.response_body !== null) {
            return existing.response_body as TaskSummary;
          }
          // in_progress: a concurrent duplicate, or a crashed run. Refuse rather
          // than risk two tasks.
          throw new AppError("idempotency_conflict", IDEMPOTENCY_CONFLICT);
        }
        idempotencyId = await this.repository.insertIdempotencyRecord(writer, {
          organizationId,
          scope: TASK_CREATE_SCOPE,
          key: idempotencyKey,
          requestDigest: digest,
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        });
      }

      let agentSessionId: string;
      if (input.agentSessionId) {
        // A caller may not attach a task to another tenant's session.
        const owned = await this.repository.agentSessionInOrg(
          writer,
          organizationId,
          input.agentSessionId,
        );
        if (!owned) {
          throw new AppError("not_found", "That agent session was not found.");
        }
        agentSessionId = input.agentSessionId;
      } else {
        agentSessionId = await this.repository.createAgentSession(writer, {
          organizationId,
          userId: principal.userId,
          title: null,
        });
      }

      const task = await this.repository.createTask(writer, {
        organizationId,
        agentSessionId,
        createdBy: principal.userId,
        goal: input.goal,
        deviceId: input.deviceId ?? null,
        workspaceId: input.workspaceId ?? null,
      });

      await this.repository.appendTaskEvent(writer, {
        organizationId,
        taskId: task.id,
        seq: 1,
        type: "task.created",
        actor: "user",
        actorId: principal.userId,
      });

      await this.repository.publishOutbox(writer, {
        organizationId,
        aggregateType: "task",
        aggregateId: task.id,
        eventType: "task.created",
        payload: { taskId: task.id, state: task.state },
      });

      if (idempotencyId !== null) {
        await this.repository.completeIdempotencyRecord(writer, {
          id: idempotencyId,
          responseStatus: 201,
          responseBody: task,
        });
      }

      await this.audit.record(
        {
          organizationId,
          actorType: "user",
          actorId: principal.userId,
          action: AUDIT_ACTIONS.taskCreate,
          resourceType: "task",
          resourceId: task.id,
          result: "success",
          ipHash: meta.ipHash,
          userAgentDigest: meta.userAgentDigest,
          traceId: meta.traceId,
          metadata: { goal_length: input.goal.length },
        },
        writer,
      );

      return task;
    });
  }
}
