import { randomUUID } from "node:crypto";
import { createLogger } from "@ua/logger";
import { Worker } from "bullmq";
import { MaintenanceWorker } from "./maintenance-worker.js";

const MAINTENANCE_QUEUE = "maintenance.job";

function loadConfig() {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const logLevel = (process.env.LOG_LEVEL ?? "info") as "debug" | "info" | "warn" | "error";
  return { redisUrl, logLevel };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ service: "worker-maintenance", level: config.logLevel });
  const owner = `worker-maintenance:${process.pid}:${randomUUID().slice(0, 8)}`;
  const maintenance = new MaintenanceWorker();

  const worker = new Worker(
    MAINTENANCE_QUEUE,
    async (job) => {
      logger.info("maintenance job received", { jobId: job.id, name: job.name });
      const data = job.data as any;
      if (data?.type) {
        return await maintenance.run({ type: data.type });
      }
      return { ok: true, processed: 0 };
    },
    { connection: { url: config.redisUrl, maxRetriesPerRequest: null } },
  );

  worker.on("completed", (job) => logger.info("job completed", { jobId: job.id }));
  worker.on("failed", (job, error) =>
    logger.error("job failed", { jobId: job?.id, error: String(error) }),
  );

  const stop = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info(`${signal} received, shutting down`);
    await worker.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));

  logger.info("worker-maintenance started", { owner, queue: MAINTENANCE_QUEUE });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
