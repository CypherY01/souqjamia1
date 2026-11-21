// API022, password change (task 3.6, plan/task-3.6.md): FR59, UC20, DEC32, DEC36, DEC38, RL01,
// SEC01, SEC11, TC27. Framework-free like the auth flows.
//   1. Member level (item 4): the current password, checked by a fresh sign-in with Turnstile in
//      this very request, is the reauthentication (lib/auth/reauth.ts, with RL01).
//   2. The new password follows DEC32 (checkPassword), and may not be the current one.
//   3. It is changed on the new session, a few seconds old, so Supabase Auth's secure password
//      change asks for no emailed code (it does for a session older than 24 hours). Supabase Auth
//      then revokes every other session of the account, the browser's previous one included
//      (TC27), and sends the "password changed" notice (SEC11, task 3.4).
//   4. account.password_changed is audited on the new session; a failure is logged and the
//      change still succeeds, as for the reset of task 3.4.
//   5. 204 with the new session's cookies and a new guest binding: the member stays signed in
//      (item 5), and the CSRF token from before is refused (owner condition on task 1.6).
// If the change fails after the sign-in, the new session is ended and the browser keeps its own.
import { checkPassword } from "@souq/domain";
import { log } from "@souq/log";
import { z } from "zod";
import { requireMember, type GuardOptions } from "../auth/guards.ts";
import {
  AUTH_RATE_LIMIT_RETRY_SECONDS,
  classifyAuthError,
  logAuthFailure,
} from "../auth/auth-errors.ts";
import { freshSignIn, replaceSessionCookies } from "../auth/reauth.ts";
import { signOutQuietly, type AuthFlowContext } from "../auth/signup.ts";
import { readJson } from "../http/body.ts";
import { readAllCookies } from "../http/cookies.ts";
import { ApiError } from "../http/errors.ts";
import { noContent } from "../http/respond.ts";

/** PasswordChangeInput of the contract. Passwords are never trimmed or normalised (DEC32). */
export const PasswordChangeBody = z.strictObject({
  current_password: z.string(),
  new_password: z.string(),
  captcha_token: z.string(),
});

function newPasswordError(code: string): ApiError {
  return new ApiError("VALIDATION_FAILED", { fieldErrors: [{ field: "new_password", code }] });
}

export async function changePassword(
  request: Request,
  ctx: AuthFlowContext,
  options: Pick<GuardOptions, "nowSeconds"> = {},
): Promise<Response> {
  const auth = await requireMember(ctx, { db: ctx.db, ...options });
  const input = await readJson(request, PasswordChangeBody);
  const rule = checkPassword(input.new_password);
  if (rule !== null) throw newPasswordError(rule);
  if (input.new_password === input.current_password) throw newPasswordError("same_password");

  const fresh = await freshSignIn(
    request,
    ctx,
    auth,
    input.current_password,
    input.captcha_token,
    "password_change",
  );
  const { error } = await fresh.client.auth.updateUser({ password: input.new_password });
  if (error !== null) {
    await signOutQuietly(fresh.client, ctx.traceId, "password_change");
    throw changeFailure(error, ctx.traceId);
  }

  try {
    await ctx.db.withActor(fresh.identity.claims, ctx.traceId, async (tx) => {
      await tx.query("select app.record_credential_change('account.password_changed')");
    });
  } catch (auditError) {
    log.error("audit.write_failed", {
      trace_id: ctx.traceId,
      action: "account.password_changed",
      reason: auditError instanceof ApiError ? auditError.code : (auditError as Error).name,
    });
  }

  return replaceSessionCookies(noContent(), readAllCookies(request.headers), fresh.written);
}

function changeFailure(error: unknown, traceId: string): ApiError {
  switch (classifyAuthError(error)) {
    case "same_password":
      return newPasswordError("same_password");
    case "weak_password":
      // Checked here before the call; after the Pro upgrade also a leaked password (DEC32).
      return newPasswordError("weak");
    case "rate_limited":
    case "email_rate_limited":
      return new ApiError("RATE_LIMITED", { retryAfter: AUTH_RATE_LIMIT_RETRY_SECONDS });
    case "unavailable":
      logAuthFailure("password_change", traceId, error);
      return new ApiError("SERVICE_UNAVAILABLE", { retryAfter: 5 });
    default:
      logAuthFailure("password_change", traceId, error);
      return new ApiError("INTERNAL_ERROR");
  }
}
