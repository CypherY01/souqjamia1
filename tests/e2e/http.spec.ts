// Task 1.6: the HTTP layer on the real server (next start): CSRF, Origin and Fetch Metadata
// (SEC05, TC64), CORS (SEC04, TC63), CSP and security headers (SEC06), trace ids (NFR13),
// and the health and readiness probes (API105, API106).
import { expect, test, type APIResponse, type PlaywrightWorkerArgs } from "@playwright/test";

const BASE = "http://localhost:3100";

// These checks do not depend on the viewport, so they run once.
test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop-1440", "server checks run in one project");
});

function guestCookie(response: APIResponse): string {
  const header = response.headersArray().find((h) => h.name.toLowerCase() === "set-cookie");
  return header?.value.split(";")[0] ?? "";
}

/** A new guest in its own request context, so no cookie jar is shared between guests. */
async function newGuest(playwright: PlaywrightWorkerArgs["playwright"]) {
  const context = await playwright.request.newContext({ baseURL: BASE });
  const response = await context.get("/api/csrf");
  const body = (await response.json()) as { data: { token: string } };
  const guest = {
    cookie: guestCookie(response),
    token: body.data.token,
    status: response.status(),
    headers: response.headers(),
    setCookie: response.headersArray().find((h) => h.name.toLowerCase() === "set-cookie"),
  };
  await context.dispose();
  return guest;
}

test("API013 issues a guest cookie and a token, never cached", async ({ playwright, request }) => {
  const { cookie, token, status, headers, setCookie } = await newGuest(playwright);
  expect(status).toBe(200);
  expect(token).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);
  expect(headers["cache-control"]).toBe("no-store");
  expect(headers.vary).toContain("Origin");
  expect(headers["x-trace-id"]).toMatch(/^[0-9a-f]{32}$/);
  expect(setCookie?.value).toMatch(
    /^__Host-souq-guest=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
  );

  // The same guest gets the same token, and no new cookie.
  const again = await request.get("/api/csrf", { headers: { cookie } });
  expect(((await again.json()) as { data: { token: string } }).data.token).toBe(token);
  expect(again.headersArray().some((h) => h.name.toLowerCase() === "set-cookie")).toBe(false);
});

test("TC64 in the browser: a mutation passes the guard only with the token", async ({ page }) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { data } = (await (await fetch("/api/csrf")).json()) as { data: { token: string } };
    const withToken = await fetch("/api/csrf", {
      method: "POST",
      headers: { "x-csrf-token": data.token },
    });
    const withoutToken = await fetch("/api/csrf", { method: "POST" });
    const body = (await withoutToken.json()) as { code: string; trace_id: string };
    return {
      withToken: withToken.status,
      withoutToken: withoutToken.status,
      code: body.code,
      traceMatches: body.trace_id === withoutToken.headers.get("x-trace-id"),
    };
  });
  // 405: the guard let it through, and /api/csrf has no POST handler.
  expect(results).toEqual({
    withToken: 405,
    withoutToken: 403,
    code: "CSRF_FAILED",
    traceMatches: true,
  });
});

test.describe("TC64 rejected mutations", () => {
  const post = async (
    request: import("@playwright/test").APIRequestContext,
    path: string,
    headers: Record<string, string>,
  ) => {
    const response = await request.post(path, { headers, maxRedirects: 0 });
    const body = (await response.json()) as { code: string; trace_id: string; message: string };
    return { status: response.status(), body, trace: response.headers()["x-trace-id"] };
  };

  test("another site, no Origin, null Origin, cross-site Fetch Metadata", async ({
    playwright,
    request,
  }) => {
    const { cookie, token } = await newGuest(playwright);
    const valid = { cookie, "x-csrf-token": token };
    for (const headers of [
      { ...valid, origin: "https://evil.example" },
      { ...valid },
      { ...valid, origin: "null" },
      { ...valid, origin: BASE, "sec-fetch-site": "cross-site" },
    ]) {
      const result = await post(request, "/api/csrf", headers);
      expect(result.status).toBe(403);
      expect(result.body.code).toBe("ORIGIN_REJECTED");
      expect(result.body.trace_id).toBe(result.trace);
      expect(result.body.message).not.toBe("");
    }
  });

  test("missing token, another guest's token, and a Server Action", async ({
    playwright,
    request,
  }) => {
    const mine = await newGuest(playwright);
    const other = await newGuest(playwright);
    expect(other.token).not.toBe(mine.token);
    const cases: Record<string, string>[] = [
      { origin: BASE, cookie: mine.cookie },
      { origin: BASE, cookie: mine.cookie, "x-csrf-token": other.token },
      { origin: BASE, cookie: mine.cookie, "next-action": "0123456789abcdef" },
    ];
    for (const headers of cases) {
      const result = await post(request, "/api/csrf", headers);
      expect(result.status).toBe(403);
      expect(result.body.code).toBe("CSRF_FAILED");
    }
    const page = await post(request, "/", { origin: BASE, "next-action": "0123456789abcdef" });
    expect(page.status).toBe(403);
    expect(page.body.code).toBe("CSRF_FAILED");
  });
});

