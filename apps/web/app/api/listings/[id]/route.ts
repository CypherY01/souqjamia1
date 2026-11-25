// API032 (task 4.3, FR13, UC04, TC05): a public listing with its images, seller and the reader's
// capabilities, or the generic 404 (hidden, archived, a restricted seller's, unknown or a
// malformed id all look the same). No rate limit in the contract. Logic in lib/listings/public.ts.
import { appDb } from "../../../../lib/db/app-client";
import { serverEnv } from "../../../../lib/env";
import { ApiError } from "../../../../lib/http/errors";
import { apiHandler } from "../../../../lib/http/handler";
import { ok } from "../../../../lib/http/respond";
import { readPublicListing } from "../../../../lib/listings/public";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export const GET = apiHandler<Context>("/api/listings/[id]", async (_request, context, api) => {
  const env = serverEnv();
  const { id } = await context.params;
  const identity = await api.identity();
  const listing = await readPublicListing(
    {
      db: appDb(),
      traceId: api.traceId,
      appSecret: env.APP_SECRET,
      supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
      claims: identity?.claims ?? null,
    },
    id,
  );
  if (listing === null) throw new ApiError("NOT_FOUND");
  return ok(listing);
});
