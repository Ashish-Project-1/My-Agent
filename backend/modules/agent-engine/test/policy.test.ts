import { describe, expect, it } from "vitest";
import {
  describePolicyAction,
  evaluateAction,
  type PolicyAction,
  type PolicyRule,
} from "../src/policy.js";

const ACTION: PolicyAction = {
  tool: "workspace.write_file",
  arguments: { path: "notes.md", content: "hello" },
  deviceId: "01930000-0000-7000-8000-000000000001",
  workspaceId: "01930000-0000-7000-8000-000000000002",
};

describe("evaluateAction", () => {
  it("is deterministic: the same action and context give the same decision", () => {
    const context = { workspaceMode: "read_write", snapshotAvailable: false } as const;
    expect(evaluateAction(ACTION, context)).toEqual(evaluateAction(ACTION, context));
  });

  it("asks before a workspace write when there is no snapshot to roll back to", () => {
    const decision = evaluateAction(ACTION, {
      workspaceMode: "read_write",
      snapshotAvailable: false,
    });
    expect(decision.decision).toBe("ask");
    expect(decision.riskClass).toBe("R2");
    expect(decision.matchedRule).toBe("policy.no_snapshot_escalation");
  });

  it("allows the same write at its floor class once a snapshot exists", () => {
    const decision = evaluateAction(ACTION, {
      workspaceMode: "read_write",
      snapshotAvailable: true,
    });
    expect(decision.decision).toBe("allow");
    expect(decision.riskClass).toBe("R1");
    expect(decision.matchedRule).toBe("policy.workspace_write");
  });

  it("denies a mutation in a read-only workspace, even with a snapshot", () => {
    const decision = evaluateAction(ACTION, {
      workspaceMode: "read_only",
      snapshotAvailable: true,
    });
    expect(decision.decision).toBe("deny");
    expect(decision.matchedRule).toBe("policy.workspace_read_only");
  });

  it("denies a tool that is not in the registry", () => {
    const decision = evaluateAction(
      { ...ACTION, tool: "shell.run" },
      { workspaceMode: "read_write", snapshotAvailable: true },
    );
    expect(decision.decision).toBe("deny");
    expect(decision.matchedRule).toBe("policy.unknown_tool");
  });

  it.each([["../escape.md"], ["/etc/passwd"], ["C:\\Windows\\win.ini"], ["a//b.md"]])(
    "denies the relative-path escape %s",
    (path) => {
      const decision = evaluateAction(
        { ...ACTION, arguments: { path, content: "x" } },
        { workspaceMode: "read_write", snapshotAvailable: true },
      );
      expect(decision.decision).toBe("deny");
      expect(decision.matchedRule).toBe("policy.invalid_arguments");
    },
  );

  it("lets the last matching rule win", () => {
    const allow: PolicyRule = {
      id: "test.allow",
      evaluate: () => ({
        decision: "allow",
        riskClass: "R0",
        matchedRule: "test.allow",
        reasons: [],
      }),
    };
    const deny: PolicyRule = {
      id: "test.deny",
      evaluate: () => ({
        decision: "deny",
        riskClass: "R3",
        matchedRule: "test.deny",
        reasons: [],
      }),
    };
    const context = { workspaceMode: "read_write", snapshotAvailable: true } as const;

    expect(evaluateAction(ACTION, context, [allow, deny]).decision).toBe("deny");
    expect(evaluateAction(ACTION, context, [deny, allow]).decision).toBe("allow");
  });

  it("falls closed when no rule has an opinion", () => {
    const decision = evaluateAction(
      ACTION,
      { workspaceMode: "read_write", snapshotAvailable: true },
      [],
    );
    expect(decision.decision).toBe("deny");
    expect(decision.matchedRule).toBe("policy.default_deny");
  });
});

describe("describePolicyAction", () => {
  it("describes the write without echoing the content", () => {
    const summary = describePolicyAction(ACTION);
    expect(summary).toContain("notes.md");
    expect(summary).toContain("5 bytes");
    expect(summary).not.toContain("hello");
  });
});
