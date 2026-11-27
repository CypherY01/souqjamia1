// API036 (task 4.4, FR24, BR27, BR28, DEC09, TC34, TC35): mark_sold, archive or restore one of
// the seller's listings with expected_version. Logic in lib/listings/manage.ts.
import { appDb } from "../../../../../lib/db/app-client";
import { serverEnv } from "../../../../../lib/env";
import { apiHandler } from "../../../../../lib/http/handler";
import { ok } from "../../../../../lib/http/respond";
import { transitionListing } from "../../../../../lib/listings/manage";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export const POST = apiHandler<Context>(
  "/api/listings/[id]/transition",
  async (request, context, api) => {
    const { id } = await context.params;
    const listing = await transitionListing(request, id, {
      db: appDb(),
      supabaseUrl: serverEnv().NEXT_PUBLIC_SUPABASE_URL,
      traceId: api.traceId,
      identity: () => api.identity(),
    });
    return ok(listing);
  },
);
