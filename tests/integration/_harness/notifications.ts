// Task 3.8: notifications and their email in integration tests.
//  - testEvent: a committed event type with the channel a test needs, removed afterwards with its
//    notifications and email jobs (every notification names a known event, item 12).
//  - runEmailJob: the worker's own path for one notification's email job: the job store claims
//    it (moved to the front of the queue first, so jobs left by other tests stay where they
//    are), email.send runs with the given transport, and the job is completed or failed as
//    the job loop does it.
import { randomBytes, randomUUID } from "node:crypto";
import { inject } from "vitest";
import { createJobStore } from "../../../apps/worker/src/db.ts";
import { createMailpitTransport } from "../../../apps/worker/src/email/mailpit.ts";
import type { EmailTransport, OutgoingEmail } from "../../../apps/worker/src/email/transport.ts";
import { PermanentJobError, type JobResult } from "../../../apps/worker/src/job.ts";
import { createEmailSend } from "../../../apps/worker/src/jobs/email.send.ts";
import { jobErrorCode } from "../../../apps/worker/src/loop.ts";
import { dbPool, scalar } from "./db.ts";
import { captureLogger, workerPool } from "./worker.ts";

export const TEST_ORIGIN = "http://localhost:3000";
export const TEST_CONTACT = "contact@souqjamia1.test";
export const TEST_FROM = { name: "سوق الجامعة", email: "no-reply@souqjamia1.test" } as const;

export interface TestEvent {
  type: string;
  cleanup(): Promise<void>;
}

/** A committed event type with this email channel, unique to the caller. */
export async function testEvent(email: string): Promise<TestEvent> {
  const type = `test.n${randomBytes(6).toString("hex")}.event`;
  await dbPool().query("insert into app.notification_event (event_type, email) values ($1, $2)", [
    type,
    email,
  ]);
  return {
    type,
    async cleanup() {
      await dbPool().query(
        `delete from app.job
          where kind = 'email.send'
            and payload ->> 'notification_id' in (
              select n.id::text from public.notification n where n.event_type = $1)`,
        [type],
      );
      await dbPool().query("delete from public.notification where event_type = $1", [type]);
      await dbPool().query("delete from app.notification_event where event_type = $1", [type]);
    },
  };
}

/** A committed notification through app.notify, as a business transaction creates it. */
export function notify(
  recipient: string,
  eventType: string,
  dedupeKey = `test:${randomUUID()}`,
  contextType = "account",
): Promise<string> {
  return scalar<string>(
    dbPool(),
    "select app.notify($1, $2, $3::public.notification_context_type, $1, $4)::text",
    [recipient, eventType, contextType, dedupeKey],
  );
}

export interface EmailJobRow {
  id: string;
  status: "queued" | "running" | "done" | "dead";
  attempts: number;
  last_error_code: string | null;
}

/** The email.send job of a notification, if any (one per notification, item 3). */
export async function emailJobOf(notificationId: string): Promise<EmailJobRow | undefined> {
  const result = await dbPool().query<EmailJobRow>(
    `select id::text, status::text, attempts, last_error_code
       from app.job where dedupe_key = 'email.send:' || $1`,
    [notificationId],
  );
  return result.rows[0];
}

export interface RecordingTransport extends EmailTransport {
  readonly sent: OutgoingEmail[];
}

/** Keeps what it is given; `fail` makes each send throw instead. */
export function recordingTransport(fail?: () => Error): RecordingTransport {
  const sent: OutgoingEmail[] = [];
  return {
    name: "resend",
    sent,
    send(email) {
      if (fail !== undefined) return Promise.reject(fail());
      sent.push(email);
      return Promise.resolve({ id: `fake-${String(sent.length)}` });
    },
  };
}

/** The real Mailpit transport of the local stack. */
export function mailpitTransport(): EmailTransport {
  return createMailpitTransport({ url: inject("stack").mailpitUrl, from: TEST_FROM });
}

export interface EmailJobRun {
  result?: JobResult;
  error?: unknown;
  logger: ReturnType<typeof captureLogger>;
}

export async function runEmailJob(
  notificationId: string,
  transport: EmailTransport,
): Promise<EmailJobRun> {
  const logs = captureLogger();
  const pool = workerPool();
  try {
    await dbPool().query(
      `update app.job set run_at = '2000-01-01T00:00:00Z'
        where dedupe_key = 'email.send:' || $1 and status = 'queued'`,
      [notificationId],
    );
    const store = createJobStore(pool);
    const [job] = await store.claim(["email.send"], 1);
    const payload = job?.payload as { notification_id?: string } | undefined;
    if (job === undefined || payload?.notification_id !== notificationId) {
      throw new Error("the email job of this notification was not the one claimed");
    }
    const definition = createEmailSend(
      () => ({ transport, origin: TEST_ORIGIN, contactEmail: TEST_CONTACT }),
      logs.logger,
    );
    try {
      const result = await definition.run(definition.payload.parse(job.payload), {
        jobId: job.id,
        attempt: job.attempt,
        idempotencyKey: `job:${job.id}`,
        signal: new AbortController().signal,
        db: pool,
      });
      await store.complete(job);
      return { result, logger: logs };
    } catch (error) {
      await store.fail(job, jobErrorCode(error), !(error instanceof PermanentJobError));
      return { error, logger: logs };
    }
  } finally {
    await pool.end();
  }
}
