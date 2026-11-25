// Task 4.3 (plan/task-4.3.md): API031 and API032 with the real server code as souq_web.
// FR06 to FR13, NFR14, RL04, DEC28, DEC77, DEC84, UC03, UC04, TC04, TC05, TC29, TC31.
// The search quality set (R11) and the index plans are in search-quality.test.ts.
// Needs `pnpm db:start` (with Storage) and applied migrations; run with `pnpm test:integration`.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MARKET_QUERY_MAX,
  MATCH_THRESHOLD,
  RL04_ADDRESS_PER_MINUTE,
  RL04_SESSION_PER_MINUTE,
} from "@souq/domain";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import { MAX_LIMIT } from "../../apps/web/lib/http/cursor.ts";
import type { ApiError } from "../../apps/web/lib/http/errors.ts";
import {
  countSearch,
  RL04_ADDRESS,
  RL04_SESSION,
  searchLimits,
} from "../../apps/web/lib/listings/limits.ts";
import { marketRequest, searchListings } from "../../apps/web/lib/listings/public.ts";
import { closeDb, dbPool, scalar } from "./_harness/db.ts";
import {
  listingInput,
  publish,
  publicUrl,
  readyImage,
  resetRl05,
  runMediaPublish,
} from "./_harness/listings.ts";
import {
  activeMeetingPoint,
  allPages,
  filtersOf,
  fixtureListing,
  publicListing,
  readContext,
  TEST_APP_SECRET,
  uniqueWord,
} from "./_harness/market.ts";
import { memberIdentity } from "./_harness/sessions.ts";
import { assertRan, trace } from "./_harness/storage.ts";
import { signUpMember } from "./_harness/users.ts";
import { changeMember, webDb } from "./_harness/web.ts";

const db = webDb();

interface Member {
  id: string;
  identity: Identity;
}

async function newMember(): Promise<Member> {
  const member = await signUpMember();
  const { identity } = await memberIdentity(member);
  return { id: member.id, identity };
}

let seller: Member;
let other: Member;

beforeAll(async () => {
  seller = await newMember();
  other = await newMember();
});

afterAll(async () => {
  // The fixtures leave the local market (some have public image rows without files).
  await dbPool().query(
    `update public.listing set status = 'archived', archive_reason = 'owner', archived_at = now()
      where seller_id = any($1::uuid[]) and status <> 'archived'`,
    [[seller.id, other.id]],
  );
  await db.end();
  await closeDb();
});

/** The contract error a promise ends with, or null when it succeeds. */
function failure(promise: Promise<unknown>): Promise<ApiError | null> {
  return promise.then(
    () => null,
    (error: unknown) => error as ApiError,
  );
}

function thrown(run: () => unknown): ApiError | null {
  try {
    run();
    return null;
  } catch (error) {
    return error as ApiError;
  }
}

const SUSPEND =
  "update public.account_control set status = 'suspended', suspended_until = now() + interval '7 days' where user_id = $1";
const REQUEST_DELETION =
  "update public.account_control set deletion_requested_at = now() where user_id = $1";

describe("task 4.3: the limits are the same in the database and @souq/domain", () => {
  it("app.market_listings() checks MARKET_QUERY_MAX, pages of MAX_LIMIT + 1 and MATCH_THRESHOLD", async () => {
    const result = await dbPool().query<{ source: string; config: string[] }>(
      `select prosrc as source, proconfig as config from pg_proc
        where oid = 'app.market_listings(text, public.category_key, public.item_condition, uuid, text, smallint, text, uuid, integer)'::regprocedure`,
    );
    const row = result.rows[0];
    expect(row?.source).toContain(`char_length(v_query) > ${String(MARKET_QUERY_MAX)}`);
    expect(row?.source).toContain(`p_limit > ${String(MAX_LIMIT + 1)}`);
    expect(row?.config).toContain(`pg_trgm.word_similarity_threshold=${String(MATCH_THRESHOLD)}`);
    expect(RL04_SESSION.limit).toBe(RL04_SESSION_PER_MINUTE);
    expect(RL04_ADDRESS.limit).toBe(RL04_ADDRESS_PER_MINUTE);
  });
});

