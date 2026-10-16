import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";

/**
 * The global guard denies by default (docs/planning/11 §5). This file pins that
 * property per route: a route added without `@Public()` must answer 401 to an
 * anonymous caller, and the few public routes must reach their handler.
 *
 * It boots the real app because the guard's behaviour is what is under test, not
 * the routing table. It needs DATABASE_URL and an applied migration, and shares
 * that database with the other integration file (see vitest.integration.config).
 */
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://universal_agent:postgres@127.0.0.1:55432/universal_agent?schema=public";

describe("route authorisation", () => {
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
  });

  const protectedRoutes: ReadonlyArray<readonly [string, string]> = [
    ["GET", "/v1/me"],
    ["POST", "/v1/auth/logout"],
    ["GET", "/v1/organizations"],
    ["POST", "/v1/organizations"],
    ["GET", "/v1/organizations/00000000-0000-0000-0000-000000000000"],
  ];

  it.each(protectedRoutes)("refuses %s %s without a session", async (method, url) => {
    const res = await app.inject({
      method: method as "GET" | "POST",
      url,
      ...(method === "POST" ? { payload: {} } : {}),
    });
    expect(res.statusCode).toBe(401);
  });

  it("lets the public auth routes reach their handler", async () => {
    // No credentials: the guard lets these through, so the answer is a body
    // validation error (400), never the guard's 401.
    const register = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {},
    });
    expect(register.statusCode).toBe(400);

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {},
    });
    expect(login.statusCode).toBe(400);
  });

  it("serves the public health routes", async () => {
    expect((await app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(200);
  });
});
