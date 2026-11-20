// API006, API007 and API008: password recovery (task 3.4, plan/task-3.4.md): FR03, UC02 step 3,
// BR21, DEC32, DEC37, DEC38, DEC52, DEC73, RL03, SEC03, TC03, TC27. Framework-free like the other
// auth flows: the route handlers pass the request, its identity and the configuration, and the
// integration tests call them the same way.
//
// API006, the request: the session is not read (owner decision on item 1). RL03 for the address
// is counted before the call (DEC70), the same counters as API005, for any address. Supabase Auth
// sends nothing for an unknown address, and its 60-second cooldown for an existing account would
// reveal it, so both get the same general 202 as success.
//
// API007, the link: the page (GET /auth/recover) only shows a button; this POST spends the link
// once. Supabase Auth opens a session with amr = otp only, a limited session (DEC73): 5 minutes,
// the new password only (DEC38). A live ordinary session in the browser is refused (403): the
// page offers "sign out and continue" first (owner decision on item 2). A limited session from
// an earlier link is ended first, so the new one replaces it.
//
// API008, the new password: the recovery access level (requireRecovery). Supabase Auth changes
// the password and revokes the account's other sessions itself (checked 20 November); then the
// reset is audited, every session of the account is revoked (scope global, this one too: it
// stays amr = otp after the change), the browser's session cookies are removed, and the guest
// binding is renewed. The member logs in with the new password (owner decision on item 3).
import { checkPassword, parseEmail } from "@souq/domain";
import { log } from "@souq/log";
import { z } from "zod";
import { readJson } from "../http/body.ts";
import { readAllCookies } from "../http/cookies.ts";
import { rotateGuestBinding } from "../http/csrf.ts";
import { ApiError } from "../http/errors.ts";
import { countAttempt } from "../http/rate-limit.ts";
import { accepted, noContent } from "../http/respond.ts";
import { routes } from "../routes.ts";
import {
  createRequestAuthClient,
  sessionSetCookie,
  type AuthFlowClient,
} from "../supabase/server.ts";
import { isSessionCookieName } from "../supabase/session.ts";
import { AUTH_RATE_LIMIT_RETRY_SECONDS, classifyAuthError, logAuthFailure } from "./auth-errors.ts";
import { TokenBody } from "./confirm.ts";
import { requireRecovery, type GuardOptions } from "./guards.ts";
import { expectedIssuer, verifyIdentity } from "./identity.ts";
import { emailLimits } from "./limits.ts";
import { prepareSession, signOutQuietly, type AuthFlowContext } from "./signup.ts";

/** EmailCaptchaInput of the contract. */
export const RecoveryBody = z.strictObject({ email: z.string(), captcha_token: z.string() });

/** ResetInput of the contract. The password is checked below (DEC32), never trimmed. */
export const ResetBody = z.strictObject({ new_password: z.string() });

/** Where a spent recovery link leads: the new-password page, with the recovery session. */
export const RECOVERY_LOCATION = routes.account.reset;

/** API006: the general 202 for any address, or 429 from our RL03 counters. */
export async function requestRecovery(request: Request, ctx: AuthFlowContext): Promise<Response> {
  const input = await readJson(request, RecoveryBody);
  const email = parseEmail(input.email);
  if (!email.ok) {
    throw new ApiError("VALIDATION_FAILED", {
      fieldErrors: [{ field: "email", code: email.error }],
    });
  }
  await countAttempt(ctx.db, ctx.traceId, emailLimits(ctx.env.APP_SECRET, email.value));

  // No request cookies: the request must not touch a session this browser may hold. The link is
  // built by the template from the site address, so no redirectTo is sent.
  const { client } = createRequestAuthClient(ctx.env, []);
  const { error } = await client.auth.resetPasswordForEmail(email.value, {
    captchaToken: input.captcha_token,
  });
  if (error !== null) {
    const kind = classifyAuthError(error);
    if (kind === "captcha_failed") throw new ApiError("CAPTCHA_FAILED");
    if (kind === "unavailable") {
      logAuthFailure("recovery", ctx.traceId, error);
      throw new ApiError("SERVICE_UNAVAILABLE", { retryAfter: 5 });
    }
    if (kind === "rate_limited") {
      throw new ApiError("RATE_LIMITED", { retryAfter: AUTH_RATE_LIMIT_RETRY_SECONDS });
    }
    // The cooldown of an existing account, and anything about one, stays the general answer.
    if (kind !== "email_rate_limited") logAuthFailure("recovery", ctx.traceId, error);
  }
  return accepted({ status: "accepted" });
}