describe("API031: filters, order and pages (FR06 to FR12, NFR14)", () => {
  it("TC04 combined filters intersect: query, category, condition and meeting point", async () => {
    const word = uniqueWord();
    const point = await activeMeetingPoint();
    const base = { category: "electronics", condition: "good" as const, locationId: point };
    const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);
    const match = await fixtureListing(seller.id, {
      ...base,
      title: `حاسوب مطابق ${word}`,
      createdAt: ago(40),
    });
    const used = await fixtureListing(seller.id, {
      ...base,
      condition: "used",
      title: `حاسوب مستعمل ${word}`,
      createdAt: ago(30),
    });
    const book = await fixtureListing(seller.id, {
      ...base,
      category: "books_study",
      title: `كتاب ${word}`,
      createdAt: ago(20),
    });
    const byAgreement = await fixtureListing(seller.id, {
      ...base,
      locationId: null,
      title: `حاسوب بلا نقطة ${word}`,
      createdAt: ago(10),
    });

    const page = await searchListings(
      readContext(db),
      filtersOf({ q: word, category: "electronics", condition: "good", location: point }),
      null,
      20,
    );
    expect(page.cards.map((card) => card.id)).toEqual([match]);
    expect(page.cards[0]).toMatchObject({
      match: "exact",
      category: { key: "electronics" },
      location: { id: point },
      status: "active",
      primary_image: null,
      seller_student_badge: false,
    });
    expect(page.nextCursor).toBeNull();

    // Reset (FR12): only the query, so every one of them, newest first.
    const all = await searchListings(readContext(db), filtersOf({ q: word }), null, 20);
    expect(all.cards.map((card) => card.id)).toEqual([byAgreement, book, used, match]);
    expect(all.cards.find((card) => card.id === byAgreement)?.location).toBeNull();
    expect(marketRequest(new URLSearchParams())).toEqual({
      filters: filtersOf(),
      cursor: null,
      limit: 20,
    });
  });

  it("TC29 equal prices and equal times page deterministically by id, without repeats or gaps", async () => {
    const word = uniqueWord();
    const at = new Date(Date.now() - 60_000);
    const same: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      same.push(
        await fixtureListing(seller.id, {
          title: `سعر متساو ${word}`,
          priceMinor: 50_000,
          createdAt: at,
        }),
      );
    }
    const cheap = await fixtureListing(seller.id, {
      title: `أرخص ${word}`,
      priceMinor: 10_000,
      createdAt: at,
    });
    const ascending = [...same].sort();

    const up = await allPages(db, filtersOf({ q: word, sort: "price_asc" }), 2);
    expect(up.ids).toEqual([cheap, ...ascending]);
    expect(up.pages).toEqual([2, 2, 2]);
    const down = await allPages(db, filtersOf({ q: word, sort: "price_desc" }), 2);
    expect(down.ids).toEqual([...ascending].reverse().concat(cheap));
    const newest = await allPages(db, filtersOf({ q: word }), 4);
    expect(newest.ids).toEqual([...same, cheap].sort().reverse());
    expect(new Set(newest.ids).size).toBe(6);
  });

  it("TC29 a forged cursor, or one made with other filters, is INVALID_CURSOR", async () => {
    const word = uniqueWord();
    await fixtureListing(seller.id, { title: `مؤشر أول ${word}` });
    await fixtureListing(seller.id, { title: `مؤشر ثان ${word}` });
    const first = await searchListings(readContext(db), filtersOf({ q: word }), null, 1);
    const cursor = first.nextCursor ?? "";
    expect(cursor).not.toBe("");
    const last = cursor.at(-1) === "A" ? "B" : "A";
    const forged = `${cursor.slice(0, -1)}${last}`;

    expect(
      (await failure(searchListings(readContext(db), filtersOf({ q: word }), forged, 1)))?.code,
    ).toBe("INVALID_CURSOR");
    expect(
      (
        await failure(
          searchListings(readContext(db), filtersOf({ q: word, sort: "price_asc" }), cursor, 1),
        )
      )?.code,
    ).toBe("INVALID_CURSOR");
    expect(
      (await failure(searchListings(readContext(db), filtersOf({ q: `${word} اخر` }), cursor, 1)))
        ?.code,
    ).toBe("INVALID_CURSOR");
    expect(
      (await failure(searchListings(readContext(db), filtersOf({ q: word }), "garbage", 1)))?.code,
    ).toBe("INVALID_CURSOR");
    const second = await searchListings(readContext(db), filtersOf({ q: word }), cursor, 1);
    expect(second.cards).toHaveLength(1);
    expect(second.cards[0]?.id).not.toBe(first.cards[0]?.id);
  });

  it("NFR14 limit: 20 by default and 1 to 50, anything else BAD_REQUEST", () => {
    expect(marketRequest(new URLSearchParams("limit=50")).limit).toBe(50);
    expect(marketRequest(new URLSearchParams("limit=1")).limit).toBe(1);
    for (const [value, code] of [
      ["51", "out_of_range"],
      ["0", "out_of_range"],
      ["abc", "invalid_type"],
    ] as const) {
      const error = thrown(() => marketRequest(new URLSearchParams({ limit: value })));
      expect(error?.code).toBe("BAD_REQUEST");
      expect(error?.fieldErrors).toEqual([{ field: "limit", code }]);
    }
  });

  it("FR07 the query: 100 code points after normalization, diacritics do not count, an empty one is no query", async () => {
    const long = await failure(
      searchListings(readContext(db), filtersOf({ q: "ب".repeat(101) }), null, 1),
    );
    expect(long?.code).toBe("BAD_REQUEST");
    expect(long?.fieldErrors).toEqual([{ field: "q", code: "too_big" }]);
    // 100 letters with a fatha each: 200 code points as typed, 100 after DEC67.
    expect(
      await failure(searchListings(readContext(db), filtersOf({ q: "بَ".repeat(100) }), null, 1)),
    ).toBeNull();
    const raw = thrown(() => marketRequest(new URLSearchParams({ q: "ب".repeat(401) })));
    expect(raw?.fieldErrors).toEqual([{ field: "q", code: "too_big" }]);
    // Tatweel only: nothing is left after DEC67, so it is the market without a query.
    const empty = await searchListings(readContext(db), filtersOf({ q: "ـــ" }), null, 1);
    expect(empty.cards[0]?.match).toBe("exact");
  });

  it("FR08 to FR11 every bad parameter at once, with its field code", () => {
    const error = thrown(() =>
      marketRequest(
        new URLSearchParams("category=nope&condition=broken&location=abc&sort=popular"),
      ),
    );
    expect(error?.code).toBe("BAD_REQUEST");
    expect(error?.fieldErrors).toEqual([
      { field: "category", code: "invalid_value" },
      { field: "condition", code: "invalid_value" },
      { field: "location", code: "invalid_format" },
      { field: "sort", code: "invalid_value" },
    ]);
  });

  it("FR10 an inactive meeting point is BAD_REQUEST with location unavailable", async () => {
    const point = await activeMeetingPoint();
    await dbPool().query("update public.meeting_point set is_active = false where id = $1", [
      point,
    ]);
    try {
      const error = await failure(
        searchListings(readContext(db), filtersOf({ location: point }), null, 1),
      );
      expect(error?.code).toBe("BAD_REQUEST");
      expect(error?.fieldErrors).toEqual([{ field: "location", code: "unavailable" }]);
    } finally {
      await dbPool().query("update public.meeting_point set is_active = true where id = $1", [
        point,
      ]);
    }
  });
});

