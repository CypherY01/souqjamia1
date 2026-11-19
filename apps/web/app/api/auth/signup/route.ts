// API001: signup (task 3.2). The logic is in lib/auth/signup.ts.
import { signup } from "../../../../lib/auth/signup";
import { appDb } from "../../../../lib/db/app-client";
import { serverEnv } from "../../../../lib/env";
import { apiHandler } from "../../../../lib/http/handler";

export const dynamic = "force-dynamic";

export const POST = apiHandler("/api/auth/signup", (request, _context, api) =>
  signup(request, {
    env: serverEnv(),
    db: appDb(),
    traceId: api.traceId,
    identity: () => api.identity(),
  }),
);
