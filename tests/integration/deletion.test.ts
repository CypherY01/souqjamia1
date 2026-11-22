// Task 3.7 (plan/task-3.7.md): the account deletion request and its recovery, with the real
// server code against the local stack. FR72, BR40, UC23, DEC37, DEC39, DEC41, DEC73, DEC81,
// RL03, SEC01, TC59, and the owner conditions on items 2 and 8.
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, inject, it } from "vitest";
import {
  ACCOUNT_RECOVERY_LOCATION,
  confirmDeletionRecovery,
  requestDeletion,
  requestDeletionRecovery,
} from "../../apps/web/lib/account/deletion.ts";
import {
  requireAccountReauth,
  requireMember,
  requireSession,
  type GuardContext,
} from "../../apps/web/lib/auth/guards.ts";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import { login } from "../../apps/web/lib/auth/login.ts";
import { requestRecovery } from "../../apps/web/lib/auth/recovery.ts";
import { GUEST_COOKIE } from "../../apps/web/lib/http/csrf.ts";
import type { RequestCookie } from "../../apps/web/lib/supabase/server.ts";
import { flowContext, flowEnv, guestId, jsonRequest, outcome } from "./_harness/auth-flow.ts";
import { setClock } from "./_harness/clock.ts";
import { auditCount, csrfAccepts, memberToken } from "./_harness/credentials.ts";
import { closeDb, dbError, dbPool, rolledBack, scalar } from "./_harness/db.ts";
import { recoveryTokenOf, waitForMail } from "./_harness/mailpit.ts";
import { withTwoConnections } from "./_harness/parallel.ts";
import { actAs, memberClaims } from "./_harness/roles.ts";
import {
  CAPTCHA,
  generateRecoveryLink,
  limitedSession,
  memberIdentity,
  passwordSession,
  recoverySession,
  refreshWorks,
  sessionCount,
  sessionExists,
} from "./_harness/sessions.ts";
import { signUpMember, testEmail, TEST_PASSWORD, type TestMember } from "./_harness/users.ts";
import { changeMember, webDb, withdrawAcknowledgments } from "./_harness/web.ts";

const db = webDb();
const RECOVERY_SUBJECT = "استرجاع حسابك في سوق الجامعة";

afterAll(async () => {
  await db.end();
  await closeDb();
});

function guard(identity: Identity): GuardContext {
  return { traceId: "trace", identity: () => Promise.resolve(identity) };
}

function deletion(
  body: unknown,
  cookies: readonly RequestCookie[],
  identity: Identity | null,
  env = flowEnv(),
  guest = guestId(),
  nowSeconds?: number,
) {
  return outcome(() =>
    requestDeletion(
      jsonRequest("/api/profile/deletion", body, { guest, cookies }),
      flowContext(env, db, identity),
      nowSeconds === undefined ? {} : { nowSeconds },
    ),
  );
}

function recoveryRequest(email: string, env = flowEnv()) {
  return outcome(() =>
    requestDeletionRecovery(
      jsonRequest(
        "/api/profile/deletion-recovery/request",
        { email, captcha_token: CAPTCHA },
        { guest: guestId() },
      ),
      flowContext(env, db),
    ),
  );
}

function recoveryConfirm(tokenHash: string, cookies: readonly RequestCookie[] = []) {
  return outcome(() =>
    confirmDeletionRecovery(
      jsonRequest(
        "/api/profile/deletion-recovery/confirm",
        { token_hash: tokenHash },
        { guest: guestId(), cookies },
      ),
      flowContext(flowEnv(), db),
    ),
  );
}

interface AccountRow {
  deletion_requested_at: Date | null;
  status: string;
  hidden_from_public: boolean;
  version: number;
}

