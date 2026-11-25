// Task 3.2, item 9 (from task 1.6): the browser's request tool. SEC05: the CSRF token comes from
// API013 and is kept in memory; after CSRF_FAILED it fetches a new token and sends the request
// again once, never more. Failures come back in the contract's shape, or NETWORK.
import { describe, expect, it } from "vitest";
import { createApiClient } from "../../apps/web/lib/client/api.ts";

interface Call {
  path: string;
  method: string;
  token: string | null;
  body: unknown;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** A fake fetch: /api/csrf hands out token-1, token-2..., the rest answers from `answers`. */
function fakeFetch(answers: (() => Response)[]) {
  const calls: Call[] = [];
  let tokens = 0;
  const fetchFn = (input: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      path: input,
      method: init?.method ?? "GET",
      token: headers.get("x-csrf-token"),
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    };
    calls.push(call);
    if (input === "/api/csrf") {
      tokens++;
      return Promise.resolve(json({ data: { token: `token-${String(tokens)}` } }));
    }
    const next = answers.shift();
    if (next === undefined) return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve(next());
  };
  return { fetchFn, calls };
}

const csrfFailed = () =>
  json({ code: "CSRF_FAILED", message: "", field_errors: [], trace_id: "t1" }, 403);

describe("createApiClient", () => {
  it("fetches the token once and sends it with JSON on every state-changing request", async () => {
    const { fetchFn, calls } = fakeFetch([
      () => json({ data: { state: "signed_in", next: "/" } }),
      () => new Response(null, { status: 204 }),
    ]);
    const api = createApiClient(fetchFn);
    const first = await api.request<{ state: string }>("/api/auth/signup", { body: { a: 1 } });
    expect(first).toEqual({
      ok: true,
      status: 200,
      data: { state: "signed_in", next: "/" },
      location: null,
    });
    const second = await api.request("/api/me/policy-acknowledgments", { body: {} });
    expect(second.ok && second.status).toBe(204);
    expect(calls.map((c) => [c.path, c.token])).toEqual([
      ["/api/csrf", null],
      ["/api/auth/signup", "token-1"],
      ["/api/me/policy-acknowledgments", "token-1"],
    ]);
    expect(calls[1]?.body).toEqual({ a: 1 });
  });

  it("retries once with a new token after CSRF_FAILED", async () => {
    const { fetchFn, calls } = fakeFetch([
      csrfFailed,
      () => json({ data: { status: "accepted" } }, 202),
    ]);
    const result = await createApiClient(fetchFn).request("/api/auth/resend", { body: {} });
    expect(result.ok && result.status).toBe(202);
    expect(calls.map((c) => [c.path, c.token])).toEqual([
      ["/api/csrf", null],
      ["/api/auth/resend", "token-1"],
      ["/api/csrf", null],
      ["/api/auth/resend", "token-2"],
    ]);
  });

  it("never retries a second time", async () => {
    const { fetchFn, calls } = fakeFetch([csrfFailed, csrfFailed, csrfFailed]);
    const result = await createApiClient(fetchFn).request("/api/auth/signup", { body: {} });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe("CSRF_FAILED");
    expect(calls.filter((c) => c.path === "/api/auth/signup")).toHaveLength(2);
  });

  it("reads the contract's error: code, field errors, Retry-After and trace id", async () => {
    const { fetchFn } = fakeFetch([
      () =>
        json(
          {
            code: "VALIDATION_FAILED",
            message: "x",
            field_errors: [{ field: "email", code: "email_registered" }, { bad: true }],
            trace_id: "trace-9",
          },
          422,
        ),
      () =>
        json({ code: "RATE_LIMITED", message: "", field_errors: [], trace_id: "t" }, 429, {
          "retry-after": "42",
        }),
    ]);
    const api = createApiClient(fetchFn);
    expect(await api.request("/api/auth/signup", { body: {} })).toEqual({
      ok: false,
      status: 422,
      code: "VALIDATION_FAILED",
      fieldErrors: [{ field: "email", code: "email_registered" }],
      retryAfter: null,
      traceId: "trace-9",
    });
    const limited = await api.request("/api/auth/signup", { body: {} });
    expect(!limited.ok && [limited.code, limited.retryAfter]).toEqual(["RATE_LIMITED", 42]);
  });

  it("NETWORK when the request gets no answer, and a general failure for a broken body", async () => {
    const { fetchFn } = fakeFetch([
      () => new Response("<html>bad gateway</html>", { status: 502 }),
    ]);
    const api = createApiClient(fetchFn);
    const broken = await api.request("/api/auth/signup", { body: {} });
    expect(!broken.ok && [broken.status, broken.code]).toEqual([502, "INTERNAL_ERROR"]);
    const offline = await api.request("/api/auth/signup", { body: {} });
    expect(!offline.ok && offline.code).toBe("NETWORK");
  });

  it("resetCsrfToken: the next request fetches a new token (after signup, login, logout)", async () => {
    const { fetchFn, calls } = fakeFetch([() => json({ data: {} }), () => json({ data: {} })]);
    const api = createApiClient(fetchFn);
    await api.request("/api/auth/signup", { body: {} });
    api.resetCsrfToken();
    await api.request("/api/auth/signup", { body: {} });
    expect(calls.filter((c) => c.path === "/api/csrf")).toHaveLength(2);
    expect(calls.at(-1)?.token).toBe("token-2");
  });

  it("GET sends no token, and a followed 303 reports where it led (API004)", async () => {
    const redirected = new Response(null, { status: 404 });
    Object.defineProperty(redirected, "redirected", { value: true });
    Object.defineProperty(redirected, "url", { value: "http://localhost:3000/login?confirmed=1" });
    const { fetchFn, calls } = fakeFetch([
      () => json({ data: { terms: { version: "v2" } } }),
      () => redirected,
    ]);
    const api = createApiClient(fetchFn);
    const policies = await api.request("/api/policies/current", { method: "GET" });
    expect(policies.ok).toBe(true);
    expect(calls[0]).toMatchObject({ path: "/api/policies/current", token: null });
    const confirmed = await api.request("/api/auth/confirm", { body: { token_hash: "x" } });
    expect(confirmed).toEqual({
      ok: true,
      status: 303,
      data: undefined,
      location: "/login?confirmed=1",
    });
  });

  it("task 4.3: a page's meta comes back with its data (API031's next_cursor)", async () => {
    const { fetchFn } = fakeFetch([
      () => json({ data: [{ id: "a" }], meta: { next_cursor: "c2" } }),
      () => json({ data: { id: "b" } }),
    ]);
    const api = createApiClient(fetchFn);
    const page = await api.request<{ id: string }[]>("/api/listings?q=x", { method: "GET" });
    expect(page).toEqual({
      ok: true,
      status: 200,
      data: [{ id: "a" }],
      location: null,
      meta: { next_cursor: "c2" },
    });
    const one = await api.request("/api/listings/b", { method: "GET" });
    expect(one).not.toHaveProperty("meta");
  });
});
