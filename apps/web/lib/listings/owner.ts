// Tasks 4.2 and 4.4: the contract's OwnerListing, the listing as its seller sees it (the answer of
// API034, API035 and API036, and the items of API033). Read through app.owner_listing(),
// app.owner_listing_images() and app.my_listings() (DEC77: named columns, the seller only).
//  - image is null until media.publish has made the public variants (SEC08, owner note 2).
//  - seller_student_badge is false until the badge exists (task 7.6).
//  - restorable_until: BR27's 90 days, computed by the database (app.listing_restorable_until).
//  - API033's cursor is signed and bound to the tab: its keys are the tab's time as text (to the
//    microsecond) and the id.
import { enums, DEFAULT_MY_LISTING_TAB } from "@souq/domain";
import type { CatalogRef, MeetingPointRef } from "../catalog.ts";
import type { Tx } from "../db/app-client.ts";
import { decodeCursor, encodeCursor, parseLimit } from "../http/cursor.ts";
import { ApiError } from "../http/errors.ts";
import { publicImageSet, type ImageSet } from "../media/public.ts";

export interface OwnerImage {
  media_id: string;
  position: number;
  image: ImageSet | null;
}

export interface OwnerListing {
  id: string;
  title: string;
  price_minor: number;
  is_negotiable: boolean;
  condition: enums.Condition;
  category: CatalogRef;
  location: MeetingPointRef | null;
  primary_image: ImageSet | null;
  status: enums.ListingStatus;
  seller_student_badge: boolean;
  created_at: string;
  description: string;
  images: OwnerImage[];
  previous_status: enums.ListingStatus | null;
  archive_reason: enums.ArchiveReason | null;
  archived_at: string | null;
  sold_at: string | null;
  restorable_until: string | null;
  moderation_hidden: boolean;
  version: number;
  updated_at: string;
}