/** API007: 303 to the new-password page with a limited session, or 422 for a spent link. */
export async function verifyRecovery(request: Request, ctx: AuthFlowContext): Promise<Response> {
  const { token_hash } = await readJson(request, TokenBody);
  const { client, written } = createRequestAuthClient(ctx.env, readAllCookies(request.headers));
  await prepareSession(ctx, client, "recovery_verify");

  const { error } = await client.auth.verifyOtp({ type: "recovery", token_hash });
  if (error !== null) {
    const kind = classifyAuthError(error);
    if (kind === "unavailable") {
      logAuthFailure("recovery_verify", ctx.traceId, error);
      throw new ApiError("SERVICE_UNAVAILABLE", { retryAfter: 5 });
    }
    if (kind === "rate_limited") {
      throw new ApiError("RATE_LIMITED", { retryAfter: AUTH_RATE_LIMIT_RETRY_SECONDS });
    }
    if (kind !== "link_invalid") logAuthFailure("recovery_verify", ctx.traceId, error);
    throw new ApiError("LINK_INVALID_OR_EXPIRED");
  }
  await assertLimited(ctx, client);

  const response = new Response(null, {
    status: 303,
    headers: { location: RECOVERY_LOCATION, "cache-control": "no-store" },
  });
  for (const cookie of written) {
    if (isSessionCookieName(cookie.name)) response.headers.append("set-cookie", cookie.setCookie);
  }
  // Owner condition 1 on task 1.6: a new session gets a new guest binding, and the next page
  // fetches a CSRF token bound to the recovery session.
  response.headers.append("set-cookie", rotateGuestBinding().setCookie);
  return response;
}

/**
 * The session a recovery link opens is limited (DEC73). Anything else is a defect: the session
 * is ended here, and no cookie leaves the server.
 */
async function assertLimited(ctx: AuthFlowContext, client: AuthFlowClient): Promise<void> {
  const identity = await verifyIdentity(
    client,
    expectedIssuer(ctx.env.NEXT_PUBLIC_SUPABASE_URL),
    ctx.traceId,
  );
  if (identity !== null && identity.limited) return;
  await signOutQuietly(client, ctx.traceId, "recovery_verify");
  throw new ApiError("INTERNAL_ERROR");
}

/** API008: 204 with every session revoked, or the error of the contract. */
export async function resetPassword(
  request: Request,
  ctx: AuthFlowContext,
  options: Pick<GuardOptions, "nowSeconds"> = {},
): Promise<Response> {
  const auth = await requireRecovery(ctx, { db: ctx.db, ...options });
  const { new_password } = await readJson(request, ResetBody);
  const rule = checkPassword(new_password);
  if (rule !== null) {
    throw new ApiError("VALIDATION_FAILED", {
      fieldErrors: [{ field: "new_password", code: rule }],
    });
  }

  const cookies = readAllCookies(request.headers);
  const { client } = createRequestAuthClient(ctx.env, cookies);
  const { error } = await client.auth.updateUser({ password: new_password });
  if (error !== null) throw resetFailure(error, ctx.traceId);

  await auditReset(ctx, auth.identity.claims);
  // Every session of the account, this one included (owner decision on item 3).
  try {
    const { error: signOutError } = await client.auth.signOut({ scope: "global" });
    if (signOutError !== null) logAuthFailure("reset", ctx.traceId, signOutError);
  } catch (signOutError) {
    logAuthFailure("reset", ctx.traceId, signOutError);
  }

  const response = noContent();
  // Like the sign-out (DEC76): every chunk the browser sent is removed, whatever Supabase said.
  const names = new Set(cookies.map(({ name }) => name).filter(isSessionCookieName));
  for (const name of names) response.headers.append("set-cookie", sessionSetCookie(name, "", true));
  response.headers.append("set-cookie", rotateGuestBinding().setCookie);
  return response;
}

function resetFailure(error: unknown, traceId: string): ApiError {
  switch (classifyAuthError(error)) {
    case "same_password":
      return new ApiError("VALIDATION_FAILED", {
        fieldErrors: [{ field: "new_password", code: "same_password" }],
      });
    case "weak_password":
      // Checked here before the call; after the Pro upgrade also a leaked password (DEC32).
      return new ApiError("VALIDATION_FAILED", {
        fieldErrors: [{ field: "new_password", code: "weak" }],
      });
    case "session_ended":
      return new ApiError("UNAUTHENTICATED");
    case "rate_limited":
    case "email_rate_limited":
      return new ApiError("RATE_LIMITED", { retryAfter: AUTH_RATE_LIMIT_RETRY_SECONDS });
    case "unavailable":
      logAuthFailure("reset", traceId, error);
      return new ApiError("SERVICE_UNAVAILABLE", { retryAfter: 5 });
    default:
      logAuthFailure("reset", traceId, error);
      return new ApiError("INTERNAL_ERROR");
  }
}

/**
 * account.password_reset in the audit trail, while the recovery session is still live. The
 * password has already changed, so a failure here is logged and the reset still succeeds (owner
 * decision on item 6).
 */
async function auditReset(
  ctx: AuthFlowContext,
  claims: Readonly<Record<string, unknown>>,
): Promise<void> {
  try {
    await ctx.db.withActor(claims, ctx.traceId, async (tx) => {
      await tx.query("select app.record_password_reset()");
    });
  } catch (error) {
    log.error("audit.write_failed", {
      trace_id: ctx.traceId,
      action: "account.password_reset",
      reason: error instanceof ApiError ? error.code : (error as Error).name,
    });
  }
}
