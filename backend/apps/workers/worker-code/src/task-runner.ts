import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
// Value imports: the state machine is the single authority on `tasks.state`
// (docs/planning/08 §4.2), and the payload schema guards the queue boundary.
import {
  actionDigest,
  assertTaskTransition,
  describePolicyAction,
  evaluateAction,
  isRepeatedAction,
  type ReportedToolResult,
  sha256Hex,
  toolManifest,
  verifyToolResult,
} from "@ua/agent-engine";
import type { TaskPlanJobPayload as TaskPlanJob, TaskState } from "@ua/contracts";
import {
  canonicalDeviceCommand,
  canonicalJson,
  isTerminalTaskState,
  TaskPlanJobPayload,
} from "@ua/contracts";
import { forOrganization, type Prisma, type PrismaClient } from "@ua/database";
import type { Logger } from "@ua/logger";
import type { CodingEngine, PlanContext, TaskPlan } from "./coding-engine.js";

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

/** The policy revision the built-in floor is published under. */
const PLATFORM_POLICY_VERSION = "1";
const APPROVAL_TTL_MS = 15 * 60 * 1000;
const COMMAND_TTL_MS = 2 * 60 * 1000;
const WAIT_POLL_MS = 500;
const DEFAULT_MAX_STEPS = 8;
const DEFAULT_MAX_WALL_CLOCK_MS = 20 * 60 * 1000;

/**
 * The `task.plan` consumer (docs/planning/07 §6, 08 §4.1).
 *
 * Delivery is at-least-once, so everything here has to survive a replay: a
 * terminal task is left alone, and the claim itself is a compare-and-set that a
 * second delivery simply loses.
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
  if (isTerminalTaskState(task.state)) {
    // A replay of work that already finished: consumers are idempotent
    // (docs/planning/08 §13).
    logger.info("task.plan: task is already terminal, nothing to do", { state: task.state });
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
    await driveTaskToCompletion(deps, organizationId, taskId, logger);
  } finally {
    clearInterval(heartbeat);
    await releaseTaskLease(deps, leaseId);
  }
}

type ScopedDatabase = ReturnType<typeof scopeFor>;
type TaskRow = Awaited<ReturnType<ScopedDatabase["tasks"]["findUniqueOrThrow"]>>;
type StepRow = Awaited<ReturnType<ScopedDatabase["task_steps"]["findMany"]>>[number];

/** A device task runs real steps; a cloud task keeps the Phase 3 mock path. */
async function driveTaskToCompletion(
  deps: TaskRunnerDeps,
  organizationId: string,
  taskId: string,
  logger: Logger,
): Promise<void> {
  const database = scopeFor(deps.database, organizationId);
  const task = await reloadTask(database, taskId);
  if (task.execution_location === "device") {
    await driveDeviceTask(deps, database, task, logger);
    return;
  }
  await driveMockTask(deps, database, task, logger);
}

/**
 * The Phase 3 happy path, unchanged for cloud tasks: plan it as data, then run.
 *
 * `shortcut: a cloud task has no executor yet, so every step succeeds without
 * doing anything. Device tasks use the real loop below; the cloud executor
 * arrives with the embedded OpenCode adapter.`
 */
