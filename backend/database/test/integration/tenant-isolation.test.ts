import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, forOrganization, TenantScopeError } from "../../src/index.js";

// The cross-tenant isolation suite (docs/planning/17 Phase 2 gate, NFR-SEC-01):
// a second organization's data must be invisible and unwritable through every
// path the tenant scope exposes.
//
// It needs a live PostgreSQL with the migration applied:
//   docker compose -f infrastructure/docker/docker-compose.yml up -d postgres
//   pnpm --filter @ua/database db:deploy
// An absent DATABASE_URL is a failure, not a skip: this suite is a gate.

const envFile = join(import.meta.dirname, "..", "..", ".env");
if (existsSync(envFile)) loadEnvFile(envFile);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is required for the isolation suite. Start the compose PostgreSQL and run `pnpm --filter @ua/database db:deploy`.",
  );
}

const prisma = createPrismaClient(connectionString);

// A fresh suffix per run so repeated and concurrent runs cannot collide.
const run = randomUUID().slice(0, 8);
const inAnHour = new Date(Date.now() + 3_600_000);

let orgA: string;
let orgB: string;
let userA: string;
let userB: string;
let membershipA: string;
let membershipB: string;
let sessionB: string;
let auditB: string;
let idempotencyB: string;

beforeAll(async () => {
  const a = await prisma.organizations.create({
    data: { name: `Isolation A ${run}`, slug: `isolation-a-${run}`, kind: "team" },
  });
  const b = await prisma.organizations.create({
    data: { name: `Isolation B ${run}`, slug: `isolation-b-${run}`, kind: "team" },
  });
  orgA = a.id;
  orgB = b.id;

  const ua = await prisma.users.create({
    data: { email: `isolation-a-${run}@example.test`, password_hash: `argon2-placeholder-${run}` },
  });
  const ub = await prisma.users.create({
    data: { email: `isolation-b-${run}@example.test`, password_hash: `argon2-placeholder-${run}` },
  });
  userA = ua.id;
  userB = ub.id;

  const ma = await prisma.memberships.create({
    data: { user_id: ua.id, organization_id: orgA, role: "owner" },
  });
  const mb = await prisma.memberships.create({
    data: { user_id: ub.id, organization_id: orgB, role: "owner" },
  });
  membershipA = ma.id;
  membershipB = mb.id;

  await prisma.invitations.create({
    data: {
      organization_id: orgA,
      email: `invitee-${run}@example.test`,
      token_hash: `invitation-a-${run}`,
      expires_at: inAnHour,
      invited_by: ua.id,
      role: "member",
    },
  });

  const sb = await prisma.sessions.create({
    data: {
      user_id: ub.id,
      organization_id: orgB,
      token_hash: `session-b-${run}`,
      expires_at: inAnHour,
    },
  });
  sessionB = sb.id;

  const ab = await prisma.audit_events.create({
    data: {
      organization_id: orgB,
      actor_type: "user",
      actor_id: ub.id,
      action: "org.member.invited",
      resource_type: "invitation",
      result: "success",
    },
  });
  auditB = ab.id;

  const ib = await prisma.idempotency_keys.create({
    data: {
      organization_id: orgB,
      scope: "isolation",
      key: `key-${run}`,
      request_digest: "digest",
      state: "in_progress",
      expires_at: inAnHour,
    },
  });
  idempotencyB = ib.id;
});

afterAll(async () => {
  // Children first: the tenancy foreign keys are RESTRICT, not CASCADE
  // (docs/planning/06 §1). Deleting sessions cascades their refresh tokens.
  await prisma.audit_events.deleteMany({
    where: { organization_id: { in: [orgA, orgB] } },
  });
  await prisma.sessions.deleteMany({ where: { organization_id: { in: [orgA, orgB] } } });
  await prisma.invitations.deleteMany({ where: { organization_id: { in: [orgA, orgB] } } });
  await prisma.memberships.deleteMany({ where: { organization_id: { in: [orgA, orgB] } } });
  await prisma.idempotency_keys.deleteMany({ where: { organization_id: { in: [orgA, orgB] } } });
  await prisma.organizations.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await prisma.users.deleteMany({ where: { id: { in: [userA, userB] } } });
  await prisma.$disconnect();
});

