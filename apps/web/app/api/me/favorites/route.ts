// API048 (task 4.5, FR15, UC05): the member's favorites, newest saved first, with a signed
// cursor; a listing the public may no longer see is «غير متاح» (only its id and saved_at).
// Logic in lib/favorites/favorites.ts.
import { appDb } from "../../../../lib/db/app-client";
import { serverEnv } from "../../../../lib/env";
import { favoritesRequest, readMyFavorites } from "../../../../lib/favorites/favorites";
import { apiHandler } from "../../../../lib/http/handler";
import { ok } from "../../../../lib/http/respond";

export const dynamic = "force-dynamic";

export const GET = apiHandler("/api/me/favorites", async (request, _context, api) => {
  const env = serverEnv();
  const page = await readMyFavorites(
    {
      db: appDb(),
      supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
      appSecret: env.APP_SECRET,
      traceId: api.traceId,
      identity: () => api.identity(),
    },
    favoritesRequest(new URL(request.url).searchParams),
  );
  return ok(page.items, { next_cursor: page.nextCursor });
});
