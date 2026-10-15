// scan-secrets:allow-file — the leak this file asserts against is a fixture, not
// a real credential.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AppError,
  fieldErrorsFromZod,
  isAppError,
  titleForCode,
  toProblemDetails,
  ValidationError,
} from "../src/index.js";

const CONTEXT = {
  instance: "/v1/tasks/018f2b3c-4d5e-7f60-8a1b-2c3d4e5f6071",
  requestId: "01J9Z8QK5M7N0P1R2S3T4V5W6X",
  traceId: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
};

describe("AppError", () => {
  it("takes its status from the single code -> status mapping", () => {
    expect(new AppError("not_found", "no such task").status).toBe(404);
    expect(new AppError("rate_limited", "slow down").status).toBe(429);
  });

  it("is recognised, and a plain Error is not", () => {
    expect(isAppError(new AppError("conflict", "x"))).toBe(true);
    expect(isAppError(new Error("x"))).toBe(false);
    expect(isAppError("x")).toBe(false);
  });
});

describe("titleForCode", () => {
  it("humanises a snake_case code", () => {
    expect(titleForCode("approval_expired")).toBe("Approval expired");
    expect(titleForCode("internal_error")).toBe("Internal error");
    expect(titleForCode("gone")).toBe("Gone");
  });
});

describe("toProblemDetails", () => {
  it("maps a deliberate error to the documented shape", () => {
    const problem = toProblemDetails(
      new AppError("approval_expired", "The approval expired."),
      CONTEXT,
    );

    expect(problem).toEqual({
      type: "https://docs.example.com/errors/approval-expired",
      title: "Approval expired",
      status: 409,
      code: "approval_expired",
      detail: "The approval expired.",
      instance: CONTEXT.instance,
      requestId: CONTEXT.requestId,
      traceId: CONTEXT.traceId,
    });
  });

  it("honours a type-base override so the host is not baked in", () => {
    const problem = toProblemDetails(new AppError("gone", "deleted"), {
      ...CONTEXT,
      typeBase: "https://errors.internal/",
    });
    expect(problem.type).toBe("https://errors.internal/gone");
  });

  it("never leaks the message or stack of an unexpected error", () => {
    const secret = "connect failed: postgres://admin:hunter2@10.0.0.5:5432/prod (tenant=acme)";
    const leaky = new Error(secret);
    leaky.stack = `Error: ${secret}\n    at /srv/app/secret.ts:42:9`;

    const problem = toProblemDetails(leaky, CONTEXT);
    const serialised = JSON.stringify(problem);

    expect(problem.code).toBe("internal_error");
    expect(problem.status).toBe(500);
    expect(serialised).not.toContain("hunter2");
    expect(serialised).not.toContain("10.0.0.5");
    expect(serialised).not.toContain("/srv/app/secret.ts");
    expect(Object.hasOwn(problem, "stack")).toBe(false);
  });

  it("survives a thrown non-Error", () => {
    for (const thrown of ["boom", null, undefined, 42, { code: "gone" }, Symbol("x")]) {
      const problem = toProblemDetails(thrown, CONTEXT);
      expect(problem.code).toBe("internal_error");
    }
  });

  it("does not throw when the context itself is unusable", () => {
    // The document cannot be validated, so it degrades to the internal-error
    // shape. The last thing an error path may do is throw.
    const problem = toProblemDetails(new AppError("conflict", "x"), {
      instance: "",
      requestId: "not-a-ulid",
      traceId: "not-a-trace",
    });
    expect(() => JSON.stringify(problem)).not.toThrow();
    expect(problem.code).toBe("internal_error");
  });

  it("includes field errors for a validation failure", () => {
    const problem = toProblemDetails(
      new ValidationError([{ pointer: "/goal", code: "too_small", detail: "must not be empty" }]),
      CONTEXT,
    );
    expect(problem.status).toBe(400);
    expect(problem.code).toBe("validation_failed");
    expect(problem.errors).toEqual([
      { pointer: "/goal", code: "too_small", detail: "must not be empty" },
    ]);
  });
});

describe("fieldErrorsFromZod", () => {
  it("addresses each issue by JSON Pointer", () => {
    const schema = z.object({
      goal: z.string().min(1),
      constraints: z.object({ maxSteps: z.number().max(200) }),
    });
    const result = schema.safeParse({ goal: "", constraints: { maxSteps: 500 } });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    const pointers = fieldErrorsFromZod(result.error)
      .map((field) => field.pointer)
      .sort();
    expect(pointers).toEqual(["/constraints/maxSteps", "/goal"]);
  });

  it("uses the empty pointer for a whole-document failure", () => {
    const result = z.string().safeParse(123);
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(fieldErrorsFromZod(result.error)[0]?.pointer).toBe("");
  });

  it("escapes ~ and / per RFC 6901", () => {
    const result = z.record(z.string(), z.number()).safeParse({ "a/b~c": "nope" });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(fieldErrorsFromZod(result.error)[0]?.pointer).toBe("/a~1b~0c");
  });
});
