// Task 4.4 (FR23, FR24, BR27, DEC09, DEC85): what a seller may do with their listing, shared by
// the server (which shows the buttons) and the tests. The database decides again in
// app.update_listing() and app.transition_listing() (20261127090000_owner_listings.sql), and
// tests/integration/listings-manage.test.ts compares the values.
import type { ArchiveReason, ListingStatus } from "./enums.ts";

/** BR27: an owner archive of an active listing can be restored for 90 days. */
export const LISTING_RESTORE_DAYS = 90;
/** DEC85: successful edits (API035) per member per hour. */
export const LISTING_EDITS_PER_HOUR = 30;

export const LISTING_ACTIONS = ["mark_sold", "archive", "restore"] as const;
export type ListingAction = (typeof LISTING_ACTIONS)[number];

/** API033's tabs, in display order; the active one is the default (item 7). */
export const MY_LISTING_TABS = [
  "active",
  "sold",
  "archived",
] as const satisfies readonly ListingStatus[];
export const DEFAULT_MY_LISTING_TAB: ListingStatus = "active";

/** The lifecycle fields of an OwnerListing. */
export interface ListingLifecycle {
  readonly status: ListingStatus;
  readonly previous_status: ListingStatus | null;
  readonly archive_reason: ArchiveReason | null;
  readonly archived_at: string | null;
  readonly moderation_hidden: boolean;
}

const DAY_MS = 86_400_000;

/** BR27: the end of the restore window, or null when the listing can never be restored. */
export function restorableUntil(
  listing: Omit<ListingLifecycle, "moderation_hidden">,
): string | null {
  if (
    listing.status !== "archived" ||
    listing.previous_status !== "active" ||
    listing.archive_reason !== "owner" ||
    listing.archived_at === null
  ) {
    return null;
  }
  return new Date(Date.parse(listing.archived_at) + LISTING_RESTORE_DAYS * DAY_MS).toISOString();
}

/** FR23: an edit needs an active listing that moderation has not hidden. */
export function canEditListing(listing: ListingLifecycle): boolean {
  return listing.status === "active" && !listing.moderation_hidden;
}

/**
 * FR24, BR27, DEC09 and the owner's item 4: the actions the seller may take now. Hidden by
 * moderation: none. Sold never returns to active. Restore within the window only (`now` in ms).
 */
export function allowedListingActions(listing: ListingLifecycle, now: number): ListingAction[] {
  if (listing.moderation_hidden) return [];
  switch (listing.status) {
    case "active":
      return ["mark_sold", "archive"];
    case "sold":
      return ["archive"];
    case "archived": {
      const until = restorableUntil(listing);
      return until !== null && now < Date.parse(until) ? ["restore"] : [];
    }
  }
}
