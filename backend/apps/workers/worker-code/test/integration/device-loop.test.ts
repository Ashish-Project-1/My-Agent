// scan-secrets:allow-file — the connection string here is the local dev default, not a secret.

import { sha256Hex } from "@ua/agent-engine";
import {
  canonicalDeviceCommand,
  canonicalJson,
  type ToolExecuteCommandPayload,
  type WorkspaceWriteArguments,
} from "@ua/contracts";
import { createPrismaClient } from "@ua/database";
import { createLogger } from "@ua/logger";
import { orgA } from "@ua/test-utilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MockCodingEngine } from "../../src/coding-engine.js";
import { createTaskPlanProcessor } from "../../src/task-runner.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://universal_agent:postgres@127.0.0.1:55432/universal_agent?schema=public";

const database = createPrismaClient(DATABASE_URL);
const logger = createLogger({ service: "worker-code-test", level: "error" });

/**
 * The whole device loop against real rows: plan, policy, approval, command,
 * device ack, verification, completion (docs/planning/17 Phase 5 / M0).
 *
 * The device is simulated in SQL — it reads the queued command's payload and
 * reports exactly what it would have written. That is the point of the test:
 * the worker must accept a correct report and reject anything else, and only a
 * queued command that names the approved action can produce one.
 */
const processTaskPlan = createTaskPlanProcessor({
  database,
  engine: new MockCodingEngine(),
  logger,
  owner: "test-worker",
  leaseTtlMs: 60_000,
});

async function cleanup() {
  await database.approval_requests.deleteMany();
  await database.policy_decisions.deleteMany();
  await database.task_checkpoints.deleteMany();
  await database.task_events.deleteMany();
  await database.task_steps.deleteMany();
  await database.tasks.deleteMany();
  await database.agent_sessions.deleteMany();
  await database.device_commands.deleteMany();
  await database.device_pairing_codes.deleteMany();
  await database.workspace_grants.deleteMany();
  await database.workspaces.deleteMany();
  await database.devices.deleteMany();
  await database.outbox.deleteMany();
  await database.job_leases.deleteMany();
  await database.idempotency_keys.deleteMany();
  await database.login_attempts.deleteMany();
  await database.refresh_tokens.deleteMany();
  await database.sessions.deleteMany();
  await database.memberships.deleteMany();
  await database.invitations.deleteMany();
  await database.audit_events.deleteMany();
  await database.organizations.deleteMany();
  await database.users.deleteMany();
}

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await database.$disconnect();
});

async function seedDeviceTask(): Promise<string> {
  await database.users.create({
    data: { id: orgA.ownerUserId, email: orgA.ownerEmail, password_hash: "not-a-real-hash" },
  });
  await database.organizations.create({
    data: { id: orgA.organizationId, name: "Acme", slug: orgA.slug },
  });
  const device = await database.devices.create({
    data: {
      organization_id: orgA.organizationId,
      user_id: orgA.ownerUserId,
      name: "DESKTOP-01",
      os: "win32",
      runner_version: "0.1.0",
      public_key: "not-a-real-key",
      fingerprint: "f".repeat(64),
      status: "active",
      capabilities: { commands: ["tool_execute"], playwright: false },
    },
  });
  const workspace = await database.workspaces.create({
    data: {
      organization_id: orgA.organizationId,
      device_id: device.id,
      path: "C:\\Projects\\demo",
      raw_path: "C:\\Projects\\demo",
      label: "demo",
      mode: "read_write",
      created_by: orgA.ownerUserId,
    },
  });
  const session = await database.agent_sessions.create({
    data: { organization_id: orgA.organizationId, user_id: orgA.ownerUserId },
  });
  const task = await database.tasks.create({
    data: {
      organization_id: orgA.organizationId,
      agent_session_id: session.id,
      created_by: orgA.ownerUserId,
      device_id: device.id,
      workspace_id: workspace.id,
      execution_location: "device",
      goal: "Write the release notes",
    },
  });
  await database.task_events.create({
    data: {
      organization_id: orgA.organizationId,
      task_id: task.id,
      seq: 1,
      type: "task.created",
      data: { state: task.state },
      actor: "user",
      actor_id: orgA.ownerUserId,
    },
  });
  return task.id;
}

