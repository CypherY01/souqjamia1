// The server's Supabase client over the session cookies (task 3.1, DEC35, item 2).
// @supabase/ssr reads and writes the session through the cookie methods given here. We write
// every session cookie with our own attributes, not the library's: HttpOnly (no refresh token
// for browser JavaScript, section 5 of the addendum), Secure, SameSite=Lax, Path=/ without a
// Domain, and 30 days (DEC38) instead of the library's fixed 400. No other code reads these
// cookies: the browser gets nothing from them (task 5.4 gives Realtime a short access token).
//
// Framework-free on purpose: the proxy, route handlers, server pages and integration tests all
// pass their own cookie source.
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serializeCookie } from "../http/cookies.ts";

/** DEC38: the longest a member session lasts. Supabase ends it too (sessions.timebox). */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** base64url values and chunk names of @supabase/ssr; anything else is refused, not written. */
const SAFE_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const SAFE_VALUE = /^[A-Za-z0-9_.-]*$/;

/** What the server uses of the client: verifying (and refreshing) the session only. */
export interface SessionClient {
  auth: Pick<SupabaseClient["auth"], "getClaims">;
}

export interface SupabaseConfig {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string;
}

export interface RequestCookie {
  name: string;
  value: string;
}

/** A session cookie the client wrote: its Set-Cookie value, and its new value (null: removed). */
export interface WrittenCookie {
  name: string;
  value: string | null;
  setCookie: string;
}

export function sessionSetCookie(name: string, value: string, remove: boolean): string {
  if (!SAFE_NAME.test(name) || !SAFE_VALUE.test(value)) {
    throw new Error("refusing a session cookie with unexpected characters");
  }
  return serializeCookie(name, remove ? "" : value, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: remove ? 0 : SESSION_MAX_AGE_SECONDS,
  });
}

/**
 * Task 3.2: a call to Supabase Auth that does not answer within 10 seconds fails, so a request
 * never hangs on it. supabase-js reports it as a retryable fetch error, answered with 503.
 */
export const AUTH_TIMEOUT_MS = 10_000;

function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const timeout = AbortSignal.timeout(AUTH_TIMEOUT_MS);
  const own = init?.signal ?? null;
  return fetch(input, {
    ...init,
    signal: own === null ? timeout : AbortSignal.any([own, timeout]),
  });
}

type CookieRead = () => { name: string; value: string }[];

function serverClient(
  config: SupabaseConfig,
  getAll: CookieRead,
  onWrite: (written: WrittenCookie[]) => void,
) {
  return createServerClient(
    config.NEXT_PUBLIC_SUPABASE_URL,
    config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      global: { fetch: timedFetch },
      cookies: {
        getAll,
        setAll: (toSet) => {
          onWrite(
            toSet.map(({ name, value, options }) => {
              const remove = options.maxAge === 0 || value === "";
              return {
                name,
                value: remove ? null : value,
                setCookie: sessionSetCookie(name, value, remove),
              };
            }),
          );
        },
      },
    },
  );
}

/**
 * A Supabase client for one request. `cookies` are the request's cookies; every cookie the
 * client writes (a refresh, a sign-out) is passed to `onWrite`. Server pages cannot write
 * cookies, so they ignore it: the proxy has refreshed the session before they run.
 */
export function createSessionClient(
  config: SupabaseConfig,
  cookies: readonly RequestCookie[],
  onWrite: (written: WrittenCookie[]) => void = () => undefined,
): SessionClient {
  return serverClient(config, () => cookies.map(({ name, value }) => ({ name, value })), onWrite);
}

/**
 * What the auth flows use: signup, the confirmation link, resend and sign-out (task 3.2), login
 * with the verification of the session it opens (task 3.3), and the recovery request and the
 * new password (task 3.4).
 */
export interface AuthFlowClient {
  auth: Pick<
    SupabaseClient["auth"],
    | "signUp"
    | "verifyOtp"
    | "resend"
    | "signOut"
    | "signInWithPassword"
    | "getClaims"
    | "resetPasswordForEmail"
    | "updateUser"
  >;
}

export interface RequestAuthClient {
  client: AuthFlowClient;
  /** Every cookie the client wrote, in order: a later write of the same name wins. */
  written: WrittenCookie[];
}

/**
 * Task 3.2: a client whose cookie reads see its own writes, like a browser's cookie jar for one
 * request. A session it has just opened can then be signed out in the same request (the
 * confirmation link, a signup while confirmation is on). Nothing reaches the response unless the
 * caller adds `written` to it.
 */
export function createRequestAuthClient(
  config: SupabaseConfig,
  cookies: readonly RequestCookie[],
): RequestAuthClient {
  const jar = new Map(cookies.map(({ name, value }) => [name, value]));
  const written: WrittenCookie[] = [];
  const client = serverClient(
    config,
    () => [...jar].map(([name, value]) => ({ name, value })),
    (batch) => {
      for (const cookie of batch) {
        if (cookie.value === null) jar.delete(cookie.name);
        else jar.set(cookie.name, cookie.value);
        written.push(cookie);
      }
    },
  );
  return { client, written };
}
