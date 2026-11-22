// API026, API027 and API028: the account deletion request and its recovery (task 3.7,
// plan/task-3.7.md): FR72, BR40, UC23, DEC37, DEC38, DEC39, DEC41, DEC73, DEC81, RL03, SEC01,
// SEC11, TC59. Framework-free like the auth flows: the route handlers pass the request, its
// identity and the configuration, and the integration tests call them the same way.
//
// API026, the request (account_reauth, DEC81): app.request_account_deletion() records it,
// hides the member's content (DEC41) and cancels what is pending (DEC39), all in one
// transaction. From that commit every session of the member gets DELETION_PENDING from our
// guards. Then every session is revoked at Supabase Auth (SEC01, scope global); a failure there
// is logged and changes nothing above (owner condition on item 8). The response removes the
// browser's session cookies and renews the guest binding. Not through endsSession in the proxy:
// it removes the cookies on a failure too, and a refused request must not sign the member out.
//
// API027, the link request (guest): the same 202 for every address (no account disclosure).
// RL03 is counted first, with the counters of API005, API006 and API020. A link is asked from
// Supabase Auth only for an account awaiting deletion whose period is still running: it is a
// Supabase sign-in link (magic_link template), in the slot of the recovery link (checked
// 22 November). Supabase Auth checks the Turnstile token only then, so a refused token is the
// same 202 too, or the answer would tell whether the account awaits deletion.
//
// API028, the link (guest): the browser's session is not read (as API021). Supabase Auth opens a
// limited session (DEC73) in a cookie jar of this request only; app.recover_account_deletion()
// runs on it, and it is ended whatever happens, so no session cookie leaves the server.
import { parseEmail } from "@souq/domain";
import { log } from "@souq/log";
import { z } from "zod";
import {
  AUTH_RATE_LIMIT_RETRY_SECONDS,
  classifyAuthError,
  logAuthFailure,
} from "../auth/auth-errors.ts";
import { TokenBody } from "../auth/confirm.ts";
import { requireAccountReauth, type GuardOptions } from "../auth/guards.ts";
import { expectedIssuer, verifyIdentity } from "../auth/identity.ts";
import { emailLimits } from "../auth/limits.ts";
import { RecoveryBody } from "../auth/recovery.ts";
import { signOutQuietly, type AuthFlowContext } from "../auth/signup.ts";
import { readJson } from "../http/body.ts";
import { readAllCookies } from "../http/cookies.ts";
import { rotateGuestBinding } from "../http/csrf.ts";
import { ApiError } from "../http/errors.ts";
import { countAttempt } from "../http/rate-limit.ts";
import { accepted } from "../http/respond.ts";
import { routes } from "../routes.ts";
import {
  createRequestAuthClient,
  sessionSetCookie,
  type RequestCookie,
} from "../supabase/server.ts";
import { isSessionCookieName } from "../supabase/session.ts";

/**
 * DeletionInput of the contract (acknowledge: const true). Any other value is a client defect,
 * not a field the member fills in: 400 (contract 0.5.6).
 */
export const DeletionBody = z.strictObject({ acknowledge: z.unknown().optional() });

/** Where a recovered account's link leads (API028). */
export const ACCOUNT_RECOVERY_LOCATION = routes.accountRecoveryDone;

/** API026: 202 with the browser signed out, or the error of the contract. */
export async function requestDeletion(
  request: Request,
  ctx: AuthFlowContext,
  options: Pick<GuardOptions, "nowSeconds"> = {},
): Promise<Response> {
  const { db, traceId } = ctx;
  const auth = await requireAccountReauth(ctx, { db, ...options });
  const input = await readJson(request, DeletionBody);
  if (input.acknowledge !== true) {
    throw new ApiError("BAD_REQUEST", {
      fieldErrors: [{ field: "acknowledge", code: "required" }],
    });
  }
  await db.withActor(auth.identity.claims, traceId, async (tx) => {
    await tx.query("select app.request_account_deletion() as requested_at");
  });

  const cookies = readAllCookies(request.headers);
  await revokeEverySession(ctx, cookies);

  const response = accepted({ status: "accepted" });
  const names = new Set(cookies.map(({ name }) => name).filter(isSessionCookieName));
  for (const name of names) response.headers.append("set-cookie", sessionSetCookie(name, "", true));
  response.headers.append("set-cookie", rotateGuestBinding().setCookie);
  return response;
}

