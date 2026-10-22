import type { TaskEventSummary } from "@ua/contracts";

/** One parsed Server-Sent Events frame. */
export interface SseFrame {
  /** The `id:` field; the last one seen is what a reconnect resumes from. */
  id?: string;
  /** Event name, or `message` when the frame omits one. */
  event: string;
  /** Everything after `data:` lines, rejoined with newlines. */
  data: string;
}

/**
 * Splits a byte stream into frames.
 *
 * A frame ends at a blank line and a network chunk can fall anywhere inside
 * one, so the incomplete tail is buffered until the rest arrives. Comment
 * frames (`: hb`) carry no data and are dropped before a caller sees them.
 *
 * Pure by construction: it only appends strings and calls back, so it is tested
 * without a browser (test/sse.test.ts).
 */
export function createFrameParser(onFrame: (frame: SseFrame) => void): (chunk: string) => void {
  let buffer = "";

  return (chunk: string): void => {
    buffer += chunk;

    let end = buffer.indexOf("\n\n");
    while (end !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const frame = parseBlock(block);
      if (frame !== null) onFrame(frame);
      end = buffer.indexOf("\n\n");
    }
  };
}

function parseBlock(block: string): SseFrame | null {
  let id: string | undefined;
  let event = "message";
  let named = false;
  const data: string[] = [];

  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    // Exactly one space after the colon is a separator, not content.
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "id") id = value;
    else if (field === "event") {
      event = value;
      named = true;
    } else if (field === "data") data.push(value);
  }

  // Drop a block with neither data nor a name: that is a heartbeat comment, not
  // a frame. `event: resync` is a name and no data, and must survive — it is the
  // signal that makes the page refetch (docs/planning/07 §5).
  if (!named && data.length === 0) return null;
  const joined = data.join("\n");
  return id === undefined ? { event, data: joined } : { id, event, data: joined };
}

/** Parses the JSON payload of a task event, discarding anything malformed. */
function parseEvent(data: string): TaskEventSummary | null {
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as Partial<TaskEventSummary>;
    if (typeof candidate.seq !== "number" || typeof candidate.type !== "string") return null;
    return parsed as TaskEventSummary;
  } catch {
    return null;
  }
}

function parseDone(data: string): string | null {
  try {
    const parsed: unknown = JSON.parse(data);
    const state =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { state?: unknown }).state
        : undefined;
    return typeof state === "string" ? state : null;
  } catch {
    return null;
  }
}

export type StreamStatus =
  /** Opening the connection for the first time. */
  | "connecting"
  /** Frames are arriving. */
  | "live"
  /** The connection dropped; a retry is scheduled. */
  | "retrying"
  /** Nothing more will ever arrive: the task is terminal, the task is not ours
   * to read, or the session is gone. */
  | "ended";

export interface TaskStreamHandlers {
  /** A task event arrived; merge it into the timeline. */
  onEvent: (event: TaskEventSummary) => void;
  /** The API says the stream has a gap and state must be refetched
   * (docs/planning/07 §5 "State beats stream"). */
  onResync: () => void;
  /** The task reached a terminal state and the server closed the stream. */
  onDone: (state: string) => void;
  /** The session expired mid-stream. The page should refetch so its own 401
   * handling takes over — the timeline will never move again. */
  onSignedOut?: () => void;
  onStatus?: (status: StreamStatus) => void;
}

/** Reconnect delay. The server polls every second, so waiting less than that
 * would hammer a stream that has nothing new to say.
 * shortcut: fixed 1 s with no backoff, so a tab left open retries a dead API at
 * 1 Hz — add jittered backoff when more than a few open tabs start to matter. */
const RETRY_DELAY_MS = 1000;

/** The server heartbeats every 15 s (`sse-frames.ts`), so three missed beats
 * means the socket is open but dead rather than merely quiet. */
const IDLE_TIMEOUT_MS = 45_000;

/**
 * Follows `GET /v1/tasks/{id}/stream` until the caller stops it or the task
 * finishes, reconnecting after a drop and resuming from the last id the server
 * gave us.
 *
 * Returns the stop function; call it from the effect cleanup that owns it, or
 * the connection outlives the page.
 */
export function followTaskEvents(taskId: string, handlers: TaskStreamHandlers): () => void {
  const controller = new AbortController();
  let lastEventId: string | undefined;
  let finished = false;

  const readOnce = async (): Promise<void> => {
    handlers.onStatus?.("connecting");
    const response = await fetch(`/v1/tasks/${taskId}/stream`, {
      headers: lastEventId === undefined ? {} : { "last-event-id": lastEventId },
      signal: controller.signal,
    });

    // Every 4xx is permanent: a signed-out session, a foreign task, a malformed
    // id. Retrying once a second changes none of them, and a stream that has
    // stopped for a reason must not keep claiming to be live.
    if (response.status === 401) {
      finished = true;
      handlers.onSignedOut?.();
      return;
    }
    if (response.status >= 400 && response.status < 500) {
      finished = true;
      return;
    }
    if (!response.ok || response.body === null)
      throw new Error(`stream failed: ${response.status}`);

    handlers.onStatus?.("live");
    const parse = createFrameParser((frame) => {
      if (frame.id !== undefined) lastEventId = frame.id;
      if (frame.event === "resync") {
        handlers.onResync();
        return;
      }
      if (frame.event === "done") {
        finished = true;
        const state = parseDone(frame.data);
        handlers.onDone(state ?? "UNKNOWN");
        return;
      }
      const event = parseEvent(frame.data);
      if (event !== null) handlers.onEvent(event);
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      // A socket can stay open and stop delivering bytes; without a watchdog the
      // pill would read "Live" forever while the timeline quietly froze.
      let starved = false;
      const watchdog = setTimeout(() => {
        starved = true;
        void reader.cancel();
      }, IDLE_TIMEOUT_MS);
      const { done, value } = await reader.read();
      clearTimeout(watchdog);
      if (starved) throw new Error("stream went idle");
      if (done) break;
      parse(decoder.decode(value, { stream: true }));
    }
  };

  void (async () => {
    while (!controller.signal.aborted && !finished) {
      try {
        await readOnce();
      } catch {
        if (controller.signal.aborted) return;
      }
      if (finished || controller.signal.aborted) break;
      handlers.onStatus?.("retrying");
      await sleep(RETRY_DELAY_MS, controller.signal);
    }
    // `ended` describes the connection, not the cleanup: announcing it after the
    // caller aborted would flash "Up to date" for a stream that never opened
    // (taskId change, StrictMode remount).
    if (finished) handlers.onStatus?.("ended");
  })();

  return () => controller.abort();
}

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Folds a freshly streamed event into what the initial fetch already produced.
 *
 * Events are addressed by `seq`, which is unique and ordered per task, so a
 * replay after a reconnect can only ever overwrite the row already on screen —
 * never duplicate it.
 */
export function mergeEvents(
  fetched: readonly TaskEventSummary[],
  streamed: readonly TaskEventSummary[],
): TaskEventSummary[] {
  const bySeq = new Map<number, TaskEventSummary>();
  for (const event of [...fetched, ...streamed]) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
}
