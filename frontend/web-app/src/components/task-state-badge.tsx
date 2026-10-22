import type { TaskState } from "@ua/contracts";
import { taskStateLabel, taskStateTone } from "@/lib/task-state";

/** One task state as a coloured pill (docs/planning/12 §4 "Status"). */
export function TaskStateBadge({ state }: { state: TaskState }) {
  return (
    <span
      className={`inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-medium ${taskStateTone(state)}`}
    >
      {taskStateLabel(state)}
    </span>
  );
}
