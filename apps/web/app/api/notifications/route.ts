// API078 and API079 (task 3.8): the session member's notifications (FR48, TC20, RET07), and
// marking them read. The logic is in lib/notifications.
import { appDb } from "../../../lib/db/app-client";
import { serverEnv } from "../../../lib/env";
import { apiHandler } from "../../../lib/http/handler";
import { noContent, ok } from "../../../lib/http/respond";
import { listNotifications } from "../../../lib/notifications/list";
import { markNotificationsRead } from "../../../lib/notifications/read";

export const dynamic = "force-dynamic";

export const GET = apiHandler("/api/notifications", async (request, _context, api) => {
  const page = await listNotifications(request, {
    db: appDb(),
    traceId: api.traceId,
    identity: () => api.identity(),
    appSecret: serverEnv().APP_SECRET,
  });
  return ok(page.data, page.meta);
});

export const PATCH = apiHandler("/api/notifications", async (request, _context, api) => {
  await markNotificationsRead(request, {
    db: appDb(),
    traceId: api.traceId,
    identity: () => api.identity(),
  });
  return noContent();
});
