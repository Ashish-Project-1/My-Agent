import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

/**
 * The local runner's runtime configuration (docs/planning/15 §6).
 *
 * Read once and validated, so a bad origin stops the process at startup rather
 * than on the first poll. Nothing here is a secret: the device's identity is a
 * keypair on disk, not a token in the environment.
 */

/** Reported to the API as `runnerVersion`; the browser shows it in the device list. */
export const RUNNER_VERSION = "0.1.0";

const ConfigSchema = z.object({
  apiOrigin: z.string().regex(/^https?:\/\/[^\s]+$/, "must be an http(s) origin"),
  dataDir: z.string().min(1),
  pollWaitSeconds: z.coerce.number().int().min(0).max(30),
});

export interface RunnerConfig {
  readonly apiOrigin: string;
  readonly dataDir: string;
  readonly pollWaitSeconds: number;
}

/**
 * Where the device keypair lives.
 *
 * Per-user and not per-checkout: the same machine is one device however many
 * copies of the runner are installed, and the key must never land in a repo.
 */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.LOCALAPPDATA ?? env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(base, "UniversalAgent");
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<RunnerConfig> = {},
): RunnerConfig {
  const parsed = ConfigSchema.safeParse({
    apiOrigin: overrides.apiOrigin ?? env.UA_API_ORIGIN ?? "http://127.0.0.1:3000",
    dataDir: overrides.dataDir ?? env.UA_DATA_DIR ?? defaultDataDir(env),
    pollWaitSeconds: overrides.pollWaitSeconds ?? env.UA_POLL_WAIT_SECONDS ?? 25,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`${issue?.path.join(".") ?? "config"}: ${issue?.message ?? "invalid"}`);
  }
  return parsed.data;
}
