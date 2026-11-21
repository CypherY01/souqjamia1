import { hkdfSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readCookie, serializeCookie } from "../../apps/web/lib/http/cookies.ts";
import {
  CSRF_HEADER,
  csrfToken,
  GUEST_COOKIE,
  issueGuestBinding,
  resolveBinding,
  rotateGuestBinding,
  verifyCsrfToken,
} from "../../apps/web/lib/http/csrf.ts";
import { checkRequestSource, guardRequest, isSafeMethod } from "../../apps/web/lib/http/guard.ts";
import { deriveKey, HKDF_SALT } from "../../apps/web/lib/http/keys.ts";
import {
  buildCsp,
  newNonce,
  securityHeaders,
  STATIC_SECURITY_HEADERS,
} from "../../apps/web/lib/http/security-headers.ts";

// Built at run time: the repository never contains a secret-like string.
const SECRET = ["test", "app", "secret", "x".repeat(32)].join("-");
const OTHER_SECRET = ["other", "app", "secret", "y".repeat(32)].join("-");
const ORIGIN = "http://localhost:3000";
const config = { APP_ORIGIN: ORIGIN, APP_SECRET: SECRET };

/** The guest cookie value from a Set-Cookie header. */
function cookieValue(setCookie: string): string {
  return setCookie.split(";")[0]?.split("=")[1] ?? "";
}

/** Headers of a browser POST from our own page, with the given guest cookie and token. */
function post(guestId: string | null, token: string | null, extra: Record<string, string> = {}) {
  const headers = new Headers({ origin: ORIGIN, "sec-fetch-site": "same-origin", ...extra });
  if (guestId !== null) headers.set("cookie", `other=1; ${GUEST_COOKIE}=${guestId}`);
  if (token !== null) headers.set(CSRF_HEADER, token);
  return headers;
}

describe("owner condition 2 on task 1.6: HKDF keys from APP_SECRET, one purpose each", () => {
  it("derives 32-byte keys with HKDF-SHA256 and the purpose names csrf and cursor", () => {
    const csrf = deriveKey(SECRET, "csrf");
    const cursor = deriveKey(SECRET, "cursor");
    expect(csrf).toHaveLength(32);
    expect(csrf.equals(cursor)).toBe(false);
    expect(csrf.equals(Buffer.from(hkdfSync("sha256", SECRET, HKDF_SALT, "csrf", 32)))).toBe(true);
    expect(cursor.equals(Buffer.from(hkdfSync("sha256", SECRET, HKDF_SALT, "cursor", 32)))).toBe(
      true,
    );
  });

  it("changes every key when APP_SECRET changes", () => {
    expect(deriveKey(SECRET, "csrf").equals(deriveKey(OTHER_SECRET, "csrf"))).toBe(false);
    expect(deriveKey(SECRET, "cursor").equals(deriveKey(OTHER_SECRET, "cursor"))).toBe(false);
  });
});

