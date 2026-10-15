// scan-secrets:allow-file — every secret-shaped value here is a fixture that
// exists to prove the deny-list works. None of them are real credentials.
import { describe, expect, it } from "vitest";
import {
  createLogger,
  type LogFields,
  type Logger,
  type LogLevel,
  REDACTED,
} from "../src/index.js";

function capture(options: { level?: LogLevel; bindings?: LogFields } = {}) {
  const lines: string[] = [];
  const logger: Logger = createLogger({
    service: "api",
    level: options.level ?? "debug",
    sink: (line) => {
      lines.push(line);
    },
    now: () => new Date("2026-10-15T09:30:00.123Z"),
    ...(options.bindings === undefined ? {} : { bindings: options.bindings }),
  });

  const lastRecord = (): Record<string, unknown> => {
    const line = lines.at(-1);
    if (line === undefined) {
      throw new Error("no log line was written");
    }
    return JSON.parse(line) as Record<string, unknown>;
  };

  return { logger, lines, lastRecord };
}

describe("createLogger", () => {
  it("writes one JSON object per line with the standard fields", () => {
    const { logger, lines, lastRecord } = capture();

    logger.info("task queued", { taskId: "018f2b3c-4d5e-7f60-8a1b-2c3d4e5f6071" });

    expect(lines).toHaveLength(1);
    expect(lastRecord()).toEqual({
      time: "2026-10-15T09:30:00.123Z",
      level: "info",
      service: "api",
      msg: "task queued",
      taskId: "018f2b3c-4d5e-7f60-8a1b-2c3d4e5f6071",
    });
  });

  it("suppresses anything below the configured level", () => {
    const { logger, lines } = capture({ level: "warn" });

    logger.debug("noise");
    logger.info("still noise");
    logger.warn("useful");
    logger.error("really useful");

    expect(lines).toHaveLength(2);
  });

  it("includes the bindings on every line", () => {
    const { logger, lastRecord } = capture({ bindings: { worker: "worker-code" } });
    logger.info("claimed a job");
    expect(lastRecord().worker).toBe("worker-code");
  });
});

describe("redaction is wired into every line", () => {
  it("removes secret-named fields from the log line", () => {
    const { logger, lines } = capture();

    logger.info("authenticating", {
      authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.abcdefghij.klmnopqr",
      password: "hunter2",
      goal: "summarise the repository",
    });

    const line = lines.join("\n");
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(line).toContain(REDACTED);
    expect(line).toContain("summarise the repository");
  });

  it("removes a secret-named field from the bindings", () => {
    const { logger, lines } = capture({ bindings: { apiKey: "sk-proj-AbCdEfGhIjKlMnOpQrStUvWx" } });

    logger.warn("quota low");

    expect(lines.join("\n")).not.toContain("sk-proj-AbCdEfGhIjKlMnOpQrStUvWx");
  });

  it("removes a secret-named field added by child()", () => {
    const { logger, lines } = capture();

    logger.child({ accessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" }).info("pushing");

    expect(lines.join("\n")).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("scrubs a secret that appears inside an error message", () => {
    const { logger, lines } = capture();

    logger.error("database unreachable", {
      err: new Error("could not connect to postgres://admin:hunter2@10.0.0.5:5432/prod"),
    });

    const line = lines.join("\n");
    expect(line).not.toContain("hunter2");
    expect(line).toContain("postgres://admin:");
  });

  it("leaves non-secret identifiers readable", () => {
    const { logger, lastRecord } = capture();

    logger.info("step finished", {
      taskId: "018f2b3c-4d5e-7f60-8a1b-2c3d4e5f6071",
      stepSeq: 4,
      riskClass: "R2",
      tokensIn: 1200,
      tokensOut: 340,
    });

    expect(lastRecord()).toMatchObject({
      taskId: "018f2b3c-4d5e-7f60-8a1b-2c3d4e5f6071",
      stepSeq: 4,
      riskClass: "R2",
      tokensIn: 1200,
      tokensOut: 340,
    });
  });

  it("does not let a field spoof the level or the message", () => {
    const { logger, lastRecord } = capture();

    logger.info("the real message", { level: "error", msg: "a fake message", time: "whenever" });

    expect(lastRecord()).toMatchObject({
      level: "info",
      msg: "the real message",
      time: "2026-10-15T09:30:00.123Z",
    });
  });
});

describe("createLogger robustness", () => {
  it("still emits a valid JSON line for values JSON cannot represent", () => {
    const { logger, lines, lastRecord } = capture();

    const cyclic: Record<string, unknown> = { name: "task" };
    cyclic.self = cyclic;

    logger.info("awkward", { big: 9007199254740993n, cyclic, fn: () => undefined });

    expect(lines).toHaveLength(1);
    expect(lastRecord().msg).toBe("awkward");
  });

  it("attaches the service name and level to a child logger's lines", () => {
    const { logger, lastRecord } = capture({ level: "warn" });
    logger.child({ taskId: "018f2b3c-4d5e-7f60-8a1b-2c3d4e5f6071" }).error("failed");
    expect(lastRecord()).toMatchObject({ service: "api", level: "error" });
  });
});
