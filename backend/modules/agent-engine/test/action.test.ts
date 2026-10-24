import { describe, expect, it } from "vitest";
import { actionDigest } from "../src/action.js";

const ACTION = {
  tool: "workspace.write_file",
  toolVersion: "1.0.0",
  arguments: { path: "notes.md", content: "hello" },
  deviceId: "01930000-0000-7000-8000-000000000001",
  workspaceId: "01930000-0000-7000-8000-000000000002",
  policyVersion: "1",
  expiresAt: "2026-10-22T10:15:00.000Z",
};

describe("actionDigest", () => {
  it("is stable for the same action regardless of key order", () => {
    expect(actionDigest(ACTION)).toBe(
      actionDigest({ ...ACTION, arguments: { content: "hello", path: "notes.md" } }),
    );
  });

  it.each([
    ["one path letter", { arguments: { path: "noteS.md", content: "hello" } }],
    ["one content byte", { arguments: { path: "notes.md", content: "hellp" } }],
    ["the device", { deviceId: "01930000-0000-7000-8000-000000000003" }],
    ["the workspace", { workspaceId: "01930000-0000-7000-8000-000000000004" }],
    ["the tool version", { toolVersion: "1.0.1" }],
    ["the policy version", { policyVersion: "2" }],
    ["one expiry second", { expiresAt: "2026-10-22T10:15:01.000Z" }],
  ])("changes when %s changes", (_label, change) => {
    expect(actionDigest({ ...ACTION, ...change })).not.toBe(actionDigest(ACTION));
  });
});
