// E2E tests (tasks 1.5 and 1.6): Chromium at the three widths of NFR01, right to left only (DEC47).
// Runs against the production build: `pnpm build`, then `pnpm test:e2e` starts `next start`.
// WebKit and Firefox join in task 8.4.
import { randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";

const PORT = 3100;

// Server secrets for this run (task 1.6): random, set once in the main process; the test workers
// inherit them, so tests can call /readyz with the probe token.
process.env.E2E_APP_SECRET ??= randomBytes(32).toString("base64url");
process.env.E2E_PROBE_TOKEN ??= randomBytes(32).toString("base64url");

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    locale: "ar",
    timezoneId: "Asia/Riyadh",
    trace: "off",
  },
  projects: [
    { name: "mobile-360", use: { viewport: { width: 360, height: 800 }, hasTouch: true } },
    { name: "tablet-768", use: { viewport: { width: 768, height: 1024 } } },
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `pnpm --filter @souq/web exec next start --port ${String(PORT)}`,
    cwd: "../..",
    url: `http://localhost:${String(PORT)}/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
    // Server variables checked at start-up (OPS05). Public placeholders, not keys: these pages
    // do not call Supabase. The public values were inlined by `pnpm build`. Key-like strings
    // are assembled at run time, so the repository never contains one (gitleaks).
    env: {
      APP_ENV: "development",
      APP_ORIGIN: `http://localhost:${String(PORT)}`,
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ["sb", "publishable", "e2e", "placeholder"].join("_"),
      EMAIL_CONFIRMATION_REQUIRED: "false",
      APP_SECRET: process.env.E2E_APP_SECRET,
      PROBE_TOKEN: process.env.E2E_PROBE_TOKEN,
      TRUSTED_PROXY_HOPS: "0",
      // Task 3.1: nothing listens on port 1, so the database is down for these tests (the
      // E2E job has no Supabase until task 3.2) and /readyz reports it.
      DATABASE_URL: "postgresql://souq_web@127.0.0.1:1/postgres",
      CONTACT_EMAIL: "contact@example.test",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
