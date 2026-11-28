// Task 4.5, item 4: ListingCard.is_favorite for the public reads (API031, API032, the home page,
// /market and /listing/{id}). app.favorite_flags() answers in the same transaction as the cards,
// for the reader only: a guest or a limited session gets no flag, and the contract leaves the
// field out for a guest ("يظهر للعضو المسجّل فقط"). The market reads themselves are unchanged.
import type { Tx } from "../db/app-client.ts";

/** The ids among `ids` that the reader has saved (at most 51, a market page). */
export async function favoriteIds(tx: Tx, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const result = await tx.query<{ listing_id: string }>(
    "select listing_id from app.favorite_flags($1::uuid[])",
    [ids],
  );
  return new Set(result.rows.map((row) => row.listing_id));
}
