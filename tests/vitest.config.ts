import { defineConfig } from "vitest/config";

// Unit tests need nothing running and run in CI.
// Integration tests need the local Supabase stack (`pnpm db:start`); they join CI in task 2.1.
export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["unit/**/*.test.ts"] } },
      {
        test: {
          name: "integration",
          include: ["integration/**/*.test.ts"],
          testTimeout: 30_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
