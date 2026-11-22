// API001, signup (task 3.2, item 3): FR01, UC01, DEC26, DEC32, DEC36, DEC37, DEC63, DEC64, DEC74,
// BR24, TC01, TC25. Framework-free: the route handler passes the request, its identity and the
// configuration, and integration tests call it the same way.
//   1. A live member session may not sign up again (403 FORBIDDEN). A limited session (a
//      recovery link) is ended first (task 3.4, prepareSession).
//   2. Every field error at once, in one 422 (TC01): name, email, password (DEC32), both boxes,
//      the policy versions in force (API114, not_current) and an active college (unknown).
//   3. RL02 (DEC74), and RL03 for the address while confirmation is on (a signup sends a link),
//      counted before Supabase Auth is called (DEC70).
//   4. Supabase Auth signs up from the server with the Turnstile token (DEC36, DEC52). The
//      profile trigger records the acknowledgments and the college in the same transaction.
//   5. Confirmation off (DEC63): 200 with the session cookies, and a new guest binding for the
//      CSRF token. An address in use: 422 email_registered (DEC64).
//      Confirmation on: the same 202 whether the address is new or in use (TC01), never a cookie.
import { checkPassword, parseDisplayName, parseEmail } from "@souq/domain";
import { z } from "zod";
import type { AppDb } from "../db/app-client.ts";
import type { ServerEnv } from "../env.ts";
import { readJson } from "../http/body.ts";
import { readAllCookies } from "../http/cookies.ts";
import { resolveBinding, rotateGuestBinding } from "../http/csrf.ts";
import { ApiError, type FieldError } from "../http/errors.ts";
import { countAttempt } from "../http/rate-limit.ts";
import { accepted, ok } from "../http/respond.ts";
import { routes } from "../routes.ts";
import {
  createRequestAuthClient,
  sessionSetCookie,
  type AuthFlowClient,
  type RequestCookie,
} from "../supabase/server.ts";
import { isSessionCookieName } from "../supabase/session.ts";
import {
  AUTH_RATE_LIMIT_RETRY_SECONDS,
  classifyAuthError,
  logAuthFailure,
  type AuthFailure,
} from "./auth-errors.ts";
import { loadSessionState } from "./guards.ts";
import type { Identity } from "./identity.ts";
import { emailLimits, signupLimits } from "./limits.ts";
import { currentPolicies } from "./policies.ts";

/** SignupInput of the contract. Values are checked below, so all field errors come together. */
export const SignupBody = z.strictObject({
  name: z.string(),
  email: z.string(),
  password: z.string(),
  college_id: z.uuid().nullable().optional(),
  terms_version: z.string(),
  privacy_version: z.string(),
  accept_terms: z.boolean(),
  acknowledge_privacy: z.boolean(),
  captcha_token: z.string(),
});
export type SignupBody = z.infer<typeof SignupBody>;

export type AuthFlowEnv = Pick<
  ServerEnv,
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  | "APP_SECRET"
  | "EMAIL_CONFIRMATION_REQUIRED"
  | "TRUSTED_PROXY_HOPS"
  | "SIGNUP_IP_LIMIT_PER_HOUR"
>;

export interface AuthFlowContext {
  env: AuthFlowEnv;
  db: AppDb;
  traceId: string;
  /** The verified identity of the request (api.identity() in a route handler). */
  identity(): Promise<Identity | null>;
}

/** The rules our server checks without the database (TC01: all of them, together). */
export function signupFieldErrors(input: SignupBody): FieldError[] {
  const errors: FieldError[] = [];
  const name = parseDisplayName(input.name);
  if (!name.ok) errors.push({ field: "name", code: name.error });
  const email = parseEmail(input.email);
  if (!email.ok) errors.push({ field: "email", code: email.error });
  const password = checkPassword(input.password);
  if (password !== null) errors.push({ field: "password", code: password });
  if (!input.accept_terms) errors.push({ field: "accept_terms", code: "required" });
  if (!input.acknowledge_privacy) errors.push({ field: "acknowledge_privacy", code: "required" });
  return errors;
}

async function isActiveCollege(db: AppDb, traceId: string, id: string): Promise<boolean> {
  return db.withActor(null, traceId, async (tx) => {
    const result = await tx.query("select 1 from app.active_colleges() where id = $1", [id]);
    return result.rowCount === 1;
  });
}

/**
 * Before a flow that opens a session (signup, login, the recovery link): a live ordinary session
 * of any account state is refused (403 FORBIDDEN), an ended one is a guest (its cookie is
 * stale), and a limited session (a recovery link, DEC73) is ended first with this client, so
 * the new session replaces it. Task 3.3 for login; task 3.4 shares it with signup (the page
 * shows its form to a limited session, and API001 refused it with 403) and the recovery link.
 * Returns whether a limited session was ended.
 */
export async function prepareSession(
  ctx: AuthFlowContext,
  client: AuthFlowClient,
  flow: string,
): Promise<boolean> {
  const identity = await ctx.identity();
  if (identity === null) return false;
  if (identity.limited) {
    await signOutQuietly(client, ctx.traceId, flow);
    return true;
  }
  try {
    await loadSessionState(identity, ctx.traceId, ctx.db);
  } catch (error) {
    if (error instanceof ApiError && error.code === "UNAUTHENTICATED") return false;
    throw error;
  }
  throw new ApiError("FORBIDDEN");
}

