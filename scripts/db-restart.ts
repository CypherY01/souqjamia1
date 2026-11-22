// Task 4.0 (DEC82): restarts the local Supabase stack in one of its two modes. Data is kept.
//   pnpm db:restart   Supabase Auth verifies Turnstile tokens, as config.toml says (DEC52). The
//                     normal mode: pnpm dev, pnpm dev:worker, the integration tests, the owner's
//                     review. pnpm db:start starts this mode too.
//   pnpm db:e2e       Without that check, for E2E only (pnpm test:e2e). The web app and the
//                     worker refuse to start against it unless APP_ENV=test, and the integration
//                     tests refuse it too.
// config.toml is never edited: the Supabase CLI reads SUPABASE_AUTH_CAPTCHA_ENABLED at start.
import { spawnSync } from "node:child_process";
import { DB_DIR, localCaptchaCheck, readLocalStack, supabaseCli } from "./local-supabase.ts";

const e2e = process.argv.includes("--e2e");

function run(args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(process.execPath, [supabaseCli(), ...args], {
    cwd: DB_DIR,
    stdio: "inherit",
    env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const env: NodeJS.ProcessEnv = { ...process.env };
if (e2e) env.SUPABASE_AUTH_CAPTCHA_ENABLED = "false";
else delete env.SUPABASE_AUTH_CAPTCHA_ENABLED;

run(["stop"], process.env);
run(["start"], env);

const check = await localCaptchaCheck(readLocalStack());
const expected = e2e ? "off" : "on";
if (check !== expected) {
  console.error(`Supabase Auth's Turnstile check is ${check}, expected ${expected}.`);
  process.exit(1);
}
console.log(
  e2e
    ? "Local Supabase runs without the Turnstile check, for pnpm test:e2e only. Back to normal: pnpm db:restart."
    : "Local Supabase runs with the Turnstile check (DEC52).",
);
