import { isTerminalTaskState, TASK_STATES, type TaskState } from "@ua/contracts";
import { describe, expect, it } from "vitest";
import {
  assertTaskTransition,
  canTransitionTask,
  IllegalTaskTransitionError,
} from "../src/index.js";

/** The legal moves, transcribed from docs/planning/08 §4.1 (failsafe rows excluded). */
const LEGAL = [
  ["QUEUED", "PLANNING"],
  ["QUEUED", "CANCELLED"],
  ["QUEUED", "EXPIRED"],
  ["PLANNING", "RUNNING"],
  ["PLANNING", "FAILED"],
  ["PLANNING", "CANCELLED"],
  ["RUNNING", "WAITING_APPROVAL"],
  ["RUNNING", "WAITING_DEVICE"],
  ["RUNNING", "PAUSED"],
  ["RUNNING", "VERIFYING"],
  ["RUNNING", "FAILED"],
  ["RUNNING", "CANCELLED"],
  ["RUNNING", "EXPIRED"],
  ["WAITING_APPROVAL", "RUNNING"],
  ["WAITING_APPROVAL", "FAILED"],
  ["WAITING_APPROVAL", "EXPIRED"],
  ["WAITING_APPROVAL", "CANCELLED"],
  ["WAITING_DEVICE", "RUNNING"],
  ["WAITING_DEVICE", "EXPIRED"],
  ["WAITING_DEVICE", "CANCELLED"],
  ["PAUSED", "RUNNING"],
  ["PAUSED", "CANCELLED"],
  ["VERIFYING", "RUNNING"],
  ["VERIFYING", "COMPLETED"],
  ["VERIFYING", "FAILED"],
  ["VERIFYING", "CANCELLED"],
] as const satisfies readonly (readonly [TaskState, TaskState])[];

/** The illegal moves named explicitly in docs/planning/08 §4.2. */
const ILLEGAL = [
  // Any transition out of a terminal state (checked exhaustively below).
  ["COMPLETED", "RUNNING"],
  ["FAILED", "QUEUED"],
  // QUEUED → RUNNING skips planning.
  ["QUEUED", "RUNNING"],
  // A grant must return the task to RUNNING, never straight past it.
  ["WAITING_APPROVAL", "VERIFYING"],
  ["WAITING_APPROVAL", "COMPLETED"],
  // Verification cannot be skipped.
  ["RUNNING", "COMPLETED"],
  // Plan approval is a step, not a task-level jump.
  ["PLANNING", "WAITING_APPROVAL"],
  // Resume must pass through RUNNING.
  ["PAUSED", "VERIFYING"],
] as const satisfies readonly (readonly [TaskState, TaskState])[];

describe("task state machine", () => {
  it.each(LEGAL)("allows %s → %s", (from, to) => {
    expect(canTransitionTask(from, to)).toBe(true);
  });

  it.each(ILLEGAL)("rejects %s → %s", (from, to) => {
    expect(canTransitionTask(from, to)).toBe(false);
  });

  it("treats every terminal state as final", () => {
    const terminals = TASK_STATES.filter(isTerminalTaskState);
    expect(terminals).toHaveLength(4);
    for (const from of terminals) {
      for (const to of TASK_STATES) {
        expect(canTransitionTask(from, to)).toBe(false);
      }
    }
  });

  it("lets the failsafe move any non-terminal state to FAILED", () => {
    for (const from of TASK_STATES.filter((s) => !isTerminalTaskState(s))) {
      expect(canTransitionTask(from, "FAILED")).toBe(true);
    }
  });

  it("assertTaskTransition throws a typed error carrying the pair", () => {
    expect(() => assertTaskTransition("RUNNING", "COMPLETED")).toThrow(IllegalTaskTransitionError);
    try {
      assertTaskTransition("RUNNING", "COMPLETED");
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalTaskTransitionError);
      expect((error as IllegalTaskTransitionError).from).toBe("RUNNING");
      expect((error as IllegalTaskTransitionError).to).toBe("COMPLETED");
    }
  });

  it("assertTaskTransition is silent for a legal move", () => {
    expect(() => assertTaskTransition("VERIFYING", "COMPLETED")).not.toThrow();
  });
});
