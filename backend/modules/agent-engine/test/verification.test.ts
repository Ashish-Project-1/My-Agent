import { canonicalJson } from "@ua/contracts";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/action.js";
import { verifyToolResult } from "../src/verification.js";

const ARGUMENTS = { path: "notes.md", content: "hello" };

function reported(payload: Record<string, unknown>) {
  return { payload, digest: sha256Hex(canonicalJson(payload)) };
}

const GOOD = reported({ path: "notes.md", bytes: 5, sha256: sha256Hex("hello") });

describe("verifyToolResult", () => {
  it("passes when the device reports the approved bytes", () => {
    const outcome = verifyToolResult({
      tool: "workspace.write_file",
      arguments: ARGUMENTS,
      result: GOOD,
    });
    expect(outcome.passed).toBe(true);
    expect(outcome.checks.map((check) => check.passed)).toEqual([true, true, true, true]);
  });

  it("fails when the reported payload no longer matches its digest", () => {
    const outcome = verifyToolResult({
      tool: "workspace.write_file",
      arguments: ARGUMENTS,
      result: { ...GOOD, payload: { ...GOOD.payload, path: "elsewhere.md" } },
    });
    expect(outcome.passed).toBe(false);
    expect(outcome.checks.find((check) => check.name === "result.digest")?.passed).toBe(false);
  });

  it("fails when the device wrote different bytes than were approved", () => {
    const outcome = verifyToolResult({
      tool: "workspace.write_file",
      arguments: ARGUMENTS,
      result: reported({ path: "notes.md", bytes: 5, sha256: sha256Hex("HELLO") }),
    });
    expect(outcome.passed).toBe(false);
    expect(outcome.checks.find((check) => check.name === "result.content")?.passed).toBe(false);
  });

  it("fails when the device wrote to a different path", () => {
    const outcome = verifyToolResult({
      tool: "workspace.write_file",
      arguments: ARGUMENTS,
      result: reported({ path: "other.md", bytes: 5, sha256: sha256Hex("hello") }),
    });
    expect(outcome.passed).toBe(false);
    expect(outcome.checks.find((check) => check.name === "result.path")?.passed).toBe(false);
  });
});
