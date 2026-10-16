import { describe, expect, it } from "vitest";
import { isUniqueViolationOn } from "../src/common/prisma-errors.js";

describe("prisma-errors", () => {
  it("detects by field name", () => {
    const err = { code: "P2002", meta: { target: ["email"] } };
    expect(isUniqueViolationOn(err, "email")).toBe(true);
  });

  it("detects by constraint suffix", () => {
    const err = { code: "P2002", meta: { target: ["users_email_key"] } };
    expect(isUniqueViolationOn(err, "email")).toBe(true);
  });

  it("detects the Prisma 7 driver-adapter shape", () => {
    // pg adapter reports the index under meta.driverAdapterError, not meta.target.
    const err = {
      code: "P2002",
      meta: {
        modelName: "users",
        driverAdapterError: {
          cause: {
            kind: "UniqueConstraintViolation",
            constraint: { index: "users_email_key" },
          },
        },
      },
    };
    expect(isUniqueViolationOn(err, "email")).toBe(true);
    expect(isUniqueViolationOn(err, "slug")).toBe(false);
  });

  it("rejects non-unique errors", () => {
    const err = { code: "P2003" };
    expect(isUniqueViolationOn(err, "email")).toBe(false);
  });
});