/** Poll a row the worker writes asynchronously; the loop waits on the same rows. */
async function waitFor<T>(read: () => Promise<T | null>, what: string): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const row = await read();
    if (row !== null) {
      return row;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("device task loop", () => {
  it("runs the approved write on the device and verifies the report", async () => {
    const taskId = await seedDeviceTask();
    const running = processTaskPlan({
      data: { organizationId: orgA.organizationId, taskId, attempt: 0 },
    });

    // Policy has no snapshot to lean on, so the write is an R2 ask.
    const approval = await waitFor(
      () => database.approval_requests.findFirst({ where: { task_id: taskId } }),
      "the approval request",
    );
    expect(approval.risk_class).toBe("R2");
    expect(approval.state).toBe("pending");
    expect(approval.task_created_by).toBe(orgA.ownerUserId);

    await database.approval_requests.update({
      where: { id: approval.id },
      data: { state: "granted", decided_at: new Date(), decided_by: orgA.ownerUserId },
    });

    const command = await waitFor(
      () => database.device_commands.findFirst({ where: { task_id: taskId } }),
      "the queued command",
    );
    expect(command.kind).toBe("tool_execute");
    expect(command.state).toBe("pending");
    expect(command.step_id).not.toBeNull();
    expect(command.command_digest).toMatch(/^[0-9a-f]{64}$/);

    const payload = command.payload as unknown as ToolExecuteCommandPayload;
    // The device recomputes this from the row it was sent; a jsonb round-trip
    // reorders keys, which is why the canonical form sorts them.
    expect(
      sha256Hex(
        canonicalDeviceCommand({
          deviceId: payload.deviceId,
          kind: command.kind,
          payload: command.payload as Record<string, unknown>,
          expiresAt: command.expires_at.toISOString(),
        }),
      ),
    ).toBe(command.command_digest);

    const args = payload.arguments as WorkspaceWriteArguments;
    expect(args.path).toBe(`.ua/${taskId}.md`);

    // The device's half: report the bytes it wrote, digest included.
    const result = {
      path: args.path,
      bytes: Buffer.byteLength(args.content, "utf8"),
      sha256: sha256Hex(args.content),
    };
    await database.device_commands.update({
      where: { id: command.id },
      data: {
        state: "acked",
        acked_at: new Date(),
        result,
        result_digest: sha256Hex(canonicalJson(result)),
      },
    });

    // The loop stops here on its own: the ack is the last row it waits on.
    await running;

    const task = await database.tasks.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.state).toBe("COMPLETED");
    expect(task.started_at).not.toBeNull();
    expect(task.finished_at).not.toBeNull();

    const [step] = await database.task_steps.findMany({ where: { task_id: taskId } });
    expect(step?.state).toBe("COMPLETED");
    expect(step?.result).toMatchObject({ path: args.path, bytes: result.bytes });
    expect(step?.result_digest).toBe(sha256Hex(canonicalJson(result)));

    const decision = await database.policy_decisions.findFirstOrThrow({
      where: { task_id: taskId },
    });
    expect(decision).toMatchObject({
      decision: "ask",
      matched_rule: "policy.no_snapshot_escalation",
      tool_name: "workspace.write_file",
      policy_version: "1",
    });

    const types = (
      await database.task_events.findMany({
        where: { task_id: taskId },
        orderBy: { seq: "asc" },
        select: { type: true },
      })
    ).map((event) => event.type);
    expect(types).toEqual([
      "task.created",
      "task.state_changed",
      "plan.created",
      "task.state_changed",
      "step.started",
      "policy.decided",
      "approval.requested",
      "task.state_changed",
      "task.state_changed",
      "approval.granted",
      "step.dispatched",
      "step.succeeded",
      "task.state_changed",
      "verification.passed",
      "task.state_changed",
      "task.completed",
    ]);

    expect(await database.job_leases.count({ where: { resource_id: taskId } })).toBe(0);
  });

  it("fails the task when the device reports different bytes", async () => {
    const taskId = await seedDeviceTask();
    const running = processTaskPlan({
      data: { organizationId: orgA.organizationId, taskId, attempt: 0 },
    });

    const approval = await waitFor(
      () => database.approval_requests.findFirst({ where: { task_id: taskId } }),
      "the approval request",
    );
    await database.approval_requests.update({
      where: { id: approval.id },
      data: { state: "granted", decided_at: new Date(), decided_by: orgA.ownerUserId },
    });

    const command = await waitFor(
      () => database.device_commands.findFirst({ where: { task_id: taskId } }),
      "the queued command",
    );
    const payload = command.payload as unknown as ToolExecuteCommandPayload;
    const args = payload.arguments as WorkspaceWriteArguments;

    // The path is right but the content hash is not: a digest over a lie.
    const result = { path: args.path, bytes: 4, sha256: sha256Hex("evil") };
    await database.device_commands.update({
      where: { id: command.id },
      data: {
        state: "acked",
        acked_at: new Date(),
        result,
        result_digest: sha256Hex(canonicalJson(result)),
      },
    });

    await running;

    const task = await database.tasks.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.state).toBe("FAILED");
    expect(task.error_code).toBe("verification_failed");
    const [step] = await database.task_steps.findMany({ where: { task_id: taskId } });
    expect(step?.state).toBe("FAILED");
  });

  it("denies the write when the approval is denied", async () => {
    const taskId = await seedDeviceTask();
    const running = processTaskPlan({
      data: { organizationId: orgA.organizationId, taskId, attempt: 0 },
    });

    const approval = await waitFor(
      () => database.approval_requests.findFirst({ where: { task_id: taskId } }),
      "the approval request",
    );
    await database.approval_requests.update({
      where: { id: approval.id },
      data: { state: "denied", decided_at: new Date(), decided_by: orgA.ownerUserId },
    });

    await running;

    const task = await database.tasks.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.state).toBe("FAILED");
    expect(task.error_code).toBe("approval_denied");
    expect(await database.device_commands.count({ where: { task_id: taskId } })).toBe(0);
  });

  it("expires a pending approval and fails the task", async () => {
    const taskId = await seedDeviceTask();
    const running = processTaskPlan({
      data: { organizationId: orgA.organizationId, taskId, attempt: 0 },
    });

    const approval = await waitFor(
      () => database.approval_requests.findFirst({ where: { task_id: taskId } }),
      "the approval request",
    );

    await database.approval_requests.update({
      where: { id: approval.id },
      data: { expires_at: new Date(Date.now() - 5_000) },
    });

    await running;

    const task = await database.tasks.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.state).toBe("EXPIRED");
    expect(task.error_code).toBe("approval_expired");
    expect(await database.device_commands.count({ where: { task_id: taskId } })).toBe(0);

    const expired = await database.approval_requests.findUniqueOrThrow({
      where: { id: approval.id },
    });
    expect(expired.state).toBe("expired");

    const types = (
      await database.task_events.findMany({
        where: { task_id: taskId },
        orderBy: { seq: "asc" },
        select: { type: true },
      })
    ).map((event) => event.type);
    expect(types).toContain("approval.expired");
  });

  it("fails on resume when a granted approval has expired before use", async () => {
    const taskId = await seedDeviceTask();
    const first = processTaskPlan({
      data: { organizationId: orgA.organizationId, taskId, attempt: 0 },
    });

    const approval = await waitFor(
      () => database.approval_requests.findFirst({ where: { task_id: taskId } }),
      "the approval request",
    );
    // Get the first attempt out of the way cheaply, so the rows exist.
    await database.approval_requests.update({
      where: { id: approval.id },
      data: { state: "denied", decided_at: new Date(), decided_by: orgA.ownerUserId },
    });
    await first;

    // Rewind to the state a worker leaves behind if it dies at the approval
    // wait, with the user having granted in the meantime and the grant having
    // since expired.
    const step = await database.task_steps.findFirstOrThrow({ where: { task_id: taskId } });
    await database.tasks.update({
      where: { id: taskId },
      data: { state: "WAITING_APPROVAL", finished_at: null, error_code: null },
    });
    await database.task_steps.update({ where: { id: step.id }, data: { state: "PENDING" } });
    await database.approval_requests.update({
      where: { id: approval.id },
      data: {
        state: "granted",
        decided_at: new Date(),
        decided_by: orgA.ownerUserId,
        expires_at: new Date(Date.now() - 5_000),
      },
    });

    await processTaskPlan({
      data: { organizationId: orgA.organizationId, taskId, attempt: 1 },
    });

    const task = await database.tasks.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.state).toBe("FAILED");
    expect(task.error_code).toBe("approval_expired");
    expect(await database.device_commands.count({ where: { task_id: taskId } })).toBe(0);
  });
});
