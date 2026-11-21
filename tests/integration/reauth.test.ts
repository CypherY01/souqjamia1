// Task 3.6 (plan/task-3.6.md, items 2, 3, 6 and 9): API009 and the member_reauth level with the
// real server code against the local stack. FR59, DEC36, DEC38, DEC70, RL01, SEC01, and the CSRF
// token after reauthentication (owner condition on task 1.6).
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { afterAll, describe, expect, it } from "vitest";
import {
  REAUTH_SECONDS,
  requireMemberReauth,
  requireSession,
  type GuardContext,
} from "../../apps/web/lib/auth/guards.ts";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import { login } from "../../apps/web/lib/auth/login.ts";
import { reauthenticate } from "../../apps/web/lib/auth/reauth.ts";
import { GUEST_COOKIE } from "../../apps/web/lib/http/csrf.ts";
import type { RequestCookie } from "../../apps/web/lib/supabase/server.ts";
import { flowContext, flowEnv, guestId, jsonRequest, outcome } from "./_harness/auth-flow.ts";
import { csrfAccepts, memberToken } from "./_harness/credentials.ts";
import { closeDb } from "./_harness/db.ts";
import {
  CAPTCHA,
  cookiePairs,
  identityFrom,
  limitedSession,
  memberIdentity,
  sessionExists,
} from "./_harness/sessions.ts";
import { signUpMember, TEST_PASSWORD } from "./_harness/users.ts";
import { changeMember, webDb } from "./_harness/web.ts";

const db = webDb();

afterAll(async () => {
  await db.end();
  await closeDb();
});

function reauth(
  input: Record<string, unknown>,
  cookies: readonly RequestCookie[],
  identity: Identity | null,
  env = flowEnv(),
) {
  return outcome(() =>
    reauthenticate(
      jsonRequest("/api/auth/reauth", input, { guest: guestId(), cookies }),
      flowContext(env, db, identity),
    ),
  );
}

const right = { current_password: TEST_PASSWORD, captcha_token: CAPTCHA };

function guard(identity: Identity): GuardContext {
  return { traceId: "trace", identity: () => Promise.resolve(identity) };
}