async function driveMockTask(
  deps: TaskRunnerDeps,
  database: ScopedDatabase,
  initial: TaskRow,
  logger: Logger,
): Promise<void> {
  const { organization_id: organizationId, id: taskId, goal } = initial;

  // 1. Claim it: `QUEUED → PLANNING`, the planner claiming the lease (08 §4.1).
  if (!(await transition(database, organizationId, taskId, "QUEUED", "PLANNING", logger))) {
    return;
  }

  const plan = deps.engine.plan(goal);
  await database.tasks.update({
    where: { id: taskId },
    data: { plan: { steps: plan.steps } as Prisma.InputJsonValue },
  });
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

    const result = { note: "mock execution: no tools are available in Phase 3" };
    const digest = sha256Hex(canonicalJson(result));
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
    note: "mock verification: the engine always passes for a cloud task",
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

/**
 * The real loop for a device task (docs/planning/08 §1, 17 Phase 5 / M0):
 * plan → per-step policy → approval when asked → execute on the device →
 * verify → next → verify the task → complete.
 *
 * It is a state machine over durable rows, not a replay: a worker that dies
 * mid-approval or mid-command resumes at the row it left behind, and a step
 * that already has a result is not run twice.
 */
async function driveDeviceTask(
  deps: TaskRunnerDeps,
  database: ScopedDatabase,
  initial: TaskRow,
  logger: Logger,
): Promise<void> {
  const organizationId = initial.organization_id;
  const taskId = initial.id;
  let task = initial;

  if (task.state === "QUEUED") {
    if (!(await transition(database, organizationId, taskId, "QUEUED", "PLANNING", logger))) {
      return;
    }
    task = await reloadTask(database, taskId);
  }

  if (task.state === "PLANNING") {
    const workspace =
      task.workspace_id === null
        ? null
        : await database.workspaces.findUnique({ where: { id: task.workspace_id } });
    if (task.device_id === null || task.workspace_id === null || workspace === null) {
      await failTask(
        database,
        organizationId,
        taskId,
        "configuration_error",
        "The task is not attached to a registered device and workspace.",
        logger,
      );
      return;
    }

    if (task.plan === null) {
      const context: PlanContext = {
        taskId,
        executionLocation: "device",
        deviceId: task.device_id,
        workspaceId: task.workspace_id,
        workspacePath: workspace.path,
      };
      const plan = deps.engine.plan(task.goal, context);
      if (!(await persistDevicePlan(database, organizationId, taskId, plan, logger))) {
        return;
      }
    }

    if (!(await transition(database, organizationId, taskId, "PLANNING", "RUNNING", logger))) {
      return;
    }
    await database.tasks.update({ where: { id: taskId }, data: { started_at: new Date() } });
    task = await reloadTask(database, taskId);
  }

  const workspace =
    task.workspace_id === null
      ? null
      : await database.workspaces.findUnique({ where: { id: task.workspace_id } });
  if (workspace === null) {
    await failTask(
      database,
      organizationId,
      taskId,
      "configuration_error",
      "The task's workspace no longer exists.",
      logger,
    );
    return;
  }

  const budget = budgetFor(task.constraints);
  const startedAt = task.started_at ?? new Date();
  const deadline = startedAt.getTime() + budget.maxWallClockMs;

  const steps = await database.task_steps.findMany({
    where: { task_id: taskId },
    orderBy: { seq: "asc" },
  });
  if (steps.length > budget.maxSteps) {
    await appendEvent(database, organizationId, taskId, "budget.exhausted", {
      budget: "steps",
      limit: budget.maxSteps,
      planned: steps.length,
    });
    await failTask(
      database,
      organizationId,
      taskId,
      "budget_exhausted",
      `The plan has ${steps.length} steps; the limit is ${budget.maxSteps}.`,
      logger,
    );
    return;
  }

  for (const step of steps) {
    task = await reloadTask(database, taskId);
    if (task.state === "CANCELLED" || task.state === "EXPIRED" || task.state === "FAILED") {
      logger.info("task.plan: task stopped before the next step", { state: task.state });
      return;
    }
    if (step.state === "COMPLETED" || step.state === "SKIPPED") {
      continue;
    }
    if (step.state === "FAILED") {
      await failTask(
        database,
        organizationId,
        taskId,
        step.error_code ?? "step_failed",
        `Step ${step.seq} failed.`,
        logger,
      );
      return;
    }
    if (step.kind !== "tool") {
      await completeModelStep(database, organizationId, taskId, step);
      continue;
    }
    if (Date.now() > deadline) {
      await appendEvent(database, organizationId, taskId, "budget.exhausted", {
        budget: "wall_clock",
        limit_ms: budget.maxWallClockMs,
      });
      await failTask(
        database,
        organizationId,
        taskId,
        "budget_exhausted",
        "The task exceeded its wall-clock budget.",
        logger,
      );
      return;
    }

    const finished = await runToolStep(database, task, workspace, step, deadline, logger);
    if (!finished) {
      return;
    }
  }

  task = await reloadTask(database, taskId);
  if (task.state === "RUNNING") {
    if (!(await transition(database, organizationId, taskId, "RUNNING", "VERIFYING", logger))) {
      return;
    }
  }

  const finalSteps = await database.task_steps.findMany({
    where: { task_id: taskId },
    orderBy: { seq: "asc" },
  });
  const unverified = finalSteps.filter(
    (step) => step.state !== "COMPLETED" || step.result_digest === null,
  );
  if (unverified.length > 0) {
    await appendEvent(database, organizationId, taskId, "verification.failed", {
      steps: unverified.length,
    });
    await failTask(
      database,
      organizationId,
      taskId,
      "verification_failed",
      `${unverified.length} step(s) have no verifiable result.`,
      logger,
    );
    return;
  }

  await appendEvent(database, organizationId, taskId, "verification.passed", {
    assertions: finalSteps.length,
  });
  if (!(await transition(database, organizationId, taskId, "VERIFYING", "COMPLETED", logger))) {
    return;
  }
  await database.tasks.update({
    where: { id: taskId },
    data: {
      finished_at: new Date(),
      result_summary: `${finalSteps.length} step(s) completed`,
      budget_used: {
        steps: finalSteps.length,
        wallClockMs: Date.now() - startedAt.getTime(),
        tokens: 0,
        costMinor: 0,
      },
    },
  });
  await appendEvent(database, organizationId, taskId, "task.completed", {
    steps: finalSteps.length,
  });
  logger.info("task.plan: task completed", { steps: finalSteps.length });
}

/**
 * One tool step. Returns false when the task stopped (denied, expired, failed),
 * so the caller does not try to verify a task that is already terminal.
 */
async function runToolStep(
  database: ScopedDatabase,
  task: TaskRow,
  workspace: { mode: "read_only" | "read_write" },
  step: StepRow,
  deadline: number,
  logger: Logger,
): Promise<boolean> {
  const organizationId = task.organization_id;
  const taskId = task.id;
  const manifest = toolManifest(step.tool_name ?? "");
  const args = asRecord(step.arguments);

  if (manifest === null) {
    await failStepAndTask(
      database,
      organizationId,
      taskId,
      step.id,
      "invalid_plan",
      "The plan names a tool that is not registered.",
      logger,
    );
    return false;
  }
  const problem = manifest.validate(args);
  if (problem !== null) {
    await failStepAndTask(
      database,
      organizationId,
      taskId,
      step.id,
      "invalid_plan",
      problem,
      logger,
    );
    return false;
  }
  if (task.device_id === null || task.workspace_id === null) {
    await failStepAndTask(
      database,
      organizationId,
      taskId,
      step.id,
      "configuration_error",
      "The task is not attached to a device and workspace.",
      logger,
    );
    return false;
  }

  const action = {
    tool: manifest.name,
    arguments: args,
    deviceId: task.device_id,
    workspaceId: task.workspace_id,
  };

  const earlier = await database.task_steps.findMany({
    where: {
      task_id: taskId,
      seq: { lt: step.seq },
      state: "COMPLETED",
      arguments_digest: { not: null },
    },
    select: { arguments_digest: true },
  });
  const earlierDigests = earlier
    .map((row) => row.arguments_digest)
    .filter((digest): digest is string => digest !== null);
  if (isRepeatedAction(earlierDigests, step.arguments_digest ?? "")) {
    await appendEvent(database, organizationId, taskId, "loop_detected", {
      stepId: step.id,
      digest: step.arguments_digest ?? "",
    });
    await failStepAndTask(
      database,
      organizationId,
      taskId,
      step.id,
      "loop_detected",
      "The same action has been requested three times.",
      logger,
    );
    return false;
  }

  if (step.state !== "RUNNING") {
    await database.task_steps.update({
      where: { id: step.id },
      data: { state: "RUNNING", started_at: new Date(), attempts: { increment: 1 } },
    });
    await appendEvent(database, organizationId, taskId, "step.started", {
      stepId: step.id,
      seq: step.seq,
    });
  }

  const decision = evaluateAction(action, {
    workspaceMode: workspace.mode,
    // Snapshots are not built yet, so every mutation is escalated to approval.
    snapshotAvailable: false,
  });
  const recorded = await database.policy_decisions.findFirst({
    where: { task_id: taskId, step_id: step.id },
    select: { id: true },
  });
  if (recorded === null) {
    await database.policy_decisions.create({
      data: {
        organization_id: organizationId,
        task_id: taskId,
        step_id: step.id,
        tool_name: manifest.name,
        // The action the policy evaluated, not an approval: no expiry is part
        // of this digest, so it stays the same across a resume.
        action_digest: sha256Hex(canonicalJson(action)),
        risk_class: decision.riskClass,
        decision: decision.decision,
        matched_rule: decision.matchedRule,
        policy_version: PLATFORM_POLICY_VERSION,
        reasons: decision.reasons as Prisma.InputJsonValue,
      },
    });
    await appendEvent(database, organizationId, taskId, "policy.decided", {
      stepId: step.id,
      decision: decision.decision,
      riskClass: decision.riskClass,
      rule: decision.matchedRule,
    });
  }

  if (decision.decision === "deny") {
    await failStepAndTask(
      database,
      organizationId,
      taskId,
      step.id,
      "policy_denied",
      `Policy denied this action (${decision.matchedRule}).`,
      logger,
    );
    return false;
  }

  let taskState = task.state;
  if (decision.decision === "ask") {
    let approval = await database.approval_requests.findFirst({
      where: { task_id: taskId, step_id: step.id },
      orderBy: { created_at: "desc" },
    });

    if (approval === null) {
      const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS);
      approval = await database.approval_requests.create({
        data: {
          organization_id: organizationId,
          task_id: taskId,
          step_id: step.id,
          tool_name: manifest.name,
          risk_class: decision.riskClass,
          summary: describePolicyAction(action),
          action_digest: actionDigest({
            tool: manifest.name,
            toolVersion: manifest.version,
            arguments: args,
            deviceId: action.deviceId,
            workspaceId: action.workspaceId,
            policyVersion: PLATFORM_POLICY_VERSION,
            expiresAt: expiresAt.toISOString(),
          }),
          policy_version: PLATFORM_POLICY_VERSION,
          task_created_by: task.created_by,
          expires_at: expiresAt,
        },
      });
      await appendEvent(database, organizationId, taskId, "approval.requested", {
        approvalId: approval.id,
        riskClass: decision.riskClass,
        digest: approval.action_digest,
      });
    }

    if (approval.state === "pending") {
      if (taskState === "RUNNING") {
        if (
          !(await transition(
            database,
            organizationId,
            taskId,
            "RUNNING",
            "WAITING_APPROVAL",
            logger,
          ))
        ) {
          return false;
        }
        taskState = "WAITING_APPROVAL";
      }

      const decided = await waitForApproval(
        database,
        approval.id,
        Math.min(deadline, approval.expires_at.getTime()),
      );
      if (decided === "granted") {
        if (
          !(await transition(
            database,
            organizationId,
            taskId,
            "WAITING_APPROVAL",
            "RUNNING",
            logger,
          ))
        ) {
          return false;
        }
        taskState = "RUNNING";
        await appendEvent(database, organizationId, taskId, "approval.granted", {
          approvalId: approval.id,
          digest: approval.action_digest,
        });
      } else if (decided === "denied") {
        await failStepAndTask(
          database,
          organizationId,
          taskId,
          step.id,
          "approval_denied",
          "The action was denied.",
          logger,
        );
        return false;
      } else {
        // Expiry returns the step to needing approval, never to allowed; the
        // task expires so nothing proceeds on a stale decision (FR-APPR-04).
        await database.approval_requests.updateMany({
          where: { id: approval.id, state: "pending" },
          data: { state: "expired", decided_at: new Date() },
        });
        await database.task_steps.update({
          where: { id: step.id },
          data: { state: "WAITING_APPROVAL" },
        });
        await appendEvent(database, organizationId, taskId, "approval.expired", {
          approvalId: approval.id,
        });
        if (
          taskState === "WAITING_APPROVAL" &&
          (await transition(
            database,
            organizationId,
            taskId,
            "WAITING_APPROVAL",
            "EXPIRED",
            logger,
          ))
        ) {
          await database.tasks.update({
            where: { id: taskId },
            data: { finished_at: new Date(), error_code: "approval_expired" },
          });
        }
        return false;
      }
    } else if (approval.state === "granted") {
      if (approval.expires_at.getTime() <= Date.now()) {
        // A grant is bounded by the expiry the user saw; using it later would
        // approve an action in a world that has moved on (FR-APPR-04).
        await failTask(
          database,
          organizationId,
          taskId,
          "approval_expired",
          "The approval expired before it was used.",
          logger,
        );
        return false;
      }
      if (taskState === "WAITING_APPROVAL") {
        if (
          !(await transition(
            database,
            organizationId,
            taskId,
            "WAITING_APPROVAL",
            "RUNNING",
            logger,
          ))
        ) {
          return false;
        }
        taskState = "RUNNING";
      }
    } else if (approval.state === "denied") {
      await failStepAndTask(
        database,
        organizationId,
        taskId,
        step.id,
        "approval_denied",
        "The action was denied.",
        logger,
      );
      return false;
    } else {
      await failTask(
        database,
        organizationId,
        taskId,
        "approval_expired",
        "The approval expired before it was used.",
        logger,
      );
      return false;
    }
  }

  const reported = await executeOnDevice(database, task, step, args, manifest, deadline, logger);
  if (reported === null) {
    return false;
  }

  const verification = verifyToolResult({ tool: manifest.name, arguments: args, result: reported });
  if (!verification.passed) {
    await appendEvent(database, organizationId, taskId, "verification.failed", {
      stepId: step.id,
      checks: verification.checks.filter((check) => !check.passed).length,
    });
    await failStepAndTask(
      database,
      organizationId,
      taskId,
      step.id,
      "verification_failed",
      `The device result did not match the approved action (${verification.checks
        .filter((check) => !check.passed)
        .map((check) => check.name)
        .join(", ")}).`,
      logger,
    );
    return false;
  }

  await database.task_steps.update({
    where: { id: step.id },
    data: {
      state: "COMPLETED",
      finished_at: new Date(),
      result: reported.payload as Prisma.InputJsonValue,
      result_digest: reported.digest,
    },
  });
  await appendEvent(database, organizationId, taskId, "step.succeeded", {
    stepId: step.id,
    seq: step.seq,
    resultDigest: reported.digest,
  });
  return true;
}

