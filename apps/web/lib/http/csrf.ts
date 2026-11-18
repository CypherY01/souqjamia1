// SEC05: every browser mutation carries a synchronizer token bound to the member or guest session.
// DEC35 dropped the server-side session table, so the token is signed instead of stored:
// token = "v1." + HMAC(csrf key, binding). It is recomputed on each request and compared in
// constant time (owner decision on task 1.6, item 1).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readCookie, serializeCookie, type CookieOptions } from "./cookies.ts";
import { deriveKey } from "./keys.ts";

export const CSRF_HEADER = "x-csrf-token";

/**
 * The guest binding: a random value in a cookie only the server can read. `__Host-` makes the
 * browser refuse it without Secure, Path=/ and a Domain, so another subdomain cannot set it.
 */
export const GUEST_COOKIE = "__Host-souq-guest";
const GUEST_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  path: "/",
};
const GUEST_ID = /^[A-Za-z0-9_-]{43}$/;

const TOKEN_VERSION = "v1";

/** Members bind to their Supabase session (task 3.1), guests to the guest cookie. */
export interface CsrfBinding {
  kind: "guest" | "member";
  id: string;
}

export function csrfToken(appSecret: string, binding: CsrfBinding): string {
  const mac = createHmac("sha256", deriveKey(appSecret, "csrf"))
    .update(`${binding.kind}:${binding.id}`)
    .digest("base64url");
  return `${TOKEN_VERSION}.${mac}`;
}

export function verifyCsrfToken(
  appSecret: string,
  binding: CsrfBinding | null,
  token: string | null,
): boolean {
  if (binding === null || token === null) return false;
  const expected = Buffer.from(csrfToken(appSecret, binding));
  const actual = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * The binding of the current request. Task 3.1 adds the member binding first: the session_id
 * of a verified Supabase session. Until then every request is a guest.
 */
export function resolveBinding(headers: Headers): CsrfBinding | null {
  const guest = readCookie(headers, GUEST_COOKIE);
  return guest !== undefined && GUEST_ID.test(guest) ? { kind: "guest", id: guest } : null;
}

export interface IssuedGuestBinding {
  binding: CsrfBinding;
  /** The Set-Cookie header value to add to the response. */
  setCookie: string;
}

/** A new guest binding: the first visit, or a rotation. */
export function issueGuestBinding(): IssuedGuestBinding {
  const id = randomBytes(32).toString("base64url");
  return {
    binding: { kind: "guest", id },
    setCookie: serializeCookie(GUEST_COOKIE, id, GUEST_COOKIE_OPTIONS),
  };
}

/**
 * Owner condition 1 on task 1.6: the token changes on login, logout and account switch.
 * A member's token follows its session_id, which is new on every login. The signup, login and
 * logout handlers (tasks 3.2 and 3.3) also call this, so the guest token from before a login is
 * not valid again after the logout.
 */
export function rotateGuestBinding(): IssuedGuestBinding {
  return issueGuestBinding();
}
