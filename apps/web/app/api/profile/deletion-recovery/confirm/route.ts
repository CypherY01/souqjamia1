// API028: the deletion recovery link (task 3.7). The logic is in lib/account/deletion.ts.
import { appDb } from "../../../../../lib/db/app-client";
import { confirmDeletionRecovery } from "../../../../../lib/account/deletion";
import { serverEnv } from "../../../../../lib/env";
import { apiHandler } from "../../../../../lib/http/handler";

export const dynamic = "force-dynamic";

export const POST = apiHandler("/api/profile/deletion-recovery/confirm", (request, _context, api) =>
  confirmDeletionRecovery(request, {
    env: serverEnv(),
    db: appDb(),
    traceId: api.traceId,
    identity: () => api.identity(),
  }),
);
