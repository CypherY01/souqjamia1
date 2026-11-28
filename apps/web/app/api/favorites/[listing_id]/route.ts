// API049 and API050 (task 4.5, FR15, DEC86, TC06): save a listing in the member's favorites and
// remove it, both 204 and idempotent. Logic in lib/favorites/favorites.ts.
import { appDb } from "../../../../lib/db/app-client";
import { serverEnv } from "../../../../lib/env";
import {
  removeFavorite,
  saveFavorite,
  type FavoritesContext,
} from "../../../../lib/favorites/favorites";
import { apiHandler, type ApiContext } from "../../../../lib/http/handler";
import { noContent } from "../../../../lib/http/respond";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ listing_id: string }> };

function contextOf(api: ApiContext): FavoritesContext {
  const env = serverEnv();
  return {
    db: appDb(),
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    appSecret: env.APP_SECRET,
    traceId: api.traceId,
    identity: () => api.identity(),
  };
}

export const PUT = apiHandler<Context>(
  "/api/favorites/[listing_id]",
  async (_request, context, api) => {
    await saveFavorite(contextOf(api), (await context.params).listing_id);
    return noContent();
  },
);

export const DELETE = apiHandler<Context>(
  "/api/favorites/[listing_id]",
  async (_request, context, api) => {
    await removeFavorite(contextOf(api), (await context.params).listing_id);
    return noContent();
  },
);
