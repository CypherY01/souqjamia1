// Task 3.2: the server's signup field rules (TC01: all errors at once), what a Supabase Auth
// failure means for the flows, the RL02 (DEC74) and RL03 limits, and the headers of SEC03.
import { describe, expect, it } from "vitest";
import { classifyAuthError } from "../../apps/web/lib/auth/auth-errors.ts";
import {
  emailLimits,
  RL02_GUEST,
  RL03_EMAIL,
  rl02Address,
  signupLimits,
} from "../../apps/web/lib/auth/limits.ts";
import { signupFieldErrors, type SignupBody } from "../../apps/web/lib/auth/signup.ts";
import {
  AUTH_LINK_HEADERS,
  buildCsp,
  isAuthLinkPath,
} from "../../apps/web/lib/http/security-headers.ts";

const valid: SignupBody = {
  name: "عضو تجريبي",
  email: "member@example.test",
  password: "كلمة-مرور-جيدة",
  college_id: null,
  terms_version: "draft-1",
  privacy_version: "draft-1",
  accept_terms: true,
  acknowledge_privacy: true,
  captcha_token: "token",
};

/** The shape supabase-js gives its errors (isAuthApiError checks __isAuthError and the name). */
function authError(name: string, status: number, code?: string): unknown {
  return Object.assign(new Error("message"), { __isAuthError: true, name, status, code });
}

describe("signupFieldErrors (FR01, DEC32, TC01)", () => {
  it("a valid signup has no field error", () => {
    expect(signupFieldErrors(valid)).toEqual([]);
  });

  it("every broken field at once, with its code", () => {
    expect(
      signupFieldErrors({
        ...valid,
        name: " س ",
        email: "not-an-email",
        password: "short",
        accept_terms: false,
        acknowledge_privacy: false,
      }),
    ).toEqual([
      { field: "name", code: "too_small" },
      { field: "email", code: "invalid_format" },
      { field: "password", code: "too_short" },
      { field: "accept_terms", code: "required" },
      { field: "acknowledge_privacy", code: "required" },
    ]);
    expect(signupFieldErrors({ ...valid, name: "", email: "", password: "x".repeat(65) })).toEqual([
      { field: "name", code: "required" },
      { field: "email", code: "required" },
      { field: "password", code: "too_long" },
    ]);
  });
});

describe("classifyAuthError (codes checked on the local stack)", () => {
  it.each([
    ["AuthApiError", 400, "captcha_failed", "captcha_failed"],
    ["AuthApiError", 422, "user_already_exists", "user_already_exists"],
    ["AuthApiError", 422, "email_exists", "user_already_exists"],
    ["AuthApiError", 429, "over_email_send_rate_limit", "email_rate_limited"],
    ["AuthApiError", 429, "over_request_rate_limit", "rate_limited"],
    ["AuthApiError", 429, undefined, "rate_limited"],
    ["AuthApiError", 403, "otp_expired", "link_invalid"],
    ["AuthApiError", 422, "weak_password", "weak_password"],
    ["AuthApiError", 400, "email_address_invalid", "email_invalid"],
    ["AuthApiError", 400, "validation_failed", "unexpected"],
    ["AuthRetryableFetchError", 0, undefined, "unavailable"],
    ["AuthRetryableFetchError", 503, undefined, "unavailable"],
    // Supabase Auth's answer to a database error (our trigger): a defect, not an outage.
    ["AuthRetryableFetchError", 500, undefined, "unexpected"],
  ])("%s %d %s is %s", (name, status, code, expected) => {
    expect(classifyAuthError(authError(name, status, code))).toBe(expected);
  });

  it("anything else is unexpected", () => {
    expect(classifyAuthError(new Error("boom"))).toBe("unexpected");
    expect(classifyAuthError(null)).toBe("unexpected");
  });
});

describe("RL02 (DEC74) and RL03", () => {
  const env = { APP_SECRET: "s".repeat(43), TRUSTED_PROXY_HOPS: 1, SIGNUP_IP_LIMIT_PER_HOUR: 300 };

  it("RL02: 5 an hour per guest, the address limit from SIGNUP_IP_LIMIT_PER_HOUR", () => {
    expect(RL02_GUEST).toEqual({ scope: "RL02:guest", limit: 5, window: "1 hour" });
    expect(rl02Address(300)).toEqual({ scope: "RL02:ip", limit: 300, window: "1 hour" });
    const headers = new Headers({ "x-forwarded-for": "198.51.100.7" });
    const limits = signupLimits(env, headers, "g".repeat(43));
    expect(limits.map((entry) => [entry.limit.scope, entry.limit.limit])).toEqual([
      ["RL02:guest", 5],
      ["RL02:ip", 300],
    ]);
    const tuned = signupLimits({ ...env, SIGNUP_IP_LIMIT_PER_HOUR: 1200 }, headers, "g".repeat(43));
    expect(tuned[1]?.limit.limit).toBe(1200);
  });

  it("RL02: without a trusted proxy the address is unknown, so only the guest limit applies", () => {
    const headers = new Headers({ "x-forwarded-for": "198.51.100.7" });
    const limits = signupLimits({ ...env, TRUSTED_PROXY_HOPS: 0 }, headers, "g".repeat(43));
    expect(limits.map((entry) => entry.limit.scope)).toEqual(["RL02:guest"]);
  });

  it("RL03: one a minute, 3 an hour, 10 a day, keyed by the address in any case", () => {
    expect(RL03_EMAIL.map((limit) => [limit.limit, limit.window])).toEqual([
      [1, "1 minute"],
      [3, "1 hour"],
      [10, "1 day"],
    ]);
    const a = emailLimits(env.APP_SECRET, "Sara@Example.com");
    const b = emailLimits(env.APP_SECRET, " sara@example.com");
    expect(a[0]?.key.equals(b[0]?.key ?? Buffer.alloc(0))).toBe(true);
  });
});

describe("SEC03 and Turnstile headers", () => {
  it("pages under /auth/ send no Referer and are never stored", () => {
    expect(isAuthLinkPath("/auth/confirm")).toBe(true);
    expect(isAuthLinkPath("/auth")).toBe(true);
    expect(isAuthLinkPath("/authors")).toBe(false);
    expect(isAuthLinkPath("/signup")).toBe(false);
    expect(Object.fromEntries(AUTH_LINK_HEADERS)).toEqual({
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    });
  });

  it("the CSP allows the Turnstile frame and nothing else from outside", () => {
    const csp = buildCsp({
      nonce: "n",
      dev: false,
      supabaseUrl: "http://127.0.0.1:54321",
      https: false,
    });
    expect(csp).toContain("frame-src https://challenges.cloudflare.com");
    expect(csp).toContain("frame-ancestors 'none'");
    // The script runs because our nonce-trusted code adds it ('strict-dynamic'), not by host.
    const script = csp.split("; ").find((directive) => directive.startsWith("script-src"));
    expect(script).toBe("script-src 'self' 'nonce-n' 'strict-dynamic'");
  });
});
