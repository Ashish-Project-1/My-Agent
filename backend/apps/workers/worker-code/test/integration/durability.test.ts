// scan-secrets:allow-file — the connection strings here are the local dev defaults, not secrets.
import { createPrismaClient } from "@ua/database";
import { createLogger } from "@ua/logger";
import { orgA } from "@ua/test-utilities";
import type { Queue } from "bullmq";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockCodingEngine } from "../../src/coding-engine.js";
import { createOutboxPublisher } from "../../src/outbox-publisher.js";
import { createTaskQueue, jobIdForOutboxRow } from "../../src/queue.js";
import { createTaskPlanProcessor } from "../../src/task-runner.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://universal_agent:postgres@127.0.0.1:55432/universal_agent?schema=public";
const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

/**
 * The Phase 3 gate (docs/planning/17 §179): a task that has been committed
 * cannot be lost by a crash, a Redis restart or a replayed job.
 *
 * These share a database with the API's integration suite, so the root
 * `test:integration` runs packages one at a time.
 */
const database = createPrismaClient(DATABASE_URL);
const logger = createLogger({ service: "worker-code-test", level: "error" });

let queue: Queue;

beforeAll(async () => {
  queue = createTaskQueue(REDIS_URL);
  // Fail here, not three assertions in, when Redis is not running.
  await queue.waitUntilReady();
});

afterAll(async () => {
  await queue.obliterate({ force: true }).catch(() => undefined);
  await queue.close();
  await database.$disconnect();
});

beforeEach(async () => {
  // Children before parents (ON DELETE RESTRICT on the tenancy roots). This
  // mirrors the API suite's cleanup, because both suites share the database and
  // either one can leave rows the other's foreign keys then hit.
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
  await queue.obliterate({ force: true }).catch(() => undefined);
});

/**
 * Everything the API writes in one transaction, minus the API. Seeding it
 * directly is what makes this a durability test rather than an HTTP test: the
 * rows are committed and then "everything else dies".
 */
