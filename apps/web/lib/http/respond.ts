// Success and error responses in the contract's shapes (chapter 09):
// success { data, meta? }, error { code, message, field_errors, trace_id }.
// API responses are never cached, and vary by Origin (SEC04).
import { errorBody, type ApiError } from "./errors.ts";
import { TRACE_HEADER } from "./trace.ts";

const API_HEADERS = { "cache-control": "no-store", vary: "Origin" } as const;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: API_HEADERS });
}

export function ok(data: unknown, meta?: Record<string, unknown>): Response {
  return json(meta === undefined ? { data } : { data, meta }, 200);
}

export function created(data: unknown): Response {
  return json({ data }, 201);
}

export function accepted(data?: unknown): Response {
  return json(data === undefined ? {} : { data }, 202);
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: API_HEADERS });
}

export function errorResponse(error: ApiError, traceId: string): Response {
  const response = json(errorBody(error, traceId), error.status);
  response.headers.set(TRACE_HEADER, traceId);
  if (error.retryAfter !== undefined) {
    response.headers.set("retry-after", String(error.retryAfter));
  }
  return response;
}
