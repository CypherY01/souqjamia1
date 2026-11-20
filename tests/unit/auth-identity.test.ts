// Task 3.1: the pure parts of the server's identity and guards (items 2, 3, 7, 8, 14).
// The same code runs against real sessions in tests/integration/auth-guards.test.ts.
import { describe, expect, it } from "vitest";
import {
  DELETION_RECOVERY_DAYS,
  limitedSessionDenial,
  memberDenial,
  memberPageRedirect,
  restrictionOf,
  type SessionAuth,
  type SessionState,
} from "../../apps/web/lib/auth/guards.ts";
import {
  checkClaims,
  expectedIssuer,
  LIMITED_SESSION_SECONDS,
  limitedSessionExpired,
  type Identity,
} from "../../apps/web/lib/auth/identity.ts";
import { cookieHeaderWith, readAllCookies } from "../../apps/web/lib/http/cookies.ts";
import { SESSION_MAX_AGE_SECONDS, sessionSetCookie } from "../../apps/web/lib/supabase/server.ts";
import { hasSessionCookie } from "../../apps/web/lib/supabase/session.ts";

const ISSUER = "http://127.0.0.1:54321/auth/v1";
const NOW = 1_800_000_000;

/** Claims shaped like a local Supabase token (checked on 19 November 2026). */
function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: "authenticated",
    role: "authenticated",
    is_anonymous: false,
    sub: "0b5e8a8e-1f6c-4d8a-9a51-3c1f8f2b7d10",
    session_id: "7d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    aal: "aal1",
    amr: [{ method: "password", timestamp: NOW }],
    email: "member@example.test",
    exp: NOW + 600,
    iat: NOW,
    ...overrides,
  };
}

function identity(overrides: Record<string, unknown> = {}): Identity {
  const checked = checkClaims(claims(overrides), ISSUER);
  if (!checked.ok) throw new Error(checked.reason);
  return checked.identity;
}

describe("item 3: checks on top of getClaims()", () => {
  it("accepts a member token and keeps the verified claims for the transaction", () => {
    const checked = checkClaims(claims(), ISSUER);
    expect(checked).toMatchObject({
      ok: true,
      identity: {
        userId: "0b5e8a8e-1f6c-4d8a-9a51-3c1f8f2b7d10",
        sessionId: "7d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
        aal: "aal1",
        limited: false,
      },
    });
    expect(checked.ok && checked.identity.claims).toEqual(claims());
    expect(checkClaims(claims({ aud: ["other", "authenticated"] }), ISSUER).ok).toBe(true);
  });

  it.each([
    ["not_an_object", null],
    ["not_an_object", ["a"]],
    ["issuer", claims({ iss: "https://evil.example.test/auth/v1" })],
    ["issuer", claims({ iss: undefined })],
    ["audience", claims({ aud: "anon" })],
    ["role", claims({ role: "service_role" })],
    ["role", claims({ role: "anon" })],
    ["anonymous", claims({ is_anonymous: true })],
    ["anonymous", claims({ is_anonymous: undefined })],
    ["subject", claims({ sub: "not-a-uuid" })],
    ["session_id", claims({ session_id: undefined })],
    ["session_id", claims({ session_id: "1" })],
    ["aal", claims({ aal: "aal3" })],
    ["amr", claims({ amr: undefined })],
    ["amr", claims({ amr: [] })],
    ["amr", claims({ amr: [{ method: "password" }] })],
    ["amr", claims({ amr: "password" })],
  ])("rejects with %s", (reason, value) => {
    expect(checkClaims(value, ISSUER)).toEqual({ ok: false, reason });
  });

  it("the issuer is the project URL with /auth/v1, with or without a trailing slash", () => {
    expect(expectedIssuer("http://127.0.0.1:54321")).toBe(ISSUER);
    expect(expectedIssuer("http://127.0.0.1:54321/")).toBe(ISSUER);
  });
});

describe("item 7, DEC73: limited sessions", () => {
  it("a session without the password method is limited; an MFA session is not", () => {
    expect(identity({ amr: [{ method: "otp", timestamp: NOW }] }).limited).toBe(true);
    expect(identity({ amr: [{ method: "recovery", timestamp: NOW }] }).limited).toBe(true);
    const mfa = identity({
      aal: "aal2",
      amr: [
        { method: "totp", timestamp: NOW + 30 },
        { method: "password", timestamp: NOW },
      ],
    });
    expect(mfa.limited).toBe(false);
    expect(limitedSessionDenial(mfa, NOW + 86_400)).toBeNull();
  });

  it("DEC38: refused with RECOVERY_SESSION_ONLY for 5 minutes, then over", () => {
    const limited = identity({ amr: [{ method: "otp", timestamp: NOW }] });
    expect(LIMITED_SESSION_SECONDS).toBe(300);
    expect(limitedSessionExpired(limited, NOW + 300)).toBe(false);
    expect(limitedSessionDenial(limited, NOW + 300)).toBe("RECOVERY_SESSION_ONLY");
    expect(limitedSessionExpired(limited, NOW + 301)).toBe(true);
    expect(limitedSessionDenial(limited, NOW + 301)).toBe("UNAUTHENTICATED");
    expect(limitedSessionExpired(identity(), NOW + 10_000)).toBe(false);
  });
});

