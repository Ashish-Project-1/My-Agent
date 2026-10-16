import { defineConfig } from "vitest/config";

// The API's half of the Phase 2 exit criterion: a revoked session is rejected on
// the next request, refresh reuse revokes the family, and a second organization's
// rows are unreachable through every implemented route. It needs a real
// PostgreSQL, so it needs DATABASE_URL and an applied migration.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // The files create identities in shared tables; running them in parallel
    // would race on the same login_attempts window and organization slugs.
    fileParallelism: false,
  },
});
