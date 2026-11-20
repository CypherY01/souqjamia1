// Attempt limits of the auth flows (SEC07), counted by our server before it calls Supabase Auth
// (lib/http/rate-limit.ts, countAttempt). Supabase Auth's own limits stay as a further layer.
//   RL02 (DEC74)  signup: 5 per hour per guest (the guest cookie), and per client address
//                 SIGNUP_IP_LIMIT_PER_HOUR (300 unless set). The address is only known behind a
//                 trusted proxy (TRUSTED_PROXY_HOPS), so locally only the guest limit applies.
//   RL03          confirmation emails per address: one a minute (the 60-second cooldown), 3 an
//                 hour and 10 a day. Recovery (task 3.4) and email change (task 3.6) share it.
//   RL01 (3.3)    failed logins: 5 per email in 15 minutes, registered or not (no enumeration),
//                 and 200 per client address. Checked before the call and counted after a wrong
//                 password only (lib/auth/login.ts). Fixed 15-minute windows (owner decision on
//                 item 5): the wait is the rest of the window, a refused attempt is not counted,
//                 so there is no permanent lock. The address limit counts failures only, so it
//                 stays the spec's 200 (DEC74 raised RL02, which counts every signup).
import type { ServerEnv } from "../env.ts";
import { clientIp } from "../http/client-ip.ts";
import { fingerprint, type AttemptLimit, type FailureLimit } from "../http/rate-limit.ts";

export const RL02_GUEST: FailureLimit = { scope: "RL02:guest", limit: 5, window: "1 hour" };

export function rl02Address(limit: number): FailureLimit {
  return { scope: "RL02:ip", limit, window: "1 hour" };
}

export const RL03_EMAIL: readonly FailureLimit[] = [
  { scope: "RL03:email:minute", limit: 1, window: "1 minute" },
  { scope: "RL03:email:hour", limit: 3, window: "1 hour" },
  { scope: "RL03:email:day", limit: 10, window: "1 day" },
];

export const RL01_EMAIL: FailureLimit = { scope: "RL01:email", limit: 5, window: "15 minutes" };
export const RL01_IP: FailureLimit = { scope: "RL01:ip", limit: 200, window: "15 minutes" };

type LimitEnv = Pick<ServerEnv, "APP_SECRET" | "TRUSTED_PROXY_HOPS" | "SIGNUP_IP_LIMIT_PER_HOUR">;

/** RL01 for one login: the email as typed, and the client address when it is known. */
export function loginLimits(
  env: Pick<ServerEnv, "APP_SECRET" | "TRUSTED_PROXY_HOPS">,
  headers: Headers,
  email: string,
): AttemptLimit[] {
  const limits: AttemptLimit[] = [
    { limit: RL01_EMAIL, key: fingerprint(env.APP_SECRET, "email", email) },
  ];
  const address = clientIp(headers.get("x-forwarded-for"), env.TRUSTED_PROXY_HOPS);
  if (address !== null) {
    limits.push({ limit: RL01_IP, key: fingerprint(env.APP_SECRET, "ip", address) });
  }
  return limits;
}

/** RL02 for one signup attempt: the guest, and the client address when it is known. */
export function signupLimits(env: LimitEnv, headers: Headers, guestId: string): AttemptLimit[] {
  const limits: AttemptLimit[] = [
    { limit: RL02_GUEST, key: fingerprint(env.APP_SECRET, "guest", guestId) },
  ];
  const address = clientIp(headers.get("x-forwarded-for"), env.TRUSTED_PROXY_HOPS);
  if (address !== null) {
    limits.push({
      limit: rl02Address(env.SIGNUP_IP_LIMIT_PER_HOUR),
      key: fingerprint(env.APP_SECRET, "ip", address),
    });
  }
  return limits;
}

/** RL03 for one email sent to `email`, whether or not an account has it (no enumeration). */
export function emailLimits(appSecret: string, email: string): AttemptLimit[] {
  const key = fingerprint(appSecret, "email", email);
  return RL03_EMAIL.map((limit) => ({ limit, key }));
}
