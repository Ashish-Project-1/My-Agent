"use client";

import { GOAL_MAX_LENGTH } from "@ua/contracts";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ApiError, createTask } from "@/lib/api";

/**
 * `POST /v1/tasks` (FR-TASK-01).
 *
 * The idempotency key is minted once per goal rather than per click, so a double
 * submit or a retry after a network error replays the same key and the API
 * returns the original task instead of a second one (FR-TASK-10). Editing the
 * goal mints a new key, because the API answers 409 for the same key carrying a
 * different body — and a lost response followed by one typo must not leave the
 * form unable to submit at all.
 */
export default function NewTaskPage() {
  const router = useRouter();
  const [goal, setGoal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  const canSubmit = goal.trim().length > 0 && goal.length <= GOAL_MAX_LENGTH && !submitting;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;

    idempotencyKey.current ??= crypto.randomUUID();
    setSubmitting(true);
    setError(null);

    try {
      const task = await createTask({ goal: goal.trim() }, idempotencyKey.current);
      router.push(`/tasks/${task.id}`);
    } catch (cause) {
      // The key survives a failed submit so pressing "Create task" again cannot
      // create a duplicate task; editing the goal or leaving the page discards it.
      setSubmitting(false);
      setError(cause instanceof ApiError ? cause.title : "Could not reach the server.");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New task</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Describe the outcome you want. The agent plans the steps and asks before anything
          irreversible.
        </p>
      </div>

      <form
        onSubmit={submit}
        className="space-y-4 rounded-card border border-line bg-surface p-6 shadow-card"
      >
        <div className="space-y-2">
          <label htmlFor="goal" className="block text-sm font-medium">
            Goal
          </label>
          <textarea
            id="goal"
            name="goal"
            value={goal}
            onChange={(event) => {
              setGoal(event.target.value);
              idempotencyKey.current = null;
            }}
            rows={6}
            required
            maxLength={GOAL_MAX_LENGTH}
            placeholder="e.g. Rename every image in the project folder to include its capture date."
            className="w-full resize-y rounded-control border border-line bg-canvas px-3 py-2 text-sm shadow-none placeholder:text-ink-subtle focus:bg-surface"
          />
          <div className="flex items-center justify-between text-xs text-ink-subtle">
            <span role="alert" className="text-danger">
              {error ?? ""}
            </span>
            <span>
              {goal.length}/{GOAL_MAX_LENGTH}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-control bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors duration-hover ease-standard hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create task"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="rounded-control px-4 py-2 text-sm font-medium text-ink-muted transition-colors duration-hover ease-standard hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
