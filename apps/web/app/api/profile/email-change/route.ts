// API020: the email change request (task 3.6). The logic is in lib/account/email-change.ts.
import { appDb } from "../../../../lib/db/app-client";
import { requestEmailChange } from "../../../../lib/account/email-change";
import { serverEnv } from "../../../../lib/env";
import { apiHandler } from "../../../../lib/http/handler";

export const dynamic = "force-dynamic";

export const POST = apiHandler("/api/profile/email-change", (request, _context, api) =>
  requestEmailChange(request, {
    env: serverEnv(),
    db: appDb(),
    traceId: api.traceId,
    identity: () => api.identity(),
  }),
);
