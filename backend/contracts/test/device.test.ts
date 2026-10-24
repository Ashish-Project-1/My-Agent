import { describe, expect, it } from "vitest";
import { canonicalDeviceCommand } from "../src/device.js";

const base = {
  deviceId: "01a16762-30ec-73ca-81f6-cc9dfba6cd44",
  kind: "tool_execute",
  expiresAt: "2026-10-23T06:20:54.158Z",
};

describe("canonicalDeviceCommand", () => {
  it("hashes the same bytes whatever order the jsonb column returns", () => {
    // Postgres `jsonb` reorders object keys, so the device sees the payload in
    // an order the worker never wrote. The canonical string must not care.
    const written = canonicalDeviceCommand({
      ...base,
      payload: { tool: "workspace.write_file", arguments: { path: ".ua/x.md", content: "hi" } },
    });
    const readBack = canonicalDeviceCommand({
      ...base,
      payload: { arguments: { content: "hi", path: ".ua/x.md" }, tool: "workspace.write_file" },
    });
    expect(readBack).toBe(written);
  });

  it("still distinguishes a different payload", () => {
    const first = canonicalDeviceCommand({ ...base, payload: { path: "a.md" } });
    const second = canonicalDeviceCommand({ ...base, payload: { path: "b.md" } });
    expect(second).not.toBe(first);
  });
});
