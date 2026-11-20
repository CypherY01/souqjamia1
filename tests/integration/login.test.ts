// Task 3.3 (plan/task-3.3.md, items 3, 4, 5 and 7): API002 with the real server code against the
// local stack. FR02, FR78, TC02, RL01 (fixed windows, owner decision on item 5), DEC70, DEC73,
// and the CSRF token after login and logout (owner condition on task 1.6).
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { afterAll, describe, expect, it } from "vitest";
import { login } from "../../apps/web/lib/auth/login.ts";
import { logout } from "../../apps/web/lib/auth/logout.ts";
import { requireSession, type GuardContext } from "../../apps/web/lib/auth/guards.ts";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import { csrfToken, GUEST_COOKIE } from "../../apps/web/lib/http/csrf.ts";
import { guardRequest } from "../../apps/web/lib/http/guard.ts";
import { fingerprint } from "../../apps/web/lib/http/rate-limit.ts";
import { SESSION_MAX_AGE_SECONDS } from "../../apps/web/lib/supabase/server.ts";
import {
  flowContext,
  flowEnv,
  generateSignupLink,
  guestId,
  jsonRequest,
  outcome,
  type RequestOptions,
} from "./_harness/auth-flow.ts";
import { closeDb, dbPool, scalar } from "./_harness/db.ts";
import {
  CAPTCHA,
  cookiePairs,
  identityFrom,
  limitedSession,
  memberIdentity,
  sessionCount,
  sessionExists,
} from "./_harness/sessions.ts";
import { signUpMember, TEST_PASSWORD, testEmail } from "./_harness/users.ts";
import { changeMember, webDb } from "./_harness/web.ts";

const db = webDb();

afterAll(async () => {
  await db.end();
  await closeDb();
});

function body(email: string, password = TEST_PASSWORD, extra: Record<string, unknown> = {}) {
  return { email, password, captcha_token: CAPTCHA, ...extra };
}

function post(
  input: unknown,
  options: RequestOptions = {},
  env = flowEnv(),
  identity: Identity | null = null,
) {
  return outcome(() =>
    login(jsonRequest("/api/auth/login", input, { guest: guestId(), ...options }), {
      ...flowContext(env, db, identity),
    }),
  );
}

/** The RL01 count of one key in the current window (0 when no attempt was counted). */
async function failures(scope: string, key: Buffer): Promise<number> {
  return Number(
    await scalar<string>(
      dbPool(),
      `select coalesce(sum(count), 0)::text from app.rate_limit_bucket
        where scope = $1 and key_hash = $2 and window_start = app.rate_limit_window_start('15 minutes')`,
      [scope, key],
    ),
  );
}

