import { defineConfig } from "vitest/config";

// The cross-tenant isolation suite (docs/planning/17 Phase 2 gate). It talks to a
// real PostgreSQL, so it needs DATABASE_URL and an applied migration; CI provides
// both in the `integration` job.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // The file rewrites rows in shared tables; running files in parallel would
    // race on the same organizations.
    fileParallelism: false,
  },
});