describe("DEC84: what the market shows and how a query matches", () => {
  it("DEC84 sold, archived and hidden listings, and those of a suspended or deleting seller, are not in the market", async () => {
    const word = uniqueWord();
    const suspended = await newMember();
    const leaving = await newMember();
    const active = await fixtureListing(seller.id, { title: `ظاهر ${word}` });
    await fixtureListing(seller.id, { title: `مباع ${word}`, status: "sold" });
    await fixtureListing(seller.id, { title: `مؤرشف ${word}`, status: "archived" });
    await fixtureListing(seller.id, { title: `مخفي ${word}`, hidden: true });
    await fixtureListing(suspended.id, { title: `بائع موقوف ${word}` });
    await fixtureListing(leaving.id, { title: `بائع يحذف حسابه ${word}` });
    await changeMember(suspended.id, SUSPEND);
    await changeMember(leaving.id, REQUEST_DELETION);

    const page = await searchListings(readContext(db), filtersOf({ q: word }), null, 50);
    expect(page.cards.map((card) => card.id)).toEqual([active]);
  });

  it("DEC84 exact matches come before close ones, each marked, then the chosen order", async () => {
    const word = uniqueWord();
    const exact = await fixtureListing(seller.id, {
      title: `لابتوبات مستعملة ${word}`,
      createdAt: new Date(Date.now() - 3_600_000),
    });
    const close = await fixtureListing(seller.id, { title: `لابتوب ديل ${word}` });

    const plural = await searchListings(
      readContext(db),
      filtersOf({ q: `لابتوبات ${word}` }),
      null,
      20,
    );
    expect(plural.cards.map((card) => [card.id, card.match])).toEqual([
      [exact, "exact"],
      [close, "close"],
    ]);
    // "لاب توب": every word is in both, so both are exact, newest first.
    const spaced = await searchListings(
      readContext(db),
      filtersOf({ q: `لاب توب ${word}` }),
      null,
      20,
    );
    expect(spaced.cards.map((card) => [card.id, card.match])).toEqual([
      [close, "exact"],
      [exact, "exact"],
    ]);
    // Without a query no card carries match.
    const browse = await searchListings(readContext(db), filtersOf(), null, 1);
    expect(browse.cards[0]).not.toHaveProperty("match");
  });
});

