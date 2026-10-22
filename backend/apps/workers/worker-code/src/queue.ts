import { Queue } from "bullmq";

/** One queue for the task pipeline; the job name is the contract from 07 §6. */
export const TASK_QUEUE = "ua.tasks";

/**
 * The BullMQ job id for an outbox row.
 *
 * Adding a job whose id already exists is ignored, so publishing the same row
 * twice — a crash between the add and the `processed_at` update, or two
 * publishers overlapping — cannot duplicate work. That is what makes the
 * Phase 3 "outbox replay is idempotent" gate hold (docs/planning/17 §179).
 *
 * `removeOnComplete`/`removeOnFailed` are deliberately left alone: a removed job
 * stops counting as existing, and the next replay would slip a duplicate in.
 *
 * The separator is a hyphen because BullMQ rejects `:` in a custom id — it is
 * the delimiter in the queue's own Redis keys.
 */
export function jobIdForOutboxRow(rowId: bigint): string {
  return `outbox-${rowId.toString()}`;
}

export function createTaskQueue(redisUrl: string): Queue {
  return new Queue(TASK_QUEUE, {
    // Fail while Redis is down rather than buffering commands: the outbox row is
    // then retried on the next poll, which is where the durability comes from.
    // Reconnection is capped so a poll returns quickly instead of parking the
    // publisher for ioredis's default backoff, which is seconds per attempt.
    connection: {
      url: redisUrl,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 50, 200)),
    },
  });
}
