// The guard in front of every request except static files (task 1.6). Next.js 16 calls this file
// Proxy (it was Middleware); it runs on Node.js.
//  1. A new trace id per request (NFR13), passed on to route handlers and returned in X-Trace-Id.
//  2. The Supabase session (task 3.1, item 4): an expired access token is refreshed, and the new
//     session cookies go on the request passed on and on the response. Route handlers verify the
//     session again themselves; nothing here is passed to them as trusted.
//  3. State-changing requests: exact Origin, Fetch Metadata and the CSRF token (SEC05, TC64),
//     bound to the verified session_id for members and to the guest cookie otherwise.
//  4. A nonce-based Content Security Policy and the other security headers (SEC06). Next.js reads
//     the nonce from the request's CSP header and adds it to its own scripts and styles.
//  5. Email link pages under /auth/ send no Referer and are never stored (SEC03, task 3.2).
import { log } from "@souq/log";
import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "./lib/env";
import { cookieHeaderWith, readAllCookies } from "./lib/http/cookies";
import { ApiError } from "./lib/http/errors";
import { guardRequest } from "./lib/http/guard";
import { errorResponse } from "./lib/http/respond";
import {
  AUTH_LINK_HEADERS,
  buildCsp,
  isAuthLinkPath,
  newNonce,
  securityHeaders,
} from "./lib/http/security-headers";
import { newTraceId, TRACE_HEADER } from "./lib/http/trace";
import { routes } from "./lib/routes";
import { sessionSetCookie } from "./lib/supabase/server";
import { authenticateRequest, isSessionCookieName } from "./lib/supabase/session";

export async function proxy(request: NextRequest): Promise<NextResponse | Response> {
  const env = serverEnv();
  const https = env.APP_ORIGIN.startsWith("https:");
  const headerOptions = { https, noindex: env.APP_ENV !== "production" };
  const traceId = newTraceId();

  const session = await authenticateRequest(env, request.headers, traceId);
  const withSessionCookies = (response: Response): Response => {
    for (const cookie of session.setCookies) response.headers.append("set-cookie", cookie);
    // A response that sets session cookies is never stored by a shared cache.
    if (session.setCookies.length > 0) response.headers.set("cache-control", "private, no-store");
    return response;
  };

  const rejected = guardRequest(
    request.method,
    request.headers,
    env,
    session.identity?.sessionId ?? null,
  );
  if (rejected !== null) {
    log.warn("http.rejected", {
      trace_id: traceId,
      method: request.method,
      path: request.nextUrl.pathname,
      code: rejected,
    });
    const response = errorResponse(new ApiError(rejected), traceId);
    for (const [name, value] of securityHeaders(headerOptions)) response.headers.set(name, value);
    return withSessionCookies(response);
  }

  const csp = buildCsp({
    nonce: newNonce(),
    dev: process.env.NODE_ENV === "development",
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    https,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(TRACE_HEADER, traceId);
  requestHeaders.set("content-security-policy", csp);
  if (session.updates.size > 0) {
    const cookie = cookieHeaderWith(request.headers, session.updates);
    if (cookie === null) requestHeaders.delete("cookie");
    else requestHeaders.set("cookie", cookie);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  response.headers.set(TRACE_HEADER, traceId);
  for (const [name, value] of securityHeaders(headerOptions)) response.headers.set(name, value);
  if (isAuthLinkPath(request.nextUrl.pathname)) {
    for (const [name, value] of AUTH_LINK_HEADERS) response.headers.set(name, value);
  }
  // Task 3.3, DEC76: a refresh written here would join the sign-out response and could put the
  // session back. On sign-out only the request passed on carries it (the route signs that
  // session out), and every session cookie the browser sent is removed here too, so chunks the
  // refresh renamed do not stay behind. Task 3.4: the new password (API008) ends the session too.
  if (endsSession(request.method, request.nextUrl.pathname)) {
    for (const { name } of readAllCookies(request.headers)) {
      if (isSessionCookieName(name)) {
        response.headers.append("set-cookie", sessionSetCookie(name, "", true));
      }
    }
  } else {
    withSessionCookies(response);
  }
  return response;
}

function endsSession(method: string, pathname: string): boolean {
  return method === "POST" && (pathname === routes.api.logout || pathname === routes.api.reset);
}

export const config = {
  // Static files get the fixed headers from next.config.ts instead.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
