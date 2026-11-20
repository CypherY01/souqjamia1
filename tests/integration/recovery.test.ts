// Task 3.4 (plan/task-3.4.md, items 1 and 2): API006 and API007 with the real server code against
// the local stack. FR03, TC03 (one hour, one use), BR21, DEC37, DEC52, DEC73, RL03 without
// enumeration, and the real link from Mailpit (task 3.1: amr = otp only).
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { t } from "@souq/i18n";
import { resendConfirmation } from "../../apps/web/lib/auth/confirm.ts";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import {
  RECOVERY_LOCATION,
  requestRecovery,
  verifyRecovery,
} from "../../apps/web/lib/auth/recovery.ts";
import { GUEST_COOKIE } from "../../apps/web/lib/http/csrf.ts";
import { fingerprint } from "../../apps/web/lib/http/rate-limit.ts";
import type { RequestCookie } from "../../apps/web/lib/supabase/server.ts";
import {
  flowContext,
  flowEnv,
  generateSignupLink,
  guestId,
  jsonRequest,
  outcome,
} from "./_harness/auth-flow.ts";
import { closeDb, dbPool, scalar } from "./_harness/db.ts";
import { recoveryTokenOf, waitForMail } from "./_harness/mailpit.ts";
import {
  CAPTCHA,
  cookiePairs,
  generateRecoveryLink,
  identityFrom,
  memberIdentity,
  recoverySession,
  sessionExists,
} from "./_harness/sessions.ts";
import { signUpMember, testEmail } from "./_harness/users.ts";
import { webDb } from "./_harness/web.ts";

const db = webDb();

afterAll(async () => {
  await db.end();
  await closeDb();
});

function request(body: Record<string, unknown>, env = flowEnv()) {
  return outcome(() =>
    requestRecovery(jsonRequest("/api/auth/recovery", body), flowContext(env, db)),
  );
}

function verify(
  tokenHash: string,
  options: { cookies?: readonly RequestCookie[]; identity?: Identity | null; guest?: string } = {},
) {
  return outcome(() =>
    verifyRecovery(
      jsonRequest(
        "/api/auth/recovery/verify",
        { token_hash: tokenHash },
        { guest: options.guest ?? guestId(), cookies: options.cookies ?? [] },
      ),
      flowContext(flowEnv(), db, options.identity ?? null),
    ),
  );
}

async function userIdOf(email: string): Promise<string> {
  return scalar<string>(dbPool(), "select id::text from auth.users where email = $1", [email]);
}

async function setRecoverySentAt(email: string, minutesAgo: number): Promise<void> {
  await dbPool().query(
    "update auth.users set recovery_sent_at = now() - make_interval(mins => $2) where email = $1",
    [email, minutesAgo],
  );
}

