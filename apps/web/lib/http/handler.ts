// Every route handler is wrapped in apiHandler (CLAUDE.md):
//   export const GET = apiHandler("/api/example", async (request, context, api) => ok(data));
// It turns thrown ApiErrors into the contract's error body, hides unexpected errors behind
// INTERNAL_ERROR with the trace id, sets X-Trace-Id, and writes one log line per request.
//
// Task 3.1: api.identity() verifies the session cookies the proxy passed on (never a header from
// the proxy), once per request. Session cookies written meanwhile (a refresh at the edge of the
// token's ten minutes) are added to the response, error responses included.
import { log } from "@souq/log";
import type { Identity } from "../auth/identity.ts";
import { serverEnv } from "../env.ts";
import { authenticateRequest, type Authentication } from "../supabase/session.ts";
import { ApiError } from "./errors.ts";
import { errorResponse } from "./respond.ts";
import { TRACE_HEADER, traceIdOf } from "./trace.ts";

export interface ApiContext {
  traceId: string;
  /** The verified identity of this request, or null for a guest (lib/auth/identity.ts). */
  identity(): Promise<Identity | null>;
}

interface ApiHandlerOptions {
  /** Health probes run often and carry no information; they are not logged. */
  log?: boolean;
}

export function apiHandler<TContext = unknown>(
  /** The route template, e.g. "/api/listings/[id]": logged instead of the real path. */
  route: string,
  handle: (request: Request, context: TContext, api: ApiContext) => Promise<Response> | Response,
  options: ApiHandlerOptions = {},
): (request: Request, context: TContext) => Promise<Response> {
  return async (request, context) => {
    const traceId = traceIdOf(request.headers);
    const started = performance.now();
    let authentication: Promise<Authentication> | undefined;
    const api: ApiContext = {
      traceId,
      identity: async () => {
        authentication ??= authenticateRequest(serverEnv(), request.headers, traceId);
        return (await authentication).identity;
      },
    };
    let response: Response;
    let code: string | undefined;
    try {
      response = await handle(request, context, api);
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");
      if (!(error instanceof ApiError)) {
        log.error("api.unhandled_error", { trace_id: traceId, route, error });
      }
      response = errorResponse(apiError, traceId);
      code = apiError.code;
    }
    response.headers.set(TRACE_HEADER, traceId);
    if (authentication !== undefined) {
      // A failed authentication already failed the handler above; it writes no cookie.
      const setCookies = await authentication.then(
        (done) => done.setCookies,
        () => [],
      );
      for (const cookie of setCookies) response.headers.append("set-cookie", cookie);
    }
    if (options.log !== false) {
      log.info("api.request", {
        trace_id: traceId,
        route,
        method: request.method,
        status: response.status,
        duration_ms: Math.round(performance.now() - started),
        code,
      });
    }
    return response;
  };
}
