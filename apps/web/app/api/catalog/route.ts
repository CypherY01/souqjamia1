// API030 (task 4.2, FR08, FR20, FR55, DEC28): the active categories, colleges and meeting points,
// public. Cached five minutes by browsers and shared caches (item 12): the lists are the same for
// everyone and change rarely, and publication checks the references again.
import { loadCatalog } from "../../../lib/catalog";
import { appDb } from "../../../lib/db/app-client";
import { apiHandler } from "../../../lib/http/handler";
import { ok } from "../../../lib/http/respond";

export const dynamic = "force-dynamic";

const CATALOG_CACHE_CONTROL = "public, max-age=300";

export const GET = apiHandler("/api/catalog", async (_request, _context, api) => {
  const response = ok(await loadCatalog(appDb(), api.traceId));
  response.headers.set("cache-control", CATALOG_CACHE_CONTROL);
  return response;
});
