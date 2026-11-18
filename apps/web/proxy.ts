// The guard in front of every request except static files (task 1.6). Next.js 16 calls this file
// Proxy (it was Middleware); it runs on Node.js.
//  1. A new trace id per request (NFR13), passed on to route handlers and returned in X-Trace-Id.
//  2. State-changing requests: exact Origin, Fetch Metadata and the CSRF token (SEC05, TC64).
//  3. A nonce-based Content Security Policy and the other security headers (SEC06). Next.js reads
//     the nonce from the request's CSP header and adds it to its own scripts and styles.
import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "./lib/env";
import { ApiError } from "./lib/http/errors";
import { guardRequest } from "./lib/http/guard";
import { errorResponse } from "./lib/http/respond";
import { buildCsp, newNonce, securityHeaders } from "./lib/http/security-headers";
import { newTraceId, TRACE_HEADER } from "./lib/http/trace";
import { log } from "./lib/log";

export function proxy(request: NextRequest): NextResponse | Response {
  const env = serverEnv();
  const https = env.APP_ORIGIN.startsWith("https:");
  const headerOptions = { https, noindex: env.APP_ENV !== "production" };
  const traceId = newTraceId();

  const rejected = guardRequest(request.method, request.headers, env);
  if (rejected !== null) {
    log.warn("http.rejected", {
      trace_id: traceId,
      method: request.method,
      path: request.nextUrl.pathname,
      code: rejected,
    });
    const response = errorResponse(new ApiError(rejected), traceId);
    for (const [name, value] of securityHeaders(headerOptions)) response.headers.set(name, value);
    return response;
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

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  response.headers.set(TRACE_HEADER, traceId);
  for (const [name, value] of securityHeaders(headerOptions)) response.headers.set(name, value);
  return response;
}

export const config = {
  // Static files get the fixed headers from next.config.ts instead.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
