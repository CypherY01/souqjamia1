// API009, reauthentication (task 3.6, plan/task-3.6.md): FR59, BR23, UC20, DEC36, DEC38, DEC70,
// RL01, SEC01, TC27. Framework-free like the other auth flows.
//
// Supabase Auth has no way to renew the password entry in amr of an existing session, and its
// password sign-in needs Turnstile (both checked on 22 November). So the password is checked by a
// fresh sign-in from the server, with the account's own address from the database:
//   1. RL01 with the login's own counters (the address and the client address), so neither this
//      nor a password change gives a guesser more tries than the login page. Checked first,
//      counted after a wrong password only, on a separate connection (DEC70).
//   2. The new session is verified: the same member, an ordinary session. Anything else is a
//      defect, and that session is ended.
//   3. It replaces the browser's session, and the old one is signed out: the session id changes,
//      so the CSRF token bound to it changes too (SEC01: rotate after privilege elevation; owner
//      condition on task 1.6), and the guest binding is renewed.
// Next.js appends the route's Set-Cookie headers after the proxy's, so the new session's cookies
// win over a refresh the proxy wrote for the old one, and a failed request leaves that refresh
// in place (checked in next/dist/server, 22 November).
import { log } from "@souq/log";
import { z } from "zod";
import { loadAccount } from "../account/me.ts";
import { readJson } from "../http/body.ts";
import { readAllCookies } from "../http/cookies.ts";
import { rotateGuestBinding } from "../http/csrf.ts";
import { ApiError } from "../http/errors.ts";
import { checkLimits, countFailures, rateLimited } from "../http/rate-limit.ts";
import { ok } from "../http/respond.ts";
import {
  createRequestAuthClient,
  sessionSetCookie,
  type AuthFlowClient,
  type RequestCookie,
  type WrittenCookie,
} from "../supabase/server.ts";
import { isSessionCookieName } from "../supabase/session.ts";
import { AUTH_RATE_LIMIT_RETRY_SECONDS, classifyAuthError, logAuthFailure } from "./auth-errors.ts";
import {
  reauthenticatedUntil,
  requireMember,
  type GuardOptions,
  type SessionAuth,
} from "./guards.ts";
import { expectedIssuer, verifyIdentity, type Identity } from "./identity.ts";
import { loginLimits } from "./limits.ts";
import { cannotBeRight } from "./login.ts";
import { signOutQuietly, type AuthFlowContext } from "./signup.ts";

/** ReauthInput of the contract. mfa_code joins with task 7.1. */
export const ReauthBody = z.strictObject({
  current_password: z.string(),
  captcha_token: z.string(),
  mfa_code: z.string().optional(),
});

/** The field and code of a wrong current password (API009 and API022). */
export function wrongPassword(): ApiError {
  return new ApiError("VALIDATION_FAILED", {
    fieldErrors: [{ field: "current_password", code: "wrong" }],
  });
}

export interface FreshSession {
  client: AuthFlowClient;
  written: WrittenCookie[];
  identity: Identity;
}

/**
 * A password sign-in for the member of `auth`, from the server (items 1 and 2 above). Returns
 * the client holding the new session, or throws the contract error.
 */
