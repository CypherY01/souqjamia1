// API016 (task 3.5): the member edits the permitted profile fields (FR49, TC21, TC65, DEC78).
// The logic is in lib/account/profile.ts.
import { updateProfile } from "../../../../lib/account/profile";
import { appDb } from "../../../../lib/db/app-client";
import { apiHandler } from "../../../../lib/http/handler";
import { ok } from "../../../../lib/http/respond";

export const dynamic = "force-dynamic";

export const PATCH = apiHandler("/api/profile/me", async (request, _context, api) => {
  const { me } = await updateProfile(request, {
    db: appDb(),
    traceId: api.traceId,
    identity: () => api.identity(),
  });
  return ok(me);
});
