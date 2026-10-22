"use client";

import type { TaskEventSummary, TaskStepSummary } from "@ua/contracts";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { TaskStateBadge } from "@/components/task-state-badge";
import { errorText, getTask, getTaskEvents, getTaskSteps, isSignedOut } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import { followTaskEvents, mergeEvents, type StreamStatus } from "@/lib/sse";
import { useAsync } from "@/lib/use-async";

/** Human text for the connection indicator (docs/planning/12 §5). */
const STATUS_LABEL: Record<StreamStatus, string> = {
  connecting: "Connecting…",
  live: "Live",
  retrying: "Reconnecting…",
  ended: "Up to date",
};

const STATUS_TONE: Record<StreamStatus, string> = {
  connecting: "bg-warning/12 text-warning",
  live: "bg-success/10 text-success",
  retrying: "bg-warning/12 text-warning",
  ended: "bg-ink/8 text-ink-muted",
};

function EventRow({ event }: { event: TaskEventSummary }) {
  return (
    <li className="flex gap-3 px-4 py-3">
      <span className="w-10 shrink-0 pt-0.5 text-right font-mono text-xs text-ink-subtle">
        {event.seq}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-sm font-medium">{event.type}</span>
          <span className="text-xs text-ink-subtle">{event.actor}</span>
          <span className="text-xs text-ink-subtle">{formatWhen(event.createdAt)}</span>
        </div>
        {event.data !== null && event.data !== undefined && (
          <pre className="mt-2 max-h-40 overflow-auto rounded-control bg-canvas px-3 py-2 font-mono text-xs text-ink-muted">
            {JSON.stringify(event.data, null, 2)}
          </pre>
        )}
      </div>
    </li>
  );
}

function StepRow({ step }: { step: TaskStepSummary }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="w-6 shrink-0 text-right font-mono text-xs text-ink-subtle">{step.seq}</span>
      <span className="min-w-0 flex-1 truncate text-sm">{step.title}</span>
      <span className="shrink-0 text-xs text-ink-subtle">{step.kind}</span>
      <span className="shrink-0 text-xs font-medium text-ink-muted">
        {step.state.replaceAll("_", " ")}
      </span>
    </li>
  );
}

/**
 * The task workspace (FR-TASK-03/04): what was asked, the plan it became, and
 * an append-only timeline that fills in as the worker runs.
 *
 * State and stream are deliberately separate — the fetch is what the page can
 * rely on, and the stream only ever adds to it. When the stream reports a gap
 * the page refetches rather than trusting a half-read log
 * (docs/planning/07 §5 "State beats stream").
 */
export default function TaskWorkspacePage() {
  const params = useParams<{ taskId: string }>();
  const taskId = params.taskId;

  const task = useAsync(() => getTask(taskId));
  const steps = useAsync(() => getTaskSteps(taskId));
  const events = useAsync(() => getTaskEvents(taskId));
  const [streamed, setStreamed] = useState<TaskEventSummary[]>([]);
  const [status, setStatus] = useState<StreamStatus>("connecting");

  useEffect(() => {
    setStreamed([]);
    return followTaskEvents(taskId, {
      onEvent: (event) => setStreamed((current) => [...current, event]),
      onResync: () => {
        task.reload();
        steps.reload();
        events.reload();
      },
      onDone: () => {
        task.reload();
        steps.reload();
      },
      // The stream has given up on the session; reloading the task is what turns
      // that into the sign-in prompt below.
      onSignedOut: () => task.reload(),
      onStatus: setStatus,
    });
    // The three `reload`s are stable callbacks; `task`/`steps`/`events` are not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, task.reload, steps.reload, events.reload]);

  if (task.status === "error") {
    if (isSignedOut(task.error)) return <SignInPrompt noun="this task" />;
    return (
      <div className="rounded-card border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
        {errorText(task.error)}
      </div>
    );
  }

  if (task.status === "loading") {
    return <p className="text-sm text-ink-subtle">Loading task…</p>;
  }

  const timeline =
    events.status === "ready" ? mergeEvents(events.value.events, streamed) : streamed;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link href="/" className="text-sm text-ink-muted hover:text-ink">
          ← All tasks
        </Link>

        <div className="flex flex-wrap items-center gap-3">
          <TaskStateBadge state={task.value.state} />
          <span
            role="status"
            className={`inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {STATUS_LABEL[status]}
          </span>
        </div>

        <h1 className="max-w-3xl text-2xl font-semibold tracking-tight">{task.value.goal}</h1>

        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-subtle">
          <div>
            <dt className="inline">Created </dt>
            <dd className="inline text-ink-muted">{formatWhen(task.value.createdAt)}</dd>
          </div>
          <div>
            <dt className="inline">Attempts </dt>
            <dd className="inline text-ink-muted">{task.value.attempts}</dd>
          </div>
          {task.value.resultSummary !== null && (
            <div className="w-full">
              <dt className="inline">Result </dt>
              <dd className="inline text-ink-muted">{task.value.resultSummary}</dd>
            </div>
          )}
          {task.value.errorCode !== null && (
            <div className="w-full">
              <dt className="inline">Error </dt>
              <dd className="inline font-mono text-danger">{task.value.errorCode}</dd>
            </div>
          )}
        </dl>
      </div>

      <section className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <header className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">Plan</h2>
        </header>
        {steps.status === "loading" && (
          <p className="px-4 py-3 text-sm text-ink-subtle">Loading steps…</p>
        )}
        {steps.status === "error" && (
          <p className="px-4 py-3 text-sm text-danger">{errorText(steps.error)}</p>
        )}
        {steps.status === "ready" && steps.value.steps.length === 0 && (
          <p className="px-4 py-3 text-sm text-ink-subtle">
            No plan yet — the worker has not produced one.
          </p>
        )}
        {steps.status === "ready" && steps.value.steps.length > 0 && (
          <ul className="divide-y divide-line">
            {steps.value.steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">Timeline</h2>
          <span className="text-xs text-ink-subtle">{timeline.length} events</span>
        </header>
        {events.status === "loading" && timeline.length === 0 && (
          <p className="px-4 py-3 text-sm text-ink-subtle">Loading events…</p>
        )}
        {events.status === "error" && (
          <p className="px-4 py-3 text-sm text-danger">{errorText(events.error)}</p>
        )}
        {timeline.length > 0 && (
          <ul className="divide-y divide-line">
            {timeline.map((event) => (
              <EventRow key={event.seq} event={event} />
            ))}
          </ul>
        )}
        {events.status === "ready" && timeline.length === 0 && (
          <p className="px-4 py-3 text-sm text-ink-subtle">Nothing has happened yet.</p>
        )}
      </section>
    </div>
  );
}