export async function freshSignIn(
  request: Request,
  ctx: AuthFlowContext,
  auth: SessionAuth,
  password: string,
  captchaToken: string,
  flow: string,
): Promise<FreshSession> {
  const { env, db, traceId } = ctx;
  const { me } = await loadAccount(db, auth.identity, traceId);
  const limits = loginLimits(env, request.headers, me.email);
  await checkLimits(db, traceId, limits);

  const wrong = async (): Promise<ApiError> => {
    const wait = await countFailures(db, traceId, limits);
    return wait > 0 ? rateLimited(wait) : wrongPassword();
  };
  if (password === "" || cannotBeRight(password)) throw await wrong();

  const { client, written } = createRequestAuthClient(env, []);
  const { error } = await client.auth.signInWithPassword({
    email: me.email,
    password,
    options: { captchaToken },
  });
  if (error !== null) {
    switch (classifyAuthError(error)) {
      case "invalid_credentials":
        throw await wrong();
      case "captcha_failed":
        throw new ApiError("CAPTCHA_FAILED");
      case "rate_limited":
      case "email_rate_limited":
        throw new ApiError("RATE_LIMITED", { retryAfter: AUTH_RATE_LIMIT_RETRY_SECONDS });
      case "unavailable":
        logAuthFailure(flow, traceId, error);
        throw new ApiError("SERVICE_UNAVAILABLE", { retryAfter: 5 });
      default:
        logAuthFailure(flow, traceId, error);
        throw new ApiError("INTERNAL_ERROR");
    }
  }

  const identity = await verifyIdentity(
    client,
    expectedIssuer(env.NEXT_PUBLIC_SUPABASE_URL),
    traceId,
  );
  if (identity === null || identity.limited || identity.userId !== auth.identity.userId) {
    await signOutQuietly(client, traceId, flow);
    throw new ApiError("INTERNAL_ERROR");
  }
  return { client, written, identity };
}

/**
 * The response carries the new session in place of the browser's: every session cookie of the
 * request that the new session does not write is removed, then the new ones are set, then the
 * guest binding is renewed (item 3).
 */
export function replaceSessionCookies(
  response: Response,
  requestCookies: readonly RequestCookie[],
  written: readonly WrittenCookie[],
): Response {
  const latest = new Map<string, WrittenCookie>();
  for (const cookie of written) {
    if (isSessionCookieName(cookie.name)) latest.set(cookie.name, cookie);
  }
  const kept = new Set(
    [...latest.values()].filter((cookie) => cookie.value !== null).map(({ name }) => name),
  );
  const stale = new Set(
    requestCookies.map(({ name }) => name).filter((name) => isSessionCookieName(name)),
  );
  for (const name of stale) {
    if (!kept.has(name)) response.headers.append("set-cookie", sessionSetCookie(name, "", true));
  }
  for (const cookie of latest.values()) {
    if (cookie.value !== null) response.headers.append("set-cookie", cookie.setCookie);
  }
  response.headers.append("set-cookie", rotateGuestBinding().setCookie);
  return response;
}

/** The browser's session is signed out at Supabase Auth (scope local: that session only). */
export async function signOutRequestSession(
  ctx: AuthFlowContext,
  requestCookies: readonly RequestCookie[],
  flow: string,
): Promise<void> {
  const { client } = createRequestAuthClient(ctx.env, requestCookies);
  await signOutQuietly(client, ctx.traceId, flow);
}

/** API009: 200 with the new window, and the new session's cookies. */
export async function reauthenticate(
  request: Request,
  ctx: AuthFlowContext,
  options: Pick<GuardOptions, "nowSeconds"> = {},
): Promise<Response> {
  const auth = await requireMember(ctx, { db: ctx.db, ...options });
  const input = await readJson(request, ReauthBody);
  // Task 7.1 adds MFA for role holders; until then no account has a verified factor.
  if (input.mfa_code !== undefined) {
    throw new ApiError("VALIDATION_FAILED", {
      fieldErrors: [{ field: "mfa_code", code: "not_enrolled" }],
    });
  }

  const fresh = await freshSignIn(
    request,
    ctx,
    auth,
    input.current_password,
    input.captcha_token,
    "reauth",
  );
  const cookies = readAllCookies(request.headers);
  await signOutRequestSession(ctx, cookies, "reauth");
  log.info("auth.reauthenticated", { trace_id: ctx.traceId });

  const until = reauthenticatedUntil(fresh.identity);
  if (until === null) throw new ApiError("INTERNAL_ERROR");
  const response = ok({ reauthenticated_until: new Date(until * 1000).toISOString() });
  return replaceSessionCookies(response, cookies, fresh.written);
}
