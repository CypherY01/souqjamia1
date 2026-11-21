// API020 and API021, the login email change (task 3.6, plan/task-3.6.md): FR59, BR23, UC20,
// DEC37, DEC38, DEC79, RL03, SEC03, SEC11, TC74. Framework-free like the auth flows.
//
// API020, the request (member_reauth): Supabase Auth keeps the old address and sends a link to
// each address (secure email change). RL03 is counted for both addresses before the call
// (item 8). An address of another account is refused (UC20, item 7).
//
// API021, a link (guest: opened on any device, the browser's session is not used to confirm):
// DEC79. Email confirmation is off (DEC63), and in that mode Supabase Auth would complete the
// change with either link alone. So each link is first recorded in the database
// (app.confirm_email_change_link), and the trigger on auth.users refuses the change until both
// are: also when a link is sent straight to Supabase Auth.
//   - The first link: recorded only, 303 to the waiting page. Supabase Auth is not called.
//   - The second: Supabase Auth is called with it and completes the change. With confirmation on
//     (DEC63 switched on) Supabase Auth counts the links itself and answers the first call
//     without a session, so the other link is sent right after it.
//   - Then every session of the account is revoked (BR23) with the session Supabase Auth
//     returned, Supabase Auth sends the email_changed notice to the old address (SEC11), and the
//     trigger has audited account.email_changed. 303 to the done page; the browser's session
//     cookies are removed only when they belong to this account (item 12).
import { parseEmail } from "@souq/domain";
import { log } from "@souq/log";
import { z } from "zod";
import {
  AUTH_RATE_LIMIT_RETRY_SECONDS,
  classifyAuthError,
  logAuthFailure,
} from "../auth/auth-errors.ts";
import { TokenBody } from "../auth/confirm.ts";
import { requireMemberReauth, type GuardOptions } from "../auth/guards.ts";
import { emailLimits } from "../auth/limits.ts";
import type { AuthFlowContext } from "../auth/signup.ts";
import { readJson } from "../http/body.ts";
import { readAllCookies } from "../http/cookies.ts";
import { rotateGuestBinding } from "../http/csrf.ts";
import { ApiError } from "../http/errors.ts";
import { countAttempt } from "../http/rate-limit.ts";
import { accepted } from "../http/respond.ts";
import { routes } from "../routes.ts";
import { createRequestAuthClient, sessionSetCookie } from "../supabase/server.ts";
import { isSessionCookieName } from "../supabase/session.ts";
import { loadAccount } from "./me.ts";

/** EmailChangeInput of the contract. */
export const EmailChangeBody = z.strictObject({ new_email: z.string() });

/** Where API021 leads: the waiting page after one link, the done page after both. */
export const EMAIL_CHANGE_WAITING = `${routes.emailChangeDone}?state=waiting`;
export const EMAIL_CHANGE_CHANGED = `${routes.emailChangeDone}?state=changed`;

function newEmailError(code: string): ApiError {
  return new ApiError("VALIDATION_FAILED", { fieldErrors: [{ field: "new_email", code }] });
}

