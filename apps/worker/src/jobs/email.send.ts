// Task 3.8: the email of one notification (FR48, FR68, BR38, SEC11, owner conditions 1 and 2).
// app.notify() queues it in the business transaction, with the notification id only.
//  1. app.notification_email() reads, at send time, the address from auth.users, the account
//     state and the preferences, and returns no row when nothing may be sent (item 5): a
//     disabled optional group, a restricted account for optional email, a deleted login. That
//     is success with nothing to do (DEC71).
//  2. @souq/email renders the fixed text of the event or of its group (BR38, DEC65).
//  3. The transport sends with the key email/<notification id> (item 4): the same for every
//     attempt of this job, and unique across database resets and restores, unlike the job id.
// A failed delivery never touches the notification nor repeats the business operation (UC19).
import { isEmailChannel } from "@souq/domain";
import { renderNotificationEmail, UnknownEmailEventError } from "@souq/email";
import { log as defaultLog } from "@souq/log";
import { z } from "zod";
import { emailSettings, type EmailSettings } from "../email/config.ts";
import { defineJob, PermanentJobError, type JobResult } from "../job.ts";
import type { Logger } from "../loop.ts";

interface EmailRow {
  notification_id: string;
  event_type: string;
  email_channel: string;
  recipient_email: string;
  created_at: Date;
  deletion_deadline: Date | null;
}

/** Item 4: the provider's idempotency key for a notification's email. */
export function emailIdempotencyKey(notificationId: string): string {
  return `email/${notificationId}`;
}

export function createEmailSend(
  settings: () => EmailSettings = emailSettings,
  logger: Logger = defaultLog,
) {
  return defineJob({
    kind: "email.send",
    payload: z.strictObject({ notification_id: z.uuid() }),
    timeoutMs: 30_000,
    async run({ notification_id }, { db, signal }): Promise<JobResult> {
      const result = await db.query<EmailRow>(
        `select notification_id, event_type, email_channel, recipient_email, created_at,
                deletion_deadline
           from app.notification_email($1)`,
        [notification_id],
      );
      const row = result.rows[0];
      if (row === undefined) return { skipped: 1 };
      if (!isEmailChannel(row.email_channel) || row.email_channel === "none") {
        throw new PermanentJobError("EMAIL_CHANNEL_INVALID");
      }
      const { transport, origin, contactEmail } = settings();
      let email;
      try {
        email = renderNotificationEmail({
          eventType: row.event_type,
          channel: row.email_channel,
          createdAt: row.created_at,
          deletionDeadline: row.deletion_deadline,
          origin,
          contactEmail,
        });
      } catch (error) {
        if (error instanceof UnknownEmailEventError) {
          throw new PermanentJobError("EMAIL_UNKNOWN_EVENT");
        }
        throw error;
      }
      signal.throwIfAborted();
      const sent = await transport.send(
        { to: row.recipient_email, ...email, idempotencyKey: emailIdempotencyKey(notification_id) },
        signal,
      );
      // Never the address or the text (NFR13).
      logger.info("email.sent", {
        notification_id,
        event_type: row.event_type,
        transport: transport.name,
        provider_id: sent.id,
      });
      return { sent: 1 };
    },
  });
}

export const emailSend = createEmailSend();
