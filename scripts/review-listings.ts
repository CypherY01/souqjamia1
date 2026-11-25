// Task 4.3, item 9 (plan/task-4.3.md): about twenty clearly fake listings for the owner's local
// review of the home page, the market and the search examples, with real processed images:
//   pnpm review:listings
// Owner condition: the local Supabase only. Both addresses must be localhost or 127.0.0.1
// (scripts/review-target.ts); anything else stops before any connection, with a clear message.
// What it writes, as postgres on the local database (the review data, not the member path):
//  - one seller, «بائع مراجعة تجريبي» (review-seller@souqjamia1.test), through the Auth admin
//    API, so the signup trigger makes the profile as for anyone;
//  - per listing: one image made with sharp, processed by the worker's own processImage (WebP
//    master and w150, w600, w1200 without metadata), the private files and their public copies
//    in Storage, the media rows, the listing and its image, published a few hours apart.
// Running it again adds nothing while the seller has listings. pnpm db:reset removes it all.
import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { assertReviewTarget } from "./review-target.ts";

export const REVIEW_SELLER_EMAIL = "review-seller@souqjamia1.test";
export const REVIEW_SELLER_NAME = "بائع مراجعة تجريبي";
const DESCRIPTION_LEAD = "إعلان تجريبي للمراجعة المحلية، لا يمثّل غرضاً حقيقياً.";

type Category =
  | "books_study"
  | "electronics"
  | "room_furniture"
  | "university_supplies"
  | "clothing_personal"
  | "vehicles"
  | "other";
type Condition = "new_boxed" | "like_new" | "good" | "fair" | "used";

export interface ReviewListing {
  title: string;
  detail: string;
  category: Category;
  condition: Condition;
  priceMinor: number;
  negotiable: boolean;
}

/** The search examples of plan/task-4.3.md, and a few more for the categories. */
export const REVIEW_LISTINGS: readonly ReviewListing[] = [
  {
    title: "لابتوب لينوفو ثينك باد تجريبي",
    detail: "بحالة ممتازة، رام 16 جيجا.",
    category: "electronics",
    condition: "like_new",
    priceMinor: 180_000,
    negotiable: true,
  },
  {
    title: "لاب توب ديل تجريبي للبيع",
    detail: "مستعمل سنة، البطارية جيدة.",
    category: "electronics",
    condition: "used",
    priceMinor: 120_000,
    negotiable: true,
  },
  {
    title: "لابتوبات مستعملة تجريبية",
    detail: "عندي ثلاثة أجهزة بأسعار مختلفة.",
    category: "electronics",
    condition: "fair",
    priceMinor: 90_000,
    negotiable: true,
  },
  {
    title: "شنطة لابتوب تجريبية",
    detail: "تناسب مقاس 15 بوصة.",
    category: "university_supplies",
    condition: "good",
    priceMinor: 4_500,
    negotiable: false,
  },
  {
    title: "آلة حاسبة علمية تجريبية",
    detail: "مناسبة لمواد الرياضيات.",
    category: "university_supplies",
    condition: "like_new",
    priceMinor: 6_000,
    negotiable: false,
  },
  {
    title: "طاولة دراسة خشبية تجريبية",
    detail: "مع درج صغير.\nالمقاس 120 في 60.",
    category: "room_furniture",
    condition: "good",
    priceMinor: 25_000,
    negotiable: true,
  },
  {
    title: "ثلاجة صغيرة تجريبية للسكن",
    detail: "تعمل بشكل ممتاز.",
    category: "room_furniture",
    condition: "good",
    priceMinor: 40_000,
    negotiable: true,
  },
  {
    title: "كتاب الفيزياء العامة تجريبي",
    detail: "الطبعة الثالثة، بدون كتابة.",
    category: "books_study",
    condition: "good",
    priceMinor: 3_000,
    negotiable: false,
  },
  {
    title: "إطار دراجة هوائية تجريبي",
    detail: "مقاس 26.",
    category: "vehicles",
    condition: "fair",
    priceMinor: 5_000,
    negotiable: true,
  },
  {
    title: "كمبيوتر مكتبي تجريبي",
    detail: "معالج i5 مع شاشة.",
    category: "electronics",
    condition: "used",
    priceMinor: 150_000,
    negotiable: true,
  },
  {
    title: "قارئ كتب إلكترونية تجريبي",
    detail: "شاشة 6 بوصة.",
    category: "electronics",
    condition: "like_new",
    priceMinor: 30_000,
    negotiable: false,
  },
  {
    title: "سماعات ايربودز تجريبية",
    detail: "أصلية مع العلبة.",
    category: "electronics",
    condition: "new_boxed",
    priceMinor: 55_000,
    negotiable: false,
  },
  {
    title: "Laptop HP Pavilion تجريبي",
    detail: "مستعمل، Windows 11.",
    category: "electronics",
    condition: "good",
    priceMinor: 140_000,
    negotiable: true,
  },
  {
    title: "كرسي مكتب مريح تجريبي",
    detail: "قابل للتعديل.",
    category: "room_furniture",
    condition: "good",
    priceMinor: 20_000,
    negotiable: true,
  },
  {
    title: "مكتبة كتب خشبية تجريبية",
    detail: "خمسة رفوف.",
    category: "room_furniture",
    condition: "fair",
    priceMinor: 15_000,
    negotiable: true,
  },
  {
    title: "آيفون 13 برو تجريبي",
    detail: "السعة ١٢٨ جيجا، مع الشاحن.",
    category: "electronics",
    condition: "like_new",
    priceMinor: 250_050,
    negotiable: true,
  },
  {
    title: "مكيف شباك تجريبي",
    detail: "يبرد جيداً، ويحتاج تنظيفاً.",
    category: "room_furniture",
    condition: "used",
    priceMinor: 60_000,
    negotiable: true,
  },
  {
    title: "دراجة هوائية تجريبية",
    detail: "مقاس 26 مع قفل.",
    category: "vehicles",
    condition: "good",
    priceMinor: 35_000,
    negotiable: true,
  },
  {
    title: "جاكيت شتوي تجريبي",
    detail: "مقاس متوسط، لبس مرتين.",
    category: "clothing_personal",
    condition: "like_new",
    priceMinor: 8_000,
    negotiable: false,
  },
  {
    title: "أقلام ومذكرات تجريبية مجانية",
    detail: "مجموعة أقلام ومذكرات فصل سابق.",
    category: "other",
    condition: "used",
    priceMinor: 0,
    negotiable: false,
  },
];