describe("SEC05 CSRF token bound to the session", () => {
  const guest = issueGuestBinding();
  const guestId = cookieValue(guest.setCookie);

  it("sets the guest cookie with __Host-, HttpOnly, Secure and SameSite=Lax, and no Domain", () => {
    expect(guest.setCookie).toBe(
      `${GUEST_COOKIE}=${guestId}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    );
    expect(guestId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(guest.setCookie).not.toMatch(/domain/i);
  });

  it("reads the binding back from the Cookie header, and ignores malformed values", () => {
    expect(resolveBinding(post(guestId, null))).toEqual({ kind: "guest", id: guestId });
    expect(resolveBinding(post("short", null))).toBeNull();
    expect(resolveBinding(post(null, null))).toBeNull();
    expect(readCookie(new Headers({ cookie: "a=1; b=x=y" }), "b")).toBe("x=y");
  });

  it("accepts the token for its own binding only", () => {
    const token = csrfToken(SECRET, guest.binding);
    expect(token).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);
    expect(verifyCsrfToken(SECRET, guest.binding, token)).toBe(true);
    expect(verifyCsrfToken(SECRET, issueGuestBinding().binding, token)).toBe(false);
    expect(verifyCsrfToken(OTHER_SECRET, guest.binding, token)).toBe(false);
    // A different last character: plain "A" equalled the real one in 1 run out of 16.
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "E" : "A"}`;
    expect(verifyCsrfToken(SECRET, guest.binding, tampered)).toBe(false);
    expect(verifyCsrfToken(SECRET, guest.binding, null)).toBe(false);
    expect(verifyCsrfToken(SECRET, null, token)).toBe(false);
  });

  it("never gives a guest and a member the same token for the same id", () => {
    const id = guest.binding.id;
    expect(csrfToken(SECRET, { kind: "guest", id })).not.toBe(
      csrfToken(SECRET, { kind: "member", id }),
    );
  });

  describe("task 3.1, item 5: a member binds to the verified session_id", () => {
    const sessionA = "11111111-2222-4333-8444-555555555555";
    const sessionB = "66666666-7777-4888-8999-aaaaaaaaaaaa";

    it("prefers the member session over the guest cookie, and refuses a malformed id", () => {
      expect(resolveBinding(post(guestId, null), sessionA)).toEqual({
        kind: "member",
        id: sessionA,
      });
      expect(resolveBinding(post(guestId, null), "not-a-session-id")).toBeNull();
    });

    it("a guest token does not pass for a member, nor a member token for a guest", () => {
      const guestToken = csrfToken(SECRET, guest.binding);
      const memberToken = csrfToken(SECRET, { kind: "member", id: sessionA });
      expect(guardRequest("POST", post(guestId, guestToken), config, sessionA)).toBe("CSRF_FAILED");
      expect(guardRequest("POST", post(guestId, memberToken), config, sessionA)).toBeNull();
      expect(guardRequest("POST", post(guestId, memberToken), config)).toBe("CSRF_FAILED");
    });

    it("owner condition 1: a new login (new session_id) and a logout make the member token fail", () => {
      const memberToken = csrfToken(SECRET, { kind: "member", id: sessionA });
      expect(guardRequest("POST", post(guestId, memberToken), config, sessionB)).toBe(
        "CSRF_FAILED",
      );
      // After logout the request has no session, so it binds to the (rotated) guest cookie.
      const rotatedId = cookieValue(rotateGuestBinding().setCookie);
      expect(guardRequest("POST", post(rotatedId, memberToken), config)).toBe("CSRF_FAILED");
    });
  });

  it("owner condition 1: a rotation (login, logout, account switch) makes the old token fail", () => {
    const before = csrfToken(SECRET, guest.binding);
    const rotated = rotateGuestBinding();
    const rotatedId = cookieValue(rotated.setCookie);
    expect(rotatedId).not.toBe(guestId);
    expect(guardRequest("POST", post(rotatedId, before), config)).toBe("CSRF_FAILED");
    expect(
      guardRequest("POST", post(rotatedId, csrfToken(SECRET, rotated.binding)), config),
    ).toBeNull();
  });
});

describe("TC64 the guard on state-changing requests", () => {
  const guest = issueGuestBinding();
  const guestId = cookieValue(guest.setCookie);
  const token = csrfToken(SECRET, guest.binding);

  it("lets reads through without a token: GET never changes state", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "get"]) {
      expect(isSafeMethod(method)).toBe(true);
      expect(guardRequest(method, new Headers(), config)).toBeNull();
    }
  });

  it("accepts a same-origin POST with the right token", () => {
    expect(guardRequest("POST", post(guestId, token), config)).toBeNull();
  });

  it.each(["POST", "PUT", "PATCH", "patch", "DELETE", "PROPFIND"])(
    "guards %s like any mutation",
    (method) => {
      expect(guardRequest(method, post(guestId, null), config)).toBe("CSRF_FAILED");
    },
  );

  const sources: [string, Record<string, string>][] = [
    ["no Origin", { origin: "" }],
    ["Origin null", { origin: "null" }],
    ["another site", { origin: "https://evil.example" }],
    ["another port", { origin: "http://localhost:3001" }],
    ["another scheme", { origin: "https://localhost:3000" }],
    ["a look-alike host", { origin: "http://localhost:3000.evil.example" }],
    ["Sec-Fetch-Site cross-site", { "sec-fetch-site": "cross-site" }],
    ["Sec-Fetch-Site same-site", { "sec-fetch-site": "same-site" }],
    ["Sec-Fetch-Site none", { "sec-fetch-site": "none" }],
  ];
  it.each(sources)("rejects %s even with a valid token", (_name, extra) => {
    const headers = post(guestId, token, extra);
    if (extra.origin === "") headers.delete("origin");
    expect(guardRequest("POST", headers, config)).toBe("ORIGIN_REJECTED");
  });

  it("accepts a request without Fetch Metadata when Origin and token are right", () => {
    const headers = post(guestId, token);
    headers.delete("sec-fetch-site");
    expect(checkRequestSource(headers, ORIGIN)).toBeNull();
    expect(guardRequest("POST", headers, config)).toBeNull();
  });

  it.each([
    ["no token", post(guestId, null)],
    ["no guest cookie", post(null, token)],
    ["another guest's token", post(guestId, csrfToken(SECRET, issueGuestBinding().binding))],
    ["a token signed with another secret", post(guestId, csrfToken(OTHER_SECRET, guest.binding))],
    ["a Server Action without a token", post(guestId, null, { "next-action": "abc123" })],
  ])("rejects %s with CSRF_FAILED", (_name, headers) => {
    expect(guardRequest("POST", headers, config)).toBe("CSRF_FAILED");
  });
});

