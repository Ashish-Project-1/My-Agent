"use client";

import Link from "next/link";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { TaskStateBadge } from "@/components/task-state-badge";
import { errorText, isSignedOut, listTasks } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import { useAsync } from "@/lib/use-async";

export default function TaskListPage() {
  const tasks = useAsync(listTasks);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
          <p className="mt-1 text-sm text-ink-muted">
            What your agents have been asked to do, and where each one got to.
          </p>
        </div>
        <Link
          href="/tasks/new"
          className="shrink-0 rounded-control bg-primary px-3 py-2 text-sm font-medium text-on-primary transition-colors duration-hover ease-standard hover:bg-primary-strong"
        >
          New task
        </Link>
      </div>

      {tasks.status === "loading" && <p className="text-sm text-ink-subtle">Loading tasks…</p>}

      {tasks.status === "error" &&
        (isSignedOut(tasks.error) ? (
          <SignInPrompt noun="your tasks" />
        ) : (
          <div className="rounded-card border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
            {errorText(tasks.error)}
          </div>
        ))}

      {tasks.status === "ready" && tasks.value.tasks.length === 0 && (
        <div className="rounded-card border border-line bg-surface p-8 text-center">
          <p className="text-sm text-ink-muted">No tasks yet.</p>
          <Link
            href="/tasks/new"
            className="mt-3 inline-block text-sm font-medium text-primary hover:text-primary-strong"
          >
            Create the first one
          </Link>
        </div>
      )}

      {tasks.status === "ready" && tasks.value.tasks.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
          {tasks.value.tasks.map((task) => (
            <li key={task.id}>
              <Link
                href={`/tasks/${task.id}`}
                className="flex items-center gap-4 px-4 py-3 transition-colors duration-hover ease-standard hover:bg-canvas"
              >
                <TaskStateBadge state={task.state} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.goal}</span>
                <span className="shrink-0 text-xs text-ink-subtle">
                  {formatWhen(task.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
