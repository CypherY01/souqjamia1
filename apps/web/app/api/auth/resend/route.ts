// API005: sends the confirmation link again (task 3.2). 404 while confirmation is off (DEC66).
import { resendConfirmation } from "../../../../lib/auth/confirm";
import { appDb } from "../../../../lib/db/app-client";
import { serverEnv } from "../../../../lib/env";
import { apiHandler } from "../../../../lib/http/handler";

export const dynamic = "force-dynamic";

export const POST = apiHandler("/api/auth/resend", (request, _context, api) =>
  resendConfirmation(request, {
    env: serverEnv(),
    db: appDb(),
    traceId: api.traceId,
    identity: () => api.identity(),
  }),
);
