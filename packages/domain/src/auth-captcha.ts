// DEC52, DEC82 (task 4.0): Supabase Auth verifies the Turnstile token of every signup and
// sign-in. Only E2E runs against a local Supabase without that check, with APP_ENV=test; the web
// app and the worker ask Supabase Auth at start-up and refuse to run otherwise.
//
// The probe is a password sign-in for an account that does not exist, sent without a captcha
// token. With verification on, Supabase Auth refuses it before anything else (captcha_failed)
// and never calls Cloudflare, so the answer is quick on any network. With verification off, it
// looks the account up and answers invalid_credentials. Nothing is created or changed.
// The caller passes fetch: this module does no I/O of its own.

/** "on": tokens are verified. "off": they are not. "unknown": no clear answer. */
export type CaptchaCheck = "on" | "off" | "unknown";

/** A reserved .test address: never a real account or mailbox. */
export const CAPTCHA_PROBE_EMAIL = "turnstile-probe@souqjamia1.test";

/** DEC82: only the E2E servers (APP_ENV=test) may run while Supabase Auth skips the check. */
export function captchaOffAllowed(appEnv: string): boolean {
  return appEnv === "test";
}

function errorCode(body: unknown): unknown {
  if (typeof body !== "object" || body === null || !("error_code" in body)) return undefined;
  return body.error_code;
}

/** Reads Supabase Auth's answer to the probe. Anything unexpected is "unknown", never "on". */
export function classifyCaptchaProbe(status: number, body: unknown): CaptchaCheck {
  if (status !== 400) return "unknown";
  const code = errorCode(body);
  if (code === "captcha_failed") return "on";
  if (code === "invalid_credentials") return "off";
  return "unknown";
}

export interface CaptchaProbeOptions {
  readonly supabaseUrl: string;
  readonly publishableKey: string;
  readonly fetch: typeof fetch;
  /** Tries before "unknown" is final (Supabase Auth restarting, for example). Default 3. */
  readonly attempts?: number;
  /** Per try. Default 5 seconds. */
  readonly attemptMs?: number;
  /** Between tries. Default 1 second. */
  readonly pauseMs?: number;
}

async function probeOnce(options: CaptchaProbeOptions, attemptMs: number): Promise<CaptchaCheck> {
  try {
    const response = await options.fetch(
      `${options.supabaseUrl.replace(/\/+$/, "")}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: { apikey: options.publishableKey, "content-type": "application/json" },
        // A new random password each time: there is no account to match it anyway.
        body: JSON.stringify({ email: CAPTCHA_PROBE_EMAIL, password: crypto.randomUUID() }),
        signal: AbortSignal.timeout(attemptMs),
      },
    );
    const body: unknown = await response.json().catch(() => null);
    return classifyCaptchaProbe(response.status, body);
  } catch {
    return "unknown";
  }
}

/** Asks Supabase Auth whether it verifies Turnstile tokens (see the top of this file). */
export async function probeAuthCaptcha(options: CaptchaProbeOptions): Promise<CaptchaCheck> {
  const attempts = options.attempts ?? 3;
  const attemptMs = options.attemptMs ?? 5_000;
  const pauseMs = options.pauseMs ?? 1_000;
  for (let attempt = 1; ; attempt++) {
    const result = await probeOnce(options, attemptMs);
    if (result !== "unknown" || attempt >= attempts) return result;
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
}

/** Why a process may not run, or null when it may (DEC82). */
export function captchaRefusal(appEnv: string, check: CaptchaCheck): "off" | "unknown" | null {
  if (captchaOffAllowed(appEnv) || check === "on") return null;
  return check;
}
