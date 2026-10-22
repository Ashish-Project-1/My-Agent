import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ua/database";
import { createLogger } from "@ua/logger";
import { Worker } from "bullmq";
import { MockCodingEngine } from "./coding-engine.js";
import { loadConfig } from "./config.js";
import { createOutboxPublisher } from "./outbox-publisher.js";
import { createTaskQueue, TASK_QUEUE } from "./queue.js";
import { createTaskPlanProcessor } from "./task-runner.js";

/** How long a task claim survives without a heartbeat (docs/planning/08 §5). */
const LEASE_TTL_MS = 60_000;
const OUTBOX_POLL_MS = 500;
const OUTBOX_BATCH_SIZE = 25;

/**
 * worker-code (docs/planning/03 §5.6): relays the outbox to the queue and runs
 * the trivial task worker.
 *
 * They share a process only because Phase 3 has one worker. Each half is its own
 * module with no knowledge of the other, so splitting them later is a move.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ service: "worker-code", level: config.logLevel });
  const database = createPrismaClient(config.databaseUrl);
  const queue = createTaskQueue(config.redisUrl);
  const owner = `worker-code:${process.pid}:${randomUUID().slice(0, 8)}`;

  const publisher = createOutboxPublisher({
    database,
    queue,
    logger,
    options: { pollMs: OUTBOX_POLL_MS, batchSize: OUTBOX_BATCH_SIZE },
  });
  const worker = new Worker(
    TASK_QUEUE,
    createTaskPlanProcessor({
      database,
      engine: new MockCodingEngine(),
      logger,
      owner,
      leaseTtlMs: LEASE_TTL_MS,
    }),
    // BullMQ blocks on Redis, so a per-request retry limit would abort every job
    // the moment the connection blips.
    { connection: { url: config.redisUrl, maxRetriesPerRequest: null } },
  );

  worker.on("completed", (job) => logger.info("job completed", { jobId: job.id }));
  worker.on("failed", (job, error) =>
    logger.error("job failed", { jobId: job?.id, error: String(error) }),
  );

  const shutdown = new AbortController();
  const stop = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info(`${signal} received, shutting down`);
    shutdown.abort();
    await worker.close();
    await queue.close();
    await database.$disconnect();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));

  await database.$connect();
  logger.info("worker-code started", { owner, queue: TASK_QUEUE });
  await publisher.run(shutdown.signal);
}

main().catch((error: unknown) => {
  // Bootstrap only: there is no logger until loadConfig succeeds.
  console.error(error);
  process.exitCode = 1;
});
