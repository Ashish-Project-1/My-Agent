import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createPrismaClient } from "@ua/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://universal_agent:postgres@127.0.0.1:55432/universal_agent?schema=public";

const prisma = createPrismaClient(DATABASE_URL);

async function cleanup() {
  // Children before parents: every relation here is ON DELETE RESTRICT, and
  // audit_events references both organizations and users.
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
  res: { cookies?: Array<{ name: string; value?: string }> },
  name: string,
): string {
  const cookie = res.cookies?.find((c) => c.name === name);
  if (cookie?.value === undefined) {
    throw new Error(`expected a ${name} cookie on the response`);
  }
  return cookie.value;
}

describe("auth integration", () => {
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

  it("registers a new user and returns session", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        email: "test@example.com",
        password: "Password123456",
        displayName: "Test User",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.user.email).toBe("test@example.com");
    expect(body.user.displayName).toBe("Test User");
    expect(body.organizations).toHaveLength(1);
    expect(body.activeOrganizationId).toBeDefined();
    expect(res.cookies.length).toBeGreaterThan(0);
    expect(extractCookie(res, "ua_session")).toBeDefined();
    expect(extractCookie(res, "ua_refresh")).toBeDefined();
    expect(extractCookie(res, "ua_csrf")).toBeDefined();
    expect(body).not.toHaveProperty("password_hash");
    expect(body).not.toHaveProperty("token_hash");
  });

  it("returns 409 for duplicate email", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "dup@example.com", password: "Password123456" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "dup@example.com", password: "Password123456" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("logs in successfully and returns cookies", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "login@example.com", password: "Password123456" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "login@example.com", password: "Password123456" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.email).toBe("login@example.com");
    expect(extractCookie(res, "ua_session")).toBeDefined();
    expect(extractCookie(res, "ua_refresh")).toBeDefined();
    expect(body).not.toHaveProperty("password_hash");
    expect(body).not.toHaveProperty("token_hash");
  });

  it("returns 401 for login with wrong password", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "badpass@example.com", password: "Password123456" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "badpass@example.com", password: "wrongpass123" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for suspended user login", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "susp@example.com", password: "Password123456" },
    });

    await prisma.users.update({
      where: { email: "susp@example.com" },
      data: { status: "suspended" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "susp@example.com", password: "Password123456" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns 401 when accessing /v1/me without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
    });
    expect(res.statusCode).toBe(401);
  });

  it("/v1/me returns user when authenticated", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "me@example.com", password: "Password123456" },
    });
    const session = extractCookie(reg, "ua_session");
    const csrf = extractCookie(reg, "ua_csrf");

    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      cookies: { ua_session: session },
      headers: { "x-csrf-token": csrf },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.email).toBe("me@example.com");
  });

  it("enforces CSRF on unsafe methods", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "csrf@example.com", password: "Password123456" },
    });
    const session = extractCookie(reg, "ua_session");
    const csrf = extractCookie(reg, "ua_csrf");

    const noCsrf = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      cookies: { ua_session: session },
      payload: { name: "Bad Org" },
    });
    expect(noCsrf.statusCode).toBe(403);

    const withCsrf = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      cookies: { ua_session: session, ua_csrf: csrf },
      headers: { "x-csrf-token": csrf },
      payload: { name: "Good Org" },
    });
    expect(withCsrf.statusCode).toBe(201);
  });

  it("rotates refresh token on refresh", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "refresh@example.com", password: "Password123456" },
    });
    const session = extractCookie(reg, "ua_session");
    const refresh = extractCookie(reg, "ua_refresh");
    const csrf = extractCookie(reg, "ua_csrf");

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      cookies: { ua_session: session, ua_refresh: refresh },
      headers: { "x-csrf-token": csrf },
    });
    expect(res.statusCode).toBe(200);
    const newRefresh = extractCookie(res, "ua_refresh");
    expect(newRefresh).toBeDefined();
    expect(newRefresh).not.toBe(refresh);
  });

  it("revokes family on refresh reuse", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "reuse@example.com", password: "Password123456" },
    });
    const session = extractCookie(reg, "ua_session");
    const refresh = extractCookie(reg, "ua_refresh");
    const csrf = extractCookie(reg, "ua_csrf");

    await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      cookies: { ua_session: session, ua_refresh: refresh },
      headers: { "x-csrf-token": csrf },
    });

    const reuse = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      cookies: { ua_session: session, ua_refresh: refresh },
      headers: { "x-csrf-token": csrf },
    });
    expect(reuse.statusCode).toBe(401);
  });

  it("logout revokes session", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "logout@example.com", password: "Password123456" },
    });
    const session = extractCookie(reg, "ua_session");
    const csrf = extractCookie(reg, "ua_csrf");

    const logout = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      cookies: { ua_session: session, ua_csrf: csrf },
      headers: { "x-csrf-token": csrf },
    });
    expect(logout.statusCode).toBe(204);

    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      cookies: { ua_session: session },
      headers: { "x-csrf-token": csrf },
    });
    expect(me.statusCode).toBe(401);
  });

  it("cross-org membership: user A cannot access org B (404)", async () => {
    const regA = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        email: "usera@example.com",
        password: "Password123456",
        displayName: "User A",
      },
    });
    const bodyA = JSON.parse(regA.body);
    const orgA = bodyA.activeOrganizationId;
    const sessionA = extractCookie(regA, "ua_session");
    const csrfA = extractCookie(regA, "ua_csrf");

    const regB = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        email: "userb@example.com",
        password: "Password123456",
        displayName: "User B",
      },
    });
    const bodyB = JSON.parse(regB.body);
    const orgB = bodyB.activeOrganizationId;

    expect(orgA).not.toBe(orgB);

    const res = await app.inject({
      method: "GET",
      url: `/v1/organizations/${orgB}`,
      cookies: { ua_session: sessionA },
      headers: { "x-csrf-token": csrfA },
    });
    expect(res.statusCode).toBe(404);
  });

  it("does not leak password_hash or token_hash in responses", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "leak@example.com", password: "Password123456" },
    });
    expect(reg.body).not.toMatch(/password_hash/i);
    expect(reg.body).not.toMatch(/token_hash/i);

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "leak@example.com", password: "Password123456" },
    });
    expect(login.body).not.toMatch(/password_hash/i);
    expect(login.body).not.toMatch(/token_hash/i);

    const session = extractCookie(reg, "ua_session");
    const csrf = extractCookie(reg, "ua_csrf");
    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      cookies: { ua_session: session },
      headers: { "x-csrf-token": csrf },
    });
    expect(me.body).not.toMatch(/password_hash/i);
    expect(me.body).not.toMatch(/token_hash/i);
  });

  it("rate limits login attempts after the configured maximum", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "ratelimit@example.com", password: "Password123456" },
    });

    // Default max is 10 failures per window; the attempt after the tenth is
    // refused before the password is even checked.
    let lastStatus = 0;
    for (let i = 0; i < 12; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email: "ratelimit@example.com", password: "wrong" },
      });
      lastStatus = res.statusCode;
      if (lastStatus === 429) break;
    }
    expect(lastStatus).toBe(429);
  });

  it("answers liveness and reads the database for readiness", async () => {
    const healthz = await app.inject({ method: "GET", url: "/healthz" });
    expect(healthz.statusCode).toBe(200);
    expect(JSON.parse(healthz.body)).toEqual({ status: "ok" });

    const readyz = await app.inject({ method: "GET", url: "/readyz" });
    expect(readyz.statusCode).toBe(200);
    expect(JSON.parse(readyz.body)).toEqual({ status: "ok" });
  });

  it("lists the caller's organizations", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        email: "lister@example.com",
        password: "Password123456",
        displayName: "Lister",
      },
    });
    const session = extractCookie(reg, "ua_session");
    const activeOrganizationId = JSON.parse(reg.body).activeOrganizationId;

    const res = await app.inject({
      method: "GET",
      url: "/v1/organizations",
      cookies: { ua_session: session },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(activeOrganizationId);
    expect(body.data[0].role).toBe("owner");
    expect(body.nextCursor).toBeNull();
  });
});
