import type { ExecutionLocation } from "@ua/contracts";

/** A plan step as the planner produces it (docs/planning/08 §3). */
export type PlannedStep = {
  seq: number;
  kind: "model" | "tool";
  title: string;
  /** Present only for `kind: "tool"`; the policy engine refuses the rest. */
  toolName?: string;
  toolVersion?: string;
  arguments?: Record<string, unknown>;
};

/**
 * A plan is persisted verbatim in `tasks.plan`, so these are type aliases, not
 * interfaces: only aliases are assignable to Prisma's JSON input.
 */
export type TaskPlan = {
  steps: PlannedStep[];
};

/** The task facts a planner needs; never the whole task row. */
export interface PlanContext {
  taskId: string;
  executionLocation: ExecutionLocation;
  deviceId: string | null;
  workspaceId: string | null;
  workspacePath: string | null;
}

/** The planner's contract, so the real engine is a drop-in replacement. */
export interface CodingEngine {
  plan(goal: string, context?: PlanContext): TaskPlan;
}

/**
 * The Phase 3 stand-in for the real coding engine (docs/planning/17 §179): a
 * single always-valid step, enough to carry a task through the pipeline.
 *
 * For a device task it plans the one real M0 tool: write a Markdown result into
 * the registered workspace. That is a genuine workspace-scoped code action, and
 * with no snapshot it is escalated to R2 by the policy engine, which is what
 * produces the M0 approval.
 *
 * shortcut: no model is called and the goal is the only input. The embedded
 * OpenCode adapter (ADR-011) replaces this class; the interface stays.
 */
export class MockCodingEngine implements CodingEngine {
  plan(goal: string, context?: PlanContext): TaskPlan {
    if (
      context?.executionLocation === "device" &&
      context.workspaceId !== null &&
      context.workspacePath !== null
    ) {
      return {
        steps: [
          {
            seq: 0,
            kind: "tool",
            title: "Write the task result into the workspace",
            toolName: "workspace.write_file",
            toolVersion: "1.0.0",
            arguments: {
              path: `.ua/${context.taskId}.md`,
              content: `# Task\n\n${goal}\n`,
            },
          },
        ],
      };
    }

    const subject = goal.trim().split(/\s+/).slice(0, 8).join(" ");
    return {
      steps: [
        {
          seq: 0,
          kind: "model",
          title: subject === "" ? "Plan and complete the goal" : `Plan and complete: ${subject}`,
        },
      ],
    };
  }
}
