// scan-secrets:allow-file — every secret-shaped value here is a fixture that
// exists to prove the deny-list works. None of them are real credentials.
import { describe, expect, it } from "vitest";
import {
  CIRCULAR_MARKER,
  isSecretKey,
  MAX_DEPTH_MARKER,
  REDACTED,
  redactString,
  redactValue,
} from "../src/index.js";

describe("isSecretKey", () => {
  it("matches a secret key whatever its casing or separators", () => {
    for (const key of ["authorization", "Authorization", "X-Api-Key", "api_key", "apiKey"]) {
      expect(isSecretKey(key)).toBe(true);
    }
  });

  it("matches a secret word inside a longer key", () => {
    for (const key of [
      "accessToken",
      "refresh_token",
      "clientSecret",
      "userPasswordHash",
      "sessionId",
      "connectionString",
      "dbUrl",
      "x-csrf-token",
      "signature",
      "otpCode",
    ]) {
      expect(isSecretKey(key), key).toBe(true);
    }
  });

  it("leaves ordinary fields alone", () => {
    for (const key of [
      "taskId",
      "organizationId",
      "msg",
      "level",
      "time",
      "service",
      "riskClass",
      "durationMs",
      "status",
      "nextCursor",
      "tokensIn",
      "tokensOut",
      "argumentsDigest",
      "authorizationDecision",
    ]) {
      expect(isSecretKey(key), key).toBe(false);
    }
  });
});

describe("redactString", () => {
  it("removes a Bearer token from free text", () => {
    const line = "upstream rejected: Bearer eyJhbGciOiJIUzI1NiJ9.abcdefghij.klmnopqr";
    expect(redactString(line)).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(redactString(line)).toContain(REDACTED);
  });

  it("removes credentials embedded in a connection string", () => {
    const line = "connect failed: postgres://admin:hunter2@10.0.0.5:5432/prod";
    const redacted = redactString(line);
    expect(redacted).not.toContain("hunter2");
    expect(redacted).toContain("postgres://admin:");
    expect(redacted).toContain("10.0.0.5:5432");
  });

  it("removes vendor-prefixed API keys", () => {
    const github = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    const openai = "sk-proj-AbCdEfGhIjKlMnOpQrStUvWx";
    const aws = "AKIAIOSFODNN7EXAMPLE";
    for (const secret of [github, openai, aws]) {
      expect(redactString(`token=${secret}`), secret).not.toContain(secret);
    }
  });

  it("removes a PEM private key block", () => {
    const pem = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEAx7Vn0pQ2",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");
    expect(redactString(pem)).toBe(REDACTED);
  });

  it("leaves a W3C traceparent intact", () => {
    const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    expect(redactString(traceparent)).toBe(traceparent);
  });

  it("leaves ordinary text untouched", () => {
    expect(redactString("task 018f2b3c queued after 42ms")).toBe("task 018f2b3c queued after 42ms");
  });
});

describe("redactValue", () => {
  it("redacts a secret-named key at any depth", () => {
    const input = {
      request: {
        headers: { authorization: "Bearer abcdefghijklmnop", "x-api-key": "k-1234567890" },
        body: { goal: "summarise the repo", credentials: { password: "hunter2" } },
      },
      taskId: "018f2b3c-4d5e-7f60-8a1b-2c3d4e5f6071",
    };

    const output = redactValue(input) as Record<string, unknown>;
    const serialised = JSON.stringify(output);

    expect(serialised).not.toContain("hunter2");
    expect(serialised).not.toContain("abcdefghijklmnop");
    expect(serialised).not.toContain("k-1234567890");
    expect(serialised).toContain("018f2b3c-4d5e-7f60-8a1b-2c3d4e5f6071");
    expect(serialised).toContain("summarise the repo");
  });

  it("redacts inside arrays", () => {
    const output = redactValue({ headers: [["authorization", "Bearer tok-1234567890"]] });
    expect(JSON.stringify(output)).not.toContain("tok-1234567890");
  });

  it("keeps budget counters, which are not secrets", () => {
    const output = redactValue({ tokensIn: 1200, tokensOut: 340, costMinor: 7 });
    expect(output).toEqual({ tokensIn: 1200, tokensOut: 340, costMinor: 7 });
  });

  it("converts a Date and an Error instead of dropping them", () => {
    const output = redactValue({
      at: new Date("2026-10-15T09:30:00.123Z"),
      failure: new Error("boom"),
    }) as Record<string, unknown>;

    expect(output.at).toBe("2026-10-15T09:30:00.123Z");
    expect(output.failure).toMatchObject({ name: "Error", message: "boom" });
  });

  it("does not throw on a cycle", () => {
    const node: Record<string, unknown> = { name: "task" };
    node.self = node;

    const output = redactValue(node) as Record<string, unknown>;
    expect(output.self).toBe(CIRCULAR_MARKER);
    expect(() => JSON.stringify(output)).not.toThrow();
  });

  it("does not treat a repeated sibling as a cycle", () => {
    const shared = { id: "018f2b3c-4d5e-7f60-8a1b-2c3d4e5f6071" };
    const output = redactValue({ first: shared, second: shared }) as Record<string, unknown>;
    expect(output.first).toEqual(shared);
    expect(output.second).toEqual(shared);
  });

  it("does not throw on BigInt or NaN, which JSON.stringify cannot represent", () => {
    const output = redactValue({ size: 9007199254740993n, ratio: Number.NaN });
    expect(() => JSON.stringify(output)).not.toThrow();
    expect(output).toEqual({ size: "9007199254740993", ratio: "NaN" });
  });

  it("truncates instead of recursing without bound", () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let index = 0; index < 40; index += 1) {
      deep = { nested: deep };
    }
    expect(JSON.stringify(redactValue(deep))).toContain(MAX_DEPTH_MARKER);
  });

  it("summarises binary instead of dumping it", () => {
    const output = redactValue({ payload: new Uint8Array(2048) });
    expect(output).toEqual({ payload: "[binary 2048 bytes]" });
  });
});
