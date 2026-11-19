// The session of a server page (task 3.1, item 8). Pages only read cookies: the proxy refreshed
// the session before the page runs, and Next.js does not let a page write cookies.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { serverEnv } from "../env.ts";
import { ApiError } from "../http/errors.ts";
import { traceIdOf } from "../http/trace.ts";
import { routes } from "../routes.ts";
import { authenticateCookies } from "../supabase/session.ts";
import { loadSessionState, memberPageRedirect, type SessionAuth } from "./guards.ts";

/**
 * The verified identity and its live state, or null for a guest or an ended session. A database
 * failure is thrown, so the page shows its error state with a retry, not a login page.
 * Cached for the request: the layout (site header) and the page share one query.
 */
export const pageSession = cache(async (): Promise<SessionAuth | null> => {
  const traceId = traceIdOf(await headers());
  const { identity } = await authenticateCookies(serverEnv(), (await cookies()).getAll(), traceId);
  if (identity === null) return null;
  try {
    return { identity, state: await loadSessionState(identity, traceId) };
  } catch (error) {
    if (error instanceof ApiError && error.code === "UNAUTHENTICATED") return null;
    throw error;
  }
});

/** A member page: redirects as memberPageRedirect says, otherwise the session. */
export async function requireMemberPage(path: string): Promise<SessionAuth> {
  const auth = await pageSession();
  const target = memberPageRedirect(auth, path);
  if (target !== null || auth === null) redirect(target ?? routes.login);
  return auth;
}