async function account(userId: string): Promise<AccountRow> {
  const result = await dbPool().query<AccountRow>(
    `select c.deletion_requested_at, c.status::text as status, p.hidden_from_public, c.version
       from public.account_control c join public.profile p on p.id = c.user_id
      where c.user_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("no such account");
  return row;
}

async function notificationCount(userId: string, eventType: string): Promise<number> {
  return Number(
    await scalar<string>(
      dbPool(),
      "select count(*)::text from public.notification where recipient_id = $1 and event_type = $2",
      [userId, eventType],
    ),
  );
}

/** A Supabase sign-in link through the Auth admin API (local secret key only), with no email. */
async function generateMagicLink(email: string): Promise<string> {
  const stack = inject("stack");
  const res = await fetch(`${stack.apiUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: stack.secretKey,
      authorization: `Bearer ${stack.secretKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  if (res.status !== 200) throw new Error(`generate_link failed with ${String(res.status)}`);
  return ((await res.json()) as { hashed_token: string }).hashed_token;
}

/** Status of a token_hash verified straight at Supabase Auth with `type`. */
async function verifyAs(type: string, tokenHash: string): Promise<number> {
  const stack = inject("stack");
  const res = await fetch(`${stack.apiUrl}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: stack.publishableKey, "content-type": "application/json" },
    body: JSON.stringify({ type, token_hash: tokenHash }),
  });
  await res.text();
  return res.status;
}

/** A member whose deletion was requested through API026, with Supabase revoking its sessions. */
async function deletedMember(): Promise<TestMember> {
  const member = await signUpMember();
  const { cookies, identity } = await memberIdentity(member);
  const result = await deletion({ acknowledge: true }, cookies, identity);
  if (result.status !== 202) throw new Error(`deletion failed with ${String(result.status)}`);
  return member;
}

/** Profile rows a role sees through RLS, as the browser would. */
async function visibleProfiles(
  role: "anon" | "authenticated",
  userId: string,
  viewer?: string,
): Promise<number> {
  return rolledBack(async (client) => {
    await actAs(client, role, viewer === undefined ? undefined : memberClaims(viewer));
    const result = await client.query("select id from public.profile where id = $1", [userId]);
    return result.rowCount ?? 0;
  });
}

