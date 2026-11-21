// Task 3.6 (plan/task-3.6.md, items 1, 7, 8, 10 and 12): API020, API021, API005 for an email
// change, and API015 pending_email, with the real server code against the local stack. FR59,
// BR23, TC74, DEC37, DEC38, DEC79 (with the owner's two conditions), RL03, SEC11, and the CSRF
// token after the change (owner condition on task 1.6).
// Local Supabase allows 30 emails an hour: one test sends real links (3 emails), one sends a
// password-changed notice, one a resend (2 emails); the others set the pending state directly.
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { afterAll, describe, expect, inject, it } from "vitest";
import { t } from "@souq/i18n";
import {
  confirmEmailChange,
  EMAIL_CHANGE_CHANGED,
  EMAIL_CHANGE_WAITING,
  requestEmailChange,
} from "../../apps/web/lib/account/email-change.ts";
import { loadAccount } from "../../apps/web/lib/account/me.ts";
import { resendConfirmation } from "../../apps/web/lib/auth/confirm.ts";
import {
  REAUTH_SECONDS,
  requireSession,
  type GuardContext,
} from "../../apps/web/lib/auth/guards.ts";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import { GUEST_COOKIE } from "../../apps/web/lib/http/csrf.ts";
import type { RequestCookie } from "../../apps/web/lib/supabase/server.ts";
import { flowContext, flowEnv, guestId, jsonRequest, outcome } from "./_harness/auth-flow.ts";
import {
  auditCount,
  changeLinks,
  csrfAccepts,
  fakeTokenHash,
  loginEmail,
  memberToken,
  pendingChange,
  recordLink,
  verifyAtSupabase,
} from "./_harness/credentials.ts";
import { closeDb, dbError, dbPool, rolledBack, scalar } from "./_harness/db.ts";
import { recoveryTokenOf, waitForMail } from "./_harness/mailpit.ts";
import {
  CAPTCHA,
  limitedSession,
  memberIdentity,
  passwordSession,
  refreshWorks,
  sessionCount,
} from "./_harness/sessions.ts";
import { signUpMember, testEmail, TEST_PASSWORD } from "./_harness/users.ts";
import { changeMember, webDb } from "./_harness/web.ts";

const db = webDb();

afterAll(async () => {
  await db.end();
  await closeDb();
});

function request(
  newEmail: string,
  cookies: readonly RequestCookie[],
  identity: Identity | null,
  options: { env?: ReturnType<typeof flowEnv>; nowSeconds?: number; extra?: object } = {},
) {
  return outcome(() =>
    requestEmailChange(
      jsonRequest(
        "/api/profile/email-change",
        { new_email: newEmail, ...options.extra },
        { guest: guestId(), cookies },
      ),
      flowContext(options.env ?? flowEnv(), db, identity),
      options.nowSeconds === undefined ? {} : { nowSeconds: options.nowSeconds },
    ),
  );
}

function confirm(
  tokenHash: unknown,
  options: { cookies?: readonly RequestCookie[]; identity?: Identity | null; guest?: string } = {},
) {
  return outcome(() =>
    confirmEmailChange(
      jsonRequest(
        "/api/profile/email-change/confirm",
        { token_hash: tokenHash },
        { guest: options.guest ?? guestId(), cookies: options.cookies ?? [] },
      ),
      flowContext(flowEnv(), db, options.identity ?? null),
    ),
  );
}

function guard(identity: Identity): GuardContext {
  return { traceId: "trace", identity: () => Promise.resolve(identity) };
}

async function confirmationRow(userId: string): Promise<string | null> {
  const result = await dbPool().query<{ state: string }>(
    `select (current_confirmed_at is not null)::text || ',' || (new_confirmed_at is not null)::text as state
       from app.email_change_confirmation where user_id = $1`,
    [userId],
  );
  return result.rows[0]?.state ?? null;
}

