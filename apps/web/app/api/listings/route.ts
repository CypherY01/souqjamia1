// API034 (task 4.2, FR16 to FR22, RL05): publish a listing from the wizard. 201 for a new
// listing, 200 for a logical retry with the same Idempotency-Key (FR22). The logic is in
// lib/listings/publish.ts. The public search (GET, API031) comes with task 4.3.
import { appDb } from "../../../lib/db/app-client";
import { serverEnv } from "../../../lib/env";
import { apiHandler } from "../../../lib/http/handler";
import { created, ok } from "../../../lib/http/respond";
import { publishListing } from "../../../lib/listings/publish";

export const dynamic = "force-dynamic";

export const POST = apiHandler("/api/listings", async (request, _context, api) => {
  const published = await publishListing(request, {
    db: appDb(),
    supabaseUrl: serverEnv().NEXT_PUBLIC_SUPABASE_URL,
    traceId: api.traceId,
    identity: () => api.identity(),
  });
  return published.created ? created(published.listing) : ok(published.listing);
});
