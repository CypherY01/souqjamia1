// OPS05, Node.js runtime only: imported by instrumentation.ts when the server process starts.
// A missing or invalid variable stops the server with exit code 1. The log line names the
// variables, never their values (lib/env.ts).
import { captchaOffAllowed, captchaRefusal, probeAuthCaptcha } from "@souq/domain";
import { log } from "@souq/log";
import { loadServerEnv, type ServerEnv } from "./env.ts";

export function exitOnInvalidServerEnv(): ServerEnv {
  try {
    return loadServerEnv();
  } catch (error) {
    log.error("env.invalid", {
      message: error instanceof Error ? error.message : "Invalid environment configuration.",
    });
    process.exit(1);
  }
}

const CAPTCHA_HINTS = {
  off: {
    message:
      "Supabase Auth does not verify Turnstile tokens (DEC52). Only the E2E servers, with APP_ENV=test, may run so (DEC82).",
    local: "Run pnpm db:restart to turn the check back on.",
  },
  unknown: {
    message: "Could not confirm that Supabase Auth verifies Turnstile tokens (DEC52, DEC82).",
    local: "Is the local stack running? Run pnpm db:start.",
  },
} as const;

/**
 * Task 4.0 (DEC82, owner condition 1): the server refuses to run while Supabase Auth skips the
 * Turnstile check, unless APP_ENV=test. A hosted Supabase must always verify (ops/runbooks).
 */
export async function exitUnlessCaptchaVerified(env: ServerEnv): Promise<void> {
  // The E2E servers run against Supabase without the check on purpose: nothing to ask.
  if (captchaOffAllowed(env.APP_ENV)) return;
  const check = await probeAuthCaptcha({
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    fetch,
  });
  const refusal = captchaRefusal(env.APP_ENV, check);
  if (refusal === null) return;
  const hint = CAPTCHA_HINTS[refusal];
  log.error("env.captcha_unverified", {
    check,
    app_env: env.APP_ENV,
    message: hint.message,
    ...(env.APP_ENV === "development" ? { hint: hint.local } : {}),
  });
  process.exit(1);
}