describe("API006: the request, without enumeration (FR03, RL03)", () => {
  it("an unknown address, an account, and Supabase's cooldown get the same 202", async () => {
    const unknown = await request({ email: testEmail("rec-unknown"), captcha_token: CAPTCHA });
    const member = await signUpMember();
    const account = await request({ email: member.email, captcha_token: CAPTCHA });
    // generate_link has just set recovery_sent_at: Supabase Auth's own 60-second cooldown runs,
    // and our counter has never seen this address.
    const cooling = await signUpMember();
    await generateRecoveryLink(cooling.email);
    const cooldown = await request({ email: cooling.email, captcha_token: CAPTCHA });
    for (const result of [unknown, account, cooldown]) {
      expect(result.status).toBe(202);
      expect(result.body).toEqual({ data: { status: "accepted" } });
      expect(result.setCookies).toEqual([]);
    }
  });

  it("RL03: a second request within the minute is 429, in any letter case", async () => {
    const email = testEmail("rec-minute");
    const env = flowEnv();
    expect((await request({ email, captcha_token: CAPTCHA }, env)).status).toBe(202);
    const again = await request({ email: email.toUpperCase(), captcha_token: CAPTCHA }, env);
    expect([again.status, again.code]).toEqual([429, "RATE_LIMITED"]);
    expect(again.retryAfter).toBeGreaterThan(0);
    expect(again.retryAfter).toBeLessThanOrEqual(60);
    // Another address is not limited.
    const other = await request({ email: testEmail("rec-other"), captcha_token: CAPTCHA }, env);
    expect(other.status).toBe(202);
  });

  it("RL03: the fourth in an hour is refused even after the minute", async () => {
    const email = testEmail("rec-hour");
    const env = flowEnv();
    await dbPool().query(
      `insert into app.rate_limit_bucket (scope, key_hash, window_start, count, expires_at)
       values ('RL03:email:hour', $1, date_bin('1 hour', app.app_now(), '2000-01-01Z'), 3,
               app.app_now() + interval '1 day')`,
      [fingerprint(env.APP_SECRET, "email", email)],
    );
    const result = await request({ email, captcha_token: CAPTCHA }, env);
    expect([result.status, result.code]).toEqual([429, "RATE_LIMITED"]);
  });

  it("RL03 is shared with API005: a confirmation resend counts for the recovery request", async () => {
    const email = testEmail("rec-shared");
    const env = flowEnv({ EMAIL_CONFIRMATION_REQUIRED: true });
    const resend = await outcome(() =>
      resendConfirmation(
        jsonRequest("/api/auth/resend", { email, purpose: "signup", captcha_token: CAPTCHA }),
        flowContext(env, db),
      ),
    );
    expect(resend.status).toBe(202);
    const result = await request({ email, captcha_token: CAPTCHA }, env);
    expect([result.status, result.code]).toEqual([429, "RATE_LIMITED"]);
  });

  it("DEC52: no Turnstile token is 403; a wrong address and an unknown field are refused", async () => {
    const captcha = await request({ email: `rec-${randomUUID()}@example.test`, captcha_token: "" });
    expect([captcha.status, captcha.code]).toEqual([403, "CAPTCHA_FAILED"]);
    const wrong = await request({ email: "nope", captcha_token: CAPTCHA });
    expect(wrong.status).toBe(422);
    expect(wrong.fieldErrors).toEqual([{ field: "email", code: "invalid_format" }]);
    const extra = await request({ email: testEmail(), captcha_token: CAPTCHA, next: "/" });
    expect(extra.status).toBe(400);
  });

  it("the real email from Mailpit: its link opens a limited session (amr otp only, DEC73)", async () => {
    const member = await signUpMember();
    expect((await request({ email: member.email, captcha_token: CAPTCHA })).status).toBe(202);
    const mail = await waitForMail(member.email, t("email.recovery.subject"));
    const link = recoveryTokenOf(mail);
    expect(link.path).toBe("/auth/recover");
    const result = await verify(link.tokenHash);
    expect(result.status).toBe(303);
    const identity = await identityFrom(cookiePairs(result.setCookies));
    expect(identity.userId).toBe(member.id);
    expect(identity.amr.map((entry) => entry.method)).toEqual(["otp"]);
    expect(identity.limited).toBe(true);
  });
});

