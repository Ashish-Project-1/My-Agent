import { Injectable } from "@nestjs/common";
import { isTerminalTaskState } from "@ua/contracts";
import { delay } from "./sse.util.js";
import {
  parseLastEventId,
  SSE_HEARTBEAT_MS,
  SSE_MAX_LIFETIME_MS,
  SSE_POLL_MS,
  sseDone,
  sseEvent,
  sseHeartbeat,
  sseResync,
} from "./sse-frames.js";
import { TasksRepository } from "./tasks.repository.js";

export interface StreamOptions {
  organizationId: string;
  taskId: string;
  lastEventId: string | undefined;
  signal: AbortSignal;
}

/**
 * The task-event stream (docs/planning/07 §5).
 *
 * It replays `task_events` after the client's `Last-Event-ID`, then follows the
 * log live until the task reaches a terminal state, at which point it emits
 * `event: done` and stops. Heartbeats are comment frames every 15 s.
 *
 * shortcut: liveness is DB polling at `SSE_POLL_MS`, not the Redis pub/sub
 * fan-out in `07` §5 — correct for one API replica and no separate publisher
 * yet; swap the `listTaskEventsAfter` loop for a subscription when the outbox
 * publisher lands.
 */
@Injectable()
export class TaskEventsStreamService {
  constructor(private readonly repository: TasksRepository) {}

  async *stream(options: StreamOptions): AsyncGenerator<string> {
    const { organizationId, taskId, lastEventId, signal } = options;

    if ((await this.repository.getTask(organizationId, taskId)) === null) {
      yield sseResync();
      return;
    }

    let lastSeq = parseLastEventId(lastEventId, taskId);
    const startedAt = Date.now();
    let lastHeartbeatAt = startedAt;

    while (!signal.aborted) {
      const events = await this.repository.listTaskEventsAfter(organizationId, taskId, lastSeq);
      for (const event of events) {
        lastSeq = event.seq;
        yield sseEvent(event, taskId);
      }

      // Re-read the task after the events: the state at a given seq is what
      // decides whether the log is finished.
      const task = await this.repository.getTask(organizationId, taskId);
      if (task === null) {
        yield sseResync();
        return;
      }
      if (isTerminalTaskState(task.state)) {
        yield sseDone(task.state);
        return;
      }

      const now = Date.now();
      if (now - startedAt >= SSE_MAX_LIFETIME_MS) {
        return;
      }
      if (now - lastHeartbeatAt >= SSE_HEARTBEAT_MS) {
        lastHeartbeatAt = now;
        yield sseHeartbeat();
      }
      await delay(SSE_POLL_MS, signal);
    }
  }
}
