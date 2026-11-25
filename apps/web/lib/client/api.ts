// The browser's way to call our /api routes (task 3.2, item 9, from task 1.6). SEC05: every
// state-changing request carries the CSRF token from API013, which this module fetches once and
// keeps in memory (never in storage). After CSRF_FAILED (an expired page, a login elsewhere) it
// fetches a new token and sends the request again once, never more. Results come back in the
// contract's shape, or NETWORK when the request never got an answer. No Server Actions.
import type { ErrorCode, FieldError } from "../http/errors.ts";

export interface ApiSuccess<T> {
  ok: true;
  status: number;
  /** The contract's `data`, undefined for 204 and for a followed redirect. */
  data: T;
  /** A 303 the browser followed (API004): the local path it led to. */
  location: string | null;
  /** Task 4.3: the contract's `meta` when the answer has one (a page's next_cursor). */
  meta?: Record<string, unknown>;
}

export interface ApiFailure {
  ok: false;
  status: number;
  code: ErrorCode | "NETWORK";
  fieldErrors: FieldError[];
  /** Seconds, from Retry-After (429, 503). */
  retryAfter: number | null;
  traceId: string | null;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export interface ApiRequestInit {
  method?: "POST" | "PATCH" | "PUT" | "DELETE" | "GET";
  body?: unknown;
  /**
   * Task 4.2 (BR32, NFR09): the Idempotency-Key of a creation. The caller keeps it for every
   * retry of the same logical request, so the server returns the first result.
   */
  idempotencyKey?: string;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClient {
  request<T = unknown>(path: string, init?: ApiRequestInit): Promise<ApiResult<T>>;
  /** After signup, login and logout (and account changes, task 3.6): the binding changed. */
  resetCsrfToken(): void;
}

const CSRF_PATH = "/api/csrf";
const SAFE = new Set(["GET", "HEAD"]);

function networkFailure(): ApiFailure {
  return {
    ok: false,
    status: 0,
    code: "NETWORK",
    fieldErrors: [],
    retryAfter: null,
    traceId: null,
  };
}

function retryAfterOf(response: Response): number | null {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
}

async function readFailure(response: Response): Promise<ApiFailure> {
  let body: { code?: unknown; field_errors?: unknown; trace_id?: unknown } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Not the contract's error body (a proxy page, a broken answer): a general failure.
  }
  const fieldErrors = Array.isArray(body.field_errors)
    ? (body.field_errors as unknown[]).filter(
        (item): item is FieldError =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as FieldError).field === "string" &&
          typeof (item as FieldError).code === "string",
      )
    : [];
  return {
    ok: false,
    status: response.status,
    code: typeof body.code === "string" ? (body.code as ErrorCode) : "INTERNAL_ERROR",
    fieldErrors,
    retryAfter: retryAfterOf(response),
    traceId: typeof body.trace_id === "string" ? body.trace_id : response.headers.get("x-trace-id"),
  };
}

function localPath(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

export function createApiClient(fetchFn: Fetch): ApiClient {
  let token: Promise<string> | null = null;

  function csrfToken(): Promise<string> {
    token ??= fetchFn(CSRF_PATH, { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("csrf token unavailable");
        const body = (await response.json()) as { data?: { token?: unknown } };
        if (typeof body.data?.token !== "string") throw new Error("csrf token unavailable");
        return body.data.token;
      })
      .catch((error: unknown) => {
        token = null;
        throw error;
      });
    return token;
  }

  async function send(path: string, init: ApiRequestInit): Promise<Response | ApiFailure> {
    const method = init.method ?? "POST";
    const headers: Record<string, string> = { accept: "application/json" };
    if (!SAFE.has(method)) {
      try {
        headers["x-csrf-token"] = await csrfToken();
      } catch {
        return networkFailure();
      }
    }
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.idempotencyKey !== undefined) headers["idempotency-key"] = init.idempotencyKey;
    try {
      return await fetchFn(path, {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: "no-store",
        credentials: "same-origin",
      });
    } catch {
      return networkFailure();
    }
  }

  async function request<T>(path: string, init: ApiRequestInit = {}): Promise<ApiResult<T>> {
    for (let attempt = 0; ; attempt++) {
      const response = await send(path, init);
      if (!(response instanceof Response)) return response;
      if (response.redirected) {
        // API004 answers 303; fetch follows it, and the page goes where it led.
        return { ok: true, status: 303, data: undefined as T, location: localPath(response.url) };
      }
      if (response.ok) {
        let data = undefined as T;
        let meta: Record<string, unknown> | undefined;
        if (response.status !== 204) {
          try {
            const body = (await response.json()) as { data: T; meta?: unknown };
            data = body.data;
            if (typeof body.meta === "object" && body.meta !== null) {
              meta = body.meta as Record<string, unknown>;
            }
          } catch {
            data = undefined as T;
          }
        }
        return meta === undefined
          ? { ok: true, status: response.status, data, location: null }
          : { ok: true, status: response.status, data, location: null, meta };
      }
      const failure = await readFailure(response);
      if (failure.code === "CSRF_FAILED" && attempt === 0) {
        token = null;
        continue;
      }
      return failure;
    }
  }

  return {
    request,
    resetCsrfToken() {
      token = null;
    },
  };
}

/** The page's client. */
export const api: ApiClient = createApiClient((input, init) => fetch(input, init));
