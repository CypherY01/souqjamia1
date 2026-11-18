import { defineConfig } from "vitest/config";

// Unit tests need nothing running. Integration tests need the local Supabase stack
// (`pnpm db:start` and applied migrations); both run in CI from task 2.1.
export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["unit/**/*.test.ts"] } },
      {
        test: {
          name: "integration",
          include: ["integration/**/*.test.ts"],
          // Checks the stack and migrations, installs the test clock (task 2.1).
          globalSetup: ["integration/_harness/global-setup.ts"],
          testTimeout: 30_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
