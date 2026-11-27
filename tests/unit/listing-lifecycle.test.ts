// Task 4.4 (FR23, FR24, BR27, DEC09, DEC85, item 4): the seller's actions, the restore window,
// API033's query and API035's field rules, without the database (listings-manage.test.ts checks
// the database decides the same).
import { describe, expect, it } from "vitest";
import {
  allowedListingActions,
  canEditListing,
  LISTING_RESTORE_DAYS,
  restorableUntil,
  type ListingLifecycle,
} from "@souq/domain";
import { priceTextOf } from "../../apps/web/components/sell/wizard.ts";
import { ApiError } from "../../apps/web/lib/http/errors.ts";
import { listingPatchErrors } from "../../apps/web/lib/listings/manage.ts";
import { myListingsRequest } from "../../apps/web/lib/listings/owner.ts";
import { parseListingPrice } from "@souq/domain";

const DAY = 86_400_000;
const archivedAt = "2026-11-01T10:00:00.000Z";

function lifecycle(overrides: Partial<ListingLifecycle>): ListingLifecycle {
  return {
    status: "active",
    previous_status: null,
    archive_reason: null,
    archived_at: null,
    moderation_hidden: false,
    ...overrides,
  };
}

const archivedActive = lifecycle({
  status: "archived",
  previous_status: "active",
  archive_reason: "owner",
  archived_at: archivedAt,
});

describe("FR24 BR27 DEC09: the seller's actions", () => {
  it("FR24 active: mark sold or archive, and edit", () => {
    expect(allowedListingActions(lifecycle({}), Date.now())).toEqual(["mark_sold", "archive"]);
    expect(canEditListing(lifecycle({}))).toBe(true);
  });

  it("BR27 sold is final: archive only, never restore or edit", () => {
    const sold = lifecycle({ status: "sold" });
    expect(allowedListingActions(sold, Date.now())).toEqual(["archive"]);
    expect(canEditListing(sold)).toBe(false);
    const archivedSale = lifecycle({
      status: "archived",
      previous_status: "sold",
      archive_reason: "owner",
      archived_at: archivedAt,
    });
    expect(allowedListingActions(archivedSale, Date.parse(archivedAt))).toEqual([]);
    expect(restorableUntil(archivedSale)).toBeNull();
  });

  it("TC34 an active archive is restorable for 90 days, then not", () => {
    const until = restorableUntil(archivedActive);
    expect(until).toBe(new Date(Date.parse(archivedAt) + LISTING_RESTORE_DAYS * DAY).toISOString());
    const end = Date.parse(until ?? "");
    expect(allowedListingActions(archivedActive, end - 1)).toEqual(["restore"]);
    expect(allowedListingActions(archivedActive, end)).toEqual([]);
    expect(canEditListing(archivedActive)).toBe(false);
  });

  it("BR27 sold_auto and account_deletion archives are never restored by the owner", () => {
    for (const reason of ["sold_auto", "account_deletion"] as const) {
      const archived = { ...archivedActive, archive_reason: reason };
      expect(restorableUntil(archived)).toBeNull();
      expect(allowedListingActions(archived, Date.parse(archivedAt))).toEqual([]);
    }
  });

  it("TC35 hidden by moderation: no action and no edit, in every state", () => {
    for (const listing of [
      lifecycle({ moderation_hidden: true }),
      lifecycle({ status: "sold", moderation_hidden: true }),
      { ...archivedActive, moderation_hidden: true },
    ]) {
      expect(allowedListingActions(listing, Date.parse(archivedAt))).toEqual([]);
      expect(canEditListing(listing)).toBe(false);
    }
  });
});

describe("API033: the tab and the cursor of the query", () => {
  it("FR24 the active tab by default, a known tab, an unknown one is BAD_REQUEST", () => {
    expect(myListingsRequest(new URLSearchParams())).toEqual({
      status: "active",
      cursor: null,
      limit: 20,
    });
    expect(myListingsRequest(new URLSearchParams("status=archived&limit=5&cursor=x"))).toEqual({
      status: "archived",
      cursor: "x",
      limit: 5,
    });
    expect(() => myListingsRequest(new URLSearchParams("status=deleted"))).toThrow(ApiError);
  });
});

describe("API035: the field rules on what was sent", () => {
  it("BR05 BR08 texts, a free negotiable item and duplicate images, all at once", () => {
    expect(
      listingPatchErrors({
        title: "قصير",
        description: "قصير",
        price_minor: 0,
        is_negotiable: true,
        media_ids: ["0b9f6a39-3c4e-4c51-9f7e-0d2b8a4d1e11", "0b9f6a39-3c4e-4c51-9f7e-0d2b8a4d1e11"],
        expected_version: 1,
      }),
    ).toEqual([
      { field: "title", code: "too_small" },
      { field: "description", code: "too_small" },
      { field: "is_negotiable", code: "not_allowed" },
      { field: "media_ids", code: "duplicate" },
    ]);
    expect(listingPatchErrors({ expected_version: 1 })).toEqual([]);
    // The stored price is unknown here: BR08 on the merge is the database's (app.update_listing).
    expect(listingPatchErrors({ is_negotiable: true, expected_version: 1 })).toEqual([]);
  });
});

describe("the edit page starts from the stored price", () => {
  it("DEC05 halalas back to the riyals the member types, read back exactly", () => {
    for (const [halalas, text] of [
      [0, "0"],
      [35_000, "350"],
      [12_050, "120.50"],
      [5, "0.05"],
      [5_000_000, "50000"],
    ] as const) {
      expect(priceTextOf(halalas)).toBe(text);
      expect(parseListingPrice(text)).toEqual({ ok: true, halalas });
    }
  });
});
