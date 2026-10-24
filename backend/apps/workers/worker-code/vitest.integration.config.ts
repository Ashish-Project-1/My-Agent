import { defineConfig } from "vitest/config";

// The Phase 3 durability gate (docs/planning/17 §179): a committed task survives
// a crash, and a replayed outbox row does not duplicate work. Needs a real
// PostgreSQL (DATABASE_URL) and a real Redis (REDIS_URL), with migrations
// applied. These share that database with the API's integration suite, so the
// root `test:integration` runs packages one at a time.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    fileParallelism: false,
    // The device loop waits on approval and command rows (500 ms poll), so a
    // test is seconds, not milliseconds.
    testTimeout: 15_000,
  },
});
