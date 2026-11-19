// API004 and API005: the email confirmation link and its resend (task 3.2, items 5 and 6): FR57,
// BR21, DEC37, DEC63, DEC66, RL03, TC26. Both exist only while confirmation is on; otherwise
// they answer 404 (DEC66), and turning confirmation on needs no code change (DEC63).
//
// API004: the link page (GET /auth/confirm) only shows a button; this POST spends the link once
// (section 5 of the addendum: email scanners follow GET links). Supabase Auth opens a session
// when it accepts the link, with amr = otp only (a limited session, DEC73); it is ended at once,
// no cookie leaves the server, and the browser goes on to the login page.
//
// API005: RL03 for the address, counted before the call (DEC70), the same for any address.
// Supabase Auth's 60-second cooldown for an existing account would reveal it, so it gets the
// same general 202 as success and as an unknown address.
import { parseEmail } from "@souq/domain";
import { z } from "zod";
import { readJson } from "../http/body.ts";
import { ApiError } from "../http/errors.ts";
import { countAttempt } from "../http/rate-limit.ts";
import { accepted } from "../http/respond.ts";
import { routes } from "../routes.ts";
import { createRequestAuthClient } from "../supabase/server.ts";
import { AUTH_RATE_LIMIT_RETRY_SECONDS, classifyAuthError, logAuthFailure } from "./auth-errors.ts";
import { emailLimits } from "./limits.ts";
import { signOutQuietly, type AuthFlowContext } from "./signup.ts";

/** Where a spent confirmation link leads: the login page of task 3.3, with a notice. */
export const CONFIRMED_LOCATION = `${routes.login}?confirmed=1`;

export const TokenBody = z.strictObject({ token_hash: z.string().min(1).max(512) });

export const ResendBody = z.strictObject({
  email: z.string(),
  purpose: z.enum(["signup", "email_change"]),
  captcha_token: z.string(),
});

function assertConfirmationOn(ctx: AuthFlowContext): void {
  if (!ctx.env.EMAIL_CONFIRMATION_REQUIRED) throw new ApiError("NOT_FOUND");
}

/** API004: 303 to the login page, or 422 LINK_INVALID_OR_EXPIRED for a spent or old link. */
export async function confirmEmail(request: Request, ctx: AuthFlowContext): Promise<Response> {
  assertConfirmationOn(ctx);
  const { token_hash } = await readJson(request, TokenBody);
  // No request cookies: the link must not touch a session this browser may hold.
  const { client } = createRequestAuthClient(ctx.env, []);
  const { data, error } = await client.auth.verifyOtp({ type: "email", token_hash });
  if (error !== null) {
    const kind = classifyAuthError(error);
    if (kind === "unavailable") {
      logAuthFailure("confirm", ctx.traceId, error);
      throw new ApiError("SERVICE_UNAVAILABLE", { retryAfter: 5 });
    }
    if (kind === "rate_limited") {
      throw new ApiError("RATE_LIMITED", { retryAfter: AUTH_RATE_LIMIT_RETRY_SECONDS });
    }
    if (kind !== "link_invalid") logAuthFailure("confirm", ctx.traceId, error);
    throw new ApiError("LINK_INVALID_OR_EXPIRED");
  }
  if (data.session !== null) await signOutQuietly(client, ctx.traceId);
  return new Response(null, {
    status: 303,
    headers: { location: CONFIRMED_LOCATION, "cache-control": "no-store" },
  });
}

/** API005: the general 202 for any address, or 429 from our RL03 counters. */
export async function resendConfirmation(
  request: Request,
  ctx: AuthFlowContext,
): Promise<Response> {
  assertConfirmationOn(ctx);
  const input = await readJson(request, ResendBody);
  // Item 7: the email change links come with task 3.6.
  if (input.purpose === "email_change") throw new ApiError("NOT_FOUND");
  const email = parseEmail(input.email);
  if (!email.ok) {
    throw new ApiError("VALIDATION_FAILED", {
      fieldErrors: [{ field: "email", code: email.error }],
    });
  }
  await countAttempt(ctx.db, ctx.traceId, emailLimits(ctx.env.APP_SECRET, email.value));

  const { client } = createRequestAuthClient(ctx.env, []);
  const { error } = await client.auth.resend({
    type: "signup",
    email: email.value,
    options: { captchaToken: input.captcha_token },
  });
  if (error !== null) {
    const kind = classifyAuthError(error);
    if (kind === "captcha_failed") throw new ApiError("CAPTCHA_FAILED");
    if (kind === "unavailable") {
      logAuthFailure("resend", ctx.traceId, error);
      throw new ApiError("SERVICE_UNAVAILABLE", { retryAfter: 5 });
    }
    if (kind === "rate_limited") {
      throw new ApiError("RATE_LIMITED", { retryAfter: AUTH_RATE_LIMIT_RETRY_SECONDS });
    }
    // The cooldown of an existing account, and anything about one, stays the general answer.
    if (kind !== "email_rate_limited") logAuthFailure("resend", ctx.traceId, error);
  }
  return accepted({ status: "accepted" });
}
