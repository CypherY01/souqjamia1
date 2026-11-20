// API003: sign-out (task 3.3, DEC76). The logic is in lib/auth/logout.ts.
import { logout } from "../../../../lib/auth/logout";
import { serverEnv } from "../../../../lib/env";
import { apiHandler } from "../../../../lib/http/handler";

export const dynamic = "force-dynamic";

export const POST = apiHandler("/api/auth/logout", (request, _context, api) =>
  logout(request, {
    env: serverEnv(),
    traceId: api.traceId,
    identity: () => api.identity(),
  }),
);
