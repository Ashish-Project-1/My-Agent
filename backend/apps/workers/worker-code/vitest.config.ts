import { defineConfig } from "vitest/config";

// `pnpm test` stays database- and Redis-free: only the pure parts of the worker
// (the mock engine, payload shaping) run on every CI leg. The durability suite
// needs PostgreSQL and Redis and lives under `test/integration`.
export default defineConfig({
  test: {
    include: ["test/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
