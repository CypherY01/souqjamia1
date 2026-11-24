// Task 4.2: the contract's OwnerListing, the listing as its seller sees it (API034's answer, and
// later API033 and API035 in task 4.4). Read through app.owner_listing() and
// app.owner_listing_images() (DEC77: named columns, the seller only).
//  - image is null until media.publish has made the public variants (SEC08, owner note 2).
//  - seller_student_badge is false until the badge exists (task 7.6).
//  - restorable_until is null: archiving comes with task 4.4 (BR27).
import type { enums } from "@souq/domain";
import type { CatalogRef, MeetingPointRef } from "../catalog.ts";
import type { Tx } from "../db/app-client.ts";
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
  moderation_hidden: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
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
  archive_reason::text as archive_reason, sold_at, archived_at, moderation_hidden, version,
  created_at, updated_at`;

/** The session member's own listing, or null (another member's, or an unknown id). */
export async function readOwnerListing(
  tx: Tx,
  id: string,
  supabaseUrl: string,
): Promise<OwnerListing | null> {
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
  const ownerImages: OwnerImage[] = images.rows.map((image) => ({
    media_id: image.media_id,
    position: image.image_position,
    image: image.public_ready ? publicImageSet(supabaseUrl, image.media_id) : null,
  }));
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
    primary_image: ownerImages[0]?.image ?? null,
    status: row.status,
    seller_student_badge: false,
    created_at: row.created_at.toISOString(),
    description: row.description,
    images: ownerImages,
    previous_status: row.previous_status,
    archive_reason: row.archive_reason,
    archived_at: row.archived_at?.toISOString() ?? null,
    sold_at: row.sold_at?.toISOString() ?? null,
    restorable_until: null,
    moderation_hidden: row.moderation_hidden,
    version: row.version,
    updated_at: row.updated_at.toISOString(),
  };
}