describe("API009: reauthentication with a fresh sign-in (FR59, DEC38, SEC01)", () => {
  it("200: a new session replaces the browser's, the old one is signed out, and the window is 5 minutes", async () => {
    const member = await signUpMember();
    const { cookies, identity } = await memberIdentity(member);
    const guest = guestId();
    const before = Date.now() / 1000;
    const result = await outcome(() =>
      reauthenticate(
        jsonRequest("/api/auth/reauth", right, { guest, cookies }),
        flowContext(flowEnv(), db, identity),
      ),
    );
    expect(result.status).toBe(200);
    const until =
      Date.parse(
        (result.body as { data: { reauthenticated_until: string } }).data.reauthenticated_until,
      ) / 1000;
    expect(until).toBeGreaterThanOrEqual(Math.floor(before) + REAUTH_SECONDS);
    expect(until).toBeLessThanOrEqual(Date.now() / 1000 + REAUTH_SECONDS + 1);

    const fresh = await identityFrom(cookiePairs(result.setCookies));
    expect(fresh.userId).toBe(member.id);
    expect(fresh.sessionId).not.toBe(identity.sessionId);
    expect(fresh.limited).toBe(false);
    // SEC01: the old session is gone at Supabase Auth, and our server refuses its token.
    expect(await sessionExists(identity.sessionId)).toBe(false);
    await expect(requireSession(guard(identity), { db })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(requireSession(guard(fresh), { db })).resolves.toBeDefined();

    const rotated = result.setCookies.find((line) => line.startsWith(`${GUEST_COOKIE}=`));
    expect(rotated).toBeDefined();
    expect(rotated).not.toContain(guest);
  });

  it("owner condition on task 1.6: the CSRF token from before reauthentication is refused after it", async () => {
    const env = flowEnv();
    const member = await signUpMember();
    const { cookies, identity } = await memberIdentity(member);
    const before = memberToken(env, identity);
    expect(csrfAccepts(env, before, identity.sessionId)).toBe(true);

    const result = await reauth(right, cookies, identity, env);
    expect(result.status).toBe(200);
    const fresh = await identityFrom(cookiePairs(result.setCookies));
    expect(csrfAccepts(env, before, fresh.sessionId)).toBe(false);
    expect(csrfAccepts(env, memberToken(env, fresh), fresh.sessionId)).toBe(true);
  });

  it("RL01: 5 wrong passwords get 422, then 429 here and on the login page, and the session stays", async () => {
    const env = flowEnv();
    const member = await signUpMember();
    const { cookies, identity } = await memberIdentity(member);
    for (let attempt = 1; attempt <= 5; attempt++) {
      const wrong = await reauth(
        { current_password: `wrong-password-${String(attempt)}`, captcha_token: CAPTCHA },
        cookies,
        identity,
        env,
      );
      expect(wrong.status, `attempt ${String(attempt)}`).toBe(422);
      expect(wrong.fieldErrors).toEqual([{ field: "current_password", code: "wrong" }]);
    }
    const sixth = await reauth(right, cookies, identity, env);
    expect([sixth.status, sixth.code]).toEqual([429, "RATE_LIMITED"]);
    // The same counters as the login page (item 9).
    const loginAttempt = await outcome(() =>
      login(
        jsonRequest(
          "/api/auth/login",
          { email: member.email, password: TEST_PASSWORD, captcha_token: CAPTCHA },
          { guest: guestId() },
        ),
        flowContext(env, db),
      ),
    );
    expect([loginAttempt.status, loginAttempt.code]).toEqual([429, "RATE_LIMITED"]);
    expect(await sessionExists(identity.sessionId)).toBe(true);
  });

  it("DEC36: no Turnstile token is 403 CAPTCHA_FAILED, and nothing changes", async () => {
    const member = await signUpMember();
    const { cookies, identity } = await memberIdentity(member);
    const result = await reauth(
      { current_password: TEST_PASSWORD, captcha_token: "" },
      cookies,
      identity,
    );
    expect([result.status, result.code]).toEqual([403, "CAPTCHA_FAILED"]);
    expect(await sessionExists(identity.sessionId)).toBe(true);
  });

  it("mfa_code is 422 not_enrolled until task 7.1, and an unknown field is 400", async () => {
    const member = await signUpMember();
    const { cookies, identity } = await memberIdentity(member);
    const mfa = await reauth({ ...right, mfa_code: "123456" }, cookies, identity);
    expect(mfa.status).toBe(422);
    expect(mfa.fieldErrors).toEqual([{ field: "mfa_code", code: "not_enrolled" }]);
    const unknown = await reauth({ ...right, email: member.email }, cookies, identity);
    expect(unknown.status).toBe(400);
  });

  it("a guest is 401, a recovery session 403 RECOVERY_SESSION_ONLY, a suspended account 403 ACCOUNT_RESTRICTED", async () => {
    expect((await reauth(right, [], null)).status).toBe(401);

    const limited = await memberIdentity(await limitedSession());
    const recovery = await reauth(right, limited.cookies, limited.identity);
    expect([recovery.status, recovery.code]).toEqual([403, "RECOVERY_SESSION_ONLY"]);

    const member = await signUpMember();
    const { cookies, identity } = await memberIdentity(member);
    await changeMember(
      member.id,
      "update public.account_control set status = 'suspended', suspended_until = now() + interval '1 day' where user_id = $1",
    );
    const restricted = await reauth(right, cookies, identity);
    expect([restricted.status, restricted.code]).toEqual([403, "ACCOUNT_RESTRICTED"]);
  });
});

describe("member_reauth (DEC38): a password check within the last 5 minutes", () => {
  it("passes within 5 minutes of the sign-in, and is 403 REAUTH_REQUIRED after them", async () => {
    const member = await signUpMember();
    const { identity } = await memberIdentity(member);
    const signedIn = Math.max(...identity.amr.map((entry) => entry.timestamp));
    await expect(
      requireMemberReauth(guard(identity), { db, nowSeconds: signedIn + REAUTH_SECONDS }),
    ).resolves.toBeDefined();
    await expect(
      requireMemberReauth(guard(identity), { db, nowSeconds: signedIn + REAUTH_SECONDS + 1 }),
    ).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
  });

  it("checks the account first: a suspended account is ACCOUNT_RESTRICTED, not REAUTH_REQUIRED", async () => {
    const member = await signUpMember();
    const { identity } = await memberIdentity(member);
    await changeMember(
      member.id,
      "update public.account_control set status = 'banned' where user_id = $1",
    );
    await expect(
      requireMemberReauth(guard(identity), { db, nowSeconds: Date.now() / 1000 + 3600 }),
    ).rejects.toMatchObject({ code: "ACCOUNT_RESTRICTED" });
  });
});
