// Task 3.2 (plan/task-3.2.md, items 5 and 6): API004 and API005 with the real server code against
// the local stack. DEC66 while confirmation is off; TC26 (one use, one hour), TC25 with
// confirmation on, and RL03 without enumeration while it is on. Supabase keeps confirmation off
// locally: generate_link creates the unconfirmed account and its link (plan/task-3.2.md).
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CONFIRMED_LOCATION,
  confirmEmail,
  resendConfirmation,
} from "../../apps/web/lib/auth/confirm.ts";
import { fingerprint } from "../../apps/web/lib/http/rate-limit.ts";
import {
  flowContext,
  flowEnv,
  generateSignupLink,
  jsonRequest,
  outcome,
} from "./_harness/auth-flow.ts";
import { actAs, memberClaims } from "./_harness/roles.ts";
import { closeDb, dbPool, rolledBack, scalar } from "./_harness/db.ts";
import { testEmail } from "./_harness/users.ts";
import { webDb } from "./_harness/web.ts";

const db = webDb();
const off = flowEnv();
const on = flowEnv({ EMAIL_CONFIRMATION_REQUIRED: true });
const DUMMY_CAPTCHA = "XXXX.DUMMY.TOKEN.XXXX";

beforeAll(async () => {
  await dbPool().query("drop function if exists app.probe_confirm_guard()");
  await dbPool().query(`create function app.probe_confirm_guard() returns uuid
    language sql security definer set search_path = ''
    as 'select app.assert_active_member()'`);
  await dbPool().query("grant execute on function app.probe_confirm_guard() to souq_web");
});

afterAll(async () => {
  await dbPool().query("drop function if exists app.probe_confirm_guard()");
  await db.end();
  await closeDb();
});

function confirm(tokenHash: string, env = on) {
  return outcome(() =>
    confirmEmail(jsonRequest("/api/auth/confirm", { token_hash: tokenHash }), flowContext(env, db)),
  );
}

function resend(body: Record<string, unknown>, env = on) {
  return outcome(() =>
    resendConfirmation(jsonRequest("/api/auth/resend", body), flowContext(env, db)),
  );
}

async function confirmed(userId: string): Promise<boolean> {
  return (
    (await scalar<string>(
      dbPool(),
      "select (email_confirmed_at is not null)::text from auth.users where id = $1",
      [userId],
    )) === "true"
  );
}

async function sessionsOf(userId: string): Promise<string> {
  return scalar<string>(dbPool(), "select count(*)::text from auth.sessions where user_id = $1", [
    userId,
  ]);
}

/** app.assert_active_member() for a session of this account, inside a rolled-back transaction. */
async function guardFor(userId: string): Promise<string> {
  return rolledBack(async (client) => {
    const claims = memberClaims(userId);
    await client.query(
      "insert into auth.sessions (id, user_id, created_at, updated_at, aal) values ($1, $2, now(), now(), 'aal1')",
      [claims.session_id, userId],
    );
    await actAs(client, "souq_web", claims);
    try {
      await client.query("savepoint guard");
      await client.query("select app.probe_confirm_guard()");
      return "ok";
    } catch (error) {
      await client.query("rollback to savepoint guard");
      if (error instanceof pg.DatabaseError && error.code === "SJ001") return error.message;
      throw error;
    }
  });
}

describe("DEC66: confirmation off", () => {
  it("API004 and API005 answer 404", async () => {
    const link = await confirm("any", off);
    expect([link.status, link.code]).toEqual([404, "NOT_FOUND"]);
    const again = await resend(
      { email: testEmail(), purpose: "signup", captcha_token: DUMMY_CAPTCHA },
      off,
    );
    expect([again.status, again.code]).toEqual([404, "NOT_FOUND"]);
  });
});