interface ListingRow {
  listing_id: string;
  title: string;
  description: string;
  category_id: string;
  category_key: string;
  category_label_ar: string;
  category_label_en: string | null;
  location_id: string | null;
  location_key: string | null;
  location_kind: enums.MeetingPointKind | null;
  location_label_ar: string | null;
  location_label_en: string | null;
  condition: enums.Condition;
  price_minor: number;
  is_negotiable: boolean;
  status: enums.ListingStatus;
  previous_status: enums.ListingStatus | null;
  archive_reason: enums.ArchiveReason | null;
  sold_at: Date | null;
  archived_at: Date | null;
  restorable_until: Date | null;
  moderation_hidden: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface ListRow extends ListingRow {
  sort_key: string;
  image_ids: string[] | null;
  image_public_ready: boolean[] | null;
}

interface ImageRow {
  media_id: string;
  image_position: number;
  public_ready: boolean;
}

const LISTING_COLUMNS = `listing_id, title, description, category_id, category_key::text as category_key,
  category_label_ar, category_label_en, location_id, location_key, location_kind::text as location_kind,
  location_label_ar, location_label_en, condition::text as condition, price_minor, is_negotiable,
  status::text as status, previous_status::text as previous_status,
  archive_reason::text as archive_reason, sold_at, archived_at, restorable_until, moderation_hidden,
  version, created_at, updated_at`;

const LIST_COLUMNS = `${LISTING_COLUMNS}, sort_key, image_ids::text[] as image_ids, image_public_ready`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toOwnerListing(row: ListingRow, images: OwnerImage[]): OwnerListing {
  const location: MeetingPointRef | null =
    row.location_id === null || row.location_key === null || row.location_kind === null
      ? null
      : {
          id: row.location_id,
          key: row.location_key,
          kind: row.location_kind,
          label_ar: row.location_label_ar ?? "",
          label_en: row.location_label_en,
        };
  return {
    id: row.listing_id,
    title: row.title,
    price_minor: row.price_minor,
    is_negotiable: row.is_negotiable,
    condition: row.condition,
    category: {
      id: row.category_id,
      key: row.category_key,
      label_ar: row.category_label_ar,
      label_en: row.category_label_en,
    },
    location,
    primary_image: images[0]?.image ?? null,
    status: row.status,
    seller_student_badge: false,
    created_at: row.created_at.toISOString(),
    description: row.description,
    images,
    previous_status: row.previous_status,
    archive_reason: row.archive_reason,
    archived_at: row.archived_at?.toISOString() ?? null,
    sold_at: row.sold_at?.toISOString() ?? null,
    restorable_until: row.restorable_until?.toISOString() ?? null,
    moderation_hidden: row.moderation_hidden,
    version: row.version,
    updated_at: row.updated_at.toISOString(),
  };
}

/** The session member's own listing, or null (another member's, or an unknown id). */
export async function readOwnerListing(
  tx: Tx,
  id: string,
  supabaseUrl: string,
): Promise<OwnerListing | null> {
  if (!UUID.test(id)) return null;
  const listing = await tx.query<ListingRow>(
    `select ${LISTING_COLUMNS} from app.owner_listing($1)`,
    [id],
  );
  const row = listing.rows[0];
  if (row === undefined) return null;
  const images = await tx.query<ImageRow>(
    "select media_id, image_position, public_ready from app.owner_listing_images($1)",
    [id],
  );
  return toOwnerListing(
    row,
    images.rows.map((image) => ({
      media_id: image.media_id,
      position: image.image_position,
      image: image.public_ready ? publicImageSet(supabaseUrl, image.media_id) : null,
    })),
  );
}

export interface OwnerListingPage {
  items: OwnerListing[];
  nextCursor: string | null;
}

export interface MyListingsRequest {
  status: enums.ListingStatus;
  cursor: string | null;
  limit: number;
}

/** API033's query: status (the active tab by default), cursor and limit; BAD_REQUEST otherwise. */
export function myListingsRequest(params: URLSearchParams): MyListingsRequest {
  const status = params.get("status");
  if (
    status !== null &&
    status !== "" &&
    !(enums.ListingStatus as readonly string[]).includes(status)
  ) {
    throw new ApiError("BAD_REQUEST", {
      fieldErrors: [{ field: "status", code: "invalid_value" }],
    });
  }
  const cursor = params.get("cursor");
  return {
    status:
      status === null || status === "" ? DEFAULT_MY_LISTING_TAB : (status as enums.ListingStatus),
    cursor: cursor === null || cursor === "" ? null : cursor,
    limit: parseLimit(params.get("limit")),
  };
}

/**
 * One page of the member's tab (API033), newest first by the tab's time. INVALID_CURSOR for a
 * forged cursor or one made for another tab.
 */
export async function listOwnerListings(
  tx: Tx,
  appSecret: string,
  supabaseUrl: string,
  request: MyListingsRequest,
): Promise<OwnerListingPage> {
  const bound = { status: request.status };
  let after: [string, string] | [null, null] = [null, null];
  if (request.cursor !== null) {
    const keys = decodeCursor(appSecret, request.cursor, bound);
    const [key, id] = keys;
    if (keys.length !== 2 || typeof key !== "string" || typeof id !== "string" || !UUID.test(id)) {
      throw new ApiError("INVALID_CURSOR");
    }
    after = [key, id];
  }
  const result = await tx.query<ListRow>(
    `select ${LIST_COLUMNS}
       from app.my_listings($1::public.listing_status, $2, $3::uuid, $4)`,
    [request.status, after[0], after[1], request.limit + 1],
  );
  const page = result.rows.slice(0, request.limit);
  const items = page.map((row) => {
    const ids = row.image_ids ?? [];
    const ready = row.image_public_ready ?? [];
    return toOwnerListing(
      row,
      ids.map((mediaId, index) => ({
        media_id: mediaId,
        position: index + 1,
        image: ready[index] === true ? publicImageSet(supabaseUrl, mediaId) : null,
      })),
    );
  });
  const last = page.at(-1);
  return {
    items,
    nextCursor:
      result.rows.length > request.limit && last !== undefined
        ? encodeCursor(appSecret, [last.sort_key, last.listing_id], bound)
        : null,
  };
}