describe("API032: the listing page (FR13, UC04)", () => {
  it("TC05 a hidden, archived, unknown or restricted seller's listing is the same generic 404", async () => {
    const suspended = await newMember();
    const leaving = await newMember();
    const ids = [
      await fixtureListing(seller.id, { title: "إعلان مخفي إدارياً", hidden: true }),
      await fixtureListing(seller.id, { title: "إعلان مؤرشف", status: "archived" }),
      await fixtureListing(suspended.id, { title: "إعلان بائع موقوف" }),
      await fixtureListing(leaving.id, { title: "إعلان بائع يحذف حسابه" }),
      randomUUID(),
      "not-a-uuid",
    ];
    await changeMember(suspended.id, SUSPEND);
    await changeMember(leaving.id, REQUEST_DELETION);
    for (const id of ids) {
      expect(await publicListing(db, id)).toBeNull();
      expect(await publicListing(db, id, other.identity.claims)).toBeNull();
    }
    // The seller reads the public view too: their hidden listing is not public.
    expect(await publicListing(db, ids[0] ?? "", seller.identity.claims)).toBeNull();
  });

  it("UC04 a sold listing keeps its page with its state, and negotiation closed", async () => {
    const id = await fixtureListing(seller.id, { title: "دراجة مباعة للعرض", status: "sold" });
    const listing = await publicListing(db, id, other.identity.claims);
    expect(listing).toMatchObject({ id, status: "sold" });
    expect(listing?.sold_at).not.toBeNull();
    expect(listing?.capabilities).toEqual({
      can_contact: false,
      can_offer: false,
      disabled_reason: "context_closed",
    });
  });

  it("UC04 the capabilities: a guest, the seller, another member, a free item, a fixed price and a restricted reader", async () => {
    const negotiable = await fixtureListing(seller.id, {
      title: "قابل للتفاوض للعرض",
      priceMinor: 20_000,
      negotiable: true,
    });
    const free = await fixtureListing(seller.id, {
      title: "غرض مجاني للعرض",
      priceMinor: 0,
      negotiable: false,
    });
    const fixed = await fixtureListing(seller.id, {
      title: "سعر ثابت للعرض",
      priceMinor: 20_000,
      negotiable: false,
    });
    const restricted = await newMember();

    expect((await publicListing(db, negotiable))?.capabilities).toEqual({
      can_contact: false,
      can_offer: false,
      disabled_reason: "sign_in_required",
    });
    expect((await publicListing(db, negotiable, seller.identity.claims))?.capabilities).toEqual({
      can_contact: false,
      can_offer: false,
      disabled_reason: "own_content",
    });
    expect((await publicListing(db, negotiable, other.identity.claims))?.capabilities).toEqual({
      can_contact: true,
      can_offer: true,
      disabled_reason: null,
    });
    expect((await publicListing(db, free, other.identity.claims))?.capabilities).toEqual({
      can_contact: true,
      can_offer: false,
      disabled_reason: "free_item",
    });
    expect((await publicListing(db, fixed, other.identity.claims))?.capabilities).toEqual({
      can_contact: true,
      can_offer: false,
      disabled_reason: "not_negotiable",
    });
    await changeMember(restricted.id, SUSPEND);
    expect((await publicListing(db, negotiable, restricted.identity.claims))?.capabilities).toEqual(
      {
        can_contact: false,
        can_offer: false,
        disabled_reason: "account_restricted",
      },
    );
  });

  it("FR13 TC31 the text comes back as stored, and the seller with public fields only", async () => {
    const description =
      "<script>alert(1)</script>\nسطر ثان javascript:alert(1)\nhttps://example.test/x";
    const id = await fixtureListing(seller.id, { title: "نص للعرض الآمن", description });
    const listing = await publicListing(db, id);
    expect(listing?.description).toBe(description);
    expect(listing?.seller.joined_month).toMatch(/^\d{4}-\d{2}$/);
    expect({ ...listing?.seller, joined_month: "month" }).toEqual({
      id: seller.id,
      display_name: "عضو تجريبي",
      avatar: null,
      college: null,
      joined_month: "month",
      student_badge: false,
      rating: { count: 0, average: null },
    });
    expect(JSON.stringify(listing)).not.toMatch(/@example\.test/);
  });
});

