import { randomUUID } from "node:crypto";
import { createLogger } from "@ua/logger";
import { Worker } from "bullmq";

const BROWSER_QUEUE = "browser.task";

function loadConfig() {
  const databaseUrl = process.env.DATABASE_URL ?? "postgresql://localhost:5432/ua";
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const logLevel = (process.env.LOG_LEVEL ?? "info") as "debug" | "info" | "warn" | "error";
  return { databaseUrl, redisUrl, logLevel };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ service: "worker-browser", level: config.logLevel });
  const owner = `worker-browser:${process.pid}:${randomUUID().slice(0, 8)}`;

  const worker = new Worker(
    BROWSER_QUEUE,
    async (job) => {
      logger.info("browser task received", { jobId: job.id, name: job.name });
      // Isolated context per task, no shared cookies; domain allow/deny enforced
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

  logger.info("worker-browser started", { owner, queue: BROWSER_QUEUE });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
