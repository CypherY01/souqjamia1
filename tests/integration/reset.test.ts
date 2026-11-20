// Task 3.4 (plan/task-3.4.md, items 3 to 7): API008 with the real server code against the local
// stack. FR03, the part of TC27 for this task (every old session revoked after the new password),
// DEC32, DEC38 (5 minutes), DEC73, the audit row, the SEC11 notice, and the CSRF token after.
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { afterAll, describe, expect, it } from "vitest";
import { t } from "@souq/i18n";
import {
  requireMember,
  requireSession,
  type GuardContext,
} from "../../apps/web/lib/auth/guards.ts";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import { login } from "../../apps/web/lib/auth/login.ts";
import { resetPassword } from "../../apps/web/lib/auth/recovery.ts";
import { csrfToken, GUEST_COOKIE } from "../../apps/web/lib/http/csrf.ts";
import { guardRequest } from "../../apps/web/lib/http/guard.ts";
import type { RequestCookie } from "../../apps/web/lib/supabase/server.ts";
import { flowContext, flowEnv, guestId, jsonRequest, outcome } from "./_harness/auth-flow.ts";
import { closeDb, dbPool, scalar } from "./_harness/db.ts";
import { waitForMail } from "./_harness/mailpit.ts";
import {
  CAPTCHA,
  memberIdentity,
  passwordSession,
  recoverySession,
  refreshWorks,
  sessionCount,
} from "./_harness/sessions.ts";
import { signUpMember, TEST_PASSWORD } from "./_harness/users.ts";
import { changeMember, webDb } from "./_harness/web.ts";

const db = webDb();
const NEW_PASSWORD = "كلمة-مرور-جديدة-2";

afterAll(async () => {
  await db.end();
  await closeDb();
});

function reset(
  newPassword: string,
  cookies: readonly RequestCookie[],
  identity: Identity | null,
  options: { env?: ReturnType<typeof flowEnv>; guest?: string; nowSeconds?: number } = {},
) {
  return outcome(() =>
    resetPassword(
      jsonRequest(
        "/api/auth/reset",
        { new_password: newPassword },
        { guest: options.guest ?? guestId(), cookies },
      ),
      flowContext(options.env ?? flowEnv(), db, identity),
      options.nowSeconds === undefined ? {} : { nowSeconds: options.nowSeconds },
    ),
  );
}

/** A member with a second (password) device and a recovery session from a link. */
async function memberInRecovery() {
  const member = await signUpMember();
  const otherDevice = await passwordSession(member.email);
  const recovery = await recoverySession(member.email);
  const { cookies, identity } = await memberIdentity(recovery);
  expect(identity.limited).toBe(true);
  return { member, otherDevice, recovery, cookies, identity };
}

async function passwordWorks(email: string, password: string): Promise<boolean> {
  try {
    await passwordSession(email, password);
    return true;
  } catch {
    return false;
  }
}

async function auditRows(userId: string): Promise<number> {
  return Number(
    await scalar<string>(
      dbPool(),
      `select count(*)::text from app.audit_event
        where action = 'account.password_reset' and actor_id = $1 and target_id = $1`,
      [userId],
    ),
  );
}

