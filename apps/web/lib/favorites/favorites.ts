// Task 4.5 (plan/task-4.5.md): favorites. API048 (FR15, UC05), API049 (FR15, DEC86, TC06) and
// API050 (FR15, TC06).
//  - The guard is member (session, email, account state, current terms), as x-access says.
//  - app.save_favorite() decides: NOT_FOUND for a listing the public may not see, LIMIT_REACHED
//    at 500 favorites, RATE_LIMITED past 120 new saves an hour (DEC86). A repeated save changes
//    nothing (TC06: the primary key keeps one row).
//  - app.remove_favorite() always succeeds, for an unknown or hidden listing too.
//  - No Idempotency-Key: PUT and DELETE are idempotent by themselves.
//  - API048: a signed cursor (saved_at to the microsecond, listing id); an unavailable favorite is
//    only its id and the time it was saved (UC05).
// Framework-free, so integration tests run it as is.
import { favoriteView, type FavoriteView } from "@souq/domain";
import { requireMember, type GuardContext } from "../auth/guards.ts";
import type { AppDb } from "../db/app-client.ts";
import { decodeCursor, encodeCursor, parseLimit } from "../http/cursor.ts";
import { ApiError } from "../http/errors.ts";
import { cardOf, REF_COLUMNS, type CardColumns, type ListingCard } from "../listings/public.ts";

export type FavoriteItem = FavoriteView<ListingCard>;

export interface FavoritePage {
  items: FavoriteItem[];
  nextCursor: string | null;
}

export interface FavoritesContext extends GuardContext {
  db: AppDb;
  /** NEXT_PUBLIC_SUPABASE_URL, for the public image URLs of the cards. */
  supabaseUrl: string;
  appSecret: string;
}

export interface FavoritesRequest {
  cursor: string | null;
  limit: number;
}

type FavoriteRow = { listing_id: string; saved_at: Date; saved_key: string; available: boolean } & (
  CardColumns | Record<keyof Omit<CardColumns, "listing_id">, null>
);

const COLUMNS = `listing_id, saved_at, saved_key, available, title, price_minor, is_negotiable,
  condition::text as condition, ${REF_COLUMNS}, status::text as status, seller_student_badge,
  created_at, primary_media_id, primary_public_ready`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The cursor is bound to this list only. */
const CURSOR_FILTERS = { list: "favorites" };

/** API048's query: the cursor and the limit (BAD_REQUEST for a malformed limit). */
export function favoritesRequest(params: URLSearchParams): FavoritesRequest {
  const cursor = params.get("cursor");
  return {
    cursor: cursor === null || cursor === "" ? null : cursor,
    limit: parseLimit(params.get("limit")),
  };
}

function afterOf(appSecret: string, cursor: string | null): [string, string] | [null, null] {
  if (cursor === null) return [null, null];
  const keys = decodeCursor(appSecret, cursor, CURSOR_FILTERS);
  const [key, id] = keys;
  if (keys.length !== 2 || typeof key !== "string" || typeof id !== "string" || !UUID.test(id)) {
    throw new ApiError("INVALID_CURSOR");
  }
  return [key, id];
}

/** API048: one page of the member's favorites, newest saved first. */
export async function readMyFavorites(
  ctx: FavoritesContext,
  request: FavoritesRequest,
): Promise<FavoritePage> {
  const { identity } = await requireMember(ctx, { db: ctx.db });
  const after = afterOf(ctx.appSecret, request.cursor);
  const rows = await ctx.db.withActor(identity.claims, ctx.traceId, async (tx) => {
    const result = await tx.query<FavoriteRow>(
      `select ${COLUMNS} from app.my_favorites($1, $2::uuid, $3)`,
      [after[0], after[1], request.limit + 1],
    );
    return result.rows;
  });
  const page = rows.slice(0, request.limit);
  const items = page.map((row): FavoriteItem => {
    const card = row.available && row.title !== null ? cardOf(row, ctx.supabaseUrl) : null;
    if (card !== null) card.is_favorite = true;
    return favoriteView(row.listing_id, row.saved_at.toISOString(), card);
  });
  const last = page.at(-1);
  return {
    items,
    nextCursor:
      rows.length > request.limit && last !== undefined
        ? encodeCursor(ctx.appSecret, [last.saved_key, last.listing_id], CURSOR_FILTERS)
        : null,
  };
}

/** API049: saves the listing (idempotent). NOT_FOUND for a malformed id, as for a hidden one. */
export async function saveFavorite(ctx: FavoritesContext, listingId: string): Promise<void> {
  const { identity } = await requireMember(ctx, { db: ctx.db });
  if (!UUID.test(listingId)) throw new ApiError("NOT_FOUND");
  // DEC72: the whole body may run again; it does everything through tx, with the same input.
  await ctx.db.withActor(identity.claims, ctx.traceId, async (tx) => {
    await tx.query("select app.save_favorite($1)", [listingId]);
  });
}

/** API050: removes the listing (idempotent). A malformed id has nothing to remove: 204. */
export async function removeFavorite(ctx: FavoritesContext, listingId: string): Promise<void> {
  const { identity } = await requireMember(ctx, { db: ctx.db });
  if (!UUID.test(listingId)) return;
  await ctx.db.withActor(identity.claims, ctx.traceId, async (tx) => {
    await tx.query("select app.remove_favorite($1)", [listingId]);
  });
}