/** Picture colors by category, from the design tokens. */
const PALETTE: Record<Category, readonly [string, string]> = {
  books_study: ["#F5EFE0", "#C59B27"],
  electronics: ["#EAF2EE", "#0B3B2D"],
  room_furniture: ["#FAF9F5", "#4B5563"],
  university_supplies: ["#F5EFE0", "#0B3B2D"],
  clothing_personal: ["#EAF2EE", "#C59B27"],
  vehicles: ["#06241B", "#FAF9F5"],
  other: ["#FAF9F5", "#0B3B2D"],
};

export interface ReviewStack {
  apiUrl: string;
  secretKey: string;
  dbUrl: string;
}

/** What the script writes with; replaced in the unit test, which never reaches them. */
export interface ReviewDeps {
  connect(dbUrl: string): Promise<Pick<pg.Client, "query" | "end">>;
  fetch: typeof fetch;
}

const realDeps: ReviewDeps = {
  async connect(dbUrl) {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: dbUrl });
    await client.connect();
    return client;
  },
  fetch: (input, init) => fetch(input, init),
};

function picture(category: Category, index: number): string {
  const [background, shape] = PALETTE[category];
  const x = 200 + (index % 5) * 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${background}"/><circle cx="${String(x)}" cy="300" r="160" fill="${shape}"/></svg>`;
}

