import { createHash, randomUUID } from "node:crypto";
// Value imports: the state machine is the single authority on `tasks.state`
// (docs/planning/08 §4.2), and the payload schema guards the queue boundary.
import { assertTaskTransition } from "@ua/agent-engine";
import type { TaskPlanJobPayload as TaskPlanJob, TaskState } from "@ua/contracts";
import { TaskPlanJobPayload } from "@ua/contracts";
import { forOrganization, type PrismaClient } from "@ua/database";
import type { Logger } from "@ua/logger";
import type { CodingEngine } from "./coding-engine.js";

export interface TaskRunnerDeps {
  database: PrismaClient;
  engine: CodingEngine;
  logger: Logger;
  /** This process's identity in `job_leases.owner`. */
  owner: string;
  /** How long a claim survives without a heartbeat. */
  leaseTtlMs: number;
}

/** The processor only reads the payload, so tests can hand it a plain object. */
export interface TaskPlanJobLike {
  data: unknown;
}

/**
 * The `task.plan` consumer (docs/planning/07 §6, 08 §4.1).
 *
 * Delivery is at-least-once, so everything here has to survive a replay: a task
 * that is no longer `QUEUED` is left alone, and the claim itself is a
 * compare-and-set that a second delivery simply loses.
 */
export function createTaskPlanProcessor(deps: TaskRunnerDeps) {
  return async function processTaskPlan(job: TaskPlanJobLike): Promise<void> {
    await runTaskPlan(deps, TaskPlanJobPayload.parse(job.data));
  };
}

async function runTaskPlan(deps: TaskRunnerDeps, payload: TaskPlanJob): Promise<void> {
  const { organizationId, taskId } = payload;
  const logger = deps.logger.child({ taskId, organizationId });

  const database = scopeFor(deps.database, organizationId);
  const task = await database.tasks.findUnique({ where: { id: taskId } });
  if (task === null) {
    logger.warn("task.plan: no such task, dropping the job");
    return;
  }
  if (task.state !== "QUEUED") {
    // A replay, or a task another worker already claimed: consumers are
    // idempotent (docs/planning/08 §13).
    logger.info("task.plan: task is no longer queued, nothing to do", { state: task.state });
    return;
  }

  const leaseId = await acquireTaskLease(deps, taskId);
  if (leaseId === null) {
    logger.info("task.plan: another worker holds the lease, dropping the job");
    return;
  }

  const heartbeat = setInterval(
    () => {
      void heartbeatTaskLease(deps, leaseId);
    },
    Math.max(1_000, Math.floor(deps.leaseTtlMs / 3)),
  );
  heartbeat.unref();

  try {
    await driveTaskToCompletion(deps, organizationId, taskId, task.goal, logger);
  } finally {
    clearInterval(heartbeat);
    await releaseTaskLease(deps, leaseId);
  }
}

/**
 * The Phase 3 happy path: plan it as data, then run it.
 *
 * shortcut: one job does the whole lifecycle, because there is nothing yet to
 * fan out — per-step `task.step.execute` jobs and real verification arrive in
 * Phase 5. The transitions are the real ones, so what changes later is only
 * what sits between them.
 */
async function driveTaskToCompletion(
  deps: TaskRunnerDeps,
  organizationId: string,
  taskId: string,
  goal: string,
  logger: Logger,
): Promise<void> {
  const database = scopeFor(deps.database, organizationId);

  // 1. Claim it: `QUEUED → PLANNING`, the planner claiming the lease (08 §4.1).
  if (!(await transition(database, organizationId, taskId, "QUEUED", "PLANNING", logger))) {
    return;
  }

  const plan = deps.engine.plan(goal);
  await database.tasks.update({ where: { id: taskId }, data: { plan: { steps: plan.steps } } });
  for (const step of plan.steps) {
    await database.task_steps.create({
      data: {
        organization_id: organizationId,
        task_id: taskId,
        seq: step.seq,
        kind: step.kind,
        title: step.title,
      },
    });
  }
  await appendEvent(database, organizationId, taskId, "plan.created", { steps: plan.steps.length });

  // 2. A valid plan is persisted, so the task can run (08 §4.1).
  if (!(await transition(database, organizationId, taskId, "PLANNING", "RUNNING", logger))) {
    return;
  }
  await database.tasks.update({ where: { id: taskId }, data: { started_at: new Date() } });

  const steps = await database.task_steps.findMany({
    where: { task_id: taskId },
    orderBy: { seq: "asc" },
  });
  for (const step of steps) {
    await database.task_steps.update({
      where: { id: step.id },
      data: { state: "RUNNING", started_at: new Date(), attempts: { increment: 1 } },
    });
    await appendEvent(database, organizationId, taskId, "step.started", {
      stepId: step.id,
      seq: step.seq,
    });

    // shortcut: the mock engine has no tools, so every step succeeds.
    const result = { note: "mock execution: no tools are available in Phase 3" };
    const digest = createHash("sha256").update(JSON.stringify(result)).digest("hex");
    await database.task_steps.update({
      where: { id: step.id },
      data: { state: "COMPLETED", finished_at: new Date(), result, result_digest: digest },
    });
    await appendEvent(database, organizationId, taskId, "step.succeeded", {
      stepId: step.id,
      seq: step.seq,
    });
  }

  // 3. Verification cannot be skipped: `RUNNING → COMPLETED` is illegal
  // (docs/planning/08 §4.2), so the task passes through `VERIFYING`.
  if (!(await transition(database, organizationId, taskId, "RUNNING", "VERIFYING", logger))) {
    return;
  }
  await appendEvent(database, organizationId, taskId, "verification.passed", {
    assertions: 1,
    // The record of the run is this event until a verification engine exists.
    note: "mock verification: the engine always passes in Phase 3",
  });

  if (!(await transition(database, organizationId, taskId, "VERIFYING", "COMPLETED", logger))) {
    return;
  }
  await database.tasks.update({
    where: { id: taskId },
    data: { finished_at: new Date(), result_summary: `${steps.length} step(s) completed` },
  });
  await appendEvent(database, organizationId, taskId, "task.completed", { steps: steps.length });
  logger.info("task.plan: task completed", { steps: steps.length });
}

