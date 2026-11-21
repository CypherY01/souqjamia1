// API009: reauthentication (task 3.6). The logic is in lib/auth/reauth.ts.
import { appDb } from "../../../../lib/db/app-client";
import { reauthenticate } from "../../../../lib/auth/reauth";
import { serverEnv } from "../../../../lib/env";
import { apiHandler } from "../../../../lib/http/handler";

export const dynamic = "force-dynamic";

export const POST = apiHandler("/api/auth/reauth", (request, _context, api) =>
  reauthenticate(request, {
    env: serverEnv(),
    db: appDb(),
    traceId: api.traceId,
    identity: () => api.identity(),
  }),
);
