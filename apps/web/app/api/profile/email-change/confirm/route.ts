// API021: one link of an email change (task 3.6). The logic is in lib/account/email-change.ts.
import { appDb } from "../../../../../lib/db/app-client";
import { confirmEmailChange } from "../../../../../lib/account/email-change";
import { serverEnv } from "../../../../../lib/env";
import { apiHandler } from "../../../../../lib/http/handler";

export const dynamic = "force-dynamic";

export const POST = apiHandler("/api/profile/email-change/confirm", (request, _context, api) =>
  confirmEmailChange(request, {
    env: serverEnv(),
    db: appDb(),
    traceId: api.traceId,
    identity: () => api.identity(),
  }),
);
