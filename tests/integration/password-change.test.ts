// Task 3.6 (plan/task-3.6.md, items 4, 5 and 11): API022 with the real server code against the
// local stack. FR59, TC27, DEC32, DEC36, RL01, SEC11, the audit row, and the CSRF token after the
// change (owner condition on task 1.6). One successful change sends one real notice (Mailpit).
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { afterAll, describe, expect, it } from "vitest";
import { t } from "@souq/i18n";
import { changePassword } from "../../apps/web/lib/account/password.ts";
import { requireSession, type GuardContext } from "../../apps/web/lib/auth/guards.ts";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import { GUEST_COOKIE } from "../../apps/web/lib/http/csrf.ts";
import type { RequestCookie } from "../../apps/web/lib/supabase/server.ts";
import { flowContext, flowEnv, guestId, jsonRequest, outcome } from "./_harness/auth-flow.ts";
import { auditCount, csrfAccepts, memberToken } from "./_harness/credentials.ts";
import { closeDb } from "./_harness/db.ts";
import { waitForMail } from "./_harness/mailpit.ts";
import {
  CAPTCHA,
  cookiePairs,
  identityFrom,
  limitedSession,
  memberIdentity,
  passwordSession,
  refreshWorks,
  sessionCount,
} from "./_harness/sessions.ts";
import { signUpMember, TEST_PASSWORD } from "./_harness/users.ts";
import { changeMember, webDb } from "./_harness/web.ts";

const db = webDb();
const NEW_PASSWORD = "كلمة-مرور-جديدة-3";

afterAll(async () => {
  await db.end();
  await closeDb();
});

function change(
  input: Record<string, unknown>,
  cookies: readonly RequestCookie[],
  identity: Identity | null,
  env = flowEnv(),
  guest = guestId(),
) {
  return outcome(() =>
    changePassword(
      jsonRequest("/api/profile/password-change", input, { guest, cookies }),
      flowContext(env, db, identity),
    ),
  );
}

function body(newPassword = NEW_PASSWORD, current = TEST_PASSWORD) {
  return { current_password: current, new_password: newPassword, captcha_token: CAPTCHA };
}

function guard(identity: Identity): GuardContext {
  return { traceId: "trace", identity: () => Promise.resolve(identity) };
}

async function passwordWorks(email: string, password: string): Promise<boolean> {
  try {
    await passwordSession(email, password);
    return true;
  } catch {
    return false;
  }
}

describe("API022: the password change (FR59, TC27)", () => {
  it("TC27 Change credentials and reuse an old session: every old session is refused, the member stays signed in on a new one", async () => {
    const env = flowEnv();
    const member = await signUpMember();
    const otherDevice = await passwordSession(member.email);
    const otherIdentity = (await memberIdentity(otherDevice)).identity;
    const { cookies, identity } = await memberIdentity(member);
    const tokenBefore = memberToken(env, identity);
    const guest = guestId();

    const result = await change(body(), cookies, identity, env, guest);
    expect(result.status).toBe(204);

    // The new session works; the browser's old one and the other device are gone (TC27).
    const fresh = await identityFrom(cookiePairs(result.setCookies));
    expect(fresh.userId).toBe(member.id);
    expect(fresh.sessionId).not.toBe(identity.sessionId);
    await expect(requireSession(guard(fresh), { db })).resolves.toBeDefined();
    for (const old of [identity, otherIdentity]) {
      await expect(requireSession(guard(old), { db })).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
    }
    expect(await refreshWorks(otherDevice.refreshToken)).toBe(false);
    expect(await refreshWorks(member.refreshToken)).toBe(false);
    expect(await sessionCount(member.id)).toBe(1);

    // Owner condition on task 1.6: the CSRF token from before is refused, a new guest binding.
    expect(csrfAccepts(env, tokenBefore, fresh.sessionId)).toBe(false);
    expect(csrfAccepts(env, memberToken(env, fresh), fresh.sessionId)).toBe(true);
    const rotated = result.setCookies.find((line) => line.startsWith(`${GUEST_COOKIE}=`));
    expect(rotated).toBeDefined();
    expect(rotated).not.toContain(guest);

    expect(await passwordWorks(member.email, NEW_PASSWORD)).toBe(true);
    expect(await passwordWorks(member.email, TEST_PASSWORD)).toBe(false);
    expect(await auditCount(member.id, "account.password_changed")).toBe(1);

    // SEC11: the "password changed" notice.
    const mail = await waitForMail(member.email, t("email.password_changed.subject"));
    expect(mail.html).toContain(t("email.password_changed.heading"));
  });

  it("a wrong current password is 422 wrong, and nothing changes", async () => {
    const member = await signUpMember();
    const { cookies, identity } = await memberIdentity(member);
    const result = await change(body(NEW_PASSWORD, "wrong-password-1"), cookies, identity);
    expect(result.status).toBe(422);
    expect(result.fieldErrors).toEqual([{ field: "current_password", code: "wrong" }]);
    await expect(requireSession(guard(identity), { db })).resolves.toBeDefined();
    expect(await passwordWorks(member.email, TEST_PASSWORD)).toBe(true);
    expect(await auditCount(member.id, "account.password_changed")).toBe(0);
  });

  it("DEC32: 7 and 65 characters, 73 bytes and the current password are refused before any sign-in", async () => {
    const member = await signUpMember();
    const { cookies, identity } = await memberIdentity(member);
    const cases: [string, string][] = [
      ["1234567", "too_short"],
      ["a".repeat(65), "too_long"],
      [`${"ك".repeat(24)}${"😀".repeat(6)}a`, "too_many_bytes"],
      [TEST_PASSWORD, "same_password"],
    ];
    for (const [password, code] of cases) {
      const result = await change(body(password), cookies, identity);
      expect(result.status, code).toBe(422);
      expect(result.fieldErrors).toEqual([{ field: "new_password", code }]);
    }
    // No fresh sign-in was made: the browser's session is still the only one.
    expect(await sessionCount(member.id)).toBe(1);
  });

  it("DEC36: no Turnstile token is 403 CAPTCHA_FAILED, and an unknown field is 400", async () => {
    const member = await signUpMember();
    const { cookies, identity } = await memberIdentity(member);
    const noCaptcha = await change({ ...body(), captcha_token: "" }, cookies, identity);
    expect([noCaptcha.status, noCaptcha.code]).toEqual([403, "CAPTCHA_FAILED"]);
    const unknown = await change({ ...body(), password: NEW_PASSWORD }, cookies, identity);
    expect(unknown.status).toBe(400);
    expect(await passwordWorks(member.email, TEST_PASSWORD)).toBe(true);
  });

  it("a guest is 401, a recovery session 403 RECOVERY_SESSION_ONLY, an account awaiting deletion 403 DELETION_PENDING", async () => {
    expect((await change(body(), [], null)).status).toBe(401);

    const limited = await memberIdentity(await limitedSession());
    const recovery = await change(body(), limited.cookies, limited.identity);
    expect([recovery.status, recovery.code]).toEqual([403, "RECOVERY_SESSION_ONLY"]);

    const member = await signUpMember();
    const { cookies, identity } = await memberIdentity(member);
    await changeMember(
      member.id,
      "update public.account_control set deletion_requested_at = now() where user_id = $1",
    );
    const pending = await change(body(), cookies, identity);
    expect([pending.status, pending.code]).toEqual([403, "DELETION_PENDING"]);
    expect(await passwordWorks(member.email, TEST_PASSWORD)).toBe(true);
  });
});
