// API033 (task 4.4, FR23, FR24): one status tab of the member's own listings, newest first by the
// tab's time, with a signed cursor bound to the tab. Logic in lib/listings/manage.ts.
import { appDb } from "../../../../lib/db/app-client";
import { serverEnv } from "../../../../lib/env";
import { apiHandler } from "../../../../lib/http/handler";
import { ok } from "../../../../lib/http/respond";
import { readMyListings } from "../../../../lib/listings/manage";
import { myListingsRequest } from "../../../../lib/listings/owner";

export const dynamic = "force-dynamic";

export const GET = apiHandler("/api/me/listings", async (request, _context, api) => {
  const env = serverEnv();
  const page = await readMyListings(
    {
      db: appDb(),
      supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
      appSecret: env.APP_SECRET,
      traceId: api.traceId,
      identity: () => api.identity(),
    },
    myListingsRequest(new URL(request.url).searchParams),
  );
  return ok(page.items, { next_cursor: page.nextCursor });
});
