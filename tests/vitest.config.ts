import { defineConfig } from "vitest/config";

// Unit tests run against packages/domain and packages/i18n.
// Integration tests (DB and RLS against local Supabase) start in task 2.1.
export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["unit/**/*.test.ts"] } },
      { test: { name: "integration", include: ["integration/**/*.test.ts"] } },
    ],
  },
});