describe("API008: the new password, then every session revoked (FR03, TC27)", () => {
  it("204: the password changes, no session of the account is left, and the device is signed out", async () => {
    const { member, otherDevice, recovery, cookies, identity } = await memberInRecovery();
    // The identities of the two password sessions, verified before the reset.
    const before = [
      (await memberIdentity(otherDevice)).identity,
      (await memberIdentity(member)).identity,
    ];
    const guest = guestId();
    const result = await reset(NEW_PASSWORD, cookies, identity, { guest });
    expect(result.status).toBe(204);

    // TC27: the other device and the recovery session are gone at Supabase Auth.
    expect(await sessionCount(member.id)).toBe(0);
    expect(await refreshWorks(otherDevice.refreshToken)).toBe(false);
    expect(await refreshWorks(recovery.refreshToken)).toBe(false);
    // Their access tokens still have minutes left, but the server refuses their sessions.
    for (const oldIdentity of before) {
      const ctx: GuardContext = { traceId: "trace", identity: () => Promise.resolve(oldIdentity) };
      await expect(requireSession(ctx, { db })).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
    }

    // Every session cookie sent is removed, and a new guest cookie is set.
    for (const { name } of cookies) {
      const line = result.setCookies.find((entry) => entry.startsWith(`${name}=`));
      expect(line).toContain("Max-Age=0");
    }
    const rotated = result.setCookies.find((line) => line.startsWith(`${GUEST_COOKIE}=`));
    expect(rotated).toBeDefined();
    expect(rotated).not.toContain(guest);

    expect(await passwordWorks(member.email, NEW_PASSWORD)).toBe(true);
    expect(await passwordWorks(member.email, TEST_PASSWORD)).toBe(false);
    expect(await auditRows(member.id)).toBe(1);
  });

  it("SEC11: the account owner gets the password-changed notice by email", async () => {
    const { member, cookies, identity } = await memberInRecovery();
    expect((await reset(NEW_PASSWORD, cookies, identity)).status).toBe(204);
    const mail = await waitForMail(member.email, t("email.password_changed.subject"));
    expect(mail.html).toContain(t("email.password_changed.heading"));
    expect(mail.html).toContain(t("email.common.notRegistered"));
  });

  it("the CSRF token of the recovery session fails after the reset", async () => {
    const env = flowEnv();
    const { cookies, identity } = await memberInRecovery();
    const token = csrfToken(env.APP_SECRET, { kind: "member", id: identity.sessionId });
    const origin = "http://localhost:3000";
    const accepted = (guest: string | undefined, sessionId: string | null) =>
      guardRequest(
        "POST",
        new Headers({
          origin,
          "x-csrf-token": token,
          ...(guest === undefined ? {} : { cookie: `${GUEST_COOKIE}=${guest}` }),
        }),
        { APP_ORIGIN: origin, APP_SECRET: env.APP_SECRET },
        sessionId,
      ) === null;
    expect(accepted(undefined, identity.sessionId)).toBe(true);
    const result = await reset(NEW_PASSWORD, cookies, identity, { env });
    expect(result.status).toBe(204);
    const line = result.setCookies.find((entry) => entry.startsWith(`${GUEST_COOKIE}=`)) ?? "";
    const guestAfter = line.slice(GUEST_COOKIE.length + 1).split(";")[0];
    expect(accepted(guestAfter, null)).toBe(false);
  });

  it("DEC32: 7 and 65 characters and 73 bytes are refused before Supabase Auth is called", async () => {
    const { member, cookies, identity } = await memberInRecovery();
    const cases: [string, string][] = [
      ["1234567", "too_short"],
      ["a".repeat(65), "too_long"],
      // 24 Arabic letters (48 bytes), 6 emoji (24 bytes) and one Latin letter: 31 characters,
      // 73 bytes. Refused whole, never truncated.
      [`${"ك".repeat(24)}${"😀".repeat(6)}a`, "too_many_bytes"],
    ];
    for (const [password, code] of cases) {
      const result = await reset(password, cookies, identity);
      expect(result.status, code).toBe(422);
      expect(result.fieldErrors).toEqual([{ field: "new_password", code }]);
    }
    // Nothing changed: the old password works, the recovery session is still there.
    expect(await passwordWorks(member.email, TEST_PASSWORD)).toBe(true);
    expect(await sessionCount(member.id)).toBeGreaterThan(0);
    expect(await auditRows(member.id)).toBe(0);
  });

  it("the same password as before is 422 same_password, and 64 characters are accepted", async () => {
    const { member, cookies, identity } = await memberInRecovery();
    const same = await reset(TEST_PASSWORD, cookies, identity);
    expect(same.status).toBe(422);
    expect(same.fieldErrors).toEqual([{ field: "new_password", code: "same_password" }]);
    // 64 characters and 64 bytes: the upper limit of DEC32.
    const longest = "a".repeat(32) + "b".repeat(32);
    expect((await reset(longest, cookies, identity)).status).toBe(204);
    expect(await passwordWorks(member.email, longest)).toBe(true);
  });

  it("an unknown field is refused (strict body)", async () => {
    const { cookies, identity } = await memberInRecovery();
    const result = await outcome(() =>
      resetPassword(
        jsonRequest("/api/auth/reset", { new_password: NEW_PASSWORD, password: "x" }, { cookies }),
        flowContext(flowEnv(), db, identity),
      ),
    );
    expect(result.status).toBe(400);
  });
});

