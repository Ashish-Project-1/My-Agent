import type { TaskEventRow } from "./tasks.repository.js";

/** How often the stream re-reads `task_events` for new rows. */
export const SSE_POLL_MS = 1000;

/** Comment frame to defeat proxy idle timeouts (docs/planning/07 §5, 15 s). */
export const SSE_HEARTBEAT_MS = 15_000;

/** Streams are closed after this long and the client reconnects (docs/planning/07 §5). */
export const SSE_MAX_LIFETIME_MS = 60 * 60 * 1000;

/**
 * The sequence to resume after, from the `Last-Event-ID` header.
 *
 * The id is `{taskId}:{seq}` (docs/planning/07 §5). A missing, malformed or
 * other-task id resumes from 0 — replaying the whole log is always safe because
 * the client is told to refetch state on any gap (`07` §5 "State beats stream").
 */
export function parseLastEventId(lastEventId: string | undefined, taskId: string): number {
  if (lastEventId === undefined) return 0;
  const [id, seqText] = lastEventId.split(":");
  if (id !== taskId || seqText === undefined) return 0;
  const seq = Number.parseInt(seqText, 10);
  return Number.isInteger(seq) && seq >= 0 ? seq : 0;
}

/** One event frame: `id` enables resume, `event` is the task-event type. */
export function sseEvent(event: TaskEventRow, taskId: string): string {
  const data = JSON.stringify({
    seq: event.seq,
    type: event.type,
    actor: event.actor,
    data: event.data,
    createdAt: event.createdAt,
  });
  return `id: ${taskId}:${event.seq}\nevent: ${event.type}\ndata: ${data}\n\n`;
}

/** A comment frame; the client ignores it (docs/planning/07 §5 heartbeat). */
export function sseHeartbeat(): string {
  return ":hb\n\n";
}

/** Tells the client its stream is unusable and it should refetch task state (`07` §5). */
export function sseResync(): string {
  return "event: resync\n\n";
}

/** Final frame before the connection closes on a terminal state (`07` §5). */
export function sseDone(state: string): string {
  return `event: done\ndata: ${JSON.stringify({ state })}\n\n`;
}
