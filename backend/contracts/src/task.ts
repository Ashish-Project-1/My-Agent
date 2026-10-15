import { z } from "zod";

/**
 * Task lifecycle states (docs/planning/08 §4). The transition table itself lives
 * with the engine — a contract must never become a second authority on which
 * transitions are legal.
 */
export const TASK_STATES = [
  "QUEUED",
  "PLANNING",
  "RUNNING",
  "WAITING_APPROVAL",
  "WAITING_DEVICE",
  "PAUSED",
  "VERIFYING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type TaskState = (typeof TASK_STATES)[number];
export const TaskState = z.enum(TASK_STATES);

/**
 * Terminal states are final: a retry creates a new task linked by `retryOf`,
 * it never revives the old one (docs/planning/08 §4.2).
 */
export const TERMINAL_TASK_STATES = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const satisfies readonly TaskState[];

export function isTerminalTaskState(state: TaskState): boolean {
  return (TERMINAL_TASK_STATES as readonly string[]).includes(state);
}

/** Step kinds (docs/planning/08 §2.2). */
export const STEP_KINDS = ["model", "tool", "approval", "verify"] as const;

export type StepKind = (typeof STEP_KINDS)[number];
export const StepKind = z.enum(STEP_KINDS);

/** Where work runs, and therefore whose machine holds the data (docs/planning/08 §2.1). */
export const EXECUTION_LOCATIONS = ["device", "cloud"] as const;

export type ExecutionLocation = (typeof EXECUTION_LOCATIONS)[number];
export const ExecutionLocation = z.enum(EXECUTION_LOCATIONS);
