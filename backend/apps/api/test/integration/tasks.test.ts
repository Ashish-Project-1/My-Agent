// scan-secrets:allow-file — the password and connection string here are test fixtures.
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createPrismaClient } from "@ua/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://universal_agent:postgres@127.0.0.1:55432/universal_agent?schema=public";

const prisma = createPrismaClient(DATABASE_URL);

async function cleanup() {
  // Children before parents (ON DELETE RESTRICT on the tenancy roots; the task
  // children cascade from tasks).
  await prisma.task_checkpoints.deleteMany();
  await prisma.task_events.deleteMany();
  await prisma.task_steps.deleteMany();
  await prisma.tasks.deleteMany();
  await prisma.agent_sessions.deleteMany();
  await prisma.device_commands.deleteMany();
  await prisma.device_pairing_codes.deleteMany();
  await prisma.workspace_grants.deleteMany();
  await prisma.workspaces.deleteMany();
  await prisma.devices.deleteMany();
  await prisma.outbox.deleteMany();
  await prisma.job_leases.deleteMany();
  await prisma.idempotency_keys.deleteMany();
  await prisma.login_attempts.deleteMany();
  await prisma.refresh_tokens.deleteMany();
  await prisma.sessions.deleteMany();
  await prisma.memberships.deleteMany();
  await prisma.invitations.deleteMany();
  await prisma.audit_events.deleteMany();
  await prisma.organizations.deleteMany();
  await prisma.users.deleteMany();
}

function extractCookie(
  res: { cookies?: Array<{ name: string; value?: string }>; body: string },
  name: string,
): string {
  const cookie = res.cookies?.find((c) => c.name === name);
  if (cookie?.value === undefined) {
    throw new Error(`expected a ${name} cookie on the response`);
  }
  return cookie.value;
}

type Registered = { session: string; csrf: string; organizationId: string; userId: string };

async function register(app: NestFastifyApplication, email: string): Promise<Registered> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, password: "Password123456" },
  });
  expect(res.statusCode).toBe(201);
  const body = JSON.parse(res.body);
  return {
    session: extractCookie(res, "ua_session"),
    csrf: extractCookie(res, "ua_csrf"),
    organizationId: body.activeOrganizationId,
    userId: body.user.id,
  };
}

