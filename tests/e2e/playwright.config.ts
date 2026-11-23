// E2E tests (tasks 1.5 and 1.6): Chromium at the three widths of NFR01, right to left only (DEC47).
// Runs against the production build: `pnpm build`, then `pnpm test:e2e` starts `next start`.
// WebKit and Firefox join in task 8.4.
//
// Task 3.2 (item 10): the servers use the local Supabase stack (`pnpm db:e2e`, then
// `pnpm env:local`, as in CI), with the values `pnpm env:local` wrote to apps/web/.env.local:
//   PORT          confirmation off (DEC63), as the site runs now
//   CONFIRM_PORT  the same build with EMAIL_CONFIRMATION_REQUIRED=true, for the confirmation
//                 link page (signup-confirm.spec.ts). Supabase itself keeps confirmation off;
//                 generate_link gives the unconfirmed account and its link.
// Task 3.5: both run with TURNSTILE_STUB, the local stand-in for the Turnstile widget, so no test
// waits on Cloudflare in the browser (2 to 8 seconds per solve, task 3.4). The owner's local
// review uses the real widget.
// Task 4.1: a worker runs beside them (worker() below), for the uploads of upload.spec.ts.
// Task 4.0 (DEC82): Supabase Auth does not verify the token either. E2E runs against local
// Supabase started with `pnpm db:e2e` (in CI, SUPABASE_AUTH_CAPTCHA_ENABLED=false), and
// global-setup.ts refuses a stack that still verifies. The servers run with APP_ENV=test, the
// only value that lets them start so. DEC52 is tested against the real check in the
// integration tests (tests/integration/supabase-local.test.ts and the flow tests).
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
import { localWebEnv, localWorkerEnv } from "./local-env.ts";
import { CONFIRM_PORT, PORT } from "./ports.ts";

// Server secrets for this run (task 1.6): random, set once in the main process; the test workers
// inherit them, so tests can call /readyz with the probe token.
process.env.E2E_APP_SECRET ??= randomBytes(32).toString("base64url");
process.env.E2E_PROBE_TOKEN ??= randomBytes(32).toString("base64url");
// Task 4.0 (item D): each server's output, for no-js.spec.ts (serverLogFile in local-env.ts).
process.env.E2E_SERVER_LOG_DIR ??= mkdtempSync(join(tmpdir(), "souq-e2e-"));

const local = localWebEnv();

function serverEnv(port: number, confirmation: boolean): Record<string, string> {
  return {
    APP_ENV: "test",
    APP_ORIGIN: `http://localhost:${String(port)}`,
    NEXT_PUBLIC_SUPABASE_URL: local.NEXT_PUBLIC_SUPABASE_URL ?? "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: local.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
    EMAIL_CONFIRMATION_REQUIRED: String(confirmation),
    APP_SECRET: process.env.E2E_APP_SECRET ?? "",
    PROBE_TOKEN: process.env.E2E_PROBE_TOKEN ?? "",
    TRUSTED_PROXY_HOPS: "0",
    DATABASE_URL: local.DATABASE_URL ?? "",
    CONTACT_EMAIL: "contact@souqjamia1.test",
    // Task 4.1: signed Storage links (upload.spec.ts).
    SUPABASE_SECRET_KEY: local.SUPABASE_SECRET_KEY ?? "",
    TURNSTILE_STUB: "true",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

function server(port: number, confirmation: boolean) {
  return {
    // web-server.ts runs `next start` and copies its output to serverLogFile(port).
    command: `node tests/e2e/web-server.ts ${String(port)}`,
    cwd: "../..",
    url: `http://localhost:${String(port)}/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
    // Variables checked at start-up (OPS05). The public values were inlined by `pnpm build`.
    env: serverEnv(port, confirmation),
  };
}

// Task 4.1: one worker, as `pnpm dev:worker` runs it, so the uploads of /dev/upload are processed
// (upload.spec.ts). APP_ENV=test because Supabase Auth does not verify Turnstile here (DEC82).
// It also sends the email jobs that tests leave queued, to the local Mailpit only.
function worker() {
  return {
    command: "node apps/worker/src/main.ts",
    cwd: "../..",
    wait: { stdout: /worker.started/ },
    reuseExistingServer: false,
    timeout: 60_000,
    env: { ...localWorkerEnv(), APP_ENV: "test" },
  };
}

export default defineConfig({
  testDir: ".",
  globalSetup: "./global-setup.ts",
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
  webServer: [server(PORT, false), server(CONFIRM_PORT, true), worker()],
});