describe("FR02: login", () => {
  it("200 signed_in, session cookies with our attributes, and a new guest binding", async () => {
    const member = await signUpMember();
    const guest = guestId();
    const result = await post(body(member.email), { guest });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ data: { state: "signed_in", next: "/" } });

    const session = result.setCookies.filter((line) => line.startsWith("sb-"));
    expect(session.length).toBeGreaterThan(0);
    for (const line of session) {
      expect(line).toContain("HttpOnly");
      expect(line).toContain("Secure");
      expect(line).toContain("SameSite=Lax");
      expect(line).toContain(`Max-Age=${String(SESSION_MAX_AGE_SECONDS)}`);
    }
    expect(result.setCookies.some((line) => line.includes("code-verifier"))).toBe(false);
    const rotated = result.setCookies.find((line) => line.startsWith(`${GUEST_COOKIE}=`));
    expect(rotated).toBeDefined();
    expect(rotated).not.toContain(guest);

    // DEC73: a password session, not limited; a new session, not the signup one.
    const identity = await identityFrom(cookiePairs(result.setCookies));
    expect(identity.userId).toBe(member.id);
    expect(identity.limited).toBe(false);
    expect(identity.sessionId).not.toBe(member.sessionId);
  });

  it("the email in another case and with spaces logs in too", async () => {
    const member = await signUpMember();
    const result = await post(body(`  ${member.email.toUpperCase()} `));
    expect(result.status).toBe(200);
  });

  it("TC02: a local next comes back as it is", async () => {
    const member = await signUpMember();
    const result = await post(body(member.email, TEST_PASSWORD, { next: "/market?q=كتاب" }));
    expect(result.body).toEqual({ data: { state: "signed_in", next: "/market?q=كتاب" } });
  });

  it.each(["//evil.example", "https://evil.example", "/\\evil.example", "/login"])(
    "TC02: failed then successful login with next %s: 422, no session, nothing counted",
    async (next) => {
      const member = await signUpMember();
      const env = flowEnv();
      const before = await sessionCount(member.id);
      for (const password of ["wrong-password-1", TEST_PASSWORD]) {
        const result = await post(body(member.email, password, { next }), {}, env);
        expect(result.status).toBe(422);
        expect(result.fieldErrors).toEqual([{ field: "next", code: "not_local" }]);
        expect(result.setCookies).toEqual([]);
      }
      expect(await sessionCount(member.id)).toBe(before);
      const key = fingerprint(env.APP_SECRET, "email", member.email);
      expect(await failures("RL01:email", key)).toBe(0);
    },
  );

  it("422: every broken field at once", async () => {
    const result = await post({
      email: "not-an-email",
      password: "",
      next: "//x",
      captcha_token: CAPTCHA,
    });
    expect(result.status).toBe(422);
    expect(result.fieldErrors).toEqual([
      { field: "email", code: "invalid_format" },
      { field: "password", code: "required" },
      { field: "next", code: "not_local" },
    ]);
  });

  it("an unknown field is refused (strict body)", async () => {
    const member = await signUpMember();
    const result = await post({ ...body(member.email), role: "owner" });
    expect(result.status).toBe(400);
  });

  it("a wrong password and an unknown address get the same answer", async () => {
    const member = await signUpMember();
    const wrong = await post(body(member.email, "wrong-password-1"));
    const unknown = await post(body(testEmail("nobody"), "wrong-password-1"));
    expect(wrong).toEqual({
      status: 401,
      code: "UNAUTHENTICATED",
      fieldErrors: [],
      setCookies: [],
      location: null,
    });
    expect(unknown).toEqual(wrong);
  });

  it("FR78: a restricted account and one awaiting deletion go to /restricted", async () => {
    const suspended = await signUpMember();
    await changeMember(
      suspended.id,
      "update public.account_control set status = 'suspended', suspended_until = now() + interval '1 day' where user_id = $1",
    );
    const banned = await signUpMember();
    await changeMember(
      banned.id,
      "update public.account_control set status = 'banned' where user_id = $1",
    );
    const deleting = await signUpMember();
    await changeMember(
      deleting.id,
      "update public.account_control set deletion_requested_at = now() where user_id = $1",
    );

    for (const member of [suspended, banned]) {
      const result = await post(body(member.email, TEST_PASSWORD, { next: "/market" }));
      expect(result.body).toEqual({ data: { state: "restricted", next: "/restricted" } });
      expect(cookiePairs(result.setCookies).length).toBeGreaterThan(0);
    }
    const result = await post(body(deleting.email));
    expect(result.body).toEqual({ data: { state: "deletion_pending", next: "/restricted" } });
  });

  it("an unconfirmed account: 403 EMAIL_NOT_CONFIRMED with the right password only, no session", async () => {
    const email = testEmail("unconfirmed");
    const link = await generateSignupLink(email);
    const wrong = await post(body(email, "wrong-password-1"));
    expect(wrong.code).toBe("UNAUTHENTICATED");
    const right = await post(body(email));
    expect([right.status, right.code]).toEqual([403, "EMAIL_NOT_CONFIRMED"]);
    expect(right.setCookies).toEqual([]);
    expect(await sessionCount(link.userId)).toBe(0);
  });

  it("DEC52: without a Turnstile token 403 CAPTCHA_FAILED, not counted in RL01", async () => {
    const member = await signUpMember();
    const env = flowEnv();
    const result = await post(body(member.email, TEST_PASSWORD, { captcha_token: "" }), {}, env);
    expect([result.status, result.code]).toEqual([403, "CAPTCHA_FAILED"]);
    expect(await failures("RL01:email", fingerprint(env.APP_SECRET, "email", member.email))).toBe(
      0,
    );
  });

  it("a live ordinary session may not log in again: 403 FORBIDDEN", async () => {
    const member = await signUpMember();
    const { identity } = await memberIdentity(member);
    const result = await post(body(member.email), {}, flowEnv(), identity);
    expect([result.status, result.code]).toEqual([403, "FORBIDDEN"]);
  });

  it("DEC73: a limited session is signed out first, then the login goes on", async () => {
    const limited = await limitedSession();
    const { cookies, identity } = await memberIdentity(limited);
    expect(identity.limited).toBe(true);
    const result = await post(body(limited.email), { cookies }, flowEnv(), identity);
    expect(result.status).toBe(200);
    expect(await sessionExists(limited.sessionId)).toBe(false);
    const next = await identityFrom(cookiePairs(result.setCookies));
    expect(next.limited).toBe(false);
  });
});

