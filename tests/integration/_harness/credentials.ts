// Task 3.6: reauthentication, password change and email change with the real server code against
// the local stack (plan/task-3.6.md). Local Supabase allows 30 emails an hour, so most email
// change tests set the pending state of auth.users directly (pendingChange) and only the tests
// that need Supabase Auth to complete a change send real links.
import { randomBytes } from "node:crypto";
import { inject } from "vitest";
import { t } from "@souq/i18n";
import type { Identity } from "../../../apps/web/lib/auth/identity.ts";
import type { AppDb } from "../../../apps/web/lib/db/app-client.ts";
import { csrfToken } from "../../../apps/web/lib/http/csrf.ts";
import { guardRequest } from "../../../apps/web/lib/http/guard.ts";
import type { AuthFlowEnv } from "../../../apps/web/lib/auth/signup.ts";
import { dbPool, scalar } from "./db.ts";
import { recoveryTokenOf, waitForMail } from "./mailpit.ts";

/** A random token hash in the shape Supabase Auth stores (hex sha224). */
export function fakeTokenHash(): string {
  return randomBytes(28).toString("hex");
}

export interface PendingChange {
  newEmail: string;
  current: string;
  next: string;
}

/**
 * The state a request leaves in auth.users, set as postgres without sending an email: an update
 * that does not touch the email column, so the trigger of DEC79 is not involved. Supabase Auth
 * cannot complete such a change (its one-time token rows are missing): for tests of
 * app.confirm_email_change_link only.
 */
export async function pendingChange(
  userId: string,
  newEmail: string,
  sentMinutesAgo = 0,
): Promise<PendingChange> {
  const change = { newEmail, current: fakeTokenHash(), next: fakeTokenHash() };
  await dbPool().query(
    `update auth.users
        set email_change = $2, email_change_token_current = $3, email_change_token_new = $4,
            email_change_sent_at = now() - make_interval(mins => $5), email_change_confirm_status = 0
      where id = $1`,
    [userId, change.newEmail, change.current, change.next, sentMinutesAgo],
  );
  return change;
}

/** The token hashes of the two real links Supabase Auth sent for a change (Mailpit). */
export async function changeLinks(
  oldEmail: string,
  newEmail: string,
): Promise<{ current: string; next: string; path: string }> {
  const subject = t("email.email_change.subject");
  const toOld = recoveryTokenOf(await waitForMail(oldEmail, subject));
  const toNew = recoveryTokenOf(await waitForMail(newEmail, subject));
  return { current: toOld.tokenHash, next: toNew.tokenHash, path: toOld.path };
}

/** A link sent straight to Supabase Auth's own /verify endpoint, without our server (DEC79). */
export async function verifyAtSupabase(tokenHash: string): Promise<number> {
  const stack = inject("stack");
  const res = await fetch(`${stack.apiUrl}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: stack.publishableKey, "content-type": "application/json" },
    body: JSON.stringify({ type: "email_change", token_hash: tokenHash }),
  });
  await res.body?.cancel();
  return res.status;
}

export interface LoginEmail {
  email: string;
  pending: string;
}

export async function loginEmail(userId: string): Promise<LoginEmail> {
  const row = await dbPool().query<{ email: string; pending: string | null }>(
    "select email::text as email, email_change::text as pending from auth.users where id = $1",
    [userId],
  );
  const found = row.rows[0];
  if (found === undefined) throw new Error("no such user");
  return { email: found.email, pending: found.pending ?? "" };
}

export async function auditCount(userId: string, action: string): Promise<number> {
  return Number(
    await scalar<string>(
      dbPool(),
      "select count(*)::text from app.audit_event where action = $2 and target_id = $1",
      [userId, action],
    ),
  );
}

/** app.confirm_email_change_link as API021 calls it, as souq_web with no identity. */
export async function recordLink(
  db: AppDb,
  tokenHash: string,
): Promise<{ user_id: string; outcome: string; other_token_hash: string | null }> {
  const row = await db.withActor(null, "trace", async (tx) => {
    const result = await tx.query<{
      user_id: string;
      outcome: string;
      other_token_hash: string | null;
    }>("select user_id, outcome, other_token_hash from app.confirm_email_change_link($1)", [
      tokenHash,
    ]);
    return result.rows[0];
  });
  if (row === undefined) throw new Error("no row");
  return row;
}

/** Whether the proxy would accept `token` (owner condition on task 1.6) for this session id. */
export function csrfAccepts(env: AuthFlowEnv, token: string, sessionId: string | null): boolean {
  const origin = "http://localhost:3000";
  return (
    guardRequest(
      "POST",
      new Headers({ origin, "x-csrf-token": token }),
      { APP_ORIGIN: origin, APP_SECRET: env.APP_SECRET },
      sessionId,
    ) === null
  );
}

/** The CSRF token the browser holds for a member session. */
export function memberToken(env: AuthFlowEnv, identity: Identity): string {
  return csrfToken(env.APP_SECRET, { kind: "member", id: identity.sessionId });
}
