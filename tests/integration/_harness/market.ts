// Task 4.3: public reads with the real server code (lib/listings/public.ts) as souq_web, on
// listings written directly as postgres so a test controls their state, time and images:
// sold, archived, hidden by moderation, equal prices or equal times. Their image rows exist
// without files (public_ready only when asked); the real pipeline is in market.test.ts's image
// test (publish, then media.publish). Each test's listings carry a unique word, so a search for
// it finds them and nothing else of the shared local database.
import { randomBytes, randomUUID } from "node:crypto";
import { inject } from "vitest";
import type { MarketFilters } from "@souq/domain";
import type { AppDb } from "../../../apps/web/lib/db/app-client.ts";
import {
  searchListings,
  readPublicListing,
  type ListingPage,
  type PublicReadContext,
} from "../../../apps/web/lib/listings/public.ts";
import { categoryId } from "./listings.ts";
import { dbPool } from "./db.ts";
import { trace } from "./storage.ts";

/** A cursor key built at run time (never a secret-like constant in the repository). */
export const TEST_APP_SECRET = randomBytes(32).toString("base64url");

/** A word no other listing has: a few Latin letters, so it never looks like Arabic text. */
export function uniqueWord(): string {
  return `zq${randomBytes(5)
    .toString("hex")
    .replace(/[0-9]/g, (digit) => "abcdefghij"[Number(digit)] ?? "x")}`;
}

export interface FixtureListing {
  title: string;
  description?: string;
  category?: string;
  condition?: "new_boxed" | "like_new" | "good" | "fair" | "used";
  priceMinor?: number;
  negotiable?: boolean;
  locationId?: string | null;
  status?: "active" | "sold" | "archived";
  hidden?: boolean;
  createdAt?: Date;
  /** The three public variant rows exist (as after media.publish). */
  publicImages?: boolean;
  images?: number;
}

/** One listing of the seller with its image rows, committed. Returns its id. */
export async function fixtureListing(sellerId: string, item: FixtureListing): Promise<string> {
  const client = await dbPool().connect();
  try {
    await client.query("begin");
    const id = randomUUID();
    const created = item.createdAt ?? new Date();
    await client.query(
      `insert into public.listing
         (id, seller_id, category_id, location_id, title, description, condition, price_minor,
          is_negotiable, status, sold_at, archive_reason, archived_at, moderation_hidden_at,
          created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::public.listing_status,
               case when $10::public.listing_status = 'sold' then $11::timestamptz end,
               case when $10::public.listing_status = 'archived' then 'owner'::public.archive_reason end,
               case when $10::public.listing_status = 'archived' then $11::timestamptz end,
               case when $12::boolean then $11::timestamptz end,
               $11::timestamptz, $11::timestamptz)`,
      [
        id,
        sellerId,
        await categoryId(item.category ?? "books_study"),
        item.locationId ?? null,
        item.title,
        item.description ?? "وصف تجريبي لإعلان اختبار السوق.",
        item.condition ?? "good",
        item.priceMinor ?? 35_000,
        item.negotiable ?? (item.priceMinor ?? 35_000) > 0,
        item.status ?? "active",
        created.toISOString(),
        item.hidden ?? false,
      ],
    );
    for (let position = 1; position <= (item.images ?? 1); position += 1) {
      const mediaId = randomUUID();
      await client.query(
        `insert into public.media_asset
           (id, owner_id, purpose, quarantine_key, status, bytes, mime, width, height,
            checksum_sha256, upload_expires_at, processed_at)
         values ($1, $2, 'listing', $3, 'ready', 1000, 'image/png', 400, 300,
                 $4, app.app_now(), app.app_now())`,
        [mediaId, sellerId, randomBytes(16).toString("hex"), randomBytes(32)],
      );
      const visibilities = item.publicImages === true ? ["private", "public"] : ["private"];
      for (const visibility of visibilities) {
        for (const [variant, edge] of [
          ["w150", 150],
          ["w600", 400],
          ["w1200", 400],
        ] as const) {
          await client.query(
            `insert into public.media_derivative
               (media_id, variant, visibility, bucket, object_key, bytes, sha256, width, height)
             values ($1, $2, $3, $4, $7, 100, $8, $5, $6)`,
            [
              mediaId,
              variant,
              visibility,
              visibility === "private" ? "media-private" : "media-public",
              edge,
              Math.round((edge * 3) / 4),
              `${mediaId}/${variant}.webp`,
              randomBytes(32),
            ],
          );
        }
      }
      await client.query(
        "insert into public.listing_image (listing_id, media_id, position) values ($1, $2, $3)",
        [id, mediaId, position],
      );
    }
    await client.query("commit");
    return id;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function readContext(
  db: AppDb,
  claims: Readonly<Record<string, unknown>> | null = null,
): PublicReadContext {
  return {
    db,
    traceId: trace(),
    appSecret: TEST_APP_SECRET,
    supabaseUrl: inject("stack").apiUrl,
    claims,
  };
}

export function filtersOf(overrides: Partial<MarketFilters> = {}): MarketFilters {
  return { q: null, category: null, condition: null, location: null, sort: "newest", ...overrides };
}

/** Every page of a search, following the cursor: the ids in order and the page sizes. */
export async function allPages(
  db: AppDb,
  filters: MarketFilters,
  limit: number,
): Promise<{ ids: string[]; pages: number[]; last: ListingPage }> {
  const ids: string[] = [];
  const pages: number[] = [];
  let cursor: string | null = null;
  let page: ListingPage;
  do {
    page = await searchListings(readContext(db), filters, cursor, limit);
    ids.push(...page.cards.map((card) => card.id));
    pages.push(page.cards.length);
    cursor = page.nextCursor;
  } while (cursor !== null && pages.length < 50);
  return { ids, pages, last: page };
}

export function publicListing(
  db: AppDb,
  id: string,
  claims: Readonly<Record<string, unknown>> | null = null,
) {
  return readPublicListing(readContext(db, claims), id);
}

/** An active seed meeting point (task 2.3); tests deactivate seed rows, never add any. */
export async function activeMeetingPoint(): Promise<string> {
  const result = await dbPool().query<{ id: string }>(
    "select id::text as id from public.meeting_point where is_active order by display_order, id limit 1",
  );
  const id = result.rows[0]?.id;
  if (id === undefined)
    throw new Error("no active seed meeting point (packages/db/supabase/seed.sql)");
  return id;
}
