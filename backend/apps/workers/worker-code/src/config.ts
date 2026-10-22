import { z } from "zod";

/**
 * worker-code's runtime configuration (docs/planning/15 §6).
 *
 * Read once at boot and validated, so a malformed connection string stops the
 * process rather than the first outbox poll. Neither value is echoed in a
 * failure message: both can carry credentials.
 */
const ConfigSchema = z.object({
  databaseUrl: z.string().regex(/^postgres(ql)?:\/\//, "must be a postgresql:// connection string"),
  redisUrl: z.string().regex(/^rediss?:\/\//, "must be a redis:// or rediss:// connection string"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type WorkerConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = ConfigSchema.safeParse({
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    logLevel: env.LOG_LEVEL,
  });
  if (!parsed.success) {
    throw new Error(
      `invalid worker-code configuration: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}
