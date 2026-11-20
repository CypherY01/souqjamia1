// API002: login (task 3.3). The logic is in lib/auth/login.ts.
import { login } from "../../../../lib/auth/login";
import { appDb } from "../../../../lib/db/app-client";
import { serverEnv } from "../../../../lib/env";
import { apiHandler } from "../../../../lib/http/handler";

export const dynamic = "force-dynamic";

export const POST = apiHandler("/api/auth/login", (request, _context, api) =>
  login(request, {
    env: serverEnv(),
    db: appDb(),
    traceId: api.traceId,
    identity: () => api.identity(),
  }),
);
