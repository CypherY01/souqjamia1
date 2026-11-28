// Task 4.3: the public listing reads. API031 (FR06 to FR12, NFR14, DEC84) for the API, the
// /market page and the home page, and API032 (FR13, UC04) for the API and /listing/{id}.
// Read through app.market_listings(), app.public_listing() and app.public_listing_images() (DEC77:
// named columns). Framework-free, so integration tests run it as is.
//  - Images: a URL only when the public copies exist (public_ready); otherwise primary_image is
//    null and the page shows «الصور قيد التجهيز» (owner note on task 4.2). No link to a missing
//    public file, so no broken image and no 404 from Storage.
//  - The cursor (NFR14, TC29) is signed and bound to the filters and the order: its keys are the
//    last card's match tier, its sort value (created_at as text, to the microsecond, or the
//    price) and its id.
//  - Task 4.5: is_favorite on every card and on the listing for a member (app.favorite_flags in
//    the same transaction); a guest's answer has no such field.
//  - Seller fields of later tasks: avatar null (4.7), student badge false (7.6), rating count 0
//    (6.2), so the page shows «بائع جديد».
import {
  matchKindOf,
  parseMarketParams,
  type enums,
  type MarketFilters,
  type MatchKind,
} from "@souq/domain";
import type { CatalogRef, MeetingPointRef } from "../catalog.ts";
import type { AppDb, Tx } from "../db/app-client.ts";
import { favoriteIds } from "../favorites/flags.ts";
import { decodeCursor, encodeCursor, parseLimit } from "../http/cursor.ts";
import { ApiError } from "../http/errors.ts";
import { publicImageSet, type ImageSet } from "../media/public.ts";

/** The contract's ListingCard. */
export interface ListingCard {
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
  /** Task 4.5: for a member only; left out for a guest. */
  is_favorite?: boolean;
  /** DEC84: with a query only. */
  match?: MatchKind;
}

/** The contract's PublicProfile. */
export interface PublicProfile {
  id: string;
  display_name: string;
  avatar: ImageSet | null;
  college: CatalogRef | null;
  joined_month: string;
  student_badge: boolean;
  rating: { count: number; average: number | null };
}

export type DisabledReason =
  | "sign_in_required"
  | "own_content"
  | "account_restricted"
  | "context_closed"
  | "free_item"
  | "not_negotiable";

/** The contract's ListingDetail. */
export interface ListingDetail extends ListingCard {
  description: string;
  images: ImageSet[];
  seller: PublicProfile;
  sold_at: string | null;
  capabilities: {
    can_contact: boolean;
    can_offer: boolean;
    disabled_reason: DisabledReason | null;
  };
}

export interface ListingPage {
  cards: ListingCard[];
  nextCursor: string | null;
}

export interface PublicReadContext {
  db: AppDb;
  traceId: string;
  appSecret: string;
  supabaseUrl: string;
  /** The verified claims of the reader, or null for a guest. */
  claims: Readonly<Record<string, unknown>> | null;
}

export interface RefColumns {
  category_id: string;
  category_key: string;
  category_label_ar: string;
  category_label_en: string | null;
  location_id: string | null;
  location_key: string | null;
  location_kind: enums.MeetingPointKind | null;
  location_label_ar: string | null;
  location_label_en: string | null;
}

/** The card columns that app.market_listings() and app.my_favorites() both return. */
export interface CardColumns extends RefColumns {
  listing_id: string;
  title: string;
  price_minor: number;
  is_negotiable: boolean;
  condition: enums.Condition;
  status: enums.ListingStatus;
  seller_student_badge: boolean;
  created_at: Date;
  primary_media_id: string | null;
  primary_public_ready: boolean;
}

interface CardRow extends CardColumns {
  created_key: string;
  match_tier: number;
}

interface DetailRow extends RefColumns {
  listing_id: string;
  title: string;
  description: string;
  price_minor: number;
  is_negotiable: boolean;
  condition: enums.Condition;
  status: enums.ListingStatus;
  sold_at: Date | null;
  created_at: Date;
  seller_id: string;
  seller_display_name: string;
  seller_college_id: string | null;
  seller_college_key: string | null;
  seller_college_label_ar: string | null;
  seller_college_label_en: string | null;
  seller_joined_month: string;
  seller_student_badge: boolean;
  seller_rating_count: number;
  can_contact: boolean;
  can_offer: boolean;
  disabled_reason: DisabledReason | null;
}

