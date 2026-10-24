// scan-secrets:allow-file — the connection string and passwords here are test fixtures.
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { ApprovalRequestSummary } from "@ua/contracts";
import { createPrismaClient } from "@ua/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://universal_agent:postgres@127.0.0.1:55432/universal_agent?schema=public";

const prisma = createPrismaClient(DATABASE_URL);

const DIGEST = "a".repeat(64);

async function cleanup() {
  await prisma.approval_requests.deleteMany();
  await prisma.policy_decisions.deleteMany();
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

function sessionCookies(user: Registered) {
  return { ua_session: user.session, ua_csrf: user.csrf };
}

async function send(
  app: NestFastifyApplication,
  user: Registered,
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
) {
  return app.inject({
    method,
    url,
    cookies: sessionCookies(user),
    headers: { "x-csrf-token": user.csrf },
    ...(payload !== undefined ? { payload } : method === "POST" ? { payload: {} } : {}),
  });
}

/** Puts `user` in `owner`'s organization with the given role. */
async function join(user: Registered, owner: Registered, role: "admin" | "member"): Promise<void> {
  await prisma.memberships.create({
    data: { organization_id: owner.organizationId, user_id: user.userId, role },
  });
  await prisma.sessions.updateMany({
    where: { user_id: user.userId },
    data: { organization_id: owner.organizationId },
  });
}

/**
 * One pending request for one write, the way the worker leaves it after policy
 * says "ask". Seeded directly: the worker's own creation path is exercised by
 * its durability suite, and this file is about the decision rules.
 */
async function seedApproval(
  user: Registered,
  overrides: { actionDigest?: string; expiresAt?: Date; createdBy?: string | null } = {},
): Promise<{ taskId: string; approval: ApprovalRequestSummary }> {
  const session = await prisma.agent_sessions.create({
    data: { organization_id: user.organizationId, user_id: user.userId, title: "approvals" },
  });
  const task = await prisma.tasks.create({
    data: {
      organization_id: user.organizationId,
      agent_session_id: session.id,
      created_by: user.userId,
      goal: "Write notes",
      state: "WAITING_APPROVAL",
      execution_location: "device",
    },
  });
  const step = await prisma.task_steps.create({
    data: {
      organization_id: user.organizationId,
      task_id: task.id,
      seq: 1,
      kind: "tool",
      title: "Write notes/a.md",
      tool_name: "workspace.write_file",
      tool_version: "1.0.0",
      arguments: { path: "notes/a.md", content: "hello" },
      arguments_digest: DIGEST,
      risk_class: "R2",
      state: "WAITING_APPROVAL",
    },
  });
  const approval = await prisma.approval_requests.create({
    data: {
      organization_id: user.organizationId,
      task_id: task.id,
      step_id: step.id,
      tool_name: "workspace.write_file",
      risk_class: "R2",
      summary: "Write notes/a.md (5 bytes)",
      action_digest: overrides.actionDigest ?? DIGEST,
      policy_version: "1",
      task_created_by: overrides.createdBy === undefined ? user.userId : overrides.createdBy,
      expires_at: overrides.expiresAt ?? new Date(Date.now() + 60_000),
    },
    select: {
      id: true,
      task_id: true,
      step_id: true,
      tool_name: true,
      risk_class: true,
      summary: true,
      action_digest: true,
      policy_version: true,
      state: true,
      expires_at: true,
      decided_at: true,
      decided_by: true,
      created_at: true,
    },
  });
  return {
    taskId: task.id,
    approval: {
      id: approval.id,
      taskId: approval.task_id,
      stepId: approval.step_id,
      toolName: approval.tool_name,
      riskClass: approval.risk_class as ApprovalRequestSummary["riskClass"],
      summary: approval.summary,
      actionDigest: approval.action_digest,
      policyVersion: approval.policy_version,
      state: approval.state,
      expiresAt: approval.expires_at.toISOString(),
      decidedAt: approval.decided_at?.toISOString() ?? null,
      decidedByUserId: approval.decided_by,
      createdAt: approval.created_at.toISOString(),
    },
  };
}

describe("approvals integration", () => {
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
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanup();
  });

  it("grants once, with the digest that was shown, and records the audit act", async () => {
    const owner = await register(app, "approvals-owner@example.com");
    const { approval, taskId } = await seedApproval(owner);

    const listed = await send(app, owner, "GET", "/v1/approvals?state=pending");
    expect(listed.statusCode).toBe(200);
    const body = JSON.parse(listed.body) as { approvals: ApprovalRequestSummary[] };
    expect(body.approvals.map((item) => item.id)).toEqual([approval.id]);
    expect(body.approvals[0]).not.toHaveProperty("taskCreatedByUserId");

    const granted = await send(app, owner, "POST", `/v1/approvals/${approval.id}/grant`, {
      actionDigest: DIGEST,
    });
    expect(granted.statusCode).toBe(200);
    expect(JSON.parse(granted.body)).toMatchObject({
      state: "granted",
      decidedAt: expect.any(String),
    });

    // One row, one decision: a second click loses.
    const again = await send(app, owner, "POST", `/v1/approvals/${approval.id}/grant`, {
      actionDigest: DIGEST,
    });
    expect(again.statusCode).toBe(409);
    expect(JSON.parse(again.body).code).toBe("state_conflict");

    const trail = await prisma.audit_events.findFirst({
      where: { organization_id: owner.organizationId, action: "approval.grant" },
      select: { resource_id: true, metadata: true },
    });
    expect(trail?.resource_id).toBe(approval.id);
    expect(trail?.metadata).toMatchObject({ task_id: taskId, action_digest: DIGEST });
  });

  it("refuses a decision that names a different action", async () => {
    const owner = await register(app, "approvals-stale@example.com");
    const { approval } = await seedApproval(owner);

    const stale = await send(app, owner, "POST", `/v1/approvals/${approval.id}/grant`, {
      actionDigest: "b".repeat(64),
    });

    expect(stale.statusCode).toBe(409);
    expect(JSON.parse(stale.body).code).toBe("state_conflict");
    const row = await prisma.approval_requests.findUnique({ where: { id: approval.id } });
    expect(row?.state).toBe("pending");
  });

  it("expires a request instead of deciding it late", async () => {
    const owner = await register(app, "approvals-late@example.com");
    const { approval } = await seedApproval(owner, { expiresAt: new Date(Date.now() - 1_000) });

    const res = await send(app, owner, "POST", `/v1/approvals/${approval.id}/deny`, {
      actionDigest: DIGEST,
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe("approval_expired");
    const row = await prisma.approval_requests.findUnique({ where: { id: approval.id } });
    expect(row?.state).toBe("expired");
  });

  it("keeps another member's request and another tenant's request out of reach", async () => {
    const owner = await register(app, "approvals-tenant@example.com");
    const member = await register(app, "approvals-member@example.com");
    const stranger = await register(app, "approvals-stranger@example.com");
    await join(member, owner, "member");
    const { approval } = await seedApproval(owner);

    // A plain member is not the task's creator: no row, no hint that it exists.
    const memberList = await send(app, member, "GET", "/v1/approvals");
    expect(memberList.statusCode).toBe(200);
    expect(
      (JSON.parse(memberList.body) as { approvals: ApprovalRequestSummary[] }).approvals,
    ).toEqual([]);
    const memberGet = await send(app, member, "GET", `/v1/approvals/${approval.id}`);
    expect(memberGet.statusCode).toBe(404);

    const foreign = await send(app, stranger, "GET", `/v1/approvals/${approval.id}`);
    expect(foreign.statusCode).toBe(404);
    const foreignDecide = await send(app, stranger, "POST", `/v1/approvals/${approval.id}/grant`, {
      actionDigest: DIGEST,
    });
    expect(foreignDecide.statusCode).toBe(404);
  });
});
