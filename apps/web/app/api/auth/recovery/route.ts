// API006: the recovery request (task 3.4). The logic is in lib/auth/recovery.ts.
import { appDb } from "../../../../lib/db/app-client";
import { requestRecovery } from "../../../../lib/auth/recovery";
import { serverEnv } from "../../../../lib/env";
import { apiHandler } from "../../../../lib/http/handler";

export const dynamic = "force-dynamic";

export const POST = apiHandler("/api/auth/recovery", (request, _context, api) =>
  requestRecovery(request, {
    env: serverEnv(),
    db: appDb(),
    traceId: api.traceId,
    identity: () => api.identity(),
  }),
);
