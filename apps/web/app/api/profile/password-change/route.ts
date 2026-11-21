// API022: the password change (task 3.6). The logic is in lib/account/password.ts.
import { appDb } from "../../../../lib/db/app-client";
import { changePassword } from "../../../../lib/account/password";
import { serverEnv } from "../../../../lib/env";
import { apiHandler } from "../../../../lib/http/handler";

export const dynamic = "force-dynamic";

export const POST = apiHandler("/api/profile/password-change", (request, _context, api) =>
  changePassword(request, {
    env: serverEnv(),
    db: appDb(),
    traceId: api.traceId,
    identity: () => api.identity(),
  }),
);