describe("TC74 and DEC79: both addresses confirm before the email changes (BR23)", () => {
  it("TC74 Confirm only one address during a login email change: one link, through our server or straight to Supabase Auth, leaves the email as it was; both change it and end every session", async () => {
    const env = flowEnv();
    const member = await signUpMember();
    const { cookies, identity } = await memberIdentity(member);
    const newEmail = testEmail("new");

    // API020: 202, the old email stays, API015 shows the pending one, audit; RL03 at once after.
    const requested = await request(newEmail, cookies, identity, { env });
    expect(requested.status).toBe(202);
    expect((await loginEmail(member.id)).email).toBe(member.email);
    const account = await loadAccount(db, identity, "trace");
    expect(account.me.pending_email).toBe(newEmail);
    expect(await auditCount(member.id, "account.email_change_requested")).toBe(1);
    const again = await request(newEmail, cookies, identity, { env });
    expect([again.status, again.code]).toEqual([429, "RATE_LIMITED"]);

    // Both links arrive, on the link page, and show the new address (item 10).
    const links = await changeLinks(member.email, newEmail);
    expect(links.path).toBe("/auth/email-change");
    const toOld = await waitForMail(member.email, t("email.email_change.subject"));
    expect(toOld.html).toContain(newEmail);

    // DEC79, owner condition 2: either link sent straight to Supabase Auth is refused.
    expect(await verifyAtSupabase(links.current)).not.toBe(200);
    expect(await verifyAtSupabase(links.next)).not.toBe(200);
    expect(await loginEmail(member.id)).toEqual({ email: member.email, pending: newEmail });

    // The old address through our server: recorded only; the email and the sessions stay.
    const first = await confirm(links.current);
    expect([first.status, first.location]).toEqual([303, EMAIL_CHANGE_WAITING]);
    expect((await loginEmail(member.id)).email).toBe(member.email);
    await expect(requireSession(guard(identity), { db })).resolves.toBeDefined();
    // One confirmation recorded, and the other link straight to Supabase Auth is still refused.
    expect(await verifyAtSupabase(links.next)).not.toBe(200);
    expect((await loginEmail(member.id)).email).toBe(member.email);
    // The same link again: single use (DEC37).
    expect((await confirm(links.current)).code).toBe("LINK_INVALID_OR_EXPIRED");

    // The new address, from the member's own browser: the change completes.
    const tokenBefore = memberToken(env, identity);
    const guest = guestId();
    const second = await confirm(links.next, { cookies, identity, guest });
    expect([second.status, second.location]).toEqual([303, EMAIL_CHANGE_CHANGED]);
    expect(await loginEmail(member.id)).toEqual({ email: newEmail, pending: "" });

    // BR23: every session ended, the browser's cookies removed, a new guest binding.
    expect(await sessionCount(member.id)).toBe(0);
    expect(await refreshWorks(member.refreshToken)).toBe(false);
    await expect(requireSession(guard(identity), { db })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    for (const { name } of cookies) {
      expect(second.setCookies.find((line) => line.startsWith(`${name}=`))).toContain("Max-Age=0");
    }
    const rotated = second.setCookies.find((line) => line.startsWith(`${GUEST_COOKIE}=`));
    expect(rotated).toBeDefined();
    expect(rotated).not.toContain(guest);

    // Owner condition on task 1.6: the CSRF token from before fails with the next session.
    const next = await memberIdentity(await passwordSession(newEmail, TEST_PASSWORD));
    expect(csrfAccepts(env, tokenBefore, next.identity.sessionId)).toBe(false);

    // SEC11: the old address is told, with the new address; the audit trail.
    const notice = await waitForMail(member.email, t("email.email_changed.subject"));
    expect(notice.html).toContain(t("email.email_changed.heading"));
    expect(notice.html).toContain(newEmail);
    expect(await auditCount(member.id, "account.email_change_confirmed")).toBe(2);
    expect(await auditCount(member.id, "account.email_changed")).toBe(1);
    expect(await confirmationRow(member.id)).toBeNull();

    // After the change, both links are spent.
    expect((await confirm(links.current)).code).toBe("LINK_INVALID_OR_EXPIRED");
    expect((await confirm(links.next)).code).toBe("LINK_INVALID_OR_EXPIRED");
  });

  it("DEC79: the new address may come first; each link counts once", async () => {
    const member = await signUpMember();
    const change = await pendingChange(member.id, testEmail("new"));
    expect((await recordLink(db, change.next)).outcome).toBe("recorded");
    await expect(recordLink(db, change.next)).rejects.toMatchObject({
      code: "LINK_INVALID_OR_EXPIRED",
    });
    const second = await recordLink(db, change.current);
    expect(second).toEqual({
      user_id: member.id,
      outcome: "complete",
      other_token_hash: change.next,
    });
    // A retry while the change is still pending (Supabase Auth failed) gets complete again.
    expect((await recordLink(db, change.next)).outcome).toBe("complete");
    expect(await auditCount(member.id, "account.email_change_confirmed")).toBe(2);
  });

  it("DEC79: the first link leads to the waiting page without calling Supabase Auth", async () => {
    const member = await signUpMember();
    const change = await pendingChange(member.id, testEmail("new"));
    const result = await confirm(change.current);
    expect([result.status, result.location]).toEqual([303, EMAIL_CHANGE_WAITING]);
    // No session was touched or removed.
    expect(result.setCookies).toEqual([]);
    expect(await confirmationRow(member.id)).toBe("true,false");
  });

  it("DEC37: a link of a request sent 61 minutes ago is 422; 59 minutes is still valid", async () => {
    const old = await signUpMember();
    const expired = await pendingChange(old.id, testEmail("new"), 61);
    expect((await confirm(expired.current)).code).toBe("LINK_INVALID_OR_EXPIRED");
    const recent = await signUpMember();
    const valid = await pendingChange(recent.id, testEmail("new"), 59);
    expect((await recordLink(db, valid.current)).outcome).toBe("recorded");
  });

  it("DEC79: a new request replaces the links, and what was recorded of the old ones no longer counts", async () => {
    const member = await signUpMember();
    const first = await pendingChange(member.id, testEmail("new"), 5);
    expect((await recordLink(db, first.current)).outcome).toBe("recorded");
    const second = await pendingChange(member.id, testEmail("new"));
    expect((await confirm(first.current)).code).toBe("LINK_INVALID_OR_EXPIRED");
    expect((await recordLink(db, second.next)).outcome).toBe("recorded");
    expect(await confirmationRow(member.id)).toBe("false,true");
  });

  it("two links opened at the same moment are recorded one after the other: one completes", async () => {
    const member = await signUpMember();
    const change = await pendingChange(member.id, testEmail("new"));
    const outcomes = await Promise.all([
      recordLink(db, change.current),
      recordLink(db, change.next),
    ]);
    expect(outcomes.map((row) => row.outcome).sort()).toEqual(["complete", "recorded"]);
  });

  it("a third party: one member's link touches only that member, and a made-up link is 422", async () => {
    const a = await signUpMember();
    const b = await signUpMember();
    await pendingChange(a.id, testEmail("new"));
    const changeB = await pendingChange(b.id, testEmail("new"));
    expect((await recordLink(db, changeB.current)).user_id).toBe(b.id);
    expect(await confirmationRow(a.id)).toBeNull();
    expect((await confirm(fakeTokenHash())).code).toBe("LINK_INVALID_OR_EXPIRED");
    expect((await confirm("")).status).toBe(422);
    const unknown = await outcome(() =>
      confirmEmailChange(
        jsonRequest("/api/profile/email-change/confirm", {
          token_hash: changeB.next,
          user_id: a.id,
        }),
        flowContext(flowEnv(), db),
      ),
    );
    expect(unknown.status).toBe(400);
  });
});

describe("DEC79, owner condition 1: the trigger acts only when the email column changes", () => {
  it("it is defined BEFORE UPDATE OF email, WHEN the email is distinct", async () => {
    const definition = await scalar<string>(
      dbPool(),
      `select pg_get_triggerdef(oid) from pg_trigger
        where tgrelid = 'auth.users'::regclass and tgname = 'guard_email_change'`,
    );
    expect(definition).toContain("BEFORE UPDATE OF email ON auth.users");
    expect(definition).toContain("WHEN (((old.email)::text IS DISTINCT FROM (new.email)::text))");
  });

  it("with a change pending and unconfirmed: sign-in, session refresh, password change and signup work, and the change stays pending", async () => {
    const member = await signUpMember();
    const newEmail = testEmail("new");
    await pendingChange(member.id, newEmail);
    const signedIn = await passwordSession(member.email);
    expect(await refreshWorks(signedIn.refreshToken)).toBe(true);
    const stack = inject("stack");
    const changed = await fetch(`${stack.apiUrl}/auth/v1/user`, {
      method: "PUT",
      headers: {
        apikey: stack.publishableKey,
        authorization: `Bearer ${signedIn.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ password: "كلمة-مرور-أخرى-4" }),
    });
    await changed.body?.cancel();
    expect(changed.status).toBe(200);
    expect((await signUpMember()).id).toBeDefined();
    expect(await loginEmail(member.id)).toEqual({ email: member.email, pending: newEmail });
  });

  it("any other change of the email column is refused", async () => {
    const member = await signUpMember();
    const error = await rolledBack((client) =>
      dbError(client, "update auth.users set email = $2 where id = $1", [
        member.id,
        testEmail("direct"),
      ]),
    );
    expect(error).toMatchObject({ code: "SJ001", message: "LINK_INVALID_OR_EXPIRED" });
    expect((await loginEmail(member.id)).email).toBe(member.email);
  });
});

describe("API020: the request (member_reauth, RL03)", () => {
  it("an address of another account is 422 taken, the current one same_email, a malformed one invalid_format", async () => {
    const member = await signUpMember();
    const other = await signUpMember();
    const { cookies, identity } = await memberIdentity(member);
    const taken = await request(other.email, cookies, identity);
    expect(taken.fieldErrors).toEqual([{ field: "new_email", code: "taken" }]);
    const same = await request(member.email.toUpperCase(), cookies, identity);
    expect(same.fieldErrors).toEqual([{ field: "new_email", code: "same_email" }]);
    const malformed = await request("nope", cookies, identity);
    expect(malformed.fieldErrors).toEqual([{ field: "new_email", code: "invalid_format" }]);
    expect(await loginEmail(member.id)).toEqual({ email: member.email, pending: "" });
  });

  it("DEC38: more than 5 minutes after the last password check is 403 REAUTH_REQUIRED", async () => {
    const member = await signUpMember();
    const { cookies, identity } = await memberIdentity(member);
    const signedIn = Math.max(...identity.amr.map((entry) => entry.timestamp));
    const late = await request(testEmail("new"), cookies, identity, {
      nowSeconds: signedIn + REAUTH_SECONDS + 1,
    });
    expect([late.status, late.code]).toEqual([403, "REAUTH_REQUIRED"]);
    expect((await loginEmail(member.id)).pending).toBe("");
  });

  it("a guest is 401, a recovery session 403 RECOVERY_SESSION_ONLY, a banned account 403 ACCOUNT_RESTRICTED, an unknown field 400", async () => {
    expect((await request(testEmail("new"), [], null)).status).toBe(401);
    const limited = await memberIdentity(await limitedSession());
    const recovery = await request(testEmail("new"), limited.cookies, limited.identity);
    expect(recovery.code).toBe("RECOVERY_SESSION_ONLY");

    const member = await signUpMember();
    const { cookies, identity } = await memberIdentity(member);
    const unknown = await request(testEmail("new"), cookies, identity, { extra: { email: "x" } });
    expect(unknown.status).toBe(400);
    await changeMember(
      member.id,
      "update public.account_control set status = 'banned' where user_id = $1",
    );
    const banned = await request(testEmail("new"), cookies, identity);
    expect([banned.status, banned.code]).toEqual([403, "ACCOUNT_RESTRICTED"]);
  });
});

describe("API015 pending_email and API005 resend for an email change", () => {
  it("pending_email is the new address while the links are valid, and null after an hour", async () => {
    const member = await signUpMember();
    const { identity } = await memberIdentity(member);
    const newEmail = testEmail("new");
    await pendingChange(member.id, newEmail);
    expect((await loadAccount(db, identity, "trace")).me.pending_email).toBe(newEmail);
    await pendingChange(member.id, newEmail, 61);
    expect((await loadAccount(db, identity, "trace")).me.pending_email).toBeNull();
  });

  it("with confirmation on, API005 sends both links again and the old ones are refused; with it off, 404", async () => {
    const member = await signUpMember();
    const newEmail = testEmail("new");
    // Two minutes ago: Supabase Auth sends no email within a minute of the last one.
    const old = await pendingChange(member.id, newEmail, 2);
    const resend = (env: ReturnType<typeof flowEnv>) =>
      outcome(() =>
        resendConfirmation(
          jsonRequest(
            "/api/auth/resend",
            { email: member.email, purpose: "email_change", captcha_token: CAPTCHA },
            { guest: guestId() },
          ),
          flowContext(env, db),
        ),
      );
    expect((await resend(flowEnv())).status).toBe(404);
    expect((await resend(flowEnv({ EMAIL_CONFIRMATION_REQUIRED: true }))).status).toBe(202);

    const links = await changeLinks(member.email, newEmail);
    expect(links.current).not.toBe(old.current);
    expect((await confirm(old.current)).code).toBe("LINK_INVALID_OR_EXPIRED");
    expect((await recordLink(db, links.current)).outcome).toBe("recorded");
    const mail = await waitForMail(newEmail, t("email.email_change.subject"));
    expect(recoveryTokenOf(mail).tokenHash).toBe(links.next);
  });
});
