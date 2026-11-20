// API007: the recovery link (task 3.4). The logic is in lib/auth/recovery.ts.
import { appDb } from "../../../../../lib/db/app-client";
import { verifyRecovery } from "../../../../../lib/auth/recovery";
import { serverEnv } from "../../../../../lib/env";
import { apiHandler } from "../../../../../lib/http/handler";

export const dynamic = "force-dynamic";

export const POST = apiHandler("/api/auth/recovery/verify", (request, _context, api) =>
  verifyRecovery(request, {
    env: serverEnv(),
    db: appDb(),
    traceId: api.traceId,
    identity: () => api.identity(),
  }),
);