describe("«الصور قيد التجهيز» until media.publish (owner note on task 4.2)", () => {
  it("a listing has no image URL before media.publish, and the public files after it", async () => {
    const word = uniqueWord();
    await resetRl05(seller.id);
    const media = await readyImage(db, seller.identity);
    const { listing } = await publish(
      db,
      seller.identity,
      await listingInput([media], { title: `صورة قيد التجهيز ${word}` }),
    );

    const before = await searchListings(readContext(db), filtersOf({ q: word }), null, 1);
    expect(before.cards[0]?.primary_image).toBeNull();
    const pending = await publicListing(db, listing.id);
    expect(pending?.images).toEqual([]);
    expect(pending?.primary_image).toBeNull();

    assertRan(await runMediaPublish(listing.id));

    const after = await searchListings(readContext(db), filtersOf({ q: word }), null, 1);
    expect(after.cards[0]?.primary_image?.w600).toBe(publicUrl(media, "w600"));
    const ready = await publicListing(db, listing.id);
    expect(ready?.images).toEqual([
      {
        w150: publicUrl(media, "w150"),
        w600: publicUrl(media, "w600"),
        w1200: publicUrl(media, "w1200"),
      },
    ]);
    expect((await fetch(publicUrl(media, "w600"))).status).toBe(200);
  });
});

describe("RL04: public search limits (DEC84)", () => {
  const env = { APP_SECRET: TEST_APP_SECRET, TRUSTED_PROXY_HOPS: 1 };

  async function fill(limit: { scope: string; limit: number; window: string }, key: Buffer) {
    // One statement, so every count falls in the same window (app.app_now() is the statement's).
    await dbPool().query(
      "select count(app.rate_limit_hit($1, $2, $3, $4::interval)) from generate_series(1, $3)",
      [limit.scope, key, limit.limit, limit.window],
    );
  }

  it("RL04 the keys: the member, the guest cookie when there is one, and the client address", () => {
    const guest = randomBytes(32).toString("base64url");
    const member = searchLimits(env, new Headers({ "x-forwarded-for": "203.0.113.7" }), seller.id);
    expect(member.map(({ limit }) => limit.scope)).toEqual(["RL04:session", "RL04:ip"]);
    const visitor = searchLimits(env, new Headers({ cookie: `__Host-souq-guest=${guest}` }), null);
    expect(visitor.map(({ limit }) => limit.scope)).toEqual(["RL04:session"]);
    expect(searchLimits({ ...env, TRUSTED_PROXY_HOPS: 0 }, new Headers(), null)).toEqual([]);
  });

  it("RL04 a session over 120 searches a minute is RATE_LIMITED with Retry-After", async () => {
    const limits = searchLimits(env, new Headers(), randomUUID());
    const session = limits[0];
    expect(session?.limit.scope).toBe("RL04:session");
    if (session === undefined) return;
    await fill(session.limit, session.key);
    const error = await failure(countSearch(db, trace(), limits));
    expect(error?.code).toBe("RATE_LIMITED");
    expect(error?.retryAfter).toBeGreaterThanOrEqual(1);
    expect(error?.retryAfter).toBeLessThanOrEqual(60);
    // Another session is not affected.
    expect(
      await failure(countSearch(db, trace(), searchLimits(env, new Headers(), randomUUID()))),
    ).toBeNull();
  });

  it("RL04 a shared address over 1200 searches a minute is RATE_LIMITED", async () => {
    const address = `198.51.100.${String(1 + ((randomBytes(1)[0] ?? 0) % 250))}`;
    const limits = searchLimits(env, new Headers({ "x-forwarded-for": address }), null);
    const ip = limits.find(({ limit }) => limit.scope === "RL04:ip");
    if (ip === undefined) throw new Error("no address limit");
    await fill(ip.limit, ip.key);
    expect((await failure(countSearch(db, trace(), limits)))?.code).toBe("RATE_LIMITED");
  });
});