/** Adds the review listings; returns how many it added (0 when they are already there). */
export async function seedReviewListings(
  stack: ReviewStack,
  deps: ReviewDeps = realDeps,
): Promise<number> {
  assertReviewTarget(stack.apiUrl, "عنوان Supabase");
  assertReviewTarget(stack.dbUrl, "عنوان القاعدة");

  const db = await deps.connect(stack.dbUrl);
  try {
    const existing = await db.query<{ id: string; listings: string }>(
      `select u.id::text as id,
              (select count(*) from public.listing l where l.seller_id = u.id)::text as listings
         from auth.users u where u.email = $1`,
      [REVIEW_SELLER_EMAIL],
    );
    let sellerId = existing.rows[0]?.id;
    if (sellerId !== undefined && existing.rows[0]?.listings !== "0") return 0;

    if (sellerId === undefined) {
      const versions = await db.query<{ terms: string; privacy: string }>(
        `select app.current_policy_version('terms') as terms,
                app.current_policy_version('privacy') as privacy`,
      );
      const created = await deps.fetch(`${stack.apiUrl}/auth/v1/admin/users`, {
        method: "POST",
        headers: { apikey: stack.secretKey, "content-type": "application/json" },
        body: JSON.stringify({
          email: REVIEW_SELLER_EMAIL,
          password: randomBytes(24).toString("base64url"),
          email_confirm: true,
          user_metadata: {
            display_name: REVIEW_SELLER_NAME,
            terms_version: versions.rows[0]?.terms,
            privacy_version: versions.rows[0]?.privacy,
          },
        }),
      });
      if (!created.ok)
        throw new Error(`Auth admin API refused the review seller (${String(created.status)}).`);
      sellerId = ((await created.json()) as { id: string }).id;
    }

    const [{ default: sharp }, { processImage }, { createMediaStorage }] = await Promise.all([
      import("sharp"),
      import("../apps/worker/src/media/process.ts"),
      import("../apps/worker/src/media/storage.ts"),
    ]);
    const storage = createMediaStorage(
      { url: stack.apiUrl, secretKey: stack.secretKey },
      new AbortController().signal,
    );
    const points = await db.query<{ id: string }>(
      "select id::text as id from public.meeting_point where is_active order by kind, display_order, id",
    );
    const categories = await db.query<{ id: string; key: Category }>(
      "select id::text as id, key::text as key from public.category",
    );
    const categoryId = new Map(categories.rows.map((row) => [row.key, row.id]));

    for (const [index, item] of REVIEW_LISTINGS.entries()) {
      const source = await sharp(Buffer.from(picture(item.category, index)))
        .png()
        .toBuffer();
      const files = await processImage({
        bytes: source,
        declaredMime: "image/png",
        purpose: "listing",
      });
      const mediaId = randomUUID();
      for (const file of files) {
        await storage.upload(
          "media-private",
          `${mediaId}/${file.variant}.webp`,
          file.data,
          "image/webp",
        );
        if (file.variant !== "master") {
          await storage.upload(
            "media-public",
            `${mediaId}/${file.variant}.webp`,
            file.data,
            "image/webp",
          );
        }
      }
      const location =
        index % 2 === 0 ? (points.rows[index % Math.max(points.rows.length, 1)]?.id ?? null) : null;
      await db.query("begin");
      try {
        await db.query(
          `insert into public.media_asset
             (id, owner_id, purpose, quarantine_key, status, bytes, mime, width, height,
              checksum_sha256, upload_expires_at, processed_at, raw_removed_at)
           values ($1, $2, 'listing', $3, 'ready', $4, 'image/png', 800, 600,
                   sha256($5::bytea), app.app_now(), app.app_now(), app.app_now())`,
          [mediaId, sellerId, randomBytes(16).toString("hex"), source.length, source],
        );
        for (const file of files) {
          for (const visibility of file.variant === "master"
            ? ["private"]
            : ["private", "public"]) {
            await db.query(
              `insert into public.media_derivative
                 (media_id, variant, visibility, bucket, object_key, bytes, sha256, width, height)
               values ($1, $2, $3, $4, $5, $6, decode($7, 'hex'), $8, $9)`,
              [
                mediaId,
                file.variant,
                visibility,
                visibility === "private" ? "media-private" : "media-public",
                `${mediaId}/${file.variant}.webp`,
                file.data.length,
                file.sha256,
                file.width,
                file.height,
              ],
            );
          }
        }
        const listing = await db.query<{ id: string }>(
          `insert into public.listing
             (seller_id, category_id, location_id, title, description, condition, price_minor,
              is_negotiable, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8,
                   app.app_now() - make_interval(hours => $9), app.app_now() - make_interval(hours => $9))
           returning id::text as id`,
          [
            sellerId,
            categoryId.get(item.category),
            location,
            item.title,
            `${DESCRIPTION_LEAD}\n${item.detail}`,
            item.condition,
            item.priceMinor,
            item.negotiable,
            index * 3,
          ],
        );
        await db.query(
          "insert into public.listing_image (listing_id, media_id, position) values ($1, $2, 1)",
          [listing.rows[0]?.id, mediaId],
        );
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }
    return REVIEW_LISTINGS.length;
  } finally {
    await db.end();
  }
}

if (import.meta.main) {
  try {
    const { readLocalStack } = await import("./local-supabase.ts");
    const stack = readLocalStack();
    const added = await seedReviewListings(stack);
    console.log(
      added === 0
        ? `إعلانات المراجعة موجودة من قبل (${REVIEW_SELLER_EMAIL})، فلم يُضف شيء.`
        : `أُضيف ${String(added)} إعلاناً تجريبياً للبائع «${REVIEW_SELLER_NAME}». افتح http://localhost:3000/market`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
