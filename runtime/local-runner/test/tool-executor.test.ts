import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalDeviceCommand,
  canonicalJson,
  canonicalToolAction,
  type DeviceCommandSummary,
  type DeviceWorkspacePolicy,
} from "@ua/contracts";
import { flavourForOs } from "@ua/sandbox-manager";
import { afterAll, describe, expect, it } from "vitest";
import { executeToolCommand, type ToolExecutionInput } from "../src/tool-executor.js";
import { inspectWorkspaceRoots } from "../src/workspace-roots.js";

/**
 * The executor is the last place a tool action is checked, so these run against
 * the real filesystem: a mocked write would prove nothing about where the bytes
 * land (docs/planning/09 §6).
 */

const flavour = flavourForOs(process.platform);
const root = mkdtempSync(join(realpathSync.native(tmpdir()), "ua-tool-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const DEVICE_ID = "0190a000-0000-7000-8000-000000000002";
const WORKSPACE_ID = "0190a000-0000-7000-8000-000000000001";
const TASK_ID = "0190a000-0000-7000-8000-000000000005";
const STEP_ID = "0190a000-0000-7000-8000-000000000006";
const COMMAND_ID = "0190a000-0000-7000-8000-000000000007";
const POLICY_VERSION = "1";
const EXPIRES = "2099-01-01T00:00:00.000Z";

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

const policy: DeviceWorkspacePolicy = {
  workspaces: [
    {
      id: WORKSPACE_ID,
      deviceId: DEVICE_ID,
      path: root,
      rawPath: root,
      label: "Scratch",
      mode: "read_write",
      createdByUserId: "0190a000-0000-7000-8000-000000000003",
      lastUsedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  grants: [],
};

function command(path: string, content: string): DeviceCommandSummary {
  const args = { path, content };
  const payload = {
    taskId: TASK_ID,
    stepId: STEP_ID,
    approvalId: null,
    tool: "workspace.write_file" as const,
    toolVersion: "1.0.0",
    arguments: args,
    actionDigest: sha256(
      canonicalToolAction({
        tool: "workspace.write_file",
        toolVersion: "1.0.0",
        arguments: args,
        deviceId: DEVICE_ID,
        workspaceId: WORKSPACE_ID,
        policyVersion: POLICY_VERSION,
        expiresAt: EXPIRES,
      }),
    ),
    policyVersion: POLICY_VERSION,
    approvalExpiresAt: EXPIRES,
    deviceId: DEVICE_ID,
    workspaceId: WORKSPACE_ID,
  };
  return {
    id: COMMAND_ID,
    seq: 1,
    kind: "tool_execute",
    payload,
    commandDigest: sha256(
      canonicalDeviceCommand({
        deviceId: DEVICE_ID,
        kind: "tool_execute",
        payload,
        expiresAt: EXPIRES,
      }),
    ),
    expiresAt: EXPIRES,
  };
}

function run(overrides: Partial<ToolExecutionInput> = {}): ReturnType<typeof executeToolCommand> {
  return executeToolCommand({
    command: command("notes/a.md", "hello\n"),
    deviceId: DEVICE_ID,
    policy,
    roots: inspectWorkspaceRoots(policy, { flavour, denied: [] }),
    flavour,
    denied: [],
    allowsMutations: true,
    ...overrides,
  });
}

describe("executeToolCommand", () => {
  it("writes inside the workspace and reports the bytes it wrote", () => {
    const content = "hello\n";
    const outcome = run();

    expect(outcome.ack.outcome).toBe("acked");
    expect(readFileSync(join(root, "notes", "a.md"), "utf8")).toBe(content);

    const payload = outcome.ack.result?.payload as { path: string; bytes: number; sha256: string };
    expect(payload.path).toBe("notes/a.md");
    expect(payload.bytes).toBe(Buffer.byteLength(content, "utf8"));
    expect(payload.sha256).toBe(sha256(content));
    expect(outcome.ack.result?.digest).toBe(sha256(canonicalJson(payload)));
    expect(statSync(join(root, "notes", "a.md")).isFile()).toBe(true);
  });

  it("refuses a path that climbs out of the workspace", () => {
    const outcome = run({ command: command("../escape.md", "nope") });

    expect(outcome.ack.outcome).toBe("failed");
    expect(outcome.ack.error).toContain("..");
    expect(outcome.writtenPath).toBeNull();
  });

  it("refuses a payload changed after the command digest was computed", () => {
    const tampered = command("notes/a.md", "hello\n");
    tampered.payload = { ...tampered.payload, arguments: { path: "notes/b.md", content: "evil" } };

    const outcome = run({ command: tampered });

    expect(outcome.ack.outcome).toBe("failed");
    expect(outcome.ack.error).toContain("digest");
  });

  it("refuses every tool while the sandbox self-test has not passed", () => {
    const outcome = run({ allowsMutations: false });

    expect(outcome.ack.outcome).toBe("failed");
    expect(outcome.ack.error).toContain("self-test");
  });
});
