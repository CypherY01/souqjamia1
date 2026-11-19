// One request's session (task 3.1, item 4). The proxy calls this for every page and API request:
// an expired access token (10 minutes, DEC38) is refreshed with the refresh token, and the new
// cookies go both on the request passed on to the route and on the response. A revoked refresh
// token (signed out elsewhere) clears the cookies and the request continues as a guest.
// Route handlers call it again on the cookies the proxy passed on: they never trust a header
// from the proxy, and verification is local with cached keys, so repeating it is cheap.
import { readAllCookies } from "../http/cookies.ts";
import { expectedIssuer, verifyIdentity, type Identity } from "../auth/identity.ts";
import { createSessionClient, type RequestCookie, type SupabaseConfig } from "./server.ts";

/** @supabase/ssr names its cookies sb-<project ref>-auth-token, split into .0, .1 when long. */
const SESSION_COOKIE = /^sb-[A-Za-z0-9_-]+-auth-token(\.\d+)?$/;

export interface Authentication {
  identity: Identity | null;
  /** Set-Cookie values the response must carry (a refresh or a removal), in order. */
  setCookies: string[];
  /** New values of the session cookies (null: removed), for the request passed on. */
  updates: Map<string, string | null>;
}

/** A cookie that holds the session (not, for example, the PKCE code verifier of @supabase/ssr). */
export function isSessionCookieName(name: string): boolean {
  return SESSION_COOKIE.test(name);
}

export function hasSessionCookie(cookies: readonly RequestCookie[]): boolean {
  return cookies.some(({ name }) => isSessionCookieName(name));
}

export async function authenticateCookies(
  config: SupabaseConfig,
  cookies: readonly RequestCookie[],
  traceId: string,
): Promise<Authentication> {
  const setCookies: string[] = [];
  const updates = new Map<string, string | null>();
  if (!hasSessionCookie(cookies)) return { identity: null, setCookies, updates };
  const client = createSessionClient(config, cookies, (written) => {
    for (const cookie of written) {
      setCookies.push(cookie.setCookie);
      updates.set(cookie.name, cookie.value);
    }
  });
  const identity = await verifyIdentity(
    client,
    expectedIssuer(config.NEXT_PUBLIC_SUPABASE_URL),
    traceId,
  );
  return { identity, setCookies, updates };
}

export function authenticateRequest(
  config: SupabaseConfig,
  headers: Headers,
  traceId: string,
): Promise<Authentication> {
  return authenticateCookies(config, readAllCookies(headers), traceId);
}
