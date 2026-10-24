/**
 * Loop detection (docs/planning/08 §7, FR-TASK-05).
 *
 * A model that is stuck tends to ask for the same concrete action again. Three
 * identical actions in one task is the floor: enough for a legitimate retry,
 * too few to burn a budget.
 */
export const MAX_IDENTICAL_ACTIONS = 3;

/** True when doing `next` would be the third identical action in this task. */
export function isRepeatedAction(seen: readonly string[], next: string): boolean {
  let count = 1;
  for (const digest of seen) {
    if (digest === next) {
      count += 1;
    }
  }
  return count >= MAX_IDENTICAL_ACTIONS;
}
