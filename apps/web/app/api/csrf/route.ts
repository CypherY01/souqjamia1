// API013: the CSRF token for this browser (SEC05). The first call creates the guest binding
// cookie; later calls return the token for the existing binding. Never cached.
import { serverEnv } from "../../../lib/env";
import { csrfToken, issueGuestBinding, resolveBinding } from "../../../lib/http/csrf";
import { apiHandler } from "../../../lib/http/handler";
import { ok } from "../../../lib/http/respond";

export const dynamic = "force-dynamic";

export const GET = apiHandler("/api/csrf", (request) => {
  const secret = serverEnv().APP_SECRET;
  const existing = resolveBinding(request.headers);
  if (existing !== null) return ok({ token: csrfToken(secret, existing) });

  const issued = issueGuestBinding();
  const response = ok({ token: csrfToken(secret, issued.binding) });
  response.headers.append("set-cookie", issued.setCookie);
  return response;
});
