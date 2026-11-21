// E2E tests (tasks 1.5 and 1.6): Chromium at the three widths of NFR01, right to left only (DEC47).
// Runs against the production build: `pnpm build`, then `pnpm test:e2e` starts `next start`.
// WebKit and Firefox join in task 8.4.
//
// Task 3.2 (item 10): the servers use the local Supabase stack (`pnpm db:start`, then
// `pnpm env:local`, as in CI), with the values `pnpm env:local` wrote to apps/web/.env.local:
//   PORT          confirmation off (DEC63), as the site runs now
//   CONFIRM_PORT  the same build with EMAIL_CONFIRMATION_REQUIRED=true, for the confirmation
//                 link page (signup-confirm.spec.ts). Supabase itself keeps confirmation off;
//                 generate_link gives the unconfirmed account and its link.
// Task 3.5: both run with TURNSTILE_STUB, the local stand-in for the Turnstile widget, so no test
// waits on Cloudflare in the browser (2 to 8 seconds per solve, task 3.4). Supabase Auth still
// verifies the test token at Cloudflare, and tests/integration/supabase-local.test.ts checks
// that verification. The owner's local review uses the real widget.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { CONFIRM_PORT, PORT } from "./ports.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** apps/web/.env.local as `pnpm env:local` wrote it: the local stack's values. */
function localWebEnv(): Record<string, string> {
  const file = join(REPO_ROOT, "apps", "web", ".env.local");
  if (!existsSync(file)) {
    throw new Error("E2E needs the local Supabase stack: run pnpm db:start, then pnpm env:local.");
  }
  const values: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) values[match[1]] = match[2];
  }
  return values;
}

// Server secrets for this run (task 1.6): random, set once in the main process; the test workers
// inherit them, so tests can call /readyz with the probe token.
process.env.E2E_APP_SECRET ??= randomBytes(32).toString("base64url");
process.env.E2E_PROBE_TOKEN ??= randomBytes(32).toString("base64url");

const local = localWebEnv();

function serverEnv(port: number, confirmation: boolean): Record<string, string> {
  return {
    APP_ENV: "development",
    APP_ORIGIN: `http://localhost:${String(port)}`,
    NEXT_PUBLIC_SUPABASE_URL: local.NEXT_PUBLIC_SUPABASE_URL ?? "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: local.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
    EMAIL_CONFIRMATION_REQUIRED: String(confirmation),
    APP_SECRET: process.env.E2E_APP_SECRET ?? "",
    PROBE_TOKEN: process.env.E2E_PROBE_TOKEN ?? "",
    TRUSTED_PROXY_HOPS: "0",
    DATABASE_URL: local.DATABASE_URL ?? "",
    CONTACT_EMAIL: "contact@example.test",
    TURNSTILE_STUB: "true",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

function server(port: number, confirmation: boolean) {
  return {
    command: `pnpm --filter @souq/web exec next start --port ${String(port)}`,
    cwd: "../..",
    url: `http://localhost:${String(port)}/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
    // Variables checked at start-up (OPS05). The public values were inlined by `pnpm build`.
    env: serverEnv(port, confirmation),
  };
}

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
  webServer: [server(PORT, false), server(CONFIRM_PORT, true)],
});