describe("TC26: the link is spent once, within one hour (DEC37)", () => {
  it("confirms, ends the session Supabase opens, sets no cookie, and goes to the login page", async () => {
    const link = await generateSignupLink(testEmail("confirm"));
    expect(await confirmed(link.userId)).toBe(false);
    const result = await confirm(link.hashedToken);
    expect(result.status).toBe(303);
    expect(result.location).toBe(CONFIRMED_LOCATION);
    expect(result.setCookies).toEqual([]);
    expect(await confirmed(link.userId)).toBe(true);
    // The limited session (amr = otp, DEC73) is not kept: its auth.sessions row is gone.
    expect(await sessionsOf(link.userId)).toBe("0");

    const second = await confirm(link.hashedToken);
    expect([second.status, second.code]).toEqual([422, "LINK_INVALID_OR_EXPIRED"]);
  });

  it("refuses a link after 61 minutes and accepts one after 59", async () => {
    const old = await generateSignupLink(testEmail("confirm-old"));
    await dbPool().query(
      "update auth.users set confirmation_sent_at = now() - interval '61 minutes' where id = $1",
      [old.userId],
    );
    const late = await confirm(old.hashedToken);
    expect([late.status, late.code]).toEqual([422, "LINK_INVALID_OR_EXPIRED"]);
    expect(await confirmed(old.userId)).toBe(false);

    const recent = await generateSignupLink(testEmail("confirm-recent"));
    await dbPool().query(
      "update auth.users set confirmation_sent_at = now() - interval '59 minutes' where id = $1",
      [recent.userId],
    );
    expect((await confirm(recent.hashedToken)).status).toBe(303);
  });

  it("an unknown or malformed token is the same 422", async () => {
    for (const token of ["0".repeat(56), "not a token"]) {
      const result = await confirm(token);
      expect([result.status, result.code], token).toEqual([422, "LINK_INVALID_OR_EXPIRED"]);
    }
    const empty = await confirm("");
    expect(empty.status).toBe(422);
    expect(empty.code).toBe("VALIDATION_FAILED");
  });
});

describe("TC25 with confirmation on", () => {
  it("no market write before the confirmation, then the member passes", async () => {
    const link = await generateSignupLink(testEmail("tc25"));
    expect(await guardFor(link.userId)).toBe("EMAIL_NOT_CONFIRMED");
    expect((await confirm(link.hashedToken)).status).toBe(303);
    expect(await guardFor(link.userId)).toBe("ok");
  });
});

describe("RL03 and API005 without enumeration (confirmation on)", () => {
  it.each([
    ["an unknown address", () => Promise.resolve(testEmail("resend"))],
    [
      "an unconfirmed account",
      async () => {
        const email = testEmail("resend-account");
        await generateSignupLink(email);
        return email;
      },
    ],
  ])("%s: 202, then 429 within the minute, with Retry-After", async (_name, address) => {
    const email = await address();
    const body = { email, purpose: "signup", captcha_token: DUMMY_CAPTCHA };
    const first = await resend(body);
    expect(first.status).toBe(202);
    expect(first.body).toEqual({ data: { status: "accepted" } });
    // The same address in another case is the same counter.
    const second = await resend({ ...body, email: email.toUpperCase() });
    expect([second.status, second.code]).toEqual([429, "RATE_LIMITED"]);
    expect(second.retryAfter).toBeGreaterThan(0);
    expect(second.retryAfter).toBeLessThanOrEqual(60);
  });

  it("Supabase's 60-second cooldown of an existing account becomes the general 202", async () => {
    const email = testEmail("cooldown");
    // generate_link has just set confirmation_sent_at: Supabase Auth's own cooldown is running,
    // and our counter has never seen this address.
    await generateSignupLink(email);
    const result = await resend({ email, purpose: "signup", captcha_token: DUMMY_CAPTCHA });
    expect(result.status).toBe(202);
  });

  it("the fourth in an hour is refused even after the minute", async () => {
    const email = testEmail("hourly");
    const key = fingerprint(on.APP_SECRET, "email", email);
    // Three earlier sends this hour, in earlier minutes.
    await dbPool().query(
      `insert into app.rate_limit_bucket (scope, key_hash, window_start, count, expires_at)
       values ('RL03:email:hour', $1, date_bin('1 hour', app.app_now(), '2000-01-01Z'), 3,
               app.app_now() + interval '1 day')`,
      [key],
    );
    const result = await resend({ email, purpose: "signup", captcha_token: DUMMY_CAPTCHA });
    expect([result.status, result.code]).toEqual([429, "RATE_LIMITED"]);
  });

  it("task 3.6: email_change for an address with no pending change is the general 202; a wrong address is a field error", async () => {
    const change = await resend({
      email: testEmail(),
      purpose: "email_change",
      captcha_token: DUMMY_CAPTCHA,
    });
    expect(change.status).toBe(202);
    const wrong = await resend({ email: "nope", purpose: "signup", captcha_token: DUMMY_CAPTCHA });
    expect(wrong.status).toBe(422);
    expect(wrong.fieldErrors).toEqual([{ field: "email", code: "invalid_format" }]);
  });

  it("Turnstile: no token is 403 CAPTCHA_FAILED", async () => {
    const result = await resend({
      email: `resend-${randomUUID()}@example.test`,
      purpose: "signup",
      captcha_token: "",
    });
    expect([result.status, result.code]).toEqual([403, "CAPTCHA_FAILED"]);
  });
});
