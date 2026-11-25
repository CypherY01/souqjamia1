// R11 (task 4.3, DEC67, DEC84): representative Arabic queries and what they find. The examples
// are the table of plan/task-4.3.md («البحث»), with its known limits. Everything runs as postgres
// in one transaction that is rolled back: the other listings of the local database are hidden
// for its length, so each query sees the sixteen fixtures only. Changing DEC67 or DEC84 (rules,
// threshold) changes this table, and needs a new owner decision.
// Also: the trigram and market indexes serve the query forms (EXPLAIN), and pg_trgm counts Arabic
// letters as word characters on this database (a locale that did not would break search quietly;
// check it on every hosted database too, ops/runbooks/supabase-upgrade.md).
import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, rolledBack } from "./_harness/db.ts";
import { signUpMember } from "./_harness/users.ts";

/** The sixteen listings of the plan's table (title, description). */
const LISTINGS: readonly (readonly [string, string])[] = [
  ["لابتوب لينوفو ثينك باد", "بحالة ممتازة، رام 16 جيجا"],
  ["لاب توب ديل للبيع", "مستعمل سنة، البطارية جيدة"],
  ["لابتوبات مستعملة", "عندي ثلاثة أجهزة بأسعار مختلفة"],
  ["شنطة لابتوب", "تناسب مقاس 15 بوصة"],
  ["آلة حاسبة علمية كاسيو", "مناسبة لمواد الرياضيات"],
  ["طاولة دراسة خشبية", "مع درج صغير"],
  ["ثلاجة صغيرة للسكن", "تعمل بشكل ممتاز"],
  ["كتاب الفيزياء العامة", "الطبعة الثالثة، بدون كتابة"],
  ["إطار دراجة هوائية", "مقاس 26 إنش"],
  ["كمبيوتر مكتبي", "معالج i5 مع شاشة"],
  ["قارئ كتب إلكترونية", "شاشة 6 بوصة"],
  ["سماعات ايربودز", "أصلية مع العلبة"],
  ["Laptop HP Pavilion", "مستعمل، Windows 11"],
  ["كرسي مكتب مريح", "قابل للتعديل"],
  ["مكتبة كتب خشبية", "خمسة رفوف واسعة"],
  ["آيفون 13 برو", "السعة ١٢٨ جيجا"],
];

/** Query -> the listing numbers (1 to 16) found as "exact" and as "close" (DEC84). */
const EXPECTED: readonly (readonly [string, readonly number[], readonly number[]])[] = [
  // «لابتوب» and «لاب توب» find each other: the query without spaces is in the text without spaces.
  ["لابتوب", [1, 2, 3, 4], []],
  ["لاب توب", [1, 2, 3, 4], []],
  // The shorter word finds the longer one; the plural query finds the singular as close only.
  ["لابتوبات", [3], [1, 4]],
  ["لابتوب ديل", [2], [1, 3, 4]],
  // Hamza on alef, taa marbuta and tatweel, in both directions (DEC67).
  ["الة حاسبه", [5], []],
  ["آلة حاسبة", [5], []],
  ["طاوله", [6], []],
  ["طاولة خشب", [6], []],
  ["اطار", [9], []],
  ["إطار", [9], []],
  // Close noise at exactly 0.50: «ثلاجة» against «ثلاثة أجهزة» (listing 3), the shared «ثلا»
  // and «اجه» of two words. Found while building this set; the 0.6 default would not show it.
  ["ثلاجـــة", [7], [3]],
  ["ايفون ١٣", [16], []],
  ["LAPTOP", [13], []],
  // A small spelling mistake: close, with the threshold of 0.5.
  ["لابتوت", [], [1, 3, 4]],
  ["سماعت", [], [12]],
  ["كومبيوتر", [], [10]],
  ["تلاجة", [], [7]],
  ["قاري", [], [11]],
  ["الكتاب", [], [8, 11]],
  ["سماعات ابل", [], [12]],
  // Known limits (plan/task-4.3.md, «ما لا تحله الطريقة»): a word inside a longer word is exact
  // («كتب» in «مكتب»), Latin and Arabic spellings do not meet, and a mistake with a space misses.
  ["كتب", [10, 11, 14, 15], [8]],
  ["لابتوب hp", [], [1, 3, 4]],
  ["لابتوت ديل", [], []],
];

let sellerId: string;

beforeAll(async () => {
  sellerId = (await signUpMember("بائع جودة البحث")).id;
});

afterAll(async () => {
  await closeDb();
});

