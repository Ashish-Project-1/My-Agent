import { randomUUID } from "node:crypto";
import { createLogger } from "@ua/logger";
import { Worker } from "bullmq";
import { DocumentWorker } from "./document-worker.js";

const DOCUMENT_QUEUE = "document.ingest";

function loadConfig() {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const logLevel = (process.env.LOG_LEVEL ?? "info") as "debug" | "info" | "warn" | "error";
  return { redisUrl, logLevel };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ service: "worker-document", level: config.logLevel });
  const owner = `worker-document:${process.pid}:${randomUUID().slice(0, 8)}`;
  const documentWorker = new DocumentWorker();

  const worker = new Worker(
    DOCUMENT_QUEUE,
    async (job) => {
      logger.info("document ingest received", { jobId: job.id, name: job.name });
      const data = job.data as any;
      if (data?.filename && data?.content) {
        const result = await documentWorker.ingest({
          filename: data.filename,
          content: Buffer.from(data.content, data.encoding || "utf8"),
          mimeType: data.mimeType,
        });
        return result;
      }
      return { ok: true };
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

  logger.info("worker-document started", { owner, queue: DOCUMENT_QUEUE });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
