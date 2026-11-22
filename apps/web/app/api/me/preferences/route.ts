// API029 (task 3.8): the optional email groups (FR68, BR38, DEC49, DEC65). The logic is in
// lib/notifications/preferences.ts.
import { appDb } from "../../../../lib/db/app-client";
import { apiHandler } from "../../../../lib/http/handler";
import { ok } from "../../../../lib/http/respond";
import { updatePreferences } from "../../../../lib/notifications/preferences";

export const dynamic = "force-dynamic";

export const PATCH = apiHandler("/api/me/preferences", async (request, _context, api) => {
  return ok(
    await updatePreferences(request, {
      db: appDb(),
      traceId: api.traceId,
      identity: () => api.identity(),
    }),
  );
});
