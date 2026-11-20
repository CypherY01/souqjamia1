// API002, login (task 3.3, item 3): FR02, UC02, FR78, BR21, RL01, DEC36, DEC52, DEC70, DEC73,
// TC02. Framework-free like the signup flow: the route handler passes the request, its identity
// and the configuration, and integration tests call it the same way.
//   1. A live ordinary session may not log in again (403 FORBIDDEN); the page never shows the
//      form to it. A limited session (a recovery link, DEC73) is signed out first.
//   2. Field errors together in one 422: the email, a password, and a local return path
//      (safeLocalPath, TC02), all before Supabase Auth is called, so a refused path opens no
//      session.
//   3. RL01 is checked without counting; a spent limit is 429 without calling Supabase Auth,
//      even with the right password. Only a wrong password (or an unknown address: the same
//      answer) is counted, on a separate connection (DEC70).
//   4. Supabase Auth signs in from the server with the Turnstile token (DEC36, DEC52).
//   5. The new session is verified like any other (task 3.1) and its account state read: an
//      account awaiting deletion or restricted goes to /restricted only (FR78, DEC41).
//   6. 200 with the session cookies and a new guest binding for the CSRF token (owner condition
//      on task 1.6). mfa_required joins with task 7.1.
import {
  parseEmail,
  passwordBytes,
  passwordLength,
  PASSWORD_MAX,
  PASSWORD_MAX_BYTES,
  safeLocalPath,
} from "@souq/domain";
import { z } from "zod";
import { readJson } from "../http/body.ts";
import { readAllCookies } from "../http/cookies.ts";
import { rotateGuestBinding } from "../http/csrf.ts";
import { ApiError, type FieldError } from "../http/errors.ts";
import { checkLimits, countFailures, rateLimited, type AttemptLimit } from "../http/rate-limit.ts";
import { ok } from "../http/respond.ts";
import { routes } from "../routes.ts";
import { createRequestAuthClient, type AuthFlowClient } from "../supabase/server.ts";
import { isSessionCookieName } from "../supabase/session.ts";
import { AUTH_RATE_LIMIT_RETRY_SECONDS, classifyAuthError, logAuthFailure } from "./auth-errors.ts";
import { loadSessionState, restrictionOf } from "./guards.ts";
import { expectedIssuer, verifyIdentity } from "./identity.ts";
import { loginLimits } from "./limits.ts";
import { prepareSession, signOutQuietly, type AuthFlowContext } from "./signup.ts";

/** LoginInput of the contract. `next` is checked below with the other fields (422). */
export const LoginBody = z.strictObject({
  email: z.string(),
  password: z.string(),
  next: z.string().optional(),
  captcha_token: z.string(),
});
export type LoginBody = z.infer<typeof LoginBody>;

/** LoginResult of the contract. */
export interface LoginResult {
  state: "signed_in" | "restricted" | "deletion_pending";
  next: string;
}

/** The rules checked before anything is counted or called (TC02: next is one of them). */
export function loginFieldErrors(input: LoginBody): FieldError[] {
  const errors: FieldError[] = [];
  const email = parseEmail(input.email);
  if (!email.ok) errors.push({ field: "email", code: email.error });
  if (input.password === "") errors.push({ field: "password", code: "required" });
  if (input.next !== undefined && safeLocalPath(input.next) === null) {
    errors.push({ field: "next", code: "not_local" });
  }
  return errors;
}

/**
 * DEC32: no account can have a password over 64 characters or 72 bytes, so such a password is
 * wrong without asking Supabase Auth. The lower bound is not checked: an account made under an
 * older rule must still be able to log in.
 */
export function cannotBeRight(password: string): boolean {
  return passwordLength(password) > PASSWORD_MAX || passwordBytes(password) > PASSWORD_MAX_BYTES;
}

/** RL01 after a wrong password: 401, or 429 when this failure went over a limit. */
async function wrongCredentials(
  ctx: AuthFlowContext,
  limits: readonly AttemptLimit[],
): Promise<ApiError> {
  const wait = await countFailures(ctx.db, ctx.traceId, limits);
  return wait > 0 ? rateLimited(wait) : new ApiError("UNAUTHENTICATED");
}

export async function login(request: Request, ctx: AuthFlowContext): Promise<Response> {
  const { env, db, traceId } = ctx;
  const { client, written } = createRequestAuthClient(env, readAllCookies(request.headers));
  await prepareSession(ctx, client, "login");
  const input = await readJson(request, LoginBody);

  const fieldErrors = loginFieldErrors(input);
  if (fieldErrors.length > 0) throw new ApiError("VALIDATION_FAILED", { fieldErrors });

  const email = input.email.trim();
  const limits = loginLimits(env, request.headers, email);
  await checkLimits(db, traceId, limits);
  if (cannotBeRight(input.password)) throw await wrongCredentials(ctx, limits);

  const { error } = await client.auth.signInWithPassword({
    email,
    password: input.password,
    options: { captchaToken: input.captcha_token },
  });
  if (error !== null) {
    const kind = classifyAuthError(error);
    switch (kind) {
      case "invalid_credentials":
        throw await wrongCredentials(ctx, limits);
      case "captcha_failed":
        throw new ApiError("CAPTCHA_FAILED");
      case "email_not_confirmed":
        throw new ApiError("EMAIL_NOT_CONFIRMED");
      case "rate_limited":
      case "email_rate_limited":
        throw new ApiError("RATE_LIMITED", { retryAfter: AUTH_RATE_LIMIT_RETRY_SECONDS });
      case "email_invalid":
        throw new ApiError("VALIDATION_FAILED", {
          fieldErrors: [{ field: "email", code: "invalid_format" }],
        });
      case "unavailable":
        logAuthFailure("login", traceId, error);
        throw new ApiError("SERVICE_UNAVAILABLE", { retryAfter: 5 });
      default:
        logAuthFailure("login", traceId, error);
        throw new ApiError("INTERNAL_ERROR");
    }
  }

  const result = await sessionResult(ctx, client, safeLocalPath(input.next) ?? routes.home);
  const response = ok(result);
  for (const cookie of written) {
    if (isSessionCookieName(cookie.name)) response.headers.append("set-cookie", cookie.setCookie);
  }
  // Owner condition 1 on task 1.6: the guest token from before this login is not valid again
  // after a later logout. The page fetches a new CSRF token now.
  response.headers.append("set-cookie", rotateGuestBinding().setCookie);
  return response;
}

/**
 * Where the new session goes. If it cannot be verified or read, it is ended here, and no cookie
 * leaves the server.
 */
async function sessionResult(
  ctx: AuthFlowContext,
  client: AuthFlowClient,
  next: string,
): Promise<LoginResult> {
  try {
    const identity = await verifyIdentity(
      client,
      expectedIssuer(ctx.env.NEXT_PUBLIC_SUPABASE_URL),
      ctx.traceId,
    );
    // A password sign-in is never limited (DEC73); anything else is a defect.
    if (identity === null || identity.limited) throw new ApiError("INTERNAL_ERROR");
    const state = await loadSessionState(identity, ctx.traceId, ctx.db);
    const restriction = restrictionOf(state);
    if (restriction === null) return { state: "signed_in", next };
    return {
      state: restriction.kind === "deletion_pending" ? "deletion_pending" : "restricted",
      next: routes.restricted,
    };
  } catch (error) {
    await signOutQuietly(client, ctx.traceId, "login");
    throw error;
  }
}
