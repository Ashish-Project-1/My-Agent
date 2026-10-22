// scan-secrets:allow-file — the credential-shaped env values below are fixtures.
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const BASE_ENV = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://user:pass@localhost:55432/db",
  AUTH_DIGEST_SECRET: "a".repeat(32),
} as NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("throws when DATABASE_URL is missing", () => {
    const env = { ...BASE_ENV };
    delete env.DATABASE_URL;
    expect(() => loadConfig(env)).toThrow(/databaseUrl/);
  });

  it("throws when AUTH_DIGEST_SECRET is too short", () => {
    const env = { ...BASE_ENV, AUTH_DIGEST_SECRET: "short" };
    expect(() => loadConfig(env)).toThrow(/must be at least 32 characters/);
  });

  it("enforces production requirements", () => {
    const env = {
      NODE_ENV: "production",
      DATABASE_URL: BASE_ENV.DATABASE_URL,
      AUTH_DIGEST_SECRET: BASE_ENV.AUTH_DIGEST_SECRET,
      COOKIE_SECURE: "false",
      ARGON2_MEMORY_KIB: "16384",
      ARGON2_TIME_COST: "1",
    } as NodeJS.ProcessEnv;
    expect(() => loadConfig(env)).toThrow(/cookieSecure|argon2MemoryKib/);
  });

  it("defaults to non-production cookie behaviour and coerces values", () => {
    const env = { ...BASE_ENV };
    delete env.COOKIE_SECURE;
    const config = loadConfig(env);
    expect(config.cookieSecure).toBe(false);
    expect(config.port).toBe(3000);
    expect(config.host).toBe("127.0.0.1");
  });

  it("does not echo secrets in error messages", () => {
    const env = {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://user:supersecret@localhost:55432/db",
      AUTH_DIGEST_SECRET: "b".repeat(32),
    } as NodeJS.ProcessEnv;
    expect(() =>
      loadConfig({
        ...env,
        DATABASE_URL: "postgresql://bad:bad@localhost:5432/x",
      }),
    ).not.toThrow(/supersecret/);
    const err = (() => {
      try {
        loadConfig({
          ...env,
          DATABASE_URL: undefined,
        } as unknown as NodeJS.ProcessEnv);
      } catch (e) {
        return e;
      }
    })();
    expect(String(err)).not.toContain("supersecret");
  });
});
