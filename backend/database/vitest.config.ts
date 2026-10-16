import { defineConfig } from "vitest/config";

// `pnpm test` stays database-free so it runs on every CI leg and on a developer
// machine with nothing running. The cross-tenant isolation suite needs a live
// PostgreSQL and runs under `pnpm test:integration` instead
// (vitest.integration.config.ts).
export default defineConfig({
  test: {
    include: ["test/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
