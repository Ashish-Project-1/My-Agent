import { describe, expect, it } from "vitest";
import {
  EXECUTION_LOCATIONS,
  ExecutionLocation,
  isTerminalTaskState,
  STEP_KINDS,
  StepKind,
  TASK_STATES,
  TaskState,
  TERMINAL_TASK_STATES,
} from "../src/index.js";

describe("TaskState", () => {
  it("accepts every documented state", () => {
    for (const state of TASK_STATES) {
      expect(TaskState.safeParse(state).success).toBe(true);
    }
  });

  it("rejects a state that is not in the state machine", () => {
    expect(TaskState.safeParse("PENDING").success).toBe(false);
  });

  it("has exactly the eleven states from docs/planning/08 §4", () => {
    expect(TASK_STATES).toHaveLength(11);
  });
});

describe("isTerminalTaskState", () => {
  it("is true for exactly the four terminal states", () => {
    const terminal = TASK_STATES.filter(isTerminalTaskState);
    expect([...terminal].sort()).toEqual([...TERMINAL_TASK_STATES].sort());
  });

  it("is false for every non-terminal state", () => {
    for (const state of ["QUEUED", "PLANNING", "RUNNING", "VERIFYING"] as const) {
      expect(isTerminalTaskState(state)).toBe(false);
    }
  });

  it("only contains states that exist in the state machine", () => {
    for (const state of TERMINAL_TASK_STATES) {
      expect(TASK_STATES).toContain(state);
    }
  });
});

describe("StepKind and ExecutionLocation", () => {
  it("accepts the four step kinds", () => {
    expect([...STEP_KINDS]).toEqual(["model", "tool", "approval", "verify"]);
    for (const kind of STEP_KINDS) {
      expect(StepKind.safeParse(kind).success).toBe(true);
    }
  });

  it("accepts device and cloud, and nothing else", () => {
    expect([...EXECUTION_LOCATIONS]).toEqual(["device", "cloud"]);
    expect(ExecutionLocation.safeParse("cluster").success).toBe(false);
  });
});
