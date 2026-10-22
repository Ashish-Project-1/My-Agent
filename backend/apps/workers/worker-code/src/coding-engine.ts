/** A plan step as the planner produces it (docs/planning/08 §3). */
export type PlannedStep = {
  seq: number;
  kind: "model" | "tool";
  title: string;
};

/**
 * A plan is persisted verbatim in `tasks.plan`, so these are type aliases, not
 * interfaces: only aliases are assignable to Prisma's JSON input.
 */
export type TaskPlan = {
  steps: PlannedStep[];
};

/** The planner's contract, so the real engine is a drop-in replacement. */
export interface CodingEngine {
  plan(goal: string): TaskPlan;
}

/**
 * The Phase 3 stand-in for the real coding engine (docs/planning/17 §179): a
 * single always-valid step, enough to carry a task through the pipeline.
 *
 * shortcut: no model is called and nothing is checked against the tool
 * registry; the real `CodingEngine` lands in Phase 5.
 */
export class MockCodingEngine implements CodingEngine {
  plan(goal: string): TaskPlan {
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
