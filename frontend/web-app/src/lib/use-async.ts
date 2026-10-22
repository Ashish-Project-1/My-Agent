"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Loadable<T> =
  | { status: "loading" }
  /** The caught value, not a string: a page needs `ApiError.status` to tell a
   * signed-out browser from a broken one. */
  | { status: "error"; error: unknown }
  | { status: "ready"; value: T };

/**
 * Runs `load` on mount and again whenever `reload` is called.
 *
 * `load` is reached through a ref so a page can hand over an inline closure —
 * `() => getTask(taskId)` — without re-fetching on every render. A reload
 * resets to `loading` rather than keeping stale rows on screen: showing a task
 * that no longer exists is worse than briefly showing nothing.
 */
export function useAsync<T>(load: () => Promise<T>): Loadable<T> & { reload: () => void } {
  const loadRef = useRef(load);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Loadable<T>>({ status: "loading" });

  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let cancelled = false;
    // A reload keeps whatever is already on screen instead of blanking to
    // "Loading…": the stream triggers a reload on every gap and on completion,
    // which is the worst possible moment to hide the thing being watched.
    setResult((current) => (current.status === "ready" ? current : { status: "loading" }));

    loadRef
      .current()
      .then((value) => {
        if (!cancelled) setResult({ status: "ready", value });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setResult({ status: "error", error });
      });

    return () => {
      cancelled = true;
    };
    // `load` is intentionally not a dependency: it is read through the ref.
  }, [attempt]);

  const reload = useCallback(() => setAttempt((current) => current + 1), []);

  return { ...result, reload };
}