/**
 * SEC01: every session of the member, with the browser's session. The request is already
 * committed, so a failure is logged and the flow goes on: the sessions left behind see only
 * DELETION_PENDING (app.assert_active_member and the guards read account_control).
 */
async function revokeEverySession(
  ctx: AuthFlowContext,
  cookies: readonly RequestCookie[],
): Promise<void> {
  try {
    const { client } = createRequestAuthClient(ctx.env, cookies);
    const { error } = await client.auth.signOut({ scope: "global" });
    if (error !== null) logAuthFailure("deletion", ctx.traceId, error);
  } catch (error) {
    logAuthFailure("deletion", ctx.traceId, error);
  }
}

/** API027: the general 202 for any address, or 429 from our RL03 counters. */
export async function requestDeletionRecovery(
  request: Request,
  ctx: AuthFlowContext,
): Promise<Response> {
  const { env, db, traceId } = ctx;
  const input = await readJson(request, RecoveryBody);
  const email = parseEmail(input.email);
  if (!email.ok) {
    throw new ApiError("VALIDATION_FAILED", {
      fieldErrors: [{ field: "email", code: email.error }],
    });
  }
  await countAttempt(db, traceId, emailLimits(env.APP_SECRET, email.value));

  const pending = await db.withActor(null, traceId, async (tx) => {
    const result = await tx.query<{ pending: boolean }>(
      "select app.deletion_recovery_pending($1) as pending",
      [email.value],
    );
    return result.rows[0]?.pending === true;
  });
  if (!pending) return accepted({ status: "accepted" });

  // No request cookies: the request must not touch a session this browser may hold. The link is
  // built by the template from the site address, so no redirect is sent.
  const { client } = createRequestAuthClient(env, []);
  const { error } = await client.auth.signInWithOtp({
    email: email.value,
    options: { shouldCreateUser: false, captchaToken: input.captcha_token },
  });
  if (error !== null) {
    const kind = classifyAuthError(error);
    if (kind === "unavailable") {
      logAuthFailure("deletion_recovery", traceId, error);
      throw new ApiError("SERVICE_UNAVAILABLE", { retryAfter: 5 });
    }
    if (kind === "rate_limited") {
      throw new ApiError("RATE_LIMITED", { retryAfter: AUTH_RATE_LIMIT_RETRY_SECONDS });
    }
    // The 60-second cooldown it shares with the recovery link, and a refused Turnstile token
    // (checked only for this account), stay the general answer.
    if (kind !== "email_rate_limited") logAuthFailure("deletion_recovery", traceId, error);
  }
  return accepted({ status: "accepted" });
}

function linkFailure(error: unknown, traceId: string): ApiError {
  switch (classifyAuthError(error)) {
    case "link_invalid":
      return new ApiError("LINK_INVALID_OR_EXPIRED");
    case "rate_limited":
      return new ApiError("RATE_LIMITED", { retryAfter: AUTH_RATE_LIMIT_RETRY_SECONDS });
    case "unavailable":
      logAuthFailure("deletion_recovery_confirm", traceId, error);
      return new ApiError("SERVICE_UNAVAILABLE", { retryAfter: 5 });
    default:
      logAuthFailure("deletion_recovery_confirm", traceId, error);
      return new ApiError("INTERNAL_ERROR");
  }
}

/** API028: 303 to the done page, or 422 for a spent link or a period that has ended. */
export async function confirmDeletionRecovery(
  request: Request,
  ctx: AuthFlowContext,
): Promise<Response> {
  const { env, db, traceId } = ctx;
  const { token_hash } = await readJson(request, TokenBody);
  // No request cookies: the link's session stays in this jar and never reaches the browser.
  const { client } = createRequestAuthClient(env, []);
  const { error } = await client.auth.verifyOtp({ type: "email", token_hash });
  if (error !== null) throw linkFailure(error, traceId);

  try {
    const identity = await verifyIdentity(
      client,
      expectedIssuer(env.NEXT_PUBLIC_SUPABASE_URL),
      traceId,
    );
    // A link always opens a limited session (DEC73); anything else is a defect.
    if (identity === null || !identity.limited) throw new ApiError("INTERNAL_ERROR");
    await db.withActor(identity.claims, traceId, async (tx) => {
      await tx.query("select app.recover_account_deletion()");
    });
  } finally {
    await signOutQuietly(client, traceId, "deletion_recovery_confirm");
  }
  log.info("account.deletion_recovered", { trace_id: traceId });
  return new Response(null, {
    status: 303,
    headers: { location: ACCOUNT_RECOVERY_LOCATION, "cache-control": "no-store" },
  });
}
