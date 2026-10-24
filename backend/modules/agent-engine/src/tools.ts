import type { RiskClass, ToolName, WorkspaceWriteArguments } from "@ua/contracts";
import {
  validateWorkspacePath,
  WorkspaceWriteArguments as WorkspaceWriteArgumentsSchema,
} from "@ua/contracts";

/**
 * The tool registry (docs/planning/17 Phase 5, FR-TOOL-01).
 *
 * A manifest is data: the name that may appear in a plan, the floor risk class
 * of calling it, whether it mutates, and how its arguments are validated and
 * described to a human. The engine consults this and nothing else, so "which
 * tools exist" has exactly one answer.
 *
 * `shortcut: one tool. The embedded OpenCode adapter (ADR-011) will register
 * its tools here in Phase 6; until then a second tool would be untested code.`
 */
export interface ToolManifest {
  readonly name: ToolName;
  readonly version: string;
  /** The class before any escalation. Escalation lives in the policy engine. */
  readonly riskClass: RiskClass;
  readonly mutating: boolean;
  /** Null when the arguments are valid, else the sentence to show. */
  validate(args: Record<string, unknown>): string | null;
  /** One line a user can approve, never the whole payload. */
  describe(args: Record<string, unknown>): string;
}

/**
 * A workspace path is relative and already free of structure the runner would
 * otherwise have to fold. The runner still resolves it against the real
 * filesystem; this is the cheap refusal before a plan is accepted.
 */
export { validateWorkspacePath } from "@ua/contracts";

function validateWriteArguments(args: Record<string, unknown>): string | null {
  const parsed = WorkspaceWriteArgumentsSchema.safeParse(args);
  if (!parsed.success) {
    return parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
  }
  return validateWorkspacePath(parsed.data.path);
}

function describeWrite(args: Record<string, unknown>): string {
  const path = typeof args.path === "string" ? args.path : "(unknown path)";
  const content = typeof args.content === "string" ? args.content : "";
  return `Write ${Buffer.byteLength(content, "utf8")} bytes to ${path}`;
}

export const TOOL_REGISTRY: Readonly<Record<ToolName, ToolManifest>> = {
  "workspace.write_file": {
    name: "workspace.write_file",
    version: "1.0.0",
    // Writing inside the user's own workspace is R1; escalation to R2 happens
    // in `policy.ts` when no snapshot protects the change (docs/planning/10 §6).
    riskClass: "R1",
    mutating: true,
    validate: validateWriteArguments,
    describe: describeWrite,
  },
};

/** Null for a name a plan invented: unknown tools are never allowed. */
export function toolManifest(name: string): ToolManifest | null {
  return (TOOL_REGISTRY as Record<string, ToolManifest>)[name] ?? null;
}

/** The typed view of a validated call, for callers that need the arguments. */
export type WriteToolArguments = WorkspaceWriteArguments;