describe("RL01: failed logins, fixed 15-minute windows", () => {
  it("5 wrong passwords get 401, then 429 even with the right one, and refusals are not counted", async () => {
    const member = await signUpMember();
    const env = flowEnv();
    const key = fingerprint(env.APP_SECRET, "email", member.email);
    for (let attempt = 1; attempt <= 5; attempt++) {
      const result = await post(body(member.email, `wrong-password-${String(attempt)}`), {}, env);
      expect(result.code).toBe("UNAUTHENTICATED");
      // DEC70: the failure stays counted although the attempt failed.
      expect(await failures("RL01:email", key)).toBe(attempt);
    }
    const sixth = await post(body(member.email, "wrong-password-6"), {}, env);
    expect([sixth.status, sixth.code]).toEqual([429, "RATE_LIMITED"]);
    expect(sixth.retryAfter).toBeGreaterThan(0);
    expect(sixth.retryAfter).toBeLessThanOrEqual(15 * 60);
    const right = await post(body(member.email), {}, env);
    expect([right.status, right.code]).toEqual([429, "RATE_LIMITED"]);
    expect(right.setCookies).toEqual([]);
    expect(await failures("RL01:email", key)).toBe(5);

    // Another address is not touched.
    const other = await signUpMember();
    expect((await post(body(other.email), {}, env)).status).toBe(200);

    // No permanent lock: once the window has passed, the right password works.
    await dbPool().query(
      "update app.rate_limit_bucket set window_start = window_start - interval '15 minutes' where scope = 'RL01:email' and key_hash = $1",
      [key],
    );
    expect((await post(body(member.email), {}, env)).status).toBe(200);
  });

  it("an unknown address is limited the same way (no enumeration)", async () => {
    const env = flowEnv();
    const email = testEmail("nobody");
    const answers = [];
    for (let attempt = 1; attempt <= 6; attempt++) {
      const result = await post(body(email, "wrong-password-1"), {}, env);
      answers.push(result.code);
    }
    expect(answers).toEqual([...Array<string>(5).fill("UNAUTHENTICATED"), "RATE_LIMITED"]);
  });

  it("a password that cannot be right (DEC32) is a counted failure, without asking Supabase", async () => {
    const member = await signUpMember();
    const env = flowEnv();
    const result = await post(body(member.email, "a".repeat(65)), {}, env);
    expect(result.code).toBe("UNAUTHENTICATED");
    expect(await failures("RL01:email", fingerprint(env.APP_SECRET, "email", member.email))).toBe(
      1,
    );
  });

  it("200 failures from one address behind the trusted proxy, then 429 for any email", async () => {
    const env = flowEnv({ TRUSTED_PROXY_HOPS: 1 });
    const address = "198.51.100.33";
    const key = fingerprint(env.APP_SECRET, "ip", address);
    const options = { forwardedFor: address };
    expect((await post(body(testEmail("ip"), "wrong-password-1"), options, env)).code).toBe(
      "UNAUTHENTICATED",
    );
    // 198 more failures from other addresses' members would take minutes; the counter is
    // moved to 199 directly, then the 200th failure is a real one.
    await dbPool().query(
      "update app.rate_limit_bucket set count = 199 where scope = 'RL01:ip' and key_hash = $1",
      [key],
    );
    expect((await post(body(testEmail("ip"), "wrong-password-1"), options, env)).code).toBe(
      "UNAUTHENTICATED",
    );
    expect(await failures("RL01:ip", key)).toBe(200);
    const member = await signUpMember();
    const result = await post(body(member.email), options, env);
    expect([result.status, result.code]).toEqual([429, "RATE_LIMITED"]);
    // From another address the same member logs in.
    expect((await post(body(member.email), { forwardedFor: "198.51.100.34" }, env)).status).toBe(
      200,
    );
  });
});

