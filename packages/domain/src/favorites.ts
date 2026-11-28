// Task 4.5 (plan/task-4.5.md): favorites. FR15, UC05, DEC86. The same limits are in the
// migration (…_favorites.sql); tests/integration/favorites.test.ts compares them.

/** DEC86: listings a member may keep in their favorites, «غير متاح» ones included. */
export const FAVORITES_MAX = 500;
/** DEC86: new saves per member per hour (a repeated save is not counted). Removal has no limit. */
export const FAVORITE_SAVES_PER_HOUR = 120;

/**
 * UC05: what a favorite shows. Available: the listing as a card. Unavailable (hidden, archived, a
 * hidden seller's): only its id and the time it was saved, never anything of the listing.
 */
export type FavoriteView<Card> =
  | { listing_id: string; available: true; listing: Card; saved_at: string }
  | { listing_id: string; available: false; listing: null; saved_at: string };

export function favoriteView<Card>(
  listingId: string,
  savedAt: string,
  card: Card | null,
): FavoriteView<Card> {
  return card === null
    ? { listing_id: listingId, available: false, listing: null, saved_at: savedAt }
    : { listing_id: listingId, available: true, listing: card, saved_at: savedAt };
}