describe("TC03 and API007: the link is spent once, within one hour (DEC37)", () => {
  it("303 to /account/reset with a limited session and a new guest binding", async () => {
    const member = await signUpMember();
    const guest = guestId();
    const result = await verify(await generateRecoveryLink(member.email), { guest });
    expect(result.status).toBe(303);
    expect(result.location).toBe(RECOVERY_LOCATION);
    expect(RECOVERY_LOCATION).toBe("/account/reset");
    const session = result.setCookies.filter((line) => line.startsWith("sb-"));
    expect(session.length).toBeGreaterThan(0);
    for (const line of session) expect(line).toContain("HttpOnly");
    const rotated = result.setCookies.find((line) => line.startsWith(`${GUEST_COOKIE}=`));
    expect(rotated).toBeDefined();
    expect(rotated).not.toContain(guest);
    const identity = await identityFrom(cookiePairs(result.setCookies));
    expect(identity.limited).toBe(true);
  });

  it("the same link a second time is 422 LINK_INVALID_OR_EXPIRED", async () => {
    const member = await signUpMember();
    const token = await generateRecoveryLink(member.email);
    expect((await verify(token)).status).toBe(303);
    const second = await verify(token);
    expect([second.status, second.code]).toEqual([422, "LINK_INVALID_OR_EXPIRED"]);
  });

  it("a link after 61 minutes is refused, one after 59 is accepted", async () => {
    const old = await signUpMember();
    const lateToken = await generateRecoveryLink(old.email);
    await setRecoverySentAt(old.email, 61);
    const late = await verify(lateToken);
    expect([late.status, late.code]).toEqual([422, "LINK_INVALID_OR_EXPIRED"]);

    const recent = await signUpMember();
    const recentToken = await generateRecoveryLink(recent.email);
    await setRecoverySentAt(recent.email, 59);
    expect((await verify(recentToken)).status).toBe(303);
  });

  it("only the newest link works: an earlier one is refused after a newer request", async () => {
    const member = await signUpMember();
    const earlier = await generateRecoveryLink(member.email);
    const newer = await generateRecoveryLink(member.email);
    const first = await verify(earlier);
    expect([first.status, first.code]).toEqual([422, "LINK_INVALID_OR_EXPIRED"]);
    expect((await verify(newer)).status).toBe(303);
  });

  it("an unknown or malformed token is the same 422; an empty one a field error", async () => {
    for (const token of ["0".repeat(56), "not a token"]) {
      const result = await verify(token);
      expect([result.status, result.code], token).toEqual([422, "LINK_INVALID_OR_EXPIRED"]);
    }
    const empty = await verify("");
    expect([empty.status, empty.code]).toEqual([422, "VALIDATION_FAILED"]);
  });

  it("item 2: a live ordinary session is refused with 403 and the link is not spent", async () => {
    const signedIn = await signUpMember();
    const { cookies, identity } = await memberIdentity(signedIn);
    const other = await signUpMember();
    const token = await generateRecoveryLink(other.email);
    const refused = await verify(token, { cookies, identity });
    expect([refused.status, refused.code]).toEqual([403, "FORBIDDEN"]);
    expect(await sessionExists(signedIn.sessionId)).toBe(true);
    // After the sign-out ("sign out and continue"), the same link works for a guest.
    const result = await verify(token);
    expect(result.status).toBe(303);
    expect((await identityFrom(cookiePairs(result.setCookies))).userId).toBe(other.id);
  });

  it("a recovery session from an earlier link is ended, and the new one replaces it", async () => {
    const member = await signUpMember();
    const earlier = await recoverySession(member.email);
    const { cookies, identity } = await memberIdentity(earlier);
    expect(identity.limited).toBe(true);
    const result = await verify(await generateRecoveryLink(member.email), { cookies, identity });
    expect(result.status).toBe(303);
    expect(await sessionExists(earlier.sessionId)).toBe(false);
    const next = await identityFrom(cookiePairs(result.setCookies));
    expect(next.sessionId).not.toBe(earlier.sessionId);
    expect(next.limited).toBe(true);
  });

  it("item 5: with confirmation on, the link confirms an unconfirmed account's email", async () => {
    const email = testEmail("rec-unconfirmed");
    await generateSignupLink(email);
    const userId = await userIdOf(email);
    const confirmedNow = () =>
      scalar<string>(
        dbPool(),
        "select (email_confirmed_at is not null)::text from auth.users where id = $1",
        [userId],
      );
    expect(await confirmedNow()).toBe("false");
    expect((await verify(await generateRecoveryLink(email))).status).toBe(303);
    expect(await confirmedNow()).toBe("true");
  });
});