/**
 * Queue one tool command and wait for the device's ack.
 *
 * A step that already has a command reuses it, so a crash between "queue" and
 * "ack" does not run the action twice. The command's own expiry is the bound:
 * a device that never polls fails the step rather than pinning the task.
 */
async function executeOnDevice(
  database: ScopedDatabase,
  task: TaskRow,
  step: StepRow,
  args: Record<string, unknown>,
  manifest: { name: "workspace.write_file"; version: string },
  deadline: number,
  logger: Logger,
): Promise<ReportedToolResult | null> {
  const organizationId = task.organization_id;
  const deviceId = task.device_id;
  const workspaceId = task.workspace_id;
  if (deviceId === null || workspaceId === null) {
    await failStepAndTask(
      database,
      organizationId,
      task.id,
      step.id,
      "configuration_error",
      "The task is not attached to a device and workspace.",
      logger,
    );
    return null;
  }

  const existing = await database.device_commands.findFirst({
    where: { task_id: task.id, step_id: step.id },
    orderBy: { seq: "desc" },
  });

  let commandId: string;
  let commandExpiresAt: Date;
  if (existing !== null) {
    commandId = existing.id;
    commandExpiresAt = existing.expires_at;
  } else {
    const approval = await database.approval_requests.findFirst({
      where: { task_id: task.id, step_id: step.id, state: "granted" },
      orderBy: { created_at: "desc" },
    });
    const expiresAt = new Date(Date.now() + COMMAND_TTL_MS);
    const approvalExpiresAt = approval?.expires_at ?? expiresAt;
    const digest = actionDigest({
      tool: manifest.name,
      toolVersion: manifest.version,
      arguments: args,
      deviceId,
      workspaceId,
      policyVersion: PLATFORM_POLICY_VERSION,
      expiresAt: approvalExpiresAt.toISOString(),
    });
    const payload = {
      taskId: task.id,
      stepId: step.id,
      approvalId: approval?.id ?? null,
      tool: manifest.name,
      toolVersion: manifest.version,
      arguments: args,
      actionDigest: digest,
      policyVersion: PLATFORM_POLICY_VERSION,
      approvalExpiresAt: approvalExpiresAt.toISOString(),
      deviceId,
      workspaceId,
    };
    const commandDigest = sha256Hex(
      canonicalDeviceCommand({
        deviceId,
        kind: "tool_execute",
        payload,
        expiresAt: expiresAt.toISOString(),
      }),
    );
    const created = await createDeviceCommand(database, {
      organizationId,
      deviceId,
      taskId: task.id,
      stepId: step.id,
      payload,
      commandDigest,
      expiresAt,
    });
    commandId = created.id;
    commandExpiresAt = created.expires_at;
    await appendEvent(database, organizationId, task.id, "step.dispatched", {
      stepId: step.id,
      commandId: created.id,
    });
  }

  const acked = await waitForCommand(
    database,
    commandId,
    Math.min(deadline, commandExpiresAt.getTime()),
  );
  if (acked === null) {
    await failStepAndTask(
      database,
      organizationId,
      task.id,
      step.id,
      "device_timeout",
      "The device did not acknowledge the command in time.",
      logger,
    );
    return null;
  }
  if (acked.error !== null || acked.result === null || acked.result_digest === null) {
    await failStepAndTask(
      database,
      organizationId,
      task.id,
      step.id,
      "tool_failed",
      acked.error ?? "The device returned no result.",
      logger,
    );
    return null;
  }

  return { payload: asRecord(acked.result), digest: acked.result_digest };
}