interface ImageRow {
  media_id: string;
  image_position: number;
  public_ready: boolean;
}

export const REF_COLUMNS = `category_id, category_key::text as category_key, category_label_ar,
  category_label_en, location_id, location_key, location_kind::text as location_kind,
  location_label_ar, location_label_en`;

const CARD_COLUMNS = `listing_id, title, price_minor, is_negotiable, condition::text as condition,
  ${REF_COLUMNS}, status::text as status, seller_student_badge, created_at, created_key,
  primary_media_id, primary_public_ready, match_tier`;

// joined_month in Riyadh time, as the account page shows dates (BR14).
const DETAIL_COLUMNS = `listing_id, title, description, price_minor, is_negotiable,
  condition::text as condition, ${REF_COLUMNS}, status::text as status, sold_at, created_at,
  seller_id, seller_display_name, seller_college_id, seller_college_key, seller_college_label_ar,
  seller_college_label_en,
  pg_catalog.to_char(seller_joined_at at time zone 'Asia/Riyadh', 'YYYY-MM') as seller_joined_month,
  seller_student_badge, seller_rating_count, can_contact, can_offer, disabled_reason`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refsOf(row: RefColumns): Pick<ListingCard, "category" | "location"> {
  return {
    category: {
      id: row.category_id,
      key: row.category_key,
      label_ar: row.category_label_ar,
      label_en: row.category_label_en,
    },
    location:
      row.location_id === null || row.location_key === null || row.location_kind === null
        ? null
        : {
            id: row.location_id,
            key: row.location_key,
            kind: row.location_kind,
            label_ar: row.location_label_ar ?? "",
            label_en: row.location_label_en,
          },
  };
}

/** One card from its columns; the image only when its public copies exist. */
export function cardOf(row: CardColumns, supabaseUrl: string): ListingCard {
  return {
    id: row.listing_id,
    title: row.title,
    price_minor: row.price_minor,
    is_negotiable: row.is_negotiable,
    condition: row.condition,
    ...refsOf(row),
    primary_image:
      row.primary_public_ready && row.primary_media_id !== null
        ? publicImageSet(supabaseUrl, row.primary_media_id)
        : null,
    status: row.status,
    seller_student_badge: row.seller_student_badge,
    created_at: row.created_at.toISOString(),
  };
}

/** What the cursor is bound to: the query as typed (NFC, trimmed), the filters and the order. */
function cursorFilters(filters: MarketFilters): Record<string, unknown> {
  return {
    q: filters.q,
    category: filters.category,
    condition: filters.condition,
    location: filters.location,
    sort: filters.sort,
  };
}

type After = [number, string, string] | [null, null, null];

function afterOf(appSecret: string, cursor: string | null, filters: MarketFilters): After {
  if (cursor === null) return [null, null, null];
  const keys = decodeCursor(appSecret, cursor, cursorFilters(filters));
  const [tier, value, id] = keys;
  if (
    keys.length !== 3 ||
    (tier !== 1 && tier !== 2) ||
    typeof value !== "string" ||
    typeof id !== "string" ||
    !UUID.test(id)
  ) {
    throw new ApiError("INVALID_CURSOR");
  }
  return [tier, value, id];
}

/**
 * One page of public cards (API031, FR06 to FR12): `limit` cards and the cursor of the next page,
 * or null on the last one. INVALID_CURSOR for a forged cursor or one made with other filters.
 */