/** The tenant-scoped view of the database these helpers work through (ADR-008). */
function scopeFor(database: PrismaClient, organizationId: string) {
  return forOrganization(database, organizationId);
}

type ScopedDatabase = ReturnType<typeof scopeFor>;

/**
 * The only place `tasks.state` is written (docs/planning/08 §4.2).
 *
 * `assertTaskTransition` decides whether the move is legal at all; the
 * compare-and-set is what makes a second delivery safe, because it loses the
 * race and stops instead of moving a task somebody else already moved.
 */
async function transition(
  database: ScopedDatabase,
  organizationId: string,
  taskId: string,
  from: TaskState,
  to: TaskState,
  logger: Logger,
): Promise<boolean> {
  assertTaskTransition(from, to);
  const { count } = await database.tasks.updateMany({
    where: { id: taskId, state: from },
    data: { state: to, state_changed_at: new Date() },
  });
  if (count === 0) {
    logger.info("task.plan: lost the race to move the task", { from, to });
    return false;
  }
  await appendEvent(database, organizationId, taskId, "task.state_changed", { from, to });
  return true;
}

/**
 * The values `task_events.data` accepts: flat, JSON-safe scalars. Anything
 * larger belongs in an artifact, not an event (docs/planning/08 §13).
 */
type EventData = Record<string, string | number>;

/**
 * Append one event with the task's next sequence number (ADR-006).
 *
 * `task_events` is append-only with a unique `(task_id, seq)`, so a racing
 * writer loses on the constraint rather than silently renumbering history.
 * `organization_id` is required, not inferred: the tenant scope validates that
 * the row belongs to the organization it was reached through (ADR-008).
 */
async function appendEvent(
  database: ScopedDatabase,
  organizationId: string,
  taskId: string,
  type: string,
  data: EventData,
): Promise<void> {
  const { _max } = await database.task_events.aggregate({
    where: { task_id: taskId },
    _max: { seq: true },
  });
  await database.task_events.create({
    data: {
      organization_id: organizationId,
      task_id: taskId,
      seq: (_max.seq ?? 0) + 1,
      type,
      data,
      actor: "worker",
    },
  });
}

/** Prisma's P2002: the row already exists — here, somebody holds the lease. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/**
 * The claim (docs/planning/08 §4.1). `job_leases` holds one row per resource, so
 * the insert *is* the compare-and-set: a duplicate can only take over from a
 * lease that has already expired.
 */
async function acquireTaskLease(deps: TaskRunnerDeps, taskId: string): Promise<string | null> {
  const now = new Date();
  const leaseId = randomUUID();
  const resource = { resource_type: "task", resource_id: taskId };
  const grant = {
    lease_id: leaseId,
    owner: deps.owner,
    heartbeat_at: now,
    expires_at: new Date(now.getTime() + deps.leaseTtlMs),
  };
  try {
    await deps.database.job_leases.create({ data: { ...resource, ...grant } });
    return leaseId;
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const held = await deps.database.job_leases.findUnique({
      where: { resource_type_resource_id: resource },
    });
    if (held === null || held.expires_at > now) {
      return null;
    }
    // The holder stopped heartbeating: take the row over rather than wait for a
    // reaper that does not exist yet.
    await deps.database.job_leases.update({ where: { id: held.id }, data: grant });
    return leaseId;
  }
}

/** Extends the claim; a missed one makes the task claimable again (08 §5). */
async function heartbeatTaskLease(deps: TaskRunnerDeps, leaseId: string): Promise<void> {
  const now = new Date();
  await deps.database.job_leases.updateMany({
    where: { lease_id: leaseId },
    data: { heartbeat_at: now, expires_at: new Date(now.getTime() + deps.leaseTtlMs) },
  });
}

async function releaseTaskLease(deps: TaskRunnerDeps, leaseId: string): Promise<void> {
  await deps.database.job_leases.deleteMany({ where: { lease_id: leaseId } });
}