function failure(
  kind: AuthFailure,
  confirmationOn: boolean,
  error: unknown,
  traceId: string,
): Response | ApiError {
  switch (kind) {
    case "captcha_failed":
      return new ApiError("CAPTCHA_FAILED");
    case "user_already_exists":
      // DEC64 while confirmation is off; the general answer while it is on (TC01).
      return confirmationOn
        ? accepted({ status: "accepted" })
        : new ApiError("VALIDATION_FAILED", {
            fieldErrors: [{ field: "email", code: "email_registered" }],
          });
    case "email_rate_limited":
      // The 60-second cooldown of an existing account would reveal it while confirmation is on.
      return confirmationOn
        ? accepted({ status: "accepted" })
        : new ApiError("RATE_LIMITED", { retryAfter: AUTH_RATE_LIMIT_RETRY_SECONDS });
    case "rate_limited":
      return new ApiError("RATE_LIMITED", { retryAfter: AUTH_RATE_LIMIT_RETRY_SECONDS });
    case "weak_password":
      // Checked here before the call; after the Pro upgrade also a leaked password (DEC32).
      return new ApiError("VALIDATION_FAILED", {
        fieldErrors: [{ field: "password", code: "weak" }],
      });
    case "email_invalid":
      return new ApiError("VALIDATION_FAILED", {
        fieldErrors: [{ field: "email", code: "invalid_format" }],
      });
    case "unavailable":
      logAuthFailure("signup", traceId, error);
      return new ApiError("SERVICE_UNAVAILABLE", { retryAfter: 5 });
    case "link_invalid":
    case "invalid_credentials":
    case "email_not_confirmed":
    case "same_password":
    case "session_ended":
    case "no_account":
    case "unexpected":
      logAuthFailure("signup", traceId, error);
      return new ApiError("INTERNAL_ERROR");
  }
}

export async function signup(request: Request, ctx: AuthFlowContext): Promise<Response> {
  const { env, db, traceId } = ctx;
  const cookies = readAllCookies(request.headers);
  const { client, written } = createRequestAuthClient(env, cookies);
  const ended = (await prepareSession(ctx, client, "signup")) ? cookies : [];
  const input = await readJson(request, SignupBody);

  const fieldErrors = signupFieldErrors(input);
  const policies = await currentPolicies(db, traceId);
  if (input.terms_version !== policies.terms.version) {
    fieldErrors.push({ field: "terms_version", code: "not_current" });
  }
  if (input.privacy_version !== policies.privacy.version) {
    fieldErrors.push({ field: "privacy_version", code: "not_current" });
  }
  const collegeId = input.college_id ?? null;
  if (collegeId !== null && !(await isActiveCollege(db, traceId, collegeId))) {
    fieldErrors.push({ field: "college_id", code: "unknown" });
  }
  if (fieldErrors.length > 0) throw new ApiError("VALIDATION_FAILED", { fieldErrors });

  // The proxy has checked the CSRF token against this guest cookie (SEC05).
  const guest = resolveBinding(request.headers, null);
  if (guest === null) throw new ApiError("CSRF_FAILED");
  const email = input.email.trim();
  const confirmationOn = env.EMAIL_CONFIRMATION_REQUIRED;
  await countAttempt(db, traceId, [
    ...signupLimits(env, request.headers, guest.id),
    ...(confirmationOn ? emailLimits(env.APP_SECRET, email) : []),
  ]);

  const { data, error } = await client.auth.signUp({
    email,
    password: input.password,
    options: {
      captchaToken: input.captcha_token,
      // Read by app.create_profile_for_auth_user() (task 2.2, and item 2 here).
      data: {
        display_name: input.name,
        terms_version: input.terms_version,
        privacy_version: input.privacy_version,
        college_id: collegeId,
      },
    },
  });
  if (error !== null) {
    const answer = failure(classifyAuthError(error), confirmationOn, error, traceId);
    if (answer instanceof ApiError) throw answer;
    return withRemovals(answer, ended);
  }

  if (confirmationOn) {
    // Supabase Auth opens no session while confirmation is on. If it ever does (its setting
    // differs from ours), the session is ended here and no session cookie leaves the server.
    if (data.session !== null) await signOutQuietly(client, traceId);
    return withRemovals(accepted({ status: "accepted" }), ended);
  }

  const response = ok({ state: "signed_in", next: routes.home });
  for (const cookie of written) {
    if (isSessionCookieName(cookie.name)) response.headers.append("set-cookie", cookie.setCookie);
  }
  // Owner condition 1 on task 1.6: a new guest binding, so the guest token from before is not
  // valid again after a later logout. The page fetches a new CSRF token now.
  response.headers.append("set-cookie", rotateGuestBinding().setCookie);
  return response;
}

/**
 * Task 3.4: when prepareSession ended a limited session, the session cookies the browser sent are
 * removed even if the answer opens no new session. Nothing else: a session Supabase opened and
 * this flow ended at once (confirmation on) must leave no trace, or a new address and one in use
 * would answer differently (TC01).
 */
function withRemovals(response: Response, sent: readonly RequestCookie[]): Response {
  const names = new Set(sent.map(({ name }) => name).filter(isSessionCookieName));
  for (const name of names) response.headers.append("set-cookie", sessionSetCookie(name, "", true));
  return response;
}

/**
 * Ends the session the client holds (this session only, scope local); a failure is logged with
 * its class and code, never a token, and the flow goes on. supabase-js treats a session Supabase
 * no longer has (session_not_found) as signed out already: no error.
 */
export async function signOutQuietly(
  client: ReturnType<typeof createRequestAuthClient>["client"],
  traceId: string,
  flow = "sign_out",
): Promise<void> {
  try {
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error !== null) logAuthFailure(flow, traceId, error);
  } catch (error) {
    logAuthFailure(flow, traceId, error);
  }
}
