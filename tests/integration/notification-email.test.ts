// Task 3.8 (plan/task-3.8.md): the worker's email.send against the local stack, with real
// messages in Mailpit where the content matters and a recording transport elsewhere.
//  - Owner condition 1 (SEC11): the "deletion requested" email, with the deadline and the way
//    to recover, reaches an account awaiting deletion; and the recovery email.
//  - Owner addition 1 (DEC63): an account signed up the ordinary way (API001) has a confirmed
//    address at once, and the deletion email reaches it with no confirmation step.
//  - Owner condition 2: optional groups off by default (DEC49, DEC65), required email whatever
//    the preferences and the account state (BR38), the DEC65 line, the DEC71 key.
//  - TC55: a disabled group, a failed delivery, a notification that is gone.
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatDateTime, t } from "@souq/i18n";
import { signup } from "../../apps/web/lib/auth/signup.ts";
import { updatePreferences } from "../../apps/web/lib/notifications/preferences.ts";
import { EmailSendError } from "../../apps/worker/src/email/transport.ts";
import { PermanentJobError } from "../../apps/worker/src/job.ts";
import { createEmailSend, emailIdempotencyKey } from "../../apps/worker/src/jobs/email.send.ts";
import {
  flowContext,
  flowEnv,
  guestId,
  jsonRequest,
  outcome,
  signupBody,
} from "./_harness/auth-flow.ts";
import { closeDb, dbPool, rolledBack, scalar } from "./_harness/db.ts";
import { mailHeaders, waitForMail } from "./_harness/mailpit.ts";
import {
  emailJobOf,
  mailpitTransport,
  notify,
  recordingTransport,
  runEmailJob,
  TEST_CONTACT,
  TEST_ORIGIN,
  testEvent,
  type TestEvent,
} from "./_harness/notifications.ts";
import { cookiePairs, identityFrom, memberIdentity } from "./_harness/sessions.ts";
import { deleteAuthUser, signUpMember, testEmail } from "./_harness/users.ts";
import { webDb } from "./_harness/web.ts";
import { workerPool } from "./_harness/worker.ts";

const db = webDb();
const trace = (): string => randomBytes(16).toString("hex");
const notRegistered = t("email.common.notRegistered");

let required: TestEvent;
let offers: TestEvent;

beforeAll(async () => {
  required = await testEvent("required");
  offers = await testEvent("offers");
});

afterAll(async () => {
  await required.cleanup();
  await offers.cleanup();
  await db.end();
  await closeDb();
});

/** API001 as the signup page sends it: a new account and its session (DEC63). */
async function signUpThroughApi(): Promise<{ email: string; id: string; claims: object }> {
  const email = testEmail("notify");
  const result = await outcome(async () =>
    signup(
      jsonRequest("/api/auth/signup", await signupBody({ email }), { guest: guestId() }),
      flowContext(flowEnv(), db),
    ),
  );
  if (result.status >= 300) throw new Error(`signup failed with ${String(result.status)}`);
  const identity = await identityFrom(cookiePairs(result.setCookies));
  return { email, id: identity.userId, claims: identity.claims };
}

async function latestNotification(
  recipient: string,
  eventType: string,
): Promise<{ id: string; created_at: Date }> {
  const result = await dbPool().query<{ id: string; created_at: Date }>(
    `select id::text, created_at from public.notification
      where recipient_id = $1 and event_type = $2 order by created_at desc limit 1`,
    [recipient, eventType],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`no ${eventType} notification`);
  return row;
}

async function notificationCount(dedupeKey: string): Promise<number> {
  return Number(
    await scalar<string>(
      dbPool(),
      "select count(*)::text from public.notification where dedupe_key = $1",
      [dedupeKey],
    ),
  );
}

