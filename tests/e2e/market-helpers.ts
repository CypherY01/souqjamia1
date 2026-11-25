// Task 4.3: listings for the market E2E, written as postgres on the local stack so a test controls
// their state (sold, archived) and its own unique word. Their image rows are private only, so the
// pages show «الصور قيد التجهيز» and request no public file; the real pipeline (wizard, worker,
// media.publish) is tested from sell.spec.ts.
import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import pg from "pg";
import { assertLocalUrl, readLocalStack } from "../../scripts/local-supabase.ts";
import { WCAG_22_AA } from "./auth-helpers.ts";

// supabase status (the CLI) is slow: read the local database URL once per test process.
let localDbUrl: string | undefined;
function dbUrl(): string {
  localDbUrl ??= assertLocalUrl(readLocalStack().dbUrl);
  return localDbUrl;
}

export async function sql<T extends object>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: dbUrl() });
  await client.connect();
  try {
    return (await client.query<T>(text, params)).rows;
  } finally {
    await client.end();
  }
}

/** A word no other listing has, Latin letters only. */
export function uniqueWord(): string {
  return `zq${randomBytes(5)
    .toString("hex")
    .replace(/[0-9]/g, (digit) => "abcdefghij"[Number(digit)] ?? "x")}`;
}

export interface E2eListing {
  title: string;
  description?: string;
  category?: string;
  condition?: string;
  priceMinor?: number;
  status?: "active" | "sold" | "archived";
  /** Seconds before now, so a test controls the order. */
  ageSeconds?: number;
}

export async function insertListing(sellerId: string, item: E2eListing): Promise<string> {
  const [id] = await insertListings(sellerId, [item]);
  if (id === undefined) throw new Error("no listing inserted");
  return id;
}

/** The listings, on one connection and in one transaction. */
export async function insertListings(
  sellerId: string,
  items: readonly E2eListing[],
): Promise<string[]> {
  const client = new pg.Client({ connectionString: dbUrl() });
  await client.connect();
  const ids: string[] = [];
  try {
    await client.query("begin");
    for (const item of items) {
      const id = randomUUID();
      const mediaId = randomUUID();
      const status = item.status ?? "active";
      await client.query(
        `insert into public.listing
         (id, seller_id, category_id, title, description, condition, price_minor, is_negotiable,
          status, sold_at, archive_reason, archived_at, created_at, updated_at)
       values ($1, $2, (select id from public.category where key = $3), $4, $5,
               $6::public.item_condition, $7, $7 > 0, $8::public.listing_status,
               case when $8::text = 'sold' then now() end,
               case when $8::text = 'archived' then 'owner'::public.archive_reason end,
               case when $8::text = 'archived' then now() end,
               now() - make_interval(secs => $9), now() - make_interval(secs => $9))`,
        [
          id,
          sellerId,
          item.category ?? "books_study",
          item.title,
          item.description ?? "وصف تجريبي لإعلان في اختبار السوق.",
          item.condition ?? "good",
          item.priceMinor ?? 35_000,
          status,
          item.ageSeconds ?? 0,
        ],
      );
      await client.query(
        `insert into public.media_asset (id, owner_id, purpose, quarantine_key, status, bytes, mime,
                                       width, height, checksum_sha256, upload_expires_at, processed_at)
       values ($1, $2, 'listing', $3, 'ready', 1000, 'image/png', 400, 300, $4, now(), now())`,
        [mediaId, sellerId, randomBytes(16).toString("hex"), randomBytes(32)],
      );
      await client.query(
        "insert into public.listing_image (listing_id, media_id, position) values ($1, $2, 1)",
        [id, mediaId],
      );
      ids.push(id);
    }
    await client.query("commit");
    return ids;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

/** Public image responses of 400 or more while the page is used (no broken image link). */
export function brokenImages(page: Page): string[] {
  const broken: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/storage/v1/object/") && response.status() >= 400) {
      broken.push(`${String(response.status())} ${response.url()}`);
    }
  });
  return broken;
}

export async function rtlAndAxe(page: Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  expect(
    results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
}
