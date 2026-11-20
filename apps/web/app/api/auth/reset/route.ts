// API008: the new password from the recovery session (task 3.4). The logic is in
// lib/auth/recovery.ts.
import { appDb } from "../../../../lib/db/app-client";
import { resetPassword } from "../../../../lib/auth/recovery";
import { serverEnv } from "../../../../lib/env";
import { apiHandler } from "../../../../lib/http/handler";

export const dynamic = "force-dynamic";

export const POST = apiHandler("/api/auth/reset", (request, _context, api) =>
  resetPassword(request, {
    env: serverEnv(),
    db: appDb(),
    traceId: api.traceId,
    identity: () => api.identity(),
  }),
);