describe("item 7: the CSRF token after login and logout (owner condition on task 1.6)", () => {
  const ORIGIN = "http://localhost:3000";

  function accepted(
    secret: string,
    token: string,
    guest: string | undefined,
    sessionId: string | null,
  ): boolean {
    const headers = new Headers({
      origin: ORIGIN,
      "x-csrf-token": token,
      ...(guest === undefined ? {} : { cookie: `${GUEST_COOKIE}=${guest}` }),
    });
    return (
      guardRequest("POST", headers, { APP_ORIGIN: ORIGIN, APP_SECRET: secret }, sessionId) === null
    );
  }

  function guestFrom(setCookies: readonly string[]): string {
    const line = setCookies.find((entry) => entry.startsWith(`${GUEST_COOKIE}=`)) ?? "";
    return line.slice(GUEST_COOKIE.length + 1).split(";")[0] ?? "";
  }

  it("old tokens fail after login, after logout, and after a login with another account", async () => {
    const env = flowEnv();
    const first = await signUpMember();
    const second = await signUpMember();
    const guest = guestId();
    const guestToken = csrfToken(env.APP_SECRET, { kind: "guest", id: guest });
    expect(accepted(env.APP_SECRET, guestToken, guest, null)).toBe(true);

    // Login: the member binds to the new session, and the guest binding is renewed.
    const signedIn = await post(body(first.email), { guest }, env);
    const memberCookies = cookiePairs(signedIn.setCookies);
    const identity = await identityFrom(memberCookies);
    const guestAfterLogin = guestFrom(signedIn.setCookies);
    expect(accepted(env.APP_SECRET, guestToken, guestAfterLogin, identity.sessionId)).toBe(false);
    const memberToken = csrfToken(env.APP_SECRET, { kind: "member", id: identity.sessionId });
    expect(accepted(env.APP_SECRET, memberToken, guestAfterLogin, identity.sessionId)).toBe(true);

    // Logout: no session, and a guest binding that neither old token matches.
    const signedOut = await outcome(() =>
      logout(
        jsonRequest("/api/auth/logout", {}, { guest: guestAfterLogin, cookies: memberCookies }),
        {
          env,
          traceId: "trace",
          identity: () => Promise.resolve(identity),
        },
      ),
    );
    expect(signedOut.status).toBe(204);
    const guestAfterLogout = guestFrom(signedOut.setCookies);
    for (const token of [guestToken, memberToken]) {
      expect(accepted(env.APP_SECRET, token, guestAfterLogout, null)).toBe(false);
    }
    const ctx: GuardContext = { traceId: "trace", identity: () => Promise.resolve(identity) };
    await expect(requireSession(ctx, { db })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    // Another account on the same browser: nothing from the first one works.
    const again = await post(body(second.email), { guest: guestAfterLogout }, env);
    const secondIdentity = await identityFrom(cookiePairs(again.setCookies));
    const guestNow = guestFrom(again.setCookies);
    for (const token of [guestToken, memberToken]) {
      expect(accepted(env.APP_SECRET, token, guestNow, secondIdentity.sessionId)).toBe(false);
    }
  });
});