describe("SEC06 security headers", () => {
  const supabaseUrl = "http://127.0.0.1:54321";

  it("production CSP: nonce scripts and styles, no eval, no framing, no plugins", () => {
    const csp = buildCsp({ nonce: "N0nce", dev: false, supabaseUrl, https: false });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'nonce-N0nce' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).toContain("style-src 'self' 'nonce-N0nce'");
    expect(csp).toContain("img-src 'self' blob: data: http://127.0.0.1:54321");
    expect(csp).toContain("connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("https: upgrades insecure requests and uses wss for Supabase Realtime", () => {
    const csp = buildCsp({
      nonce: "n",
      dev: false,
      supabaseUrl: "https://project.supabase.example",
      https: true,
    });
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).toContain("wss://project.supabase.example");
  });

  it("task 3.5: the Turnstile frame is allowed, except with the E2E stand-in", () => {
    expect(buildCsp({ nonce: "n", dev: false, supabaseUrl, https: false })).toContain(
      "frame-src https://challenges.cloudflare.com",
    );
    const stub = buildCsp({
      nonce: "n",
      dev: false,
      supabaseUrl,
      https: false,
      turnstileStub: true,
    });
    expect(stub).toContain("frame-src 'none'");
    expect(stub).not.toContain("challenges.cloudflare.com");
  });

  it("next dev only: eval for React and unsigned dev styles", () => {
    const csp = buildCsp({ nonce: "n", dev: true, supabaseUrl, https: false });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("a new random nonce every time", () => {
    const nonces = new Set(Array.from({ length: 50 }, newNonce));
    expect(nonces.size).toBe(50);
    expect([...nonces][0]).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  it("HSTS only over https, X-Robots-Tag only outside production", () => {
    const names = (options: { https: boolean; noindex: boolean }) =>
      securityHeaders(options).map(([name]) => name);
    expect(names({ https: false, noindex: true })).toEqual([
      ...STATIC_SECURITY_HEADERS.map(([name]) => name),
      "X-Robots-Tag",
    ]);
    expect(names({ https: true, noindex: false })).toContain("Strict-Transport-Security");
    expect(names({ https: true, noindex: false })).not.toContain("X-Robots-Tag");
    expect(Object.fromEntries(STATIC_SECURITY_HEADERS)).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
  });

  it("serializes cookies without a Domain", () => {
    expect(
      serializeCookie("n", "v", {
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
        path: "/",
        maxAge: 60,
      }),
    ).toBe("n=v; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Strict");
  });
});