describe("API026: the deletion request (FR72, DEC41, SEC01)", () => {
  it("FR72 API026 revokes every session of the member", async () => {
    const env = flowEnv();
    const member = await signUpMember();
    const other = await passwordSession(member.email);
    const { cookies, identity } = await memberIdentity(member);
    const guest = guestId();
    const before = memberToken(env, identity);

    const result = await deletion({ acknowledge: true }, cookies, identity, env, guest);
    expect([result.status, result.body]).toEqual([202, { data: { status: "accepted" } }]);
    // The browser's session cookies are removed and the guest binding renewed (task 1.6).
    for (const { name } of cookies) {
      expect(result.setCookies.some((line) => line.startsWith(`${name}=;`))).toBe(true);
    }
    const rotated = result.setCookies.find((line) => line.startsWith(`${GUEST_COOKIE}=`));
    expect(rotated).toBeDefined();
    expect(rotated).not.toContain(guest);
    // SEC01: every session, the other device's too, at Supabase Auth and in our guards.
    expect(await sessionCount(member.id)).toBe(0);
    expect(await refreshWorks(other.refreshToken)).toBe(false);
    await expect(requireSession(guard(identity), { db })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    // Owner condition on task 1.6: the token bound to the old session is refused.
    expect(csrfAccepts(env, before, null)).toBe(false);

    const row = await account(member.id);
    expect(row.deletion_requested_at).not.toBeNull();
    expect(row.status).toBe("active");
    expect(row.hidden_from_public).toBe(true);
    expect(await auditCount(member.id, "account.deletion_requested")).toBe(1);
    // SEC11: the in-app notice now; its email joins in task 3.8 (owner condition on item 2).
    expect(await notificationCount(member.id, "account.deletion_requested")).toBe(1);
  });

  it("owner condition on item 8: the old session is refused at once, even when Supabase Auth cannot revoke it", async () => {
    const member = await signUpMember();
    const other = await passwordSession(member.email);
    const { cookies, identity } = await memberIdentity(member);
    // Nothing listens on port 9: the sign-out at Supabase Auth fails after the commit.
    const unreachable = flowEnv({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9" });

    const result = await deletion({ acknowledge: true }, cookies, identity, unreachable);
    expect(result.status).toBe(202);
    expect(await sessionExists(identity.sessionId)).toBe(true);
    expect(await sessionExists(other.sessionId)).toBe(true);

    // Our guards and the database refuse both sessions from the commit on.
    const { identity: otherIdentity } = await memberIdentity(other);
    for (const session of [identity, otherIdentity]) {
      await expect(requireMember(guard(session), { db })).rejects.toMatchObject({
        code: "DELETION_PENDING",
      });
      await expect(requireAccountReauth(guard(session), { db })).rejects.toMatchObject({
        code: "DELETION_PENDING",
      });
      await expect(
        db.withActor(session.claims, "trace", (tx) =>
          tx.query("select app.update_profile(1, '{}'::jsonb)"),
        ),
      ).rejects.toMatchObject({ code: "DELETION_PENDING" });
    }
    // A second request from a session left behind changes nothing.
    const again = await deletion({ acknowledge: true }, cookies, identity, unreachable);
    expect([again.status, again.code]).toEqual([403, "DELETION_PENDING"]);
    expect(await auditCount(member.id, "account.deletion_requested")).toBe(1);
  });

  it("DEC41 login during the recovery period returns deletion_pending", async () => {
    const member = await deletedMember();
    const result = await outcome(() =>
      login(
        jsonRequest(
          "/api/auth/login",
          { email: member.email, password: TEST_PASSWORD, captcha_token: CAPTCHA },
          { guest: guestId() },
        ),
        flowContext(flowEnv(), db),
      ),
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ data: { state: "deletion_pending", next: "/restricted" } });
    // A session of the pending period writes nothing to the market (DEC41).
    const session = await passwordSession(member.email);
    const { identity } = await memberIdentity(session);
    await expect(
      db.withActor(identity.claims, "trace", (tx) =>
        tx.query("select app.update_profile(1, '{}'::jsonb)"),
      ),
    ).rejects.toMatchObject({ code: "DELETION_PENDING" });
    await expect(requireSession(guard(identity), { db })).resolves.toMatchObject({
      state: { deletionRequestedAt: expect.any(Date) as Date },
    });
  });

  it("DEC41 a deletion request hides the profile from guests and third parties", async () => {
    const member = await signUpMember();
    const third = await signUpMember("عضو ثالث");
    expect(await visibleProfiles("anon", member.id)).toBe(1);
    expect(await visibleProfiles("authenticated", member.id, third.id)).toBe(1);
    const { cookies, identity } = await memberIdentity(member);
    expect((await deletion({ acknowledge: true }, cookies, identity)).status).toBe(202);
    expect(await visibleProfiles("anon", member.id)).toBe(0);
    expect(await visibleProfiles("authenticated", member.id, third.id)).toBe(0);
    // The member's own row stays readable to its own sessions (RLS, task 2.2).
    expect(await visibleProfiles("authenticated", member.id, member.id)).toBe(1);
    // The third party's own account is untouched.
    expect((await account(third.id)).deletion_requested_at).toBeNull();
  });

  it("DEC38: after 5 minutes from the last password check, 403 REAUTH_REQUIRED and nothing changes", async () => {
    const member = await signUpMember();
    const { cookies, identity } = await memberIdentity(member);
    const result = await deletion(
      { acknowledge: true },
      cookies,
      identity,
      flowEnv(),
      guestId(),
      Date.now() / 1000 + 301,
    );
    expect([result.status, result.code]).toEqual([403, "REAUTH_REQUIRED"]);
    expect(result.setCookies).toEqual([]);
    expect((await account(member.id)).deletion_requested_at).toBeNull();
    expect(await sessionExists(identity.sessionId)).toBe(true);
  });

  it("DEC81: a member who has not acknowledged the current policy versions may still request deletion", async () => {
    const member = await signUpMember();
    await withdrawAcknowledgments(member.id);
    const { cookies, identity } = await memberIdentity(member);
    await expect(requireMember(guard(identity), { db })).rejects.toMatchObject({
      code: "TERMS_NOT_ACKNOWLEDGED",
    });
    const result = await deletion({ acknowledge: true }, cookies, identity);
    expect(result.status).toBe(202);
    expect((await account(member.id)).deletion_requested_at).not.toBeNull();
  });

  it("DEC81: a suspended or banned account is refused with ACCOUNT_RESTRICTED", async () => {
    for (const sql of [
      "update public.account_control set status = 'suspended', suspended_until = now() + interval '1 day' where user_id = $1",
      "update public.account_control set status = 'banned' where user_id = $1",
    ]) {
      const member = await signUpMember();
      const { cookies, identity } = await memberIdentity(member);
      await changeMember(member.id, sql);
      const result = await deletion({ acknowledge: true }, cookies, identity);
      expect([result.status, result.code]).toEqual([403, "ACCOUNT_RESTRICTED"]);
      expect((await account(member.id)).deletion_requested_at).toBeNull();
    }
  });

  it("the database refuses the request without a confirmed email, and from a limited session", async () => {
    const member = await signUpMember();
    const { identity } = await memberIdentity(member);
    const unconfirmed = await rolledBack(async (client) => {
      await client.query("update auth.users set email_confirmed_at = null where id = $1", [
        member.id,
      ]);
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(identity.claims),
      ]);
      return dbError(client, "select app.request_account_deletion()");
    });
    expect(unconfirmed.message).toBe("EMAIL_NOT_CONFIRMED");

    const limited = await limitedSession();
    const { cookies, identity: limitedIdentity } = await memberIdentity(limited);
    const result = await deletion({ acknowledge: true }, cookies, limitedIdentity);
    expect([result.status, result.code]).toEqual([403, "RECOVERY_SESSION_ONLY"]);
    const direct = await rolledBack(async (client) => {
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(limitedIdentity.claims),
      ]);
      return dbError(client, "select app.request_account_deletion()");
    });
    expect(direct.message).toBe("RECOVERY_SESSION_ONLY");
  });

  it("a guest is UNAUTHENTICATED, and acknowledge other than true is 400 with nothing changed", async () => {
    expect(await deletion({ acknowledge: true }, [], null)).toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
    const member = await signUpMember();
    const { cookies, identity } = await memberIdentity(member);
    for (const body of [{}, { acknowledge: false }, { acknowledge: "true" }]) {
      const result = await deletion(body, cookies, identity);
      expect([result.status, result.code]).toEqual([400, "BAD_REQUEST"]);
      expect(result.fieldErrors).toEqual([{ field: "acknowledge", code: "required" }]);
    }
    const extra = await deletion({ acknowledge: true, user_id: member.id }, cookies, identity);
    expect([extra.status, extra.code]).toEqual([400, "BAD_REQUEST"]);
    expect((await account(member.id)).deletion_requested_at).toBeNull();
    expect(await sessionExists(identity.sessionId)).toBe(true);
  });

  it("two concurrent requests: one records the request, the other gets DELETION_PENDING", async () => {
    const member = await signUpMember();
    const { identity } = await memberIdentity(member);
    const claims = JSON.stringify(identity.claims);
    const outcomes = await withTwoConnections(async (a, b) => {
      for (const client of [a, b]) {
        await client.query("begin");
        await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
      }
      await a.query("select app.request_account_deletion()");
      // b waits for a's row lock (FOR UPDATE), then sees the request.
      const second = b.query("select app.request_account_deletion()").then(
        () => "recorded",
        (error: unknown) => (error as Error).message,
      );
      await a.query("commit");
      return [await second];
    });
    expect(outcomes).toEqual(["DELETION_PENDING"]);
    expect(await auditCount(member.id, "account.deletion_requested")).toBe(1);
  });

  it("DEC39 a deletion request calls the pending cancellation hook", async () => {
    const member = await signUpMember();
    const { identity } = await memberIdentity(member);
    const result = await rolledBack(async (client) => {
      // Tasks 5.5, 5.6 and 6.1 fill the hook in; here a stand-in reports how it was called.
      await client.query(`create or replace function app.cancel_pending_for_account(p_user_id uuid, p_reason text)
        returns integer language plpgsql volatile set search_path = '' as $$
        begin
          raise exception 'hook % %', p_user_id, p_reason;
        end;
        $$`);
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(identity.claims),
      ]);
      return dbError(client, "select app.request_account_deletion()");
    });
    expect(result.message).toBe(`hook ${member.id} account_restricted`);
    // The hook takes the DEC39 reason only.
    const wrong = await rolledBack((client) =>
      dbError(client, "select app.cancel_pending_for_account($1, 'blocked')", [member.id]),
    );
    expect(wrong.message).toBe("BAD_REQUEST");
  });
});