describe("owner addition 1 and condition 1 (DEC63, SEC11): the deletion email", () => {
  let account: { email: string; id: string; claims: object };
  let notification: { id: string; created_at: Date };

  beforeAll(async () => {
    account = await signUpThroughApi();
  });

  it("DEC63 an account from API001 has email_confirmed_at", async () => {
    expect(
      await scalar<boolean>(
        dbPool(),
        "select email_confirmed_at is not null from auth.users where id = $1",
        [account.id],
      ),
    ).toBe(true);
  });

  it("SEC11 a deletion request emails the deadline and the recovery steps", async () => {
    await db.withActor(account.claims as never, trace(), async (tx) => {
      await tx.query("select app.request_account_deletion() as requested_at");
    });
    notification = await latestNotification(account.id, "account.deletion_requested");
    expect((await emailJobOf(notification.id))?.status).toBe("queued");

    const run = await runEmailJob(notification.id, mailpitTransport());
    expect(run.error).toBeUndefined();
    expect(run.result).toEqual({ sent: 1 });
    expect((await emailJobOf(notification.id))?.status).toBe("done");

    const subject = t("email.notification.account.deletion_requested.subject");
    const mail = await waitForMail(account.email, subject);
    const deadline = new Date(notification.created_at.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(mail.text).toContain(formatDateTime(notification.created_at));
    expect(mail.text).toContain(formatDateTime(deadline));
    expect(mail.text).toContain(t("email.notification.account.deletion_requested.steps"));
    expect(mail.text).toContain(TEST_CONTACT);
    expect(mail.text).toContain(`${TEST_ORIGIN}/login`);
    expect(mail.text).toContain(t("email.notification.requiredNotice"));
    expect(mail.text.trimEnd().endsWith(notRegistered)).toBe(true);
    expect(mail.html).toContain(`<span dir="ltr">${TEST_CONTACT}</span>`);
    expect(mail.html).toContain(`href="${TEST_ORIGIN}/login"`);
    // DEC71, item 4: the key is the notification's, the same for every attempt.
    const headers = await mailHeaders(mail.id);
    expect(headers["X-Souq-Idempotency-Key"]).toEqual([emailIdempotencyKey(notification.id)]);
    // NFR13: the log line names the notification, never the address.
    const sent = run.logger.lines.find((line) => line.event === "email.sent");
    expect(sent?.fields).toMatchObject({ notification_id: notification.id });
    expect(JSON.stringify(run.logger.lines)).not.toContain(account.email);
  });

  it("SEC11 the deletion email reaches an account awaiting deletion", async () => {
    // The email above went out while the account was hidden and its sessions refused.
    expect(
      await scalar<boolean>(
        dbPool(),
        "select deletion_requested_at is not null from public.account_control where user_id = $1",
        [account.id],
      ),
    ).toBe(true);
    // Item 5: required email whatever the account state; optional email never while restricted.
    await rolledBack(async (client) => {
      const sendable = async (id: string): Promise<number> =>
        Number(
          await scalar<string>(client, "select count(*)::text from app.notification_email($1)", [
            id,
          ]),
        );
      await client.query(
        "update public.notification_preference set offers = true where user_id = $1",
        [account.id],
      );
      const optional = await scalar<string>(
        client,
        "select app.notify($1, $2, 'account', $1, $3)::text",
        [account.id, offers.type, `test:${randomUUID()}`],
      );
      expect(await sendable(notification.id)).toBe(1);
      expect(await sendable(optional)).toBe(0);
      for (const status of ["suspended", "banned"]) {
        await client.query(
          `update public.account_control
              set status = $2::public.account_status, deletion_requested_at = null,
                  suspended_until = case when $2 = 'suspended' then now() + interval '1 day' end
            where user_id = $1`,
          [account.id, status],
        );
        expect(await sendable(notification.id), status).toBe(1);
        expect(await sendable(optional), status).toBe(0);
      }
    });
  });

  it("SEC11 a recovery emails the account owner", async () => {
    const member = await signUpMember();
    const email = await scalar<string>(dbPool(), "select email from auth.users where id = $1", [
      member.id,
    ]);
    const id = await notify(member.id, "account.deletion_recovered");
    const run = await runEmailJob(id, mailpitTransport());
    expect(run.result).toEqual({ sent: 1 });
    const mail = await waitForMail(
      email,
      t("email.notification.account.deletion_recovered.subject"),
    );
    expect(mail.text).toContain(t("email.notification.account.deletion_recovered.body"));
    expect(mail.text).toContain(t("email.notification.account.deletion_recovered.notRequested"));
    // Owner addition 3: no sentence about a suspension or a ban.
    expect(mail.text).not.toContain("الإيقاف");
    expect(mail.text.trimEnd().endsWith(notRegistered)).toBe(true);
    await dbPool().query("delete from app.job where dedupe_key = 'email.send:' || $1", [id]);
    await dbPool().query("delete from public.notification where id = $1", [id]);
  });
});

describe("owner condition 2 (BR38, DEC49, DEC65) and TC55", () => {
  it("DEC65 a new member gets no optional email until the group is enabled", async () => {
    const member = await signUpMember();
    const { identity } = await memberIdentity(member);
    const before = await notify(member.id, offers.type);
    const transport = recordingTransport();
    expect((await runEmailJob(before, transport)).result).toEqual({ skipped: 1 });
    expect(transport.sent).toHaveLength(0);

    const saved = await updatePreferences(
      new Request("http://localhost:3000/api/me/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email_groups: { offers: true }, expected_version: 1 }),
      }),
      { db, traceId: trace(), identity: () => Promise.resolve(identity) },
    );
    expect(saved.email_groups.offers).toBe(true);
    const after = await notify(member.id, offers.type);
    expect((await runEmailJob(after, transport)).result).toEqual({ sent: 1 });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.subject).toBe(t("email.notification.groups.offers.subject"));
    // Optional email opens the notifications list and says how to stop it.
    expect(transport.sent[0]?.text).toContain(`${TEST_ORIGIN}/notifications`);
    expect(transport.sent[0]?.text).toContain(`${TEST_ORIGIN}/account/notifications`);
    expect(transport.sent[0]?.text.trimEnd().endsWith(notRegistered)).toBe(true);
  });

  it("TC55 a disabled optional group sends no email and keeps the in-app notification", async () => {
    const member = await signUpMember();
    const dedupe = `test:${randomUUID()}`;
    const id = await notify(member.id, offers.type, dedupe);
    const transport = recordingTransport();
    expect((await runEmailJob(id, transport)).result).toEqual({ skipped: 1 });
    expect(transport.sent).toHaveLength(0);
    expect((await emailJobOf(id))?.status).toBe("done");
    expect(await notificationCount(dedupe)).toBe(1);
    expect(
      await scalar<string | null>(
        dbPool(),
        "select read_at::text from public.notification where id = $1",
        [id],
      ),
    ).toBeNull();
  });

  it("TC55 security email is sent with every optional group off", async () => {
    const member = await signUpMember();
    const id = await notify(member.id, required.type);
    // The required channel needs its own email: a test event has none, so render the deletion
    // email instead through the same decision (item 5): the row is returned with all groups off.
    expect(
      Number(
        await scalar<string>(dbPool(), "select count(*)::text from app.notification_email($1)", [
          id,
        ]),
      ),
    ).toBe(1);
    const deletion = await notify(member.id, "account.deletion_requested");
    const transport = recordingTransport();
    expect((await runEmailJob(deletion, transport)).result).toEqual({ sent: 1 });
    expect(transport.sent[0]?.subject).toBe(
      t("email.notification.account.deletion_requested.subject"),
    );
    await dbPool().query("delete from app.job where dedupe_key = 'email.send:' || $1", [deletion]);
    await dbPool().query("delete from public.notification where id = $1", [deletion]);
  });

  it("TC55 a failed delivery retries without a second notification", async () => {
    const member = await signUpMember();
    const dedupe = `test:${randomUUID()}`;
    const id = await notify(member.id, "account.deletion_recovered", dedupe);
    const failing = recordingTransport(() => new EmailSendError("EMAIL_HTTP_503"));
    const failed = await runEmailJob(id, failing);
    expect(failed.error).toBeInstanceOf(EmailSendError);
    expect(await emailJobOf(id)).toMatchObject({
      status: "queued",
      attempts: 1,
      last_error_code: "EMAIL_HTTP_503",
    });
    expect(await notificationCount(dedupe)).toBe(1);

    const transport = recordingTransport();
    expect((await runEmailJob(id, transport)).result).toEqual({ sent: 1 });
    expect(await emailJobOf(id)).toMatchObject({ status: "done", attempts: 2 });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.idempotencyKey).toBe(emailIdempotencyKey(id));
    expect(await notificationCount(dedupe)).toBe(1);

    // A permanent failure (any other 4xx) is dead at once, and still one notification.
    const again = await notify(member.id, "account.deletion_recovered");
    const dead = await runEmailJob(
      again,
      recordingTransport(() => new PermanentJobError("EMAIL_HTTP_422")),
    );
    expect(dead.error).toBeInstanceOf(PermanentJobError);
    expect(await emailJobOf(again)).toMatchObject({
      status: "dead",
      last_error_code: "EMAIL_HTTP_422",
    });
    for (const notificationId of [id, again]) {
      await dbPool().query("delete from app.job where dedupe_key = 'email.send:' || $1", [
        notificationId,
      ]);
      await dbPool().query("delete from public.notification where id = $1", [notificationId]);
    }
  });

  it("DEC71 an email for a notification that is gone is a success", async () => {
    const transport = recordingTransport();
    const definition = createEmailSend(() => ({
      transport,
      origin: TEST_ORIGIN,
      contactEmail: TEST_CONTACT,
    }));
    const pool = workerPool();
    try {
      const context = {
        jobId: "1",
        attempt: 1,
        idempotencyKey: "job:1",
        signal: new AbortController().signal,
        db: pool,
      };
      expect(await definition.run({ notification_id: randomUUID() }, context)).toEqual({
        skipped: 1,
      });
      // A login deleted since the notification (RET06): nothing to send either.
      const member = await signUpMember();
      const id = await notify(member.id, "account.deletion_recovered");
      expect((await deleteAuthUser(member.id)).status).toBe(200);
      expect(await definition.run({ notification_id: id }, context)).toEqual({ skipped: 1 });
      expect(transport.sent).toHaveLength(0);
      await dbPool().query("delete from app.job where dedupe_key = 'email.send:' || $1", [id]);
      await dbPool().query("delete from public.notification where id = $1", [id]);
    } finally {
      await pool.end();
    }
  });
});

