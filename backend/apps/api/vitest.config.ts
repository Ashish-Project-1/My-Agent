import { defineConfig } from "vitest/config";

// `pnpm test` stays database-free (docs/planning/17 Phase 2): everything here
// runs on every CI leg with nothing else installed. Request-level tests that
// need PostgreSQL live under `test/integration` and run via
// vitest.integration.config.ts.
export default defineConfig({
  test: {
    include: ["test/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
