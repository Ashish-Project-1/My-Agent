import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  ERROR_STATUS,
  ErrorCode,
  isErrorCode,
  ProblemDetails,
  riskRank,
} from "../src/index.js";

/** The example document from docs/planning/07 §2, verbatim. */
const DOC_EXAMPLE = {
  type: "https://docs.example.com/errors/approval-expired",
  title: "Approval expired",
  status: 409,
  code: "approval_expired",
  detail: "The approval for this action expired before it was used.",
  instance: "/v1/tasks/018f0000-0000-7000-8000-000000000000/steps/4/approvals",
  requestId: "01J9Z8QK5M7N0P1R2S3T4V5W6X",
  traceId: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  errors: [{ pointer: "/constraints/maxSteps", code: "out_of_range", detail: "must be <= 200" }],
};

describe("ERROR_STATUS", () => {
  it("maps every code, with no code left without a status", () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_STATUS[code]).toBeTypeOf("number");
    }
  });

  it("has no status for a code that is not declared", () => {
    expect(Object.keys(ERROR_STATUS).sort()).toEqual([...ERROR_CODES].sort());
  });

  it("uses only client- or server-error statuses", () => {
    for (const status of Object.values(ERROR_STATUS)) {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThanOrEqual(599);
    }
  });

  it("agrees with the documented families", () => {
    expect(ERROR_STATUS.not_found).toBe(404);
    expect(ERROR_STATUS.approval_expired).toBe(409);
    expect(ERROR_STATUS.rate_limited).toBe(429);
    expect(ERROR_STATUS.internal_error).toBe(500);
    expect(ERROR_STATUS.gateway_timeout).toBe(504);
  });
});

describe("isErrorCode", () => {
  it("accepts a declared code", () => {
    expect(isErrorCode("state_conflict")).toBe(true);
  });

  it("rejects an undeclared code", () => {
    expect(isErrorCode("everyone_is_fine")).toBe(false);
  });

  it("does not treat inherited Object properties as codes", () => {
    expect(isErrorCode("toString")).toBe(false);
    expect(isErrorCode("constructor")).toBe(false);
  });
});

describe("ErrorCode", () => {
  it("rejects a code that is not in the closed set", () => {
    expect(ErrorCode.safeParse("teapot").success).toBe(false);
  });
});

describe("ProblemDetails", () => {
  it("accepts the documented example", () => {
    expect(ProblemDetails.safeParse(DOC_EXAMPLE).success).toBe(true);
  });

  it("rejects an unknown error code", () => {
    expect(ProblemDetails.safeParse({ ...DOC_EXAMPLE, code: "whoops" }).success).toBe(false);
  });

  it("rejects a requestId that is not a ULID", () => {
    expect(ProblemDetails.safeParse({ ...DOC_EXAMPLE, requestId: "req-1" }).success).toBe(false);
  });

  it("rejects a malformed traceparent", () => {
    expect(ProblemDetails.safeParse({ ...DOC_EXAMPLE, traceId: "not-a-trace" }).success).toBe(
      false,
    );
  });

  it("rejects a status that is not an HTTP error status", () => {
    expect(ProblemDetails.safeParse({ ...DOC_EXAMPLE, status: 200 }).success).toBe(false);
  });

  it("rejects extra fields, so a stack trace cannot be attached to a response", () => {
    const leaked = { ...DOC_EXAMPLE, stack: "Error: boom\n    at /srv/app/secret.ts:42" };
    expect(ProblemDetails.safeParse(leaked).success).toBe(false);
  });
});

describe("riskRank", () => {
  it("orders R0 < R1 < R2 < R3 < R4", () => {
    expect(riskRank("R0")).toBeLessThan(riskRank("R1"));
    expect(riskRank("R1")).toBeLessThan(riskRank("R2"));
    expect(riskRank("R2")).toBeLessThan(riskRank("R3"));
    expect(riskRank("R3")).toBeLessThan(riskRank("R4"));
  });
});