test("TC63: no CORS for another origin, and Vary: Origin", async ({ request }) => {
  const response = await request.get("/api/csrf", { headers: { origin: "https://evil.example" } });
  const names = Object.keys(response.headers());
  expect(names.filter((name) => name.startsWith("access-control-"))).toEqual([]);
  expect(response.headers().vary).toContain("Origin");
  const preflight = await request.fetch("/api/csrf", {
    method: "OPTIONS",
    headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
  });
  expect(
    Object.keys(preflight.headers()).filter((name) => name.startsWith("access-control-")),
  ).toEqual([]);
});

test("SEC06: a new nonce per request on every script, and the security headers", async ({
  request,
}) => {
  const first = await request.get("/");
  const second = await request.get("/");
  const csp = first.headers()["content-security-policy"] ?? "";
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1];
  expect(nonce).toBeDefined();
  expect(second.headers()["content-security-policy"]).not.toBe(csp);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).not.toContain("unsafe-eval");

  const html = await first.text();
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  expect(scripts.length).toBeGreaterThan(0);
  for (const script of scripts) expect(script).toContain(`nonce="${nonce ?? ""}"`);

  const headers = first.headers();
  expect(headers).toMatchObject({
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "cross-origin-opener-policy": "same-origin",
    "x-robots-tag": "noindex, nofollow",
  });
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["strict-transport-security"]).toBeUndefined();
  expect(headers["x-trace-id"]).toMatch(/^[0-9a-f]{32}$/);

  // Static files skip the proxy but still get the fixed headers (next.config.ts).
  const asset = /\/_next\/static\/[^"']+\.js/.exec(html)?.[0];
  expect(asset).toBeDefined();
  const assetResponse = await request.get(asset ?? "/");
  expect(assetResponse.headers()["x-content-type-options"]).toBe("nosniff");
  expect(assetResponse.headers()["content-security-policy"]).toBeUndefined();
});

test("API105 and API106: health is open, readiness needs the probe token", async ({ request }) => {
  const health = await request.get("/healthz");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });

  const probes: Record<string, string>[] = [{}, { "x-probe-token": "wrong" }];
  for (const headers of probes) {
    const denied = await request.get("/readyz", { headers });
    expect(denied.status()).toBe(401);
    expect(((await denied.json()) as { code: string }).code).toBe("UNAUTHENTICATED");
  }

  const ready = await request.get("/readyz", {
    headers: { "x-probe-token": process.env.E2E_PROBE_TOKEN ?? "" },
  });
  const body = (await ready.json()) as { status: string; checks: Record<string, boolean> };
  // Task 3.2: the E2E servers use the local stack, so Auth and the database answer and the server
  // is ready. The queue check is reported but does not decide readiness (task 3.1), and depends
  // on what earlier local runs left in the queue (no worker runs here).
  expect(ready.status()).toBe(200);
  expect(body.status).toBe("ready");
  expect(body.checks.supabase_auth).toBe(true);
  expect(body.checks.database).toBe(true);
  expect(typeof body.checks.job_queue).toBe("boolean");
  expect(ready.headers()["cache-control"]).toBe("no-store");
});
