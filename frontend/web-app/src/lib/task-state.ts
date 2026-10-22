import type { TaskState } from "@ua/contracts";

/**
 * Badge tone per task state (docs/planning/12 §4).
 *
 * A lookup rather than conditionals so a new state cannot silently render as
 * "neutral": adding one to `TASK_STATES` forces a decision here.
 */
const TONES: Record<TaskState, string> = {
  QUEUED: "bg-ink/8 text-ink-muted",
  PLANNING: "bg-info/10 text-info",
  RUNNING: "bg-info/10 text-info",
  WAITING_APPROVAL: "bg-warning/12 text-warning",
  WAITING_DEVICE: "bg-warning/12 text-warning",
  PAUSED: "bg-ink/8 text-ink-muted",
  VERIFYING: "bg-info/10 text-info",
  COMPLETED: "bg-success/10 text-success",
  FAILED: "bg-danger/10 text-danger",
  CANCELLED: "bg-ink/8 text-ink-muted",
  EXPIRED: "bg-ink/8 text-ink-muted",
};

export function taskStateTone(state: TaskState): string {
  return TONES[state];
}

/** `WAITING_APPROVAL` reads better than `WAITING APPROVAL`. */
export function taskStateLabel(state: TaskState): string {
  return state.replaceAll("_", " ");
}
