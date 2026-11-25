// API031 (task 4.3, FR06 to FR12, NFR14, RL04, DEC84): the public search, and API034 (task 4.2,
// FR16 to FR22, RL05): publish a listing from the wizard. For API034, 201 for a new listing and
// 200 for a logical retry with the same Idempotency-Key (FR22). The logic is in
// lib/listings/public.ts and lib/listings/publish.ts.
import { appDb } from "../../../lib/db/app-client";
import { serverEnv } from "../../../lib/env";
import { apiHandler } from "../../../lib/http/handler";
import { created, ok } from "../../../lib/http/respond";
import { countSearch, searchLimits } from "../../../lib/listings/limits";
import { marketRequest, searchListings } from "../../../lib/listings/public";
import { publishListing } from "../../../lib/listings/publish";

export const dynamic = "force-dynamic";

export const GET = apiHandler("/api/listings", async (request, _context, api) => {
  const env = serverEnv();
  const db = appDb();
  // Every parameter is checked before anything is counted, so a malformed request costs nothing.
  const { filters, cursor, limit } = marketRequest(new URL(request.url).searchParams);
  const identity = await api.identity();
  await countSearch(db, api.traceId, searchLimits(env, request.headers, identity?.userId ?? null));
  const page = await searchListings(
    {
      db,
      traceId: api.traceId,
      appSecret: env.APP_SECRET,
      supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
      claims: identity?.claims ?? null,
    },
    filters,
    cursor,
    limit,
  );
  return ok(page.cards, { next_cursor: page.nextCursor });
});

export const POST = apiHandler("/api/listings", async (request, _context, api) => {
  const published = await publishListing(request, {
    db: appDb(),
    supabaseUrl: serverEnv().NEXT_PUBLIC_SUPABASE_URL,
    traceId: api.traceId,
    identity: () => api.identity(),
  });
  return published.created ? created(published.listing) : ok(published.listing);
});
