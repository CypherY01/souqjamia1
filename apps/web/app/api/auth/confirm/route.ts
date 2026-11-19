// API004: spends the email confirmation link (task 3.2). 404 while confirmation is off (DEC66).
import { confirmEmail } from "../../../../lib/auth/confirm";
import { appDb } from "../../../../lib/db/app-client";
import { serverEnv } from "../../../../lib/env";
import { apiHandler } from "../../../../lib/http/handler";

export const dynamic = "force-dynamic";

export const POST = apiHandler("/api/auth/confirm", (request, _context, api) =>
  confirmEmail(request, {
    env: serverEnv(),
    db: appDb(),
    traceId: api.traceId,
    identity: () => api.identity(),
  }),
);