/** `device_commands.seq` is max+1 per device; retry a lost race on the unique key. */
async function createDeviceCommand(
  database: ScopedDatabase,
  input: {
    organizationId: string;
    deviceId: string;
    taskId: string;
    stepId: string;
    payload: Record<string, unknown>;
    commandDigest: string;
    expiresAt: Date;
  },
): Promise<{ id: string; expires_at: Date }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const aggregate = await database.device_commands.aggregate({
      where: { organization_id: input.organizationId, device_id: input.deviceId },
      _max: { seq: true },
    });
    try {
      return await database.device_commands.create({
        data: {
          organization_id: input.organizationId,
          device_id: input.deviceId,
          task_id: input.taskId,
          step_id: input.stepId,
          kind: "tool_execute",
          payload: input.payload as Prisma.InputJsonValue,
          command_digest: input.commandDigest,
          seq: (aggregate._max.seq ?? 0) + 1,
          expires_at: input.expiresAt,
        },
        select: { id: true, expires_at: true },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
  }
  throw new Error("could not allocate a device command sequence after 5 attempts");
}

type ApprovalOutcome = "granted" | "denied" | "expired";

async function waitForApproval(
  database: ScopedDatabase,
  approvalId: string,
  deadline: number,
): Promise<ApprovalOutcome> {
  for (;;) {
    const row = await database.approval_requests.findUnique({ where: { id: approvalId } });
    if (row === null) {
      return "expired";
    }
    if (row.state !== "pending") {
      return row.state;
    }
    if (row.expires_at.getTime() <= Date.now() || Date.now() >= deadline) {
      return "expired";
    }
    await sleep(WAIT_POLL_MS);
  }
}

async function waitForCommand(
  database: ScopedDatabase,
  commandId: string,
  deadline: number,
): Promise<{
  state: string;
  result: unknown;
  result_digest: string | null;
  error: string | null;
} | null> {
  for (;;) {
    const row = await database.device_commands.findUnique({ where: { id: commandId } });
    if (row === null) {
      return null;
    }
    if (row.state === "acked") {
      return {
        state: row.state,
        result: row.result,
        result_digest: row.result_digest,
        error: row.error,
      };
    }
    if (row.state === "expired" || row.expires_at.getTime() <= Date.now()) {
      return null;
    }
    if (Date.now() >= deadline) {
      return null;
    }
    await sleep(WAIT_POLL_MS);
  }
}

/** Validate the whole plan before persisting it, so a bad plan fails once. */
async function persistDevicePlan(
  database: ScopedDatabase,
  organizationId: string,
  taskId: string,
  plan: TaskPlan,
  logger: Logger,
): Promise<boolean> {
  for (const step of plan.steps) {
    if (step.kind !== "tool") {
      continue;
    }
    const manifest = step.toolName === undefined ? null : toolManifest(step.toolName);
    if (manifest === null) {
      await failTask(
        database,
        organizationId,
        taskId,
        "invalid_plan",
        "The plan names a tool that is not registered.",
        logger,
      );
      return false;
    }
    const problem = manifest.validate(step.arguments ?? {});
    if (problem !== null) {
      await failTask(database, organizationId, taskId, "invalid_plan", problem, logger);
      return false;
    }
  }

  await database.tasks.update({
    where: { id: taskId },
    data: { plan: { steps: plan.steps } as Prisma.InputJsonValue },
  });
  await database.task_steps.createMany({
    data: plan.steps.map((step) => ({
      organization_id: organizationId,
      task_id: taskId,
      seq: step.seq,
      kind: step.kind,
      title: step.title,
      tool_name: step.toolName ?? null,
      tool_version: step.toolVersion ?? null,
      ...(step.arguments === undefined
        ? {}
        : {
            arguments: step.arguments as Prisma.InputJsonValue,
            arguments_digest: sha256Hex(canonicalJson(step.arguments)),
          }),
    })),
    skipDuplicates: true,
  });
  await appendEvent(database, organizationId, taskId, "plan.created", { steps: plan.steps.length });
  return true;
}

async function completeModelStep(
  database: ScopedDatabase,
  organizationId: string,
  taskId: string,
  step: StepRow,
): Promise<void> {
  await database.task_steps.update({
    where: { id: step.id },
    data: { state: "RUNNING", started_at: new Date(), attempts: { increment: 1 } },
  });
  await appendEvent(database, organizationId, taskId, "step.started", {
    stepId: step.id,
    seq: step.seq,
  });
  const result = { note: "mock execution: no model adapter is wired in this build" };
  const digest = sha256Hex(canonicalJson(result));
  await database.task_steps.update({
    where: { id: step.id },
    data: { state: "COMPLETED", finished_at: new Date(), result, result_digest: digest },
  });
  await appendEvent(database, organizationId, taskId, "step.succeeded", {
    stepId: step.id,
    seq: step.seq,
  });
}

async function failStepAndTask(
  database: ScopedDatabase,
  organizationId: string,
  taskId: string,
  stepId: string,
  code: string,
  message: string,
  logger: Logger,
): Promise<void> {
  await database.task_steps.update({
    where: { id: stepId },
    data: { state: "FAILED", finished_at: new Date(), error_code: code },
  });
  await appendEvent(database, organizationId, taskId, "step.failed", { stepId, code });
  await failTask(database, organizationId, taskId, code, message, logger);
}

/** Fail the task from whatever non-terminal state it is in, once. */
async function failTask(
  database: ScopedDatabase,
  organizationId: string,
  taskId: string,
  code: string,
  message: string,
  logger: Logger,
): Promise<void> {
  const task = await database.tasks.findUnique({
    where: { id: taskId },
    select: { state: true },
  });
  if (task === null || isTerminalTaskState(task.state)) {
    return;
  }
  if (!(await transition(database, organizationId, taskId, task.state, "FAILED", logger))) {
    return;
  }
  await database.tasks.update({
    where: { id: taskId },
    data: {
      finished_at: new Date(),
      error_code: code,
      error_message: message.slice(0, 500),
    },
  });
  await appendEvent(database, organizationId, taskId, "task.failed", { code });
}

function budgetFor(constraints: unknown): { maxSteps: number; maxWallClockMs: number } {
  const values = asRecord(constraints);
  return {
    maxSteps:
      typeof values.maxSteps === "number" && values.maxSteps > 0
        ? values.maxSteps
        : DEFAULT_MAX_STEPS,
    maxWallClockMs:
      typeof values.maxWallClockMs === "number" && values.maxWallClockMs > 0
        ? values.maxWallClockMs
        : DEFAULT_MAX_WALL_CLOCK_MS,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function reloadTask(database: ScopedDatabase, taskId: string): Promise<TaskRow> {
  const task = await database.tasks.findUnique({ where: { id: taskId } });
  if (task === null) {
    throw new Error(`task ${taskId} disappeared mid-run`);
  }
  return task;
}

/** The tenant-scoped view of the database these helpers work through (ADR-008). */
function scopeFor(database: PrismaClient, organizationId: string) {
  return forOrganization(database, organizationId);
}

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
