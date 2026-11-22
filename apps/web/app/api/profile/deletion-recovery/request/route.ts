// API027: the deletion recovery link request (task 3.7). The logic is in lib/account/deletion.ts.
import { appDb } from "../../../../../lib/db/app-client";
import { requestDeletionRecovery } from "../../../../../lib/account/deletion";
import { serverEnv } from "../../../../../lib/env";
import { apiHandler } from "../../../../../lib/http/handler";

export const dynamic = "force-dynamic";

export const POST = apiHandler("/api/profile/deletion-recovery/request", (request, _context, api) =>
  requestDeletionRecovery(request, {
    env: serverEnv(),
    db: appDb(),
    traceId: api.traceId,
    identity: () => api.identity(),
  }),
);