describe("TC59: recovery within the 30 days only, restrictions kept (test clock)", () => {
  const start = new Date("2026-06-01T09:00:00Z");
  const day = 86_400_000;

  /** Request at `start` and recover at `at`, in one rolled-back transaction. */
  async function recoverAt(
    member: TestMember,
    at: Date,
    restrict?: string,
  ): Promise<{ error: string | null; row: AccountRow }> {
    const { identity } = await memberIdentity(member);
    const link = await recoverySession(member.email);
    const { identity: linkIdentity } = await memberIdentity(link);
    return rolledBack(async (client) => {
      await setClock(client, start);
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(identity.claims),
      ]);
      await client.query("select app.request_account_deletion()");
      if (restrict !== undefined) await client.query(restrict, [member.id]);
      await setClock(client, at);
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(linkIdentity.claims),
      ]);
      let error: string | null = null;
      try {
        await client.query("savepoint recover");
        await client.query("select app.recover_account_deletion()");
      } catch (caught) {
        await client.query("rollback to savepoint recover");
        error = (caught as Error).message;
      }
      const result = await client.query<AccountRow>(
        `select c.deletion_requested_at, c.status::text as status, p.hidden_from_public, c.version
           from public.account_control c join public.profile p on p.id = c.user_id
          where c.user_id = $1`,
        [member.id],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error("no such account");
      return { error, row };
    });
  }

  it("TC59 deletion recovery on day 29 succeeds", async () => {
    const member = await signUpMember();
    const { error, row } = await recoverAt(member, new Date(start.getTime() + 29 * day));
    expect(error).toBeNull();
    expect(row.deletion_requested_at).toBeNull();
    expect(row.hidden_from_public).toBe(false);
    // One second before the end of the period still recovers.
    const late = await recoverAt(await signUpMember(), new Date(start.getTime() + 30 * day - 1000));
    expect(late.error).toBeNull();
  });

  it("TC59 deletion recovery after day 30 is refused", async () => {
    for (const at of [start.getTime() + 30 * day, start.getTime() + 31 * day]) {
      const member = await signUpMember();
      const { error, row } = await recoverAt(member, new Date(at));
      expect(error).toBe("DEADLINE_PASSED");
      expect(row.deletion_requested_at).toEqual(start);
      expect(row.hidden_from_public).toBe(true);
    }
  });

  it("TC59 recovery keeps a ban and a suspension", async () => {
    const banned = await recoverAt(
      await signUpMember(),
      new Date(start.getTime() + 10 * day),
      "update public.account_control set status = 'banned' where user_id = $1",
    );
    expect(banned.error).toBeNull();
    expect(banned.row).toMatchObject({
      deletion_requested_at: null,
      status: "banned",
      hidden_from_public: true,
    });
    const suspended = await recoverAt(
      await signUpMember(),
      new Date(start.getTime() + 10 * day),
      "update public.account_control set status = 'suspended', suspended_until = now() + interval '90 days' where user_id = $1",
    );
    expect(suspended.error).toBeNull();
    expect(suspended.row).toMatchObject({
      deletion_requested_at: null,
      status: "suspended",
      hidden_from_public: true,
    });
  });

  it("DEC41: an ordinary password session cannot recover without the link", async () => {
    const member = await deletedMember();
    const session = await passwordSession(member.email);
    const { identity } = await memberIdentity(session);
    const error = await rolledBack(async (client) => {
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(identity.claims),
      ]);
      return dbError(client, "select app.recover_account_deletion()");
    });
    expect(error.message).toBe("FORBIDDEN");
    expect((await account(member.id)).deletion_requested_at).not.toBeNull();
  });
});