describe("the recovery access level (DEC38, DEC73)", () => {
  it("a guest is 401, an ordinary session 403", async () => {
    const guest = await reset(NEW_PASSWORD, [], null);
    expect([guest.status, guest.code]).toEqual([401, "UNAUTHENTICATED"]);
    const member = await signUpMember();
    const { cookies, identity } = await memberIdentity(member);
    const ordinary = await reset(NEW_PASSWORD, cookies, identity);
    expect([ordinary.status, ordinary.code]).toEqual([403, "FORBIDDEN"]);
    expect(await passwordWorks(member.email, TEST_PASSWORD)).toBe(true);
  });

  it("the recovery session passes at 4:59 and is 401 at 5:01", async () => {
    const { member, cookies, identity } = await memberInRecovery();
    const since = Math.max(...identity.amr.map((entry) => entry.timestamp));
    const late = await reset(NEW_PASSWORD, cookies, identity, { nowSeconds: since + 301 });
    expect([late.status, late.code]).toEqual([401, "UNAUTHENTICATED"]);
    expect(await passwordWorks(member.email, TEST_PASSWORD)).toBe(true);
    const inTime = await reset(NEW_PASSWORD, cookies, identity, { nowSeconds: since + 299 });
    expect(inTime.status).toBe(204);
  });

  it("a recovery session revoked at Supabase Auth is 401", async () => {
    const { member, recovery, cookies, identity } = await memberInRecovery();
    await dbPool().query("delete from auth.sessions where id = $1", [recovery.sessionId]);
    const result = await reset(NEW_PASSWORD, cookies, identity);
    expect([result.status, result.code]).toEqual([401, "UNAUTHENTICATED"]);
    expect(await passwordWorks(member.email, TEST_PASSWORD)).toBe(true);
  });

  it("the recovery session is still refused by every member access level", async () => {
    const { identity } = await memberInRecovery();
    const ctx: GuardContext = { traceId: "trace", identity: () => Promise.resolve(identity) };
    await expect(requireSession(ctx, { db })).rejects.toMatchObject({
      code: "RECOVERY_SESSION_ONLY",
    });
    await expect(requireMember(ctx, { db })).rejects.toMatchObject({
      code: "RECOVERY_SESSION_ONLY",
    });
  });

  it("item 4: a suspended account resets its password, then the login sends it to /restricted", async () => {
    const { member, cookies, identity } = await memberInRecovery();
    await changeMember(
      member.id,
      "update public.account_control set status = 'suspended', suspended_until = now() + interval '1 day' where user_id = $1",
    );
    expect((await reset(NEW_PASSWORD, cookies, identity)).status).toBe(204);
    const signedIn = await outcome(() =>
      login(
        jsonRequest(
          "/api/auth/login",
          { email: member.email, password: NEW_PASSWORD, captcha_token: CAPTCHA },
          { guest: guestId() },
        ),
        flowContext(flowEnv(), db),
      ),
    );
    expect(signedIn.body).toEqual({ data: { state: "restricted", next: "/restricted" } });
  });
});