describe("cross-tenant isolation", () => {
  // Without this the isolation assertions could pass on an empty database.
  it("control: the unscoped client really can see both organizations", async () => {
    const memberships = await prisma.memberships.findMany({
      where: { organization_id: { in: [orgA, orgB] } },
    });
    expect(memberships).toHaveLength(2);
    expect(await prisma.sessions.findUnique({ where: { id: sessionB } })).not.toBeNull();
  });

  it("read: findMany returns only the scoped organization's rows", async () => {
    const scopeA = forOrganization(prisma, orgA);
    const rows = await scopeA.memberships.findMany();
    expect(rows.map((row) => row.id)).toEqual([membershipA]);
    expect(rows.every((row) => row.organization_id === orgA)).toBe(true);
  });

  it("read: a caller's own filter cannot widen the scope", async () => {
    const scopeA = forOrganization(prisma, orgA);
    expect(await scopeA.memberships.findMany({ where: { id: membershipB } })).toEqual([]);
    expect(await scopeA.memberships.count({ where: { id: membershipB } })).toBe(0);
    // Naming the other organization explicitly is overridden, not honored: the
    // scope replaces the field rather than intersecting it, so no caller can
    // widen the scope to the other tenant — and org A's own rows still come back.
    const rows = await scopeA.memberships.findMany({ where: { organization_id: orgB } });
    expect(rows.map((row) => row.id)).toEqual([membershipA]);
    expect(rows.every((row) => row.organization_id === orgA)).toBe(true);
  });

  it("read: findUnique and findFirst cannot reach another organization's row", async () => {
    const scopeA = forOrganization(prisma, orgA);
    expect(await scopeA.memberships.findUnique({ where: { id: membershipB } })).toBeNull();
    expect(await scopeA.memberships.findFirst({ where: { id: membershipB } })).toBeNull();
    expect(await scopeA.sessions.findUnique({ where: { id: sessionB } })).toBeNull();
    expect(await scopeA.audit_events.findUnique({ where: { id: auditB } })).toBeNull();
    expect(await scopeA.idempotency_keys.findUnique({ where: { id: idempotencyB } })).toBeNull();
  });

  it("write: updateMany cannot touch another organization's row", async () => {
    const scopeA = forOrganization(prisma, orgA);
    const result = await scopeA.memberships.updateMany({
      where: { id: membershipB },
      data: { role: "viewer" },
    });
    expect(result.count).toBe(0);
    const untouched = await prisma.memberships.findUnique({ where: { id: membershipB } });
    expect(untouched?.role).toBe("owner");
  });

  it("write: deleteMany cannot remove another organization's row", async () => {
    const scopeA = forOrganization(prisma, orgA);
    const result = await scopeA.memberships.deleteMany({ where: { id: membershipB } });
    expect(result.count).toBe(0);
    expect(await prisma.memberships.findUnique({ where: { id: membershipB } })).not.toBeNull();
  });

  it("write: create stamps the scope's organization when the payload omits it", async () => {
    const scopeA = forOrganization(prisma, orgA);
    // The scope supplies organization_id, so a payload may legitimately omit it;
    // Prisma's checked input cannot express that, hence the cast.
    const payload: Record<string, unknown> = { user_id: userB, role: "viewer" };
    const created = await scopeA.memberships.create({ data: payload as never });
    expect(created.organization_id).toBe(orgA);
    await prisma.memberships.delete({ where: { id: created.id } });
  });

  it("write: create cannot name another organization", async () => {
    const scopeA = forOrganization(prisma, orgA);
    await expect(
      scopeA.memberships.create({ data: { user_id: userB, organization_id: orgB } }),
    ).rejects.toThrow(TenantScopeError);
  });

  it("write: an update cannot move a row into another organization", async () => {
    const scopeA = forOrganization(prisma, orgA);
    await expect(
      scopeA.memberships.updateMany({
        where: { id: membershipA },
        data: { organization_id: orgB },
      }),
    ).rejects.toThrow(TenantScopeError);
  });

  it("write: Prisma's relation-object API is refused rather than left unfiltered", async () => {
    const scopeA = forOrganization(prisma, orgA);
    // This form type-checks but escapes the scope's stamping, since a relation
    // object can name any organization; the runtime rule refuses it outright.
    await expect(
      scopeA.memberships.create({
        data: {
          user: { connect: { id: userB } },
          organization: { connect: { id: orgA } },
          role: "member",
        },
      }),
    ).rejects.toThrow(TenantScopeError);
  });

  it("refuses a model that is not organization-scoped", async () => {
    const scopeA = forOrganization(prisma, orgA);
    await expect(scopeA.users.findMany()).rejects.toThrow(TenantScopeError);
    await expect(scopeA.organizations.findMany()).rejects.toThrow(TenantScopeError);
  });

  it("has no raw-SQL escape hatch", () => {
    const scopeA = forOrganization(prisma, orgA);
    // Harmless statements: if the override ever stopped working these throw
    // only if it is still working, so a regression fails without touching data.
    expect(() => scopeA.$queryRaw`SELECT 1`).toThrow(TenantScopeError);
    expect(() => scopeA.$executeRaw`SELECT 1`).toThrow(TenantScopeError);
  });

  it("keeps sessions and audit events inside the organization", async () => {
    const scopeA = forOrganization(prisma, orgA);
    expect(await scopeA.sessions.findMany()).toEqual([]);
    expect(await scopeA.audit_events.findMany()).toEqual([]);

    const scopeB = forOrganization(prisma, orgB);
    expect((await scopeB.sessions.findMany()).map((row) => row.id)).toEqual([sessionB]);
    expect((await scopeB.audit_events.findMany()).map((row) => row.id)).toEqual([auditB]);
  });

  it("lets two organizations hold the same idempotency key", async () => {
    const scopeA = forOrganization(prisma, orgA);
    const created = await scopeA.idempotency_keys.create({
      data: {
        organization_id: orgA,
        scope: "isolation",
        key: `key-${run}`,
        request_digest: "digest",
        state: "in_progress",
        expires_at: inAnHour,
      },
    });
    expect(created.organization_id).toBe(orgA);
    expect(await prisma.idempotency_keys.count({ where: { key: `key-${run}` } })).toBe(2);
  });

  it("stays scoped inside a transaction", async () => {
    const scopeA = forOrganization(prisma, orgA);
    const rows = await scopeA.$transaction(async (tx) => tx.memberships.findMany());
    expect(rows.map((row) => row.id)).toEqual([membershipA]);
  });
});