describe("API027: the recovery link request (DEC37, DEC41, RL03)", () => {
  it("the same 202 for an unknown, an active, an expired and a pending account; the link reaches the pending one only", async () => {
    const env = flowEnv();
    const active = await signUpMember();
    const expired = await deletedMember();
    await changeMember(
      expired.id,
      "update public.account_control set deletion_requested_at = now() - interval '31 days' where user_id = $1",
    );
    const pending = await deletedMember();
    const unknown = testEmail("nobody");
    for (const email of [unknown, active.email, expired.email, pending.email]) {
      const result = await recoveryRequest(email, env);
      expect([result.status, result.body], email).toEqual([202, { data: { status: "accepted" } }]);
      expect(result.setCookies).toEqual([]);
      // RL03 is counted for every address before anything else: the second within the minute.
      const again = await recoveryRequest(email, env);
      expect([again.status, again.code], email).toEqual([429, "RATE_LIMITED"]);
    }
    // The same counters as the password recovery request (API006).
    const recovery = await outcome(() =>
      requestRecovery(
        jsonRequest(
          "/api/auth/recovery",
          { email: unknown, captcha_token: CAPTCHA },
          { guest: guestId() },
        ),
        flowContext(env, db),
      ),
    );
    expect([recovery.status, recovery.code]).toEqual([429, "RATE_LIMITED"]);
    const mail = await waitForMail(pending.email, RECOVERY_SUBJECT);
    const link = recoveryTokenOf(mail);
    expect(link.path).toBe("/auth/account-recovery");
    // DEC65 and the notice for an account not awaiting deletion are in the message.
    expect(mail.html).toContain("إذا لم تسجّل في سوق الجامعة، تجاهل هذه الرسالة.");
    for (const email of [active.email, expired.email]) {
      await expect(waitForMail(email, RECOVERY_SUBJECT)).rejects.toThrow("no ");
    }
  }, 60_000);

  it("an address in a wrong format is 422 for the field email", async () => {
    const result = await recoveryRequest("not-an-address");
    expect([result.status, result.code]).toEqual([422, "VALIDATION_FAILED"]);
    expect(result.fieldErrors).toEqual([{ field: "email", code: "invalid_format" }]);
  });

  it("DEC77 app.deletion_recovery_pending(): a guest reads one boolean for the given address", async () => {
    const pending = await deletedMember();
    const read = (email: string) =>
      db.withActor(null, "trace", async (tx) => {
        const result = await tx.query<{ pending: boolean }>(
          "select app.deletion_recovery_pending($1) as pending",
          [email],
        );
        return result.rows;
      });
    expect(await read(pending.email)).toEqual([{ pending: true }]);
    expect(await read(pending.email.toUpperCase())).toEqual([{ pending: true }]);
    expect(await read(testEmail("nobody"))).toEqual([{ pending: false }]);
    expect(await read("")).toEqual([{ pending: false }]);
  });

  it("DEC77 app.deletion_recovery_pending(): a member's identity changes nothing", async () => {
    const pending = await deletedMember();
    const third = await signUpMember("عضو ثالث");
    const { identity } = await memberIdentity(third);
    const read = (claims: Readonly<Record<string, unknown>> | null, email: string) =>
      db.withActor(claims, "trace", async (tx) => {
        const result = await tx.query<{ pending: boolean }>(
          "select app.deletion_recovery_pending($1) as pending",
          [email],
        );
        return result.rows[0]?.pending;
      });
    expect(await read(identity.claims, pending.email)).toBe(true);
    expect(await read(identity.claims, third.email)).toBe(false);
    expect(await read(null, third.email)).toBe(false);
  });
});

