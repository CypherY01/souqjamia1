// API115 (task 3.8): the unread count for the badge in the site header (FR48).
import { appDb } from "../../../../lib/db/app-client";
import { apiHandler } from "../../../../lib/http/handler";
import { ok } from "../../../../lib/http/respond";
import { unreadCount } from "../../../../lib/notifications/list";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  "/api/notifications/unread-count",
  async (_request, _context, api) => {
    return ok(
      await unreadCount({ db: appDb(), traceId: api.traceId, identity: () => api.identity() }),
    );
  },
);
