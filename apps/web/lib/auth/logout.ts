// API003, sign-out (task 3.3, items 1 and 2): FR49, UC20 step 3, DEC73, DEC76, TC56.
// Framework-free like the signup flow: the route handler passes the request and its identity.
//   1. Any verified session signs out: ordinary, limited (a recovery link, even after its five
//      minutes), restricted or unconfirmed. Supabase Auth revokes this session only (scope
//      local): the member's other devices stay signed in.
//   2. DEC76, shared computers: the device is signed out whatever Supabase answers. Every session
//      cookie of the request is removed and the guest binding renewed (owner condition on task
//      1.6), and the answer is 204. A revocation that failed is logged (class and code, never a
//      token): the access token ends within 10 minutes, the refresh token has left the browser.
//   3. No session (no cookie, or one that has ended): 401 as in the contract, with the same
//      removal, so a stale cookie never outlives a sign-out.
// Realtime channels close with the page (task 5.4 adds them, TC42).
import { readAllCookies } from "../http/cookies.ts";
import { rotateGuestBinding } from "../http/csrf.ts";
import { ApiError } from "../http/errors.ts";
import { errorResponse, noContent } from "../http/respond.ts";
import { createRequestAuthClient, sessionSetCookie } from "../supabase/server.ts";
import { isSessionCookieName } from "../supabase/session.ts";
import { signOutQuietly, type AuthFlowContext } from "./signup.ts";

export type LogoutContext = Pick<AuthFlowContext, "env" | "traceId" | "identity">;

export async function logout(request: Request, ctx: LogoutContext): Promise<Response> {
  const cookies = readAllCookies(request.headers);
  const identity = await ctx.identity();
  if (identity !== null) {
    const { client } = createRequestAuthClient(ctx.env, cookies);
    await signOutQuietly(client, ctx.traceId, "logout");
  }

  const response =
    identity === null ? errorResponse(new ApiError("UNAUTHENTICATED"), ctx.traceId) : noContent();
  // Every chunk the browser sent (sb-<ref>-auth-token, .0, .1, ...), whatever Supabase answered.
  const names = new Set(cookies.map(({ name }) => name).filter(isSessionCookieName));
  for (const name of names) response.headers.append("set-cookie", sessionSetCookie(name, "", true));
  response.headers.append("set-cookie", rotateGuestBinding().setCookie);
  return response;
}
