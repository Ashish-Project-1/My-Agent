import { describe, expect, it } from "vitest";
import { MockCodingEngine } from "../src/coding-engine.js";

describe("MockCodingEngine", () => {
  it("always plans at least one executable step", () => {
    for (const goal of ["Ship the release notes", "", "   ", "a"]) {
      const plan = new MockCodingEngine().plan(goal);
      expect(plan.steps.length).toBeGreaterThan(0);
      for (const step of plan.steps) {
        expect(["model", "tool"]).toContain(step.kind);
        expect(step.title.length).toBeGreaterThan(0);
      }
    }
  });

  it("numbers steps from zero with no gaps, so `depends_on` can name them", () => {
    const { steps } = new MockCodingEngine().plan("anything");
    expect(steps.map((step) => step.seq)).toEqual(steps.map((_, index) => index));
  });
});