describe("API028: the recovery link (DEC37, DEC41, DEC73, TC59)", () => {
  it("a real link recovers the account; its session never leaves the server; it works once", async () => {
    const member = await deletedMember();
    expect((await recoveryRequest(member.email)).status).toBe(202);
    const { tokenHash } = recoveryTokenOf(await waitForMail(member.email, RECOVERY_SUBJECT));
    const sessionsBefore = await sessionCount(member.id);

    const result = await recoveryConfirm(tokenHash);
    expect([result.status, result.location]).toEqual([303, ACCOUNT_RECOVERY_LOCATION]);
    expect(result.location).toBe("/auth/account-recovery/done");
    expect(result.setCookies).toEqual([]);
    // The link's session was ended on the server.
    expect(await sessionCount(member.id)).toBe(sessionsBefore);
    const row = await account(member.id);
    expect(row.deletion_requested_at).toBeNull();
    expect(row.hidden_from_public).toBe(false);
    expect(await auditCount(member.id, "account.deletion_recovered")).toBe(1);
    expect(await notificationCount(member.id, "account.deletion_recovered")).toBe(1);

    const again = await recoveryConfirm(tokenHash);
    expect([again.status, again.code]).toEqual([422, "LINK_INVALID_OR_EXPIRED"]);
    // The member signs in as before.
    const session = await passwordSession(member.email);
    const { identity } = await memberIdentity(session);
    await expect(requireMember(guard(identity), { db })).resolves.toBeDefined();
  });

  it("a link for an account not awaiting deletion is 422 and changes nothing", async () => {
    const active = await signUpMember();
    const before = await account(active.id);
    const sessionsBefore = await sessionCount(active.id);
    const result = await recoveryConfirm(await generateMagicLink(active.email));
    expect([result.status, result.code]).toEqual([422, "LINK_INVALID_OR_EXPIRED"]);
    expect(await account(active.id)).toEqual(before);
    expect(await sessionCount(active.id)).toBe(sessionsBefore);
    expect(await auditCount(active.id, "account.deletion_recovered")).toBe(0);
  });

  it("after 30 days the link is 422 DEADLINE_PASSED, and the account stays pending", async () => {
    const member = await deletedMember();
    await changeMember(
      member.id,
      "update public.account_control set deletion_requested_at = now() - interval '30 days 1 minute' where user_id = $1",
    );
    const result = await recoveryConfirm(await generateMagicLink(member.email));
    expect([result.status, result.code]).toEqual([422, "DEADLINE_PASSED"]);
    expect((await account(member.id)).deletion_requested_at).not.toBeNull();
    expect(await sessionCount(member.id)).toBe(0);
  });

  it("a made-up token is 422, and the browser's own session is not read", async () => {
    const result = await recoveryConfirm(randomBytes(28).toString("hex"));
    expect([result.status, result.code]).toEqual([422, "LINK_INVALID_OR_EXPIRED"]);
    // A link of a pending account recovers it whoever is signed in in the browser.
    const member = await deletedMember();
    const bystander = await signUpMember("عضو آخر");
    const { cookies } = await memberIdentity(bystander);
    const recovered = await recoveryConfirm(await generateMagicLink(member.email), cookies);
    expect(recovered.status).toBe(303);
    expect(recovered.setCookies).toEqual([]);
    expect((await account(member.id)).deletion_requested_at).toBeNull();
    expect((await account(bystander.id)).deletion_requested_at).toBeNull();
  });

  it("Supabase: a deletion recovery link and a recovery link share one slot", async () => {
    // Checked on GoTrue v2.197.0 (plan/task-3.7.md); recheck after every Supabase upgrade.
    const member = await signUpMember();
    expect(await verifyAs("recovery", await generateMagicLink(member.email))).toBe(200);
    expect(await verifyAs("email", await generateRecoveryLink(member.email))).toBe(200);
    const older = await generateMagicLink(member.email);
    await generateRecoveryLink(member.email);
    expect(await verifyAs("email", older)).toBe(403);
  });
});