/** API020: 202 once Supabase Auth has sent both links. */
export async function requestEmailChange(
  request: Request,
  ctx: AuthFlowContext,
  options: Pick<GuardOptions, "nowSeconds"> = {},
): Promise<Response> {
  const { env, db, traceId } = ctx;
  const auth = await requireMemberReauth(ctx, { db, ...options });
  const input = await readJson(request, EmailChangeBody);
  const email = parseEmail(input.new_email);
  if (!email.ok) throw newEmailError(email.error);
  const { me } = await loadAccount(db, auth.identity, traceId);
  if (email.value.toLowerCase() === me.email.toLowerCase()) throw newEmailError("same_email");

  // Item 8: both addresses receive an email.
  await countAttempt(db, traceId, [
    ...emailLimits(env.APP_SECRET, email.value),
    ...emailLimits(env.APP_SECRET, me.email),
  ]);

  const { client } = createRequestAuthClient(env, readAllCookies(request.headers));
  const { error } = await client.auth.updateUser({ email: email.value });
  if (error !== null) {
    switch (classifyAuthError(error)) {
      case "user_already_exists":
        throw newEmailError("taken");
      case "email_invalid":
        throw newEmailError("invalid_format");
      case "rate_limited":
      case "email_rate_limited":
        throw new ApiError("RATE_LIMITED", { retryAfter: AUTH_RATE_LIMIT_RETRY_SECONDS });
      case "session_ended":
        throw new ApiError("UNAUTHENTICATED");
      case "unavailable":
        logAuthFailure("email_change", traceId, error);
        throw new ApiError("SERVICE_UNAVAILABLE", { retryAfter: 5 });
      default:
        logAuthFailure("email_change", traceId, error);
        throw new ApiError("INTERNAL_ERROR");
    }
  }

  try {
    await db.withActor(auth.identity.claims, traceId, async (tx) => {
      await tx.query("select app.record_credential_change('account.email_change_requested')");
    });
  } catch (auditError) {
    log.error("audit.write_failed", {
      trace_id: traceId,
      action: "account.email_change_requested",
      reason: auditError instanceof ApiError ? auditError.code : (auditError as Error).name,
    });
  }
  return accepted({ status: "accepted" });
}

interface LinkRow {
  user_id: string;
  outcome: "recorded" | "complete";
  other_token_hash: string | null;
}

function linkFailure(error: unknown, traceId: string): ApiError {
  switch (classifyAuthError(error)) {
    case "link_invalid":
      return new ApiError("LINK_INVALID_OR_EXPIRED");
    case "rate_limited":
      return new ApiError("RATE_LIMITED", { retryAfter: AUTH_RATE_LIMIT_RETRY_SECONDS });
    case "unavailable":
      logAuthFailure("email_change_confirm", traceId, error);
      return new ApiError("SERVICE_UNAVAILABLE", { retryAfter: 5 });
    default:
      logAuthFailure("email_change_confirm", traceId, error);
      return new ApiError("INTERNAL_ERROR");
  }
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });
}

/** API021: 303 to the waiting or the done page, or 422 for a spent, old or replaced link. */
export async function confirmEmailChange(
  request: Request,
  ctx: AuthFlowContext,
): Promise<Response> {
  const { env, db, traceId } = ctx;
  const { token_hash } = await readJson(request, TokenBody);
  const link = await db.withActor(null, traceId, async (tx) => {
    const result = await tx.query<LinkRow>(
      "select user_id, outcome, other_token_hash from app.confirm_email_change_link($1)",
      [token_hash],
    );
    return result.rows[0];
  });
  if (link === undefined) throw new ApiError("INTERNAL_ERROR");
  if (link.outcome === "recorded") return redirect(EMAIL_CHANGE_WAITING);

  // No request cookies: the link must not touch a session this browser may hold.
  const { client } = createRequestAuthClient(env, []);
  let { data, error } = await client.auth.verifyOtp({ type: "email_change", token_hash });
  if (error === null && data.session === null && link.other_token_hash !== null) {
    ({ data, error } = await client.auth.verifyOtp({
      type: "email_change",
      token_hash: link.other_token_hash,
    }));
  }
  if (error !== null) throw linkFailure(error, traceId);

  // BR23: every session of the account, also the one Supabase Auth has just opened.
  if (data.session !== null) {
    try {
      const { error: signOutError } = await client.auth.signOut({ scope: "global" });
      if (signOutError !== null) logAuthFailure("email_change_confirm", traceId, signOutError);
    } catch (signOutError) {
      logAuthFailure("email_change_confirm", traceId, signOutError);
    }
  } else {
    log.error("auth.email_change_without_session", { trace_id: traceId });
  }

  const response = redirect(EMAIL_CHANGE_CHANGED);
  const identity = await ctx.identity();
  if (identity !== null && identity.userId === link.user_id) {
    const names = new Set(
      readAllCookies(request.headers)
        .map(({ name }) => name)
        .filter(isSessionCookieName),
    );
    for (const name of names)
      response.headers.append("set-cookie", sessionSetCookie(name, "", true));
  }
  response.headers.append("set-cookie", rotateGuestBinding().setCookie);
  return response;
}
