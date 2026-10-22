import type { TaskState } from "@ua/contracts";

/**
 * The legal task-state transitions (docs/planning/08 §4.1).
 *
 * This table is the single authority on task state: every write path that
 * changes `tasks.state` goes through `assertTaskTransition` first, so a state is
 * never assigned in a second place (docs/planning/08 §4.2). Only the *shape* of
 * each move lives here; the guards in the planning table (quota, lease,
 * capability, approval digest) are conditions the caller checks before asking to
 * move, and the row for a given `from` is deliberately the whole answer to
 * "where may this task go next".
 *
 * The `any non-terminal → FAILED` failsafe (docs/planning/08 §4.1, last row) is
 * spelled out in every non-terminal row rather than special-cased in code, so
 * the table stays the only thing to read.
 */
const LEGAL_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  QUEUED: ["PLANNING", "CANCELLED", "EXPIRED", "FAILED"],
  PLANNING: ["RUNNING", "CANCELLED", "FAILED"],
  RUNNING: [
    "WAITING_APPROVAL",
    "WAITING_DEVICE",
    "PAUSED",
    "VERIFYING",
    "CANCELLED",
    "EXPIRED",
    "FAILED",
  ],
  WAITING_APPROVAL: ["RUNNING", "CANCELLED", "EXPIRED", "FAILED"],
  WAITING_DEVICE: ["RUNNING", "CANCELLED", "EXPIRED", "FAILED"],
  PAUSED: ["RUNNING", "CANCELLED", "FAILED"],
  VERIFYING: ["RUNNING", "COMPLETED", "CANCELLED", "FAILED"],
  // Terminal states are final: a retry creates a new task linked by `retryOf`
  // (docs/planning/08 §4.2), it never revives the old one.
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
};

/** True when a task may move from `from` to `to` (docs/planning/08 §4.1). */
export function canTransitionTask(from: TaskState, to: TaskState): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

/**
 * Raised when a caller attempts a transition the table forbids. The pair is
 * carried on the error so the caller can log it without re-deriving it
 * (docs/planning/08 §4.2 — illegal transitions are rejected *and logged*).
 */
export class IllegalTaskTransitionError extends Error {
  readonly from: TaskState;
  readonly to: TaskState;

  constructor(from: TaskState, to: TaskState) {
    super(`A task cannot move from ${from} to ${to}.`);
    this.name = "IllegalTaskTransitionError";
    this.from = from;
    this.to = to;
  }
}

/**
 * The one check every state write calls before it assigns `tasks.state`. Throws
 * {@link IllegalTaskTransitionError} on an illegal move.
 */
export function assertTaskTransition(from: TaskState, to: TaskState): void {
  if (!canTransitionTask(from, to)) {
    throw new IllegalTaskTransitionError(from, to);
  }
}
