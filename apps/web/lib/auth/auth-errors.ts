// What a failed Supabase Auth call means for the auth flows (task 3.2). The codes were checked
// on the local stack on 19 November 2026 (plan/task-3.2.md, "ما وجدته اليوم"). Only the class
// and the error code are ever logged, never the message (it can repeat the address).
import { log } from "@souq/log";
import { isAuthApiError, isAuthRetryableFetchError } from "@supabase/supabase-js";

export type AuthFailure =
  | "captcha_failed"
  | "user_already_exists"
  /** The 60-second cooldown of an existing account: reveals the account, never shown as such. */
  | "email_rate_limited"
  | "rate_limited"
  | "link_invalid"
  | "weak_password"
  | "email_invalid"
  | "unavailable"
  | "unexpected";

const BY_CODE: Readonly<Record<string, AuthFailure>> = {
  captcha_failed: "captcha_failed",
  user_already_exists: "user_already_exists",
  email_exists: "user_already_exists",
  over_email_send_rate_limit: "email_rate_limited",
  over_request_rate_limit: "rate_limited",
  otp_expired: "link_invalid",
  weak_password: "weak_password",
  email_address_invalid: "email_invalid",
};

/** Seconds a 429 from Supabase Auth asks to wait: it sends no Retry-After of its own. */
export const AUTH_RATE_LIMIT_RETRY_SECONDS = 60;

export function classifyAuthError(error: unknown): AuthFailure {
  // supabase-js reports every 5xx as retryable. A 500 is Supabase Auth's answer to a database
  // error, such as our signup trigger refusing the account: a defect, not an outage.
  if (isAuthRetryableFetchError(error)) return error.status === 500 ? "unexpected" : "unavailable";
  if (!isAuthApiError(error)) return "unexpected";
  const known = error.code === undefined ? undefined : BY_CODE[error.code];
  if (known !== undefined) return known;
  if (error.status === 429) return "rate_limited";
  return "unexpected";
}

/** One log line for a failed call: the flow, the error class and code, and the status. */
export function logAuthFailure(flow: string, traceId: string, error: unknown): void {
  const details = isAuthApiError(error)
    ? { reason: error.code ?? "none", status: error.status }
    : { reason: error instanceof Error ? error.name : typeof error };
  log.warn("auth.call_failed", { trace_id: traceId, flow, ...details });
}
