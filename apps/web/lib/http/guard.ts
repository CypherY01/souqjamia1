// SEC05 and TC64: the checks every state-changing request passes before any route code runs.
// Called by proxy.ts for every path, so Server Actions (POSTs to page paths) are covered too:
// without a token they are rejected, and this project uses /api route handlers instead.
// Phase 1 has no webhooks or Auth Hooks, so nothing is exempt.
import { CSRF_HEADER, resolveBinding, verifyCsrfToken } from "./csrf.ts";
import type { ErrorCode } from "./errors.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

/**
 * The exact Origin, and Fetch Metadata when the browser sends it. A missing Origin, "null",
 * another port or scheme, or a cross-site or same-site (another subdomain) request is rejected.
 */
export function checkRequestSource(headers: Headers, appOrigin: string): ErrorCode | null {
  if (headers.get("origin") !== appOrigin) return "ORIGIN_REJECTED";
  const site = headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return "ORIGIN_REJECTED";
  return null;
}

export interface GuardConfig {
  APP_ORIGIN: string;
  APP_SECRET: string;
}

/** null when the request may continue, otherwise the error code to answer with (403). */
export function guardRequest(
  method: string,
  headers: Headers,
  config: GuardConfig,
): ErrorCode | null {
  if (isSafeMethod(method)) return null;
  const source = checkRequestSource(headers, config.APP_ORIGIN);
  if (source !== null) return source;
  return verifyCsrfToken(config.APP_SECRET, resolveBinding(headers), headers.get(CSRF_HEADER))
    ? null
    : "CSRF_FAILED";
}