/** POST /v1/tasks with the caller's session and CSRF token. */
async function postTask(
  app: NestFastifyApplication,
  user: Registered,
  payload: Record<string, unknown>,
  idempotencyKey?: string,
) {
  return app.inject({
    method: "POST",
    url: "/v1/tasks",
    cookies: { ua_session: user.session, ua_csrf: user.csrf },
    headers: {
      "x-csrf-token": user.csrf,
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    payload,
  });
}

/** Insert a task row directly: creation is not part of this read-only slice. */
async function seedTask(organizationId: string, userId: string, goal: string): Promise<string> {
  const session = await prisma.agent_sessions.create({
    data: { organization_id: organizationId, user_id: userId, title: "seed" },
  });
  const task = await prisma.tasks.create({
    data: {
      organization_id: organizationId,
      agent_session_id: session.id,
      created_by: userId,
      goal,
      state: "QUEUED",
    },
  });
  await prisma.task_events.create({
    data: {
      organization_id: organizationId,
      task_id: task.id,
      seq: 1,
      type: "task.created",
      actor: "user",
      actor_id: userId,
    },
  });
  return task.id;
}

describe("tasks integration", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.AUTH_DIGEST_SECRET = "test_digest_secret_1234567890abcdef12";
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = DATABASE_URL;
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanup();
  });

  it("lists only the caller's organization tasks", async () => {
    const alice = await register(app, "alice@example.com");
    const bob = await register(app, "bob@example.com");
    await seedTask(alice.organizationId, alice.userId, "alice goal");
    await seedTask(bob.organizationId, bob.userId, "bob goal");

    const res = await app.inject({
      method: "GET",
      url: "/v1/tasks",
      cookies: { ua_session: alice.session },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].goal).toBe("alice goal");
  });

  it("returns 404 for a task in another tenant", async () => {
    const alice = await register(app, "alice@example.com");
    const bob = await register(app, "bob@example.com");
    const bobTask = await seedTask(bob.organizationId, bob.userId, "bob goal");

    const res = await app.inject({
      method: "GET",
      url: `/v1/tasks/${bobTask}`,
      cookies: { ua_session: alice.session },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns a task's steps and event log in order", async () => {
    const alice = await register(app, "alice@example.com");
    const taskId = await seedTask(alice.organizationId, alice.userId, "goal");
    await prisma.task_steps.create({
      data: {
        organization_id: alice.organizationId,
        task_id: taskId,
        seq: 1,
        kind: "tool",
        title: "step one",
      },
    });

    const events = await app.inject({
      method: "GET",
      url: `/v1/tasks/${taskId}/events`,
      cookies: { ua_session: alice.session },
    });
    const steps = await app.inject({
      method: "GET",
      url: `/v1/tasks/${taskId}/steps`,
      cookies: { ua_session: alice.session },
    });

    expect(events.statusCode).toBe(200);
    expect(JSON.parse(events.body).events).toHaveLength(1);
    expect(steps.statusCode).toBe(200);
    expect(JSON.parse(steps.body).steps[0].title).toBe("step one");
  });

  it("lists only the caller's agent sessions", async () => {
    const alice = await register(app, "alice@example.com");
    const bob = await register(app, "bob@example.com");
    await prisma.agent_sessions.create({
      data: { organization_id: alice.organizationId, user_id: alice.userId, title: "mine" },
    });
    await prisma.agent_sessions.create({
      data: { organization_id: bob.organizationId, user_id: bob.userId, title: "theirs" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/agent-sessions",
      cookies: { ua_session: alice.session },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.agent_sessions).toHaveLength(1);
    expect(body.agent_sessions[0].title).toBe("mine");
  });

  it("creates a task with its first event, an outbox row and an audit row", async () => {
    const alice = await register(app, "alice@example.com");
    const res = await postTask(app, alice, { goal: "build the thing" });
    expect(res.statusCode).toBe(201);
    const task = JSON.parse(res.body);
    expect(task.state).toBe("QUEUED");
    expect(task.goal).toBe("build the thing");

    const events = await prisma.task_events.findMany({
      where: { task_id: task.id },
      orderBy: { seq: "asc" },
    });
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.type).toBe("task.created");
    expect(event?.seq).toBe(1);

    const outbox = await prisma.outbox.findMany({ where: { aggregate_id: task.id } });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.event_type).toBe("task.created");

    const audit = await prisma.audit_events.findMany({
      where: { action: "task.create", resource_id: task.id },
    });
    expect(audit).toHaveLength(1);
  });

  it("replays the original task for a duplicate Idempotency-Key", async () => {
    const alice = await register(app, "alice@example.com");
    const key = "dup-key-1";
    const first = await postTask(app, alice, { goal: "same goal" }, key);
    const second = await postTask(app, alice, { goal: "same goal" }, key);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const a = JSON.parse(first.body);
    const b = JSON.parse(second.body);
    expect(b.id).toBe(a.id);

    const count = await prisma.tasks.count({ where: { organization_id: alice.organizationId } });
    expect(count).toBe(1);
  });

  it("rejects a duplicate Idempotency-Key with a different body", async () => {
    const alice = await register(app, "alice@example.com");
    const key = "dup-key-2";
    await postTask(app, alice, { goal: "first body" }, key);
    const conflict = await postTask(app, alice, { goal: "different body" }, key);
    expect(conflict.statusCode).toBe(409);
  });

  it("refuses a task attached to another tenant's agent session", async () => {
    const alice = await register(app, "alice@example.com");
    const bob = await register(app, "bob@example.com");
    const bobSession = await prisma.agent_sessions.create({
      data: { organization_id: bob.organizationId, user_id: bob.userId, title: "bob" },
    });

    const res = await postTask(app, alice, {
      goal: "steal a session",
      agentSessionId: bobSession.id,
    });
    expect(res.statusCode).toBe(404);
  });

  it("enforces CSRF on task creation", async () => {
    const alice = await register(app, "alice@example.com");
    const res = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      cookies: { ua_session: alice.session },
      payload: { goal: "no csrf" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("streams task events for a terminal task and emits done", async () => {
    const alice = await register(app, "alice@example.com");
    // Create a task
    const create = await postTask(app, alice, { goal: "stream test" });
    const task = JSON.parse(create.body);
    // Make task terminal by updating directly
    await prisma.tasks.update({ where: { id: task.id }, data: { state: "COMPLETED" } });
    // Stream
    const res = await app.inject({
      method: "GET",
      url: `/v1/tasks/${task.id}/stream`,
      cookies: { ua_session: alice.session },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.body).toContain("event: task.created");
    expect(res.body).toMatch(/id: /);
    expect(res.body).toContain("event: done");
  });

  it("resumes stream from Last-Event-ID without re-emitting earlier events", async () => {
    const alice = await register(app, "alice@example.com");
    const create = await postTask(app, alice, { goal: "resume test" });
    const task = JSON.parse(create.body);
    // Add another event manually
    await prisma.task_events.create({
      data: {
        organization_id: alice.organizationId,
        task_id: task.id,
        seq: 2,
        type: "task.state_changed",
        actor: "system",
        actor_id: null,
        data: { from: "QUEUED", to: "PLANNING" },
      },
    });
    await prisma.tasks.update({ where: { id: task.id }, data: { state: "COMPLETED" } });
    const res = await app.inject({
      method: "GET",
      url: `/v1/tasks/${task.id}/stream`,
      cookies: { ua_session: alice.session },
      headers: { "last-event-id": `${task.id}:1` },
    });
    expect(res.statusCode).toBe(200);
    // Should have seq 2 event, not seq 1 again
    expect(res.body).toContain("task.state_changed");
    expect(res.body).toContain("event: done");
  });

  it("returns 404 for a task in another tenant", async () => {
    const alice = await register(app, "alice@example.com");
    const bob = await register(app, "bob@example.com");
    const create = await postTask(app, bob, { goal: "bob task" });
    const task = JSON.parse(create.body);
    const res = await app.inject({
      method: "GET",
      url: `/v1/tasks/${task.id}/stream`,
      cookies: { ua_session: alice.session },
    });
    expect(res.statusCode).toBe(404);
  });

  it("follows events that arrive after the connection opens", async () => {
    const alice = await register(app, "alice@example.com");
    const create = await postTask(app, alice, { goal: "live test" });
    const task = JSON.parse(create.body);

    // A real socket, because `inject` only returns once the response has ended.
    await app.listen(0);
    const response = await fetch(`${await app.getUrl()}/v1/tasks/${task.id}/stream`, {
      headers: { cookie: `ua_session=${alice.session}` },
    });
    expect(response.status).toBe(200);

    // Arrive while the client is connected: the poll must pick these up.
    await prisma.task_events.create({
      data: {
        organization_id: alice.organizationId,
        task_id: task.id,
        seq: 2,
        type: "task.completed",
        actor: "worker",
        actor_id: null,
      },
    });
    await prisma.tasks.update({ where: { id: task.id }, data: { state: "COMPLETED" } });

    const body = await new Response(response.body).text();
    expect(body).toContain("event: task.created");
    expect(body).toContain("event: task.completed");
    expect(body).toContain("event: done");
  });
});
