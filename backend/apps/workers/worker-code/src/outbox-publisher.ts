// Value import: this is the durable hand-off, and the payload contract is what
// the publisher validates at the produce end (docs/planning/07 §6).
import { TaskPlanJobPayload, Uuid } from "@ua/contracts";
import type { PrismaClient } from "@ua/database";
import type { Logger } from "@ua/logger";
import type { Queue } from "bullmq";
import { z } from "zod";
import { jobIdForOutboxRow } from "./queue.js";

/** The `task.created` payload the API writes inside the creation transaction. */
const TaskCreatedPayload = z.object({ taskId: Uuid, state: z.string().optional() });

/** What the publisher needs from an outbox row to build a job. */
interface RoutableRow {
  organization_id: string;
  attempts: number;
  payload: unknown;
}

interface Route {
  /** The queue job this event becomes (docs/planning/07 §6). */
  job: string;
  /** Builds the job payload from the outbox row, validating it at the produce end. */
  payload(row: RoutableRow): unknown;
}

/**
 * Outbox event type → queue job.
 *
 * A type with no entry is left alone rather than marked processed, so an event
 * this worker does not understand yet waits for the worker that does instead of
 * being silently dropped.
 */
const ROUTES: Record<string, Route> = {
  "task.created": {
    job: "task.plan",
    payload: (row) =>
      TaskPlanJobPayload.parse({
        organizationId: row.organization_id,
        taskId: TaskCreatedPayload.parse(row.payload).taskId,
        attempt: row.attempts,
        schemaVersion: 1,
      }),
  },
};

export interface OutboxPublisherOptions {
  /** How many rows one poll relays. */
  batchSize: number;
  /** How long to wait between polls. */
  pollMs: number;
}

export interface OutboxPublisherDeps {
  /**
   * The unscoped client: the outbox is infrastructure, and one poll relays rows
   * for every organization (docs/planning/08 §13).
   */
  database: PrismaClient;
  queue: Queue;
  logger: Logger;
  options: OutboxPublisherOptions;
}

export interface OutboxPublisherHandle {
  /** Relay one batch of pending rows. Returns how many reached the queue. */
  publishBatch(): Promise<number>;
  /** Poll until `signal` aborts. */
  run(signal: AbortSignal): Promise<void>;
}

/**
 * The outbox publisher (ADR-005, docs/planning/17 Phase 3).
 *
 * The API writes a row here inside the same transaction as the task, so work is
 * durable the moment the task exists. This is the only process that turns those
 * rows into queue jobs, which means a Redis restart costs a delay, never a task.
 */
export function createOutboxPublisher(deps: OutboxPublisherDeps): OutboxPublisherHandle {
  async function publishBatch(): Promise<number> {
    const rows = await deps.database.outbox.findMany({
      where: {
        processed_at: null,
        available_at: { lte: new Date() },
        event_type: { in: Object.keys(ROUTES) },
      },
      orderBy: { id: "asc" },
      take: deps.options.batchSize,
    });

    let published = 0;
    for (const row of rows) {
      const route = ROUTES[row.event_type];
      try {
        if (route === undefined) {
          // Unreachable: the query only asks for the types ROUTES knows.
          continue;
        }
        const jobId = jobIdForOutboxRow(row.id);
        await deps.queue.add(route.job, route.payload(row), { jobId });
        await deps.database.outbox.update({
          where: { id: row.id },
          data: { processed_at: new Date() },
        });
        published += 1;
      } catch (error) {
        // processed_at stays null, so the row is retried on the next poll. If
        // the crash was between the add and the update, the replay re-adds the
        // same job id and the queue drops it as a duplicate.
        await deps.database.outbox.update({
          where: { id: row.id },
          data: { attempts: { increment: 1 }, last_error: String(error).slice(0, 2000) },
        });
        deps.logger.error("outbox row could not be published", {
          outboxId: row.id.toString(),
          eventType: row.event_type,
          error: String(error),
        });
      }
    }
    return published;
  }

  async function run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await publishBatch();
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        const timer = setTimeout(finish, deps.options.pollMs);
        function finish(): void {
          clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          resolve();
        }
        signal.addEventListener("abort", finish, { once: true });
      });
    }
  }

  return { publishBatch, run };
}
