// RL04 (task 4.3, DEC84): public search, 120 a minute per session and 1200 per client address.
// Counted before every public search read (API031, the /market page and the home page list) on
// a separate connection, because the read itself is STABLE and never writes (DEC70). The session
// is the member id, or the guest cookie when the visitor has one (it is set by /api/csrf, the first
// time a form needs it). The address is only known behind a trusted proxy (TRUSTED_PROXY_HOPS), so
// locally a visitor without the cookie has no limit; in production every request has an address.
// A refused request is counted too: the window is one minute, so it only ends that minute.
import { RL04_ADDRESS_PER_MINUTE, RL04_SESSION_PER_MINUTE } from "@souq/domain";
import type { AppDb } from "../db/app-client.ts";
import type { ServerEnv } from "../env.ts";
import { clientIp } from "../http/client-ip.ts";
import { resolveBinding } from "../http/csrf.ts";
import {
  countFailures,
  fingerprint,
  rateLimited,
  type AttemptLimit,
  type FailureLimit,
} from "../http/rate-limit.ts";

export const RL04_SESSION: FailureLimit = {
  scope: "RL04:session",
  limit: RL04_SESSION_PER_MINUTE,
  window: "1 minute",
};
export const RL04_ADDRESS: FailureLimit = {
  scope: "RL04:ip",
  limit: RL04_ADDRESS_PER_MINUTE,
  window: "1 minute",
};

type LimitEnv = Pick<ServerEnv, "APP_SECRET" | "TRUSTED_PROXY_HOPS">;

/** The RL04 counters of one request: the session (member or guest cookie) and the address. */
export function searchLimits(
  env: LimitEnv,
  headers: Headers,
  memberId: string | null,
): AttemptLimit[] {
  const limits: AttemptLimit[] = [];
  if (memberId !== null) {
    limits.push({ limit: RL04_SESSION, key: fingerprint(env.APP_SECRET, "member", memberId) });
  } else {
    const guest = resolveBinding(headers);
    if (guest !== null) {
      limits.push({ limit: RL04_SESSION, key: fingerprint(env.APP_SECRET, "guest", guest.id) });
    }
  }
  const address = clientIp(headers.get("x-forwarded-for"), env.TRUSTED_PROXY_HOPS);
  if (address !== null) {
    limits.push({ limit: RL04_ADDRESS, key: fingerprint(env.APP_SECRET, "ip", address) });
  }
  return limits;
}

/** Counts one search in each limit; RATE_LIMITED with Retry-After when one is over. */
export async function countSearch(
  db: AppDb,
  traceId: string,
  limits: readonly AttemptLimit[],
): Promise<void> {
  const wait = await countFailures(db, traceId, limits);
  if (wait > 0) throw rateLimited(wait);
}