function state(overrides: Partial<SessionState> = {}): SessionState {
  return {
    userId: "0b5e8a8e-1f6c-4d8a-9a51-3c1f8f2b7d10",
    displayName: "عضو تجريبي",
    accountStatus: "active",
    suspendedUntil: null,
    deletionRequestedAt: null,
    restricted: false,
    emailConfirmed: true,
    termsAcknowledged: true,
    roles: [],
    ...overrides,
  };
}

describe("item 8: member access, in the order of app.assert_active_member()", () => {
  it("names the first reason only", () => {
    expect(memberDenial(state())).toBeNull();
    const everything = state({
      deletionRequestedAt: new Date(),
      restricted: true,
      emailConfirmed: false,
      termsAcknowledged: false,
    });
    expect(memberDenial(everything)).toBe("DELETION_PENDING");
    expect(memberDenial({ ...everything, deletionRequestedAt: null })).toBe("ACCOUNT_RESTRICTED");
    expect(memberDenial(state({ emailConfirmed: false, termsAcknowledged: false }))).toBe(
      "EMAIL_NOT_CONFIRMED",
    );
    expect(memberDenial(state({ termsAcknowledged: false }))).toBe("TERMS_NOT_ACKNOWLEDGED");
  });

  it("member pages: guests to login with the path, restricted accounts to /restricted", () => {
    const auth = (s: SessionState, i: Identity = identity()): SessionAuth => ({
      identity: i,
      state: s,
    });
    expect(memberPageRedirect(null, "/account/listings")).toBe("/login?next=%2Faccount%2Flistings");
    // Task 3.4: a limited session goes to the new-password page within its 5 minutes, then to
    // the login page.
    const limited = auth(state(), identity({ amr: [{ method: "otp", timestamp: NOW }] }));
    expect(memberPageRedirect(limited, "/sell", NOW + 60)).toBe("/account/reset");
    expect(memberPageRedirect(limited, "/sell", NOW + 301)).toBe("/login");
    expect(memberPageRedirect(auth(state({ restricted: true })), "/sell")).toBe("/restricted");
    expect(memberPageRedirect(auth(state({ deletionRequestedAt: new Date() })), "/sell")).toBe(
      "/restricted",
    );
    expect(memberPageRedirect(auth(state({ termsAcknowledged: false })), "/sell")).toBeNull();
    expect(memberPageRedirect(auth(state()), "/sell")).toBeNull();
  });
});

describe("item 14: what /restricted shows", () => {
  it("deletion first (DEC41), then a ban, then a suspension in force; nothing otherwise", () => {
    const requested = new Date("2026-11-19T12:00:00Z");
    expect(DELETION_RECOVERY_DAYS).toBe(30);
    expect(
      restrictionOf(
        state({ deletionRequestedAt: requested, accountStatus: "banned", restricted: true }),
      ),
    ).toEqual({ kind: "deletion_pending", deadline: new Date("2026-12-19T12:00:00Z") });
    expect(restrictionOf(state({ accountStatus: "banned", restricted: true }))).toEqual({
      kind: "banned",
    });
    const until = new Date("2026-12-01T09:00:00Z");
    expect(
      restrictionOf(state({ accountStatus: "suspended", suspendedUntil: until, restricted: true })),
    ).toEqual({ kind: "suspended", until });
    // A suspension that has ended is not a restriction (the database decides with its clock).
    expect(
      restrictionOf(
        state({ accountStatus: "suspended", suspendedUntil: until, restricted: false }),
      ),
    ).toBeNull();
    expect(restrictionOf(state())).toBeNull();
  });
});

describe("item 2: session cookies", () => {
  it("are written HttpOnly, Secure, SameSite=Lax, Path=/, for 30 days, or removed", () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(2_592_000);
    expect(sessionSetCookie("sb-127-auth-token", "base64-eyJh", false)).toBe(
      "sb-127-auth-token=base64-eyJh; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax",
    );
    expect(sessionSetCookie("sb-127-auth-token.1", "", true)).toBe(
      "sb-127-auth-token.1=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("refuses names or values that could break the header", () => {
    expect(() => sessionSetCookie("sb-127-auth-token", "a;b", false)).toThrow();
    expect(() => sessionSetCookie("bad name", "a", false)).toThrow();
  });

  it("recognizes the session cookies and their chunks only", () => {
    expect(hasSessionCookie([{ name: "sb-127-auth-token", value: "x" }])).toBe(true);
    expect(hasSessionCookie([{ name: "sb-abcd-auth-token.1", value: "x" }])).toBe(true);
    expect(hasSessionCookie([{ name: "sb-127-auth-token-code-verifier", value: "x" }])).toBe(false);
    expect(hasSessionCookie([{ name: "__Host-souq-guest", value: "x" }])).toBe(false);
  });

  it("the proxy passes on the refreshed cookies and drops removed ones", () => {
    const headers = new Headers({
      cookie: "__Host-souq-guest=g; sb-1-auth-token.0=a; sb-1-auth-token.1=b",
    });
    expect(readAllCookies(headers)).toHaveLength(3);
    const updates = new Map<string, string | null>([
      ["sb-1-auth-token", "new"],
      ["sb-1-auth-token.0", null],
      ["sb-1-auth-token.1", null],
    ]);
    expect(cookieHeaderWith(headers, updates)).toBe("__Host-souq-guest=g; sb-1-auth-token=new");
    expect(
      cookieHeaderWith(
        new Headers({ cookie: "sb-1-auth-token=a" }),
        new Map([["sb-1-auth-token", null]]),
      ),
    ).toBeNull();
  });
});
