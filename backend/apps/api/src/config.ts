import { z } from "zod";

/**
 * The API's runtime configuration (docs/planning/15 §6).
 *
 * Read once at boot, validated, then injected — so a malformed value stops the
 * process rather than failing the first request that happens to need it. Secrets
 * have no default: a default secret is worse than a missing one, because it
 * produces a running deployment with published credentials.
 *
 * Values are never echoed in the failure message, because a malformed
 * connection string contains a password.
 */

/** `z.coerce.boolean()` maps the string "false" to `true`, which is a trap. */
const booleanish = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((value) => value === true || value === "true" || value === "1");

/** OWASP's floor for Argon2id (docs/planning/11 §5), enforced in production below. */
export const ARGON2_MIN_MEMORY_KIB = 19_456;
export const ARGON2_MIN_TIME_COST = 2;

const ConfigSchema = z
  .object({
    nodeEnv: z.enum(["development", "test", "production"]).default("development"),
    host: z.string().min(1).default("127.0.0.1"),
    port: z.coerce.number().int().min(1).max(65_535).default(3000),
    /**
     * Behind a load balancer every request arrives from the proxy, so without
     * this the per-IP rate limit and `ip_hash` would describe the proxy instead
     * of the caller.
     */
    trustProxy: booleanish.default(false),
    databaseUrl: z
      .string()
      .regex(/^postgres(ql)?:\/\//, "must be a postgresql:// connection string"),
    /** HMAC key for the digests that stand in for an email, an IP or a CSRF token. */
    digestSecret: z.string().min(32, "must be at least 32 characters"),
    argon2MemoryKib: z.coerce.number().int().min(1024).default(65_536),
    argon2TimeCost: z.coerce.number().int().min(1).max(10).default(2),
    argon2Parallelism: z.coerce.number().int().min(1).max(4).default(1),
    sessionTtlMinutes: z.coerce.number().int().min(1).max(1440).default(60),
    refreshTtlDays: z.coerce.number().int().min(1).max(365).default(30),
    cookieSecure: booleanish.default(true),
    cookieDomain: z.string().min(1).optional(),
    authRateLimitMaxAttempts: z.coerce.number().int().min(1).max(1000).default(10),
    authRateLimitWindowMinutes: z.coerce.number().int().min(1).max(1440).default(15),
    logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .superRefine((config, ctx) => {
    if (config.nodeEnv !== "production") {
      return;
    }
    if (!config.cookieSecure) {
      ctx.addIssue({
        code: "custom",
        path: ["cookieSecure"],
        message: "must be true in production: a session cookie over plain http is exposed",
      });
    }
    if (
      config.argon2MemoryKib < ARGON2_MIN_MEMORY_KIB ||
      config.argon2TimeCost < ARGON2_MIN_TIME_COST
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["argon2MemoryKib"],
        message: `in production must be at least ${ARGON2_MIN_MEMORY_KIB} KiB with timeCost at least ${ARGON2_MIN_TIME_COST}`,
      });
    }
  });

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const parsed = ConfigSchema.safeParse({
    nodeEnv,
    host: env.HOST,
    port: env.PORT,
    trustProxy: env.TRUST_PROXY,
    databaseUrl: env.DATABASE_URL,
    digestSecret: env.AUTH_DIGEST_SECRET,
    argon2MemoryKib: env.ARGON2_MEMORY_KIB,
    argon2TimeCost: env.ARGON2_TIME_COST,
    argon2Parallelism: env.ARGON2_PARALLELISM,
    sessionTtlMinutes: env.AUTH_SESSION_TTL_MINUTES,
    refreshTtlDays: env.AUTH_REFRESH_TTL_DAYS,
    // A Secure cookie is not set over http://localhost, so the default follows
    // the environment; production has to opt in explicitly (checked above).
    cookieSecure: env.COOKIE_SECURE ?? (nodeEnv === "production" ? "true" : "false"),
    cookieDomain: env.COOKIE_DOMAIN,
    authRateLimitMaxAttempts: env.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
    authRateLimitWindowMinutes: env.AUTH_RATE_LIMIT_WINDOW_MINUTES,
    logLevel: env.LOG_LEVEL,
  });

  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "config"}: ${issue.message}`,
    );
    throw new Error(`invalid API configuration:\n  ${problems.join("\n  ")}`);
  }

  return parsed.data;
}