describe("DEC77: the public read functions of task 4.3", () => {
  async function asCaller(identity: Identity | null, sql: string, values: unknown[]) {
    return db
      .withActor(
        identity?.claims ?? null,
        trace(),
        async (tx) => (await tx.query(sql, values)).rows,
      )
      .catch((error: unknown) => (error as { code?: string }).code);
  }

  const CARDS =
    "select listing_id, title, match_tier from app.market_listings($1, null, null, null, 'newest', null, null, null, 20)";

  it("DEC77 app.market_listings(): a member gets the same public cards as a guest", async () => {
    const word = uniqueWord();
    await fixtureListing(seller.id, { title: `بطاقة للجميع ${word}` });
    const guest = await asCaller(null, CARDS, [word]);
    expect(guest).toHaveLength(1);
    expect(await asCaller(other.identity, CARDS, [word])).toEqual(guest);
    expect(await asCaller(seller.identity, CARDS, [word])).toEqual(guest);
  });

  it("DEC77 app.market_listings(): a guest reads public cards only", async () => {
    const word = uniqueWord();
    const shown = await fixtureListing(seller.id, { title: `بطاقة ظاهرة ${word}` });
    await fixtureListing(seller.id, { title: `بطاقة مخفية ${word}`, hidden: true });
    await fixtureListing(seller.id, { title: `بطاقة مباعة ${word}`, status: "sold" });
    const rows = (await asCaller(null, CARDS, [word])) as { listing_id: string }[];
    expect(rows.map((row) => row.listing_id)).toEqual([shown]);
  });

  const DETAIL =
    "select title, description, can_contact, disabled_reason from app.public_listing($1)";

  it("DEC77 app.public_listing(): a member reads the same public listing as a guest, with its own capabilities", async () => {
    const id = await fixtureListing(seller.id, { title: "إعلان للقراءة العامة" });
    const guest = (await asCaller(null, DETAIL, [id])) as Record<string, unknown>[];
    const member = (await asCaller(other.identity, DETAIL, [id])) as Record<string, unknown>[];
    expect(member[0]?.title).toBe(guest[0]?.title);
    expect(member[0]?.description).toBe(guest[0]?.description);
    expect(member[0]?.disabled_reason).toBeNull();
    expect(guest[0]?.disabled_reason).toBe("sign_in_required");
  });

  it("DEC77 app.public_listing(): a guest reads a public listing with sign_in_required and nothing of a hidden one", async () => {
    const shown = await fixtureListing(seller.id, { title: "إعلان ظاهر للزائر" });
    const hidden = await fixtureListing(seller.id, { title: "إعلان مخفي عن الزائر", hidden: true });
    expect(await asCaller(null, DETAIL, [shown])).toEqual([
      expect.objectContaining({
        title: "إعلان ظاهر للزائر",
        can_contact: false,
        disabled_reason: "sign_in_required",
      }),
    ]);
    expect(await asCaller(null, DETAIL, [hidden])).toEqual([]);
  });

  const IMAGES = "select media_id, image_position, public_ready from app.public_listing_images($1)";

  it("DEC77 app.public_listing_images(): a member reads the same images as a guest", async () => {
    const id = await fixtureListing(seller.id, {
      title: "صور للجميع",
      images: 2,
      publicImages: true,
    });
    const guest = (await asCaller(null, IMAGES, [id])) as {
      image_position: number;
      public_ready: boolean;
    }[];
    expect(guest.map((row) => [row.image_position, row.public_ready])).toEqual([
      [1, true],
      [2, true],
    ]);
    expect(await asCaller(other.identity, IMAGES, [id])).toEqual(guest);
  });

  it("DEC77 app.public_listing_images(): a guest reads the images of a public listing only", async () => {
    const archived = await fixtureListing(seller.id, { title: "صور مؤرشفة", status: "archived" });
    const hidden = await fixtureListing(seller.id, { title: "صور مخفية", hidden: true });
    expect(await asCaller(null, IMAGES, [archived])).toEqual([]);
    expect(await asCaller(null, IMAGES, [hidden])).toEqual([]);
    const count = await scalar<string>(
      dbPool(),
      "select count(*)::text from public.listing_image where listing_id = any($1::uuid[])",
      [[archived, hidden]],
    );
    expect(count).toBe("2");
  });
});