describe("DEC77: app.notification_email()", () => {
  async function asWorker(claims: object | null, id: string): Promise<string[]> {
    const pool = workerPool();
    const client = await pool.connect();
    try {
      await client.query("begin");
      if (claims !== null) {
        await client.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify(claims),
        ]);
      }
      const result = await client.query<{ notification_id: string }>(
        "select notification_id from app.notification_email($1)",
        [id],
      );
      await client.query("rollback");
      return result.rows.map((row) => row.notification_id);
    } finally {
      client.release();
      await pool.end();
    }
  }

  it("DEC77 app.notification_email(): a member's identity changes nothing", async () => {
    const owner = await signUpMember();
    const other = await signUpMember();
    const { identity } = await memberIdentity(other);
    const id = await notify(owner.id, required.type);
    expect(await asWorker(identity.claims, id)).toEqual(await asWorker(null, id));
    expect(await asWorker(identity.claims, id)).toEqual([id]);
  });

  it("DEC77 app.notification_email(): a guest reads the email of the given notification only", async () => {
    const owner = await signUpMember();
    const id = await notify(owner.id, required.type);
    expect(await asWorker(null, id)).toEqual([id]);
    expect(await asWorker(null, randomUUID())).toEqual([]);
    // Only the worker role may call it.
    const refused = await outcome(() =>
      db.withActor(null, trace(), async (tx) => {
        await tx.query("select notification_id from app.notification_email($1)", [id]);
        return new Response(null);
      }),
    );
    expect(refused.status).toBe(500);
  });
});