export async function searchListings(
  ctx: PublicReadContext,
  filters: MarketFilters,
  cursor: string | null,
  limit: number,
): Promise<ListingPage> {
  const after = afterOf(ctx.appSecret, cursor, filters);
  const { rows, saved } = await ctx.db.withActor(ctx.claims, ctx.traceId, async (tx) => {
    const result = await tx.query<CardRow>(
      `select ${CARD_COLUMNS}
         from app.market_listings($1, $2::public.category_key, $3::public.item_condition,
                                  $4::uuid, $5, $6::smallint, $7, $8::uuid, $9)`,
      [
        filters.q,
        filters.category,
        filters.condition,
        filters.location,
        filters.sort,
        after[0],
        after[1],
        after[2],
        limit + 1,
      ],
    );
    // Task 4.5: is_favorite for a member, in the same transaction.
    const ids = result.rows.slice(0, limit).map((row) => row.listing_id);
    return {
      rows: result.rows,
      saved: ctx.claims === null ? null : await favoriteIds(tx, ids),
    };
  });
  const page = rows.slice(0, limit);
  const cards = page.map((row): ListingCard => {
    const card = cardOf(row, ctx.supabaseUrl);
    if (saved !== null) card.is_favorite = saved.has(row.listing_id);
    if (filters.q !== null) card.match = matchKindOf(row.match_tier);
    return card;
  });
  const last = page.at(-1);
  const value = (row: CardRow) =>
    filters.sort === "newest" ? row.created_key : String(row.price_minor);
  return {
    cards,
    nextCursor:
      rows.length > limit && last !== undefined
        ? encodeCursor(
            ctx.appSecret,
            [last.match_tier, value(last), last.listing_id],
            cursorFilters(filters),
          )
        : null,
  };
}

/** The filters, cursor and limit of an API031 request; BAD_REQUEST with every field code. */
export function marketRequest(params: URLSearchParams): {
  filters: MarketFilters;
  cursor: string | null;
  limit: number;
} {
  const parsed = parseMarketParams(params);
  if (!parsed.ok) {
    throw new ApiError("BAD_REQUEST", {
      fieldErrors: parsed.errors.map(({ field, code }) => ({ field, code })),
    });
  }
  const cursor = params.get("cursor");
  return {
    filters: parsed.filters,
    cursor: cursor === null || cursor === "" ? null : cursor,
    limit: parseLimit(params.get("limit")),
  };
}

async function readImages(tx: Tx, id: string): Promise<ImageRow[]> {
  const result = await tx.query<ImageRow>(
    "select media_id, image_position, public_ready from app.public_listing_images($1)",
    [id],
  );
  return result.rows;
}

/** API032 (FR13, UC04): the public listing, or null for the generic 404. */
export async function readPublicListing(
  ctx: PublicReadContext,
  id: string,
): Promise<ListingDetail | null> {
  if (!UUID.test(id)) return null;
  const found = await ctx.db.withActor(ctx.claims, ctx.traceId, async (tx) => {
    const listing = await tx.query<DetailRow>(
      `select ${DETAIL_COLUMNS} from app.public_listing($1)`,
      [id],
    );
    const row = listing.rows[0];
    if (row === undefined) return null;
    return {
      row,
      images: await readImages(tx, id),
      saved: ctx.claims === null ? null : (await favoriteIds(tx, [id])).has(id),
    };
  });
  if (found === null) return null;
  const { row, images, saved } = found;
  const ready = images
    .filter((image) => image.public_ready)
    .map((image) => publicImageSet(ctx.supabaseUrl, image.media_id));
  const primary = images[0];
  return {
    id: row.listing_id,
    title: row.title,
    price_minor: row.price_minor,
    is_negotiable: row.is_negotiable,
    condition: row.condition,
    ...refsOf(row),
    primary_image:
      primary?.public_ready === true ? publicImageSet(ctx.supabaseUrl, primary.media_id) : null,
    status: row.status,
    seller_student_badge: row.seller_student_badge,
    created_at: row.created_at.toISOString(),
    ...(saved === null ? {} : { is_favorite: saved }),
    description: row.description,
    images: ready,
    seller: {
      id: row.seller_id,
      display_name: row.seller_display_name,
      avatar: null,
      college:
        row.seller_college_id === null || row.seller_college_key === null
          ? null
          : {
              id: row.seller_college_id,
              key: row.seller_college_key,
              label_ar: row.seller_college_label_ar ?? "",
              label_en: row.seller_college_label_en,
            },
      joined_month: row.seller_joined_month,
      student_badge: row.seller_student_badge,
      rating: { count: row.seller_rating_count, average: null },
    },
    sold_at: row.sold_at?.toISOString() ?? null,
    capabilities: {
      can_contact: row.can_contact,
      can_offer: row.can_offer,
      disabled_reason: row.disabled_reason,
    },
  };
}
