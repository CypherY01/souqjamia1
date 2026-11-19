// API013: the CSRF token for this browser (SEC05). A signed-in member gets the token bound to
// the session_id of the verified session (task 3.1); a guest gets the token bound to the guest
// cookie, created on the first call. Never cached.
import { serverEnv } from "../../../lib/env";
import { csrfToken, issueGuestBinding, resolveBinding } from "../../../lib/http/csrf";
import { apiHandler } from "../../../lib/http/handler";
import { ok } from "../../../lib/http/respond";

export const dynamic = "force-dynamic";

export const GET = apiHandler("/api/csrf", async (request, _context, api) => {
  const secret = serverEnv().APP_SECRET;
  const identity = await api.identity();
  const existing = resolveBinding(request.headers, identity?.sessionId ?? null);
  if (existing !== null) return ok({ token: csrfToken(secret, existing) });

  const issued = issueGuestBinding();
  const response = ok({ token: csrfToken(secret, issued.binding) });
  response.headers.append("set-cookie", issued.setCookie);
  return response;
});