async function seedCommittedTask(): Promise<{ taskId: string; outboxId: bigint }> {
  await database.users.create({
    data: { id: orgA.ownerUserId, email: orgA.ownerEmail, password_hash: "not-a-real-hash" },
  });
  await database.organizations.create({
    data: { id: orgA.organizationId, name: "Acme", slug: orgA.slug },
  });
  const session = await database.agent_sessions.create({
    data: { organization_id: orgA.organizationId, user_id: orgA.ownerUserId },
  });
  const task = await database.tasks.create({
    data: {
      organization_id: orgA.organizationId,
      agent_session_id: session.id,
      created_by: orgA.ownerUserId,
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
  const outbox = await database.outbox.create({
    data: {
      aggregate_type: "task",
      aggregate_id: task.id,
      organization_id: orgA.organizationId,
      event_type: "task.created",
      payload: { taskId: task.id, state: task.state },
    },
  });
  return { taskId: task.id, outboxId: outbox.id };
}

function makePublisher() {
  return createOutboxPublisher({
    database,
    queue,
    logger,
    options: { batchSize: 10, pollMs: 10 },
  });
}

const processTaskPlan = createTaskPlanProcessor({
  database,
  engine: new MockCodingEngine(),
  logger,
  owner: "test-worker",
  leaseTtlMs: 60_000,
});

describe("outbox publisher", () => {
  it("relays a pending row to the queue exactly once", async () => {
    const { outboxId } = await seedCommittedTask();
    const publisher = makePublisher();

    expect(await publisher.publishBatch()).toBe(1);
    expect(await publisher.publishBatch()).toBe(0);

    const jobs = await queue.getJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe(jobIdForOutboxRow(outboxId));
    expect(jobs[0]?.name).toBe("task.plan");
    expect(jobs[0]?.data).toMatchObject({ taskId: expect.any(String), attempt: 0 });
  });

  it("does not duplicate a job when a crash lands between the add and the mark", async () => {
    const { outboxId } = await seedCommittedTask();
    const publisher = makePublisher();

    await publisher.publishBatch();
    // Simulate dying after the job reached Redis but before `processed_at` was
    // written: the row is pending again and the next poll replays it.
    await database.outbox.update({ where: { id: outboxId }, data: { processed_at: null } });
    expect(await publisher.publishBatch()).toBe(1);

    expect(await queue.getJobs()).toHaveLength(1);
  });

  it("keeps a row for retry instead of marking it processed when the queue is down", async () => {
    await seedCommittedTask();
    const unreachable = createTaskQueue("redis://127.0.0.1:1");
    const publisher = createOutboxPublisher({
      database,
      queue: unreachable,
      logger,
      options: { batchSize: 10, pollMs: 10 },
    });

    expect(await publisher.publishBatch()).toBe(0);

    const row = await database.outbox.findFirstOrThrow();
    expect(row.processed_at).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.last_error).not.toBeNull();
    await unreachable.close().catch(() => undefined);
  });
});

describe("task.plan consumer", () => {
  it("drives a committed task to completion and releases the lease", async () => {
    const { taskId } = await seedCommittedTask();
    const publisher = makePublisher();

    // Nothing was published before the "crash", and the queue is empty: this is
    // the whole NFR-REL-02 story in one assertion.
    expect(await queue.getJobs()).toHaveLength(0);
    await publisher.publishBatch();
    const [job] = await queue.getJobs();
    await processTaskPlan({ data: job?.data });

    const task = await database.tasks.findUnique({ where: { id: taskId } });
    expect(task?.state).toBe("COMPLETED");
    expect(task?.started_at).not.toBeNull();
    expect(task?.finished_at).not.toBeNull();
    expect(task?.result_summary).toBe("1 step(s) completed");

    const steps = await database.task_steps.findMany({ where: { task_id: taskId } });
    expect(steps).toHaveLength(1);
    expect(steps[0]?.state).toBe("COMPLETED");
    expect(steps[0]?.result_digest).toMatch(/^[0-9a-f]{64}$/);

    // The claim is released, so the task is not left pinned to a dead worker.
    expect(await database.job_leases.count({ where: { resource_id: taskId } })).toBe(0);
  });

  it("writes the whole event history in order, with one sequence number per event", async () => {
    const { taskId } = await seedCommittedTask();
    const publisher = makePublisher();
    await publisher.publishBatch();
    const [job] = await queue.getJobs();
    await processTaskPlan({ data: job?.data });

    const events = await database.task_events.findMany({
      where: { task_id: taskId },
      orderBy: { seq: "asc" },
    });
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(events.map((event) => event.type)).toEqual([
      "task.created",
      "task.state_changed", // QUEUED → PLANNING
      "plan.created",
      "task.state_changed", // PLANNING → RUNNING
      "step.started",
      "step.succeeded",
      "task.state_changed", // RUNNING → VERIFYING
      "verification.passed",
      "task.state_changed", // VERIFYING → COMPLETED
      "task.completed",
    ]);
    // The first event is the API's, written as the user; everything after it is
    // the worker's account of the run.
    expect(events[0]?.actor).toBe("user");
    expect(events.slice(1).every((event) => event.actor === "worker")).toBe(true);
  });

  it("does nothing on a replay of a job it already ran", async () => {
    const { taskId } = await seedCommittedTask();
    const publisher = makePublisher();
    await publisher.publishBatch();
    const [job] = await queue.getJobs();

    await processTaskPlan({ data: job?.data });
    const afterFirst = await database.task_events.count({ where: { task_id: taskId } });

    await processTaskPlan({ data: job?.data });

    const task = await database.tasks.findUnique({ where: { id: taskId } });
    expect(task?.state).toBe("COMPLETED");
    expect(await database.task_events.count({ where: { task_id: taskId } })).toBe(afterFirst);
    expect(await database.task_steps.count({ where: { task_id: taskId } })).toBe(1);
  });

  it("leaves the task alone when another worker holds a live lease", async () => {
    const { taskId } = await seedCommittedTask();
    await database.job_leases.create({
      data: {
        resource_type: "task",
        resource_id: taskId,
        lease_id: "11111111-1111-1111-1111-111111111111",
        owner: "somewhere-else",
        acquired_at: new Date(),
        heartbeat_at: new Date(),
        expires_at: new Date(Date.now() + 60_000),
      },
    });

    await processTaskPlan({
      data: { organizationId: orgA.organizationId, taskId, attempt: 0, schemaVersion: 1 },
    });

    const task = await database.tasks.findUnique({ where: { id: taskId } });
    expect(task?.state).toBe("QUEUED");
    expect(await database.task_steps.count({ where: { task_id: taskId } })).toBe(0);
  });

  it("takes over a lease whose holder stopped heartbeating", async () => {
    const { taskId } = await seedCommittedTask();
    await database.job_leases.create({
      data: {
        resource_type: "task",
        resource_id: taskId,
        lease_id: "22222222-2222-2222-2222-222222222222",
        owner: "crashed",
        acquired_at: new Date(Date.now() - 120_000),
        heartbeat_at: new Date(Date.now() - 120_000),
        expires_at: new Date(Date.now() - 60_000),
      },
    });

    await processTaskPlan({
      data: { organizationId: orgA.organizationId, taskId, attempt: 0, schemaVersion: 1 },
    });

    // The stale lease did not block the work, and the takeover lease is released
    // with the task rather than left behind to pin it later.
    const task = await database.tasks.findUnique({ where: { id: taskId } });
    expect(task?.state).toBe("COMPLETED");
    expect(
      await database.job_leases.count({ where: { resource_type: "task", resource_id: taskId } }),
    ).toBe(0);
  });
});