async function insertListing(
  client: pg.ClientBase,
  title: string,
  description: string,
): Promise<string> {
  const id = randomUUID();
  const mediaId = randomUUID();
  await client.query(
    `insert into public.listing (id, seller_id, category_id, title, description, condition,
                                 price_minor, is_negotiable)
     values ($1, $2, (select id from public.category where key = 'other'), $3, $4, 'good', 1000, false)`,
    [id, sellerId, title, description],
  );
  await client.query(
    `insert into public.media_asset (id, owner_id, purpose, quarantine_key, status, bytes, mime,
                                     width, height, checksum_sha256, upload_expires_at, processed_at)
     values ($1, $2, 'listing', $3, 'ready', 1000, 'image/png', 400, 300, $4,
             now(), now())`,
    [mediaId, sellerId, randomBytes(16).toString("hex"), randomBytes(32)],
  );
  await client.query(
    "insert into public.listing_image (listing_id, media_id, position) values ($1, $2, 1)",
    [id, mediaId],
  );
  return id;
}

/** Hides every other listing in this transaction, then adds the sixteen. */
async function onlyFixtures(client: pg.ClientBase): Promise<Map<string, number>> {
  await client.query(
    "update public.listing set moderation_hidden_at = now() where moderation_hidden_at is null",
  );
  const numbers = new Map<string, number>();
  for (const [index, [title, description]] of LISTINGS.entries()) {
    numbers.set(await insertListing(client, title, description), index + 1);
  }
  return numbers;
}

async function plan(client: pg.ClientBase, sql: string): Promise<string> {
  const result = await client.query<{ "QUERY PLAN": unknown }>(`explain (format json) ${sql}`);
  return JSON.stringify(result.rows[0]?.["QUERY PLAN"]);
}

describe("R11 Arabic search quality (DEC67, DEC84)", () => {
  it("R11 each representative query finds its listings as exact or close", async () => {
    await rolledBack(async (client) => {
      const numbers = await onlyFixtures(client);
      const found: [string, number[], number[]][] = [];
      for (const [query] of EXPECTED) {
        const result = await client.query<{ listing_id: string; match_tier: number }>(
          `select listing_id, match_tier
             from app.market_listings($1, null, null, null, 'newest', null, null, null, 51)`,
          [query],
        );
        const tier = (wanted: number) =>
          result.rows
            .filter((row) => row.match_tier === wanted)
            .map((row) => numbers.get(row.listing_id) ?? 0)
            .sort((a, b) => a - b);
        found.push([query, tier(1), tier(2)]);
      }
      expect(found).toEqual(
        EXPECTED.map(([query, exact, close]) => [
          query,
          [...exact],
          [...close].sort((a, b) => a - b),
        ]),
      );
    });
  });

  it("R11 within a tier the chosen order holds: close results never come before exact ones", async () => {
    await rolledBack(async (client) => {
      const numbers = await onlyFixtures(client);
      const result = await client.query<{ listing_id: string; match_tier: number }>(
        `select listing_id, match_tier
           from app.market_listings('لابتوب ديل', null, null, null, 'price_asc', null, null, null, 51)`,
      );
      expect(result.rows.map((row) => row.match_tier)).toEqual([1, 2, 2, 2]);
      expect(numbers.get(result.rows[0]?.listing_id ?? "")).toBe(2);
    });
  });

  it("pg_trgm counts Arabic letters as word characters on this database", async () => {
    await rolledBack(async (client) => {
      const result = await client.query<{ trigrams: number }>(
        "select array_length(extensions.show_trgm('لابتوب'), 1) as trigrams",
      );
      expect(result.rows[0]?.trigrams).toBe(7);
    });
  });

  it("the trigram and market indexes serve the query forms (EXPLAIN, sequential scans off)", async () => {
    await rolledBack(async (client) => {
      await client.query("set local enable_seqscan = off");
      await client.query("set local pg_trgm.word_similarity_threshold = 0.5");
      const shown = "status = 'active' and moderation_hidden_at is null";
      expect(
        await plan(client, "select id from public.listing where search_text like '%لابتوب%'"),
      ).toContain("listing_search_trgm");
      expect(
        await plan(
          client,
          `select id from public.listing where ${shown} and pg_catalog.replace(search_text, ' ', '') like '%لابتوب%'`,
        ),
      ).toContain("listing_search_compact_trgm");
      expect(
        await plan(
          client,
          "select id from public.listing where 'لابتوت' operator(extensions.<%) search_text",
        ),
      ).toContain("listing_search_trgm");
      expect(
        await plan(
          client,
          `select id from public.listing where ${shown} order by created_at desc, id desc limit 20`,
        ),
      ).toContain("listing_market_newest");
      expect(
        await plan(
          client,
          `select id from public.listing where ${shown} order by price_minor desc, id desc limit 20`,
        ),
      ).toContain("listing_market_price");
      expect(
        await plan(
          client,
          `select id from public.listing where ${shown}
              and category_id = (select id from public.category where key = 'electronics')
            order by created_at desc, id desc limit 20`,
        ),
      ).toContain("listing_market_category_newest");
    });
  });
});
