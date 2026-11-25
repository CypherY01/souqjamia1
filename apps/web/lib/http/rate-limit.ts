// Failure and attempt limits from the server (task 3.1, item 12, DEC70, SEC07).
// A failed login rolls its own transaction back, so its count must not live in it: the server
// counts on a separate connection, in a transaction of its own, after the attempt
// (app.rate_limit_hit), and checks before an attempt without counting (app.rate_limit_check).
// Success limits stay inside the business transaction (app.rate_limit_take, task 2.4).
//
// Counter keys are never stored in the clear: HMAC-SHA256 with the rate-limit key derived from
// APP_SECRET, 32 bytes as app.rate_limit_bucket requires. If the counter cannot be reached, the
// operation is refused with 503, never let through without a limit (SEC07).
// First real use: RL02 and RL03 in task 3.2 (countAttempt below); RL01 for logins in task 3.3
// (checkLimits before the call, countFailures after a wrong password).
import { createHmac } from "node:crypto";
import type { AppDb } from "../db/app-client.ts";
import { ApiError } from "./errors.ts";
import { deriveKey } from "./keys.ts";

/** "member" (task 4.3, RL04 and DEC84): a member's search counts by the member id. */
export type FingerprintKind = "ip" | "email" | "guest" | "member";

/** One limit of SEC07, e.g. { scope: "RL01:email", limit: 5, window: "15 minutes" }. */
export interface FailureLimit {
  /** The format of app.rate_limit_bucket.scope, with the spec id first. */
  scope: string;
  limit: number;
  /** A Postgres interval that divides a day (task 2.4). */
  window: string;
}

const SCOPE = /^[A-Za-z0-9:_.-]{1,64}$/;

/** Emails are compared as typed addresses: NFC, trimmed, lower case. */
function normalize(kind: FingerprintKind, value: string): string {
  return kind === "email" ? value.normalize("NFC").trim().toLowerCase() : value;
}

export function fingerprint(appSecret: string, kind: FingerprintKind, value: string): Buffer {
  return createHmac("sha256", deriveKey(appSecret, "rate-limit"))
    .update(`${kind}:${normalize(kind, value)}`)
    .digest();
}

function assertLimit(limit: FailureLimit): void {
  if (!SCOPE.test(limit.scope) || !Number.isInteger(limit.limit) || limit.limit < 1) {
    throw new Error(`invalid rate limit ${limit.scope}`);
  }
}

async function call(
  db: AppDb,
  traceId: string,
  fn: "app.rate_limit_check" | "app.rate_limit_hit",
  limit: FailureLimit,
  key: Buffer,
): Promise<number> {
  assertLimit(limit);
  const result = await db.query<{ retry_after: number }>(
    traceId,
    `select ${fn}($1, $2, $3, $4::interval) as retry_after`,
    [limit.scope, key, limit.limit, limit.window],
  );
  const retryAfter = result.rows[0]?.retry_after;
  // No answer from the counter is the same as no counter (SEC07).
  if (typeof retryAfter !== "number") {
    throw new ApiError("SERVICE_UNAVAILABLE", { retryAfter: 1 });
  }
  return retryAfter;
}

/** Before an attempt: 0 when below the limit, otherwise seconds until the window ends. */
export function rateLimitCheck(
  db: AppDb,
  traceId: string,
  limit: FailureLimit,
  key: Buffer,
): Promise<number> {
  return call(db, traceId, "app.rate_limit_check", limit, key);
}

/** After a failed attempt: counts it, then as rateLimitCheck. Kept when the attempt rolled back. */
export function rateLimitHit(
  db: AppDb,
  traceId: string,
  limit: FailureLimit,
  key: Buffer,
): Promise<number> {
  return call(db, traceId, "app.rate_limit_hit", limit, key);
}

/** 429 with Retry-After, the contract's answer to an exhausted limit. */
export function rateLimited(retryAfter: number): ApiError {
  return new ApiError("RATE_LIMITED", { retryAfter: Math.max(1, Math.ceil(retryAfter)) });
}

export interface AttemptLimit {
  limit: FailureLimit;
  key: Buffer;
}

/**
 * Attempt limits counted before the call they protect (task 3.2: RL02 for signup, DEC74, and RL03
 * for confirmation emails): every limit is checked first without counting, so a refused request
 * uses up nothing; then the attempt is counted in each, kept even when the call fails (DEC70).
 * Two requests that both passed the check are settled by the count itself: the one over the
 * limit is refused. Throws RATE_LIMITED with the longest wait, or SERVICE_UNAVAILABLE.
 */
export async function countAttempt(
  db: AppDb,
  traceId: string,
  limits: readonly AttemptLimit[],
): Promise<void> {
  await checkLimits(db, traceId, limits);
  const wait = await countFailures(db, traceId, limits);
  if (wait > 0) throw rateLimited(wait);
}

/** Before an attempt, without counting: RATE_LIMITED with the longest wait, if any is spent. */
export async function checkLimits(
  db: AppDb,
  traceId: string,
  limits: readonly AttemptLimit[],
): Promise<void> {
  let wait = 0;
  for (const { limit, key } of limits) {
    wait = Math.max(wait, await rateLimitCheck(db, traceId, limit, key));
  }
  if (wait > 0) throw rateLimited(wait);
}

/**
 * Counts one attempt (or failure) in each limit, kept whatever happens next (DEC70). Returns
 * the longest wait when the count went over a limit, otherwise 0.
 */
export async function countFailures(
  db: AppDb,
  traceId: string,
  limits: readonly AttemptLimit[],
): Promise<number> {
  let wait = 0;
  for (const { limit, key } of limits) {
    wait = Math.max(wait, await rateLimitHit(db, traceId, limit, key));
  }
  return wait;
}
