// Task 4.5 (plan/task-4.5.md): favorites with the real server code (lib/favorites/favorites.ts,
// lib/listings/public.ts) and the real database. FR15, UC05, DEC86, API048, API049, API050,
// TC06, DEC77.
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { FAVORITE_SAVES_PER_HOUR, FAVORITES_MAX } from "@souq/domain";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import {
  favoritesRequest,
  readMyFavorites,
  removeFavorite,
  saveFavorite,
  type FavoritePage,
  type FavoritesContext,
} from "../../apps/web/lib/favorites/favorites.ts";
import { readPublicListing, searchListings } from "../../apps/web/lib/listings/public.ts";
import { outcome, type Outcome } from "./_harness/auth-flow.ts";
import { closeDb, dbPool, scalar } from "./_harness/db.ts";
import { categoryId } from "./_harness/listings.ts";
import {
  TEST_APP_SECRET,
  filtersOf,
  fixtureListing,
  readContext,
  uniqueWord,
  type FixtureListing,
} from "./_harness/market.ts";
import { limitedSession, memberIdentity } from "./_harness/sessions.ts";
import { trace } from "./_harness/storage.ts";
import { signUpMember } from "./_harness/users.ts";
import { changeMember, webDb, withdrawAcknowledgments } from "./_harness/web.ts";

const db = webDb();

interface Member {
  id: string;
  identity: Identity;
}

const members: string[] = [];

async function newMember(): Promise<Member> {
  const member = await signUpMember();
  const { identity } = await memberIdentity(member);
  members.push(member.id);
  return { id: member.id, identity };
}

let seller: Member;
let saver: Member;
let other: Member;

beforeAll(async () => {
  seller = await newMember();
  saver = await newMember();
  other = await newMember();
});

afterAll(async () => {
  // The fixtures leave the local market.
  await dbPool().query(
    `update public.listing
        set status = 'archived', archive_reason = 'owner', archived_at = now(),
            previous_status = case when sold_at is null then 'active' else 'sold' end::public.listing_status
      where seller_id = any($1::uuid[]) and status <> 'archived'`,
    [members],
  );
  await dbPool().query("delete from public.favorite where user_id = any($1::uuid[])", [members]);
  await db.end();
  await closeDb();
});

const SUSPEND =
  "update public.account_control set status = 'suspended', suspended_until = now() + interval '7 days' where user_id = $1";
const UNSUSPEND =
  "update public.account_control set status = 'active', suspended_until = null where user_id = $1";
const REQUEST_DELETION =
  "update public.account_control set deletion_requested_at = now() where user_id = $1";

function ctx(identity: Identity | null): FavoritesContext {
  return {
    db,
    supabaseUrl: inject("stack").apiUrl,
    appSecret: TEST_APP_SECRET,
    traceId: trace(),
    identity: () => Promise.resolve(identity),
  };
}

function save(identity: Identity | null, listingId: string): Promise<Outcome> {
  return outcome(async () => {
    await saveFavorite(ctx(identity), listingId);
    return new Response(null, { status: 204 });
  });
}

function remove(identity: Identity | null, listingId: string): Promise<Outcome> {
  return outcome(async () => {
    await removeFavorite(ctx(identity), listingId);
    return new Response(null, { status: 204 });
  });
}

// async: favoritesRequest throws BAD_REQUEST before the read, and the tests expect a rejection.
async function list(
  identity: Identity | null,
  query: Record<string, string> = {},
): Promise<FavoritePage> {
  return readMyFavorites(ctx(identity), favoritesRequest(new URLSearchParams(query)));
}

function listing(sellerId: string, overrides: Partial<FixtureListing> = {}): Promise<string> {
  return fixtureListing(sellerId, { title: "إعلان مفضلة تجريبي", ...overrides });
}

async function favoriteRows(userId: string, listingId: string): Promise<Date[]> {
  const result = await dbPool().query<{ created_at: Date }>(
    "select created_at from public.favorite where user_id = $1 and listing_id = $2",
    [userId, listingId],
  );
  return result.rows.map((row) => row.created_at);
}

async function dec86Count(userId: string): Promise<number> {
  const count = await scalar<number | null>(
    dbPool(),
    `select coalesce(sum(count), 0)::int from app.rate_limit_bucket
      where scope = 'DEC86:hour' and key_hash = sha256(convert_to($1::text, 'UTF8'))`,
    [userId],
  );
  return count ?? 0;
}

async function resetDec86(userId: string): Promise<void> {
  await dbPool().query(
    `delete from app.rate_limit_bucket
      where scope = 'DEC86:hour' and key_hash = sha256(convert_to($1::text, 'UTF8'))`,
    [userId],
  );
}

async function setArchived(id: string): Promise<void> {
  await dbPool().query(
    `update public.listing
        set status = 'archived', previous_status = 'active', archive_reason = 'owner',
            archived_at = now()
      where id = $1`,
    [id],
  );
}

async function setActive(id: string): Promise<void> {
  await dbPool().query(
    `update public.listing
        set status = 'active', previous_status = null, archive_reason = null, archived_at = null,
            moderation_hidden_at = null
      where id = $1`,
    [id],
  );
}

describe("task 4.5: the limits are the same in the database and @souq/domain", () => {
  it("DEC86 app.save_favorite() checks FAVORITES_MAX and FAVORITE_SAVES_PER_HOUR", async () => {
    const source = await scalar<string>(
      dbPool(),
      "select prosrc from pg_proc where oid = 'app.save_favorite(uuid)'::regprocedure",
    );
    expect(source).toContain(`v_count >= ${String(FAVORITES_MAX)}`);
    expect(source).toContain(`'DEC86:hour',`);
    expect(source).toContain(`    ${String(FAVORITE_SAVES_PER_HOUR)},\n    '1 hour'`);
  });
});

describe("API049 and API050: save and remove (FR15, UC05, TC06)", () => {
  it("TC06 repeated favorite save and removal keep at most one relationship", async () => {
    const id = await listing(seller.id);
    expect(await save(saver.identity, id)).toMatchObject({ status: 204 });
    const [first] = await favoriteRows(saver.id, id);
    expect(first).toBeInstanceOf(Date);
    expect(await save(saver.identity, id)).toMatchObject({ status: 204 });
    // Two saves at the same time: the primary key and the profile lock keep one row.
    const both = await Promise.all([save(saver.identity, id), save(saver.identity, id)]);
    expect(both.map((result) => result.status)).toEqual([204, 204]);
    expect(await favoriteRows(saver.id, id)).toEqual([first]);

    expect(await remove(saver.identity, id)).toMatchObject({ status: 204 });
    expect(await remove(saver.identity, id)).toMatchObject({ status: 204 });
    expect(await favoriteRows(saver.id, id)).toEqual([]);
    const again = await Promise.all([save(saver.identity, id), remove(saver.identity, id)]);
    expect(again.map((result) => result.status)).toEqual([204, 204]);
    expect((await favoriteRows(saver.id, id)).length).toBeLessThanOrEqual(1);
  });

  it("UC05 a listing the public may not see is NOT_FOUND, the same for every reason", async () => {
    const hidden = await listing(seller.id, { hidden: true });
    const archived = await listing(seller.id, { status: "archived" });
    for (const id of [hidden, archived, randomUUID(), "not-a-uuid"]) {
      expect(await save(saver.identity, id)).toMatchObject({ status: 404, code: "NOT_FOUND" });
    }
    const restricted = await newMember();
    const ofRestricted = await listing(restricted.id);
    await changeMember(restricted.id, SUSPEND);
    expect(await save(saver.identity, ofRestricted)).toMatchObject({ code: "NOT_FOUND" });
    expect(await favoriteRows(saver.id, hidden)).toEqual([]);
  });

  it("DEC86 a sold listing and the member's own listing are saved", async () => {
    const sold = await listing(seller.id, { status: "sold" });
    expect(await save(saver.identity, sold)).toMatchObject({ status: 204 });
    const own = await listing(seller.id);
    expect(await save(seller.identity, own)).toMatchObject({ status: 204 });
    expect(await favoriteRows(seller.id, own)).toHaveLength(1);
  });

  it("API050 removes a listing that is unknown or no longer visible", async () => {
    const id = await listing(seller.id);
    await save(saver.identity, id);
    await setArchived(id);
    expect(await remove(saver.identity, id)).toMatchObject({ status: 204 });
    expect(await favoriteRows(saver.id, id)).toEqual([]);
    expect(await remove(saver.identity, randomUUID())).toMatchObject({ status: 204 });
    expect(await remove(saver.identity, "not-a-uuid")).toMatchObject({ status: 204 });
  });

  it("x-access member: a guest, a recovery session and a member who may not write are refused", async () => {
    const id = await listing(seller.id);
    expect(await save(null, id)).toMatchObject({ status: 401 });
    expect(await remove(null, id)).toMatchObject({ status: 401 });
    await expect(list(null)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    const limited = await memberIdentity(await limitedSession());
    expect(await save(limited.identity, id)).toMatchObject({
      status: 403,
      code: "RECOVERY_SESSION_ONLY",
    });

    const cases: [string, string][] = [
      ["TERMS_NOT_ACKNOWLEDGED", ""],
      [
        "ACCOUNT_RESTRICTED",
        "update public.account_control set status = 'banned' where user_id = $1",
      ],
      ["DELETION_PENDING", REQUEST_DELETION],
    ];
    for (const [code, sql] of cases) {
      const member = await newMember();
      if (code === "TERMS_NOT_ACKNOWLEDGED") await withdrawAcknowledgments(member.id);
      else await changeMember(member.id, sql);
      expect(await save(member.identity, id)).toMatchObject({ status: 403, code });
      expect(await remove(member.identity, id)).toMatchObject({ status: 403, code });
      await expect(list(member.identity)).rejects.toMatchObject({ code });
      expect(await favoriteRows(member.id, id)).toEqual([]);
    }
  });
});

describe("DEC86: 500 favorites and 120 new saves an hour", () => {
  it("DEC86 the 120 new saves an hour count new rows only", async () => {
    const member = await newMember();
    const first = await listing(seller.id);
    const second = await listing(seller.id);
    await save(member.identity, first);
    await save(member.identity, first);
    expect(await save(member.identity, randomUUID())).toMatchObject({ code: "NOT_FOUND" });
    expect(await dec86Count(member.id)).toBe(1);

    // The rest of the hour's quota, used: a new save is refused, a repeated one still succeeds.
    await dbPool().query(
      `update app.rate_limit_bucket set count = $2
        where scope = 'DEC86:hour' and key_hash = sha256(convert_to($1::text, 'UTF8'))`,
      [member.id, FAVORITE_SAVES_PER_HOUR],
    );
    const refused = await save(member.identity, second);
    expect(refused).toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect(refused.retryAfter).toBeGreaterThan(0);
    expect(await favoriteRows(member.id, second)).toEqual([]);
    expect(await save(member.identity, first)).toMatchObject({ status: 204 });
    expect(await remove(member.identity, first)).toMatchObject({ status: 204 });
    await resetDec86(member.id);
  });

  it("DEC86 at 500 favorites a new save is LIMIT_REACHED, unavailable ones counted", async () => {
    const member = await newMember();
    const bulkSeller = await newMember();
    const category = await categoryId();
    // FAVORITES_MAX listings hidden by moderation (never in the market), each with its image row
    // (the listing_images_required trigger), and the member's favorites of all of them.
    const client = await dbPool().connect();
    try {
      await client.query("begin");
      await client.query(
        `with l as (
           insert into public.listing
             (seller_id, category_id, title, description, condition, price_minor, is_negotiable,
              status, moderation_hidden_at)
           select $1, $2, 'إعلان سقف المفضلة', 'وصف تجريبي لإعلان سقف المفضلة.', 'good', 1000,
                  true, 'active', now()
             from generate_series(1, $3)
           returning id
         ), m as (
           insert into public.media_asset
             (id, owner_id, purpose, quarantine_key, status, bytes, mime, width, height,
              checksum_sha256, upload_expires_at, processed_at)
           select gen_random_uuid(), $1, 'listing', md5(random()::text || g::text), 'ready', 1000,
                  'image/png', 400, 300, sha256(convert_to(random()::text || g::text, 'UTF8')),
                  app.app_now(), app.app_now()
             from generate_series(1, $3) g
           returning id
         ), pairs as (
           select l.id as listing_id, m.id as media_id
             from (select id, row_number() over () as n from l) l
             join (select id, row_number() over () as n from m) m using (n)
         ), images as (
           insert into public.listing_image (listing_id, media_id, position)
           select listing_id, media_id, 1 from pairs
           returning listing_id
         )
         insert into public.favorite (user_id, listing_id)
         select $4, listing_id from images`,
        [bulkSeller.id, category, FAVORITES_MAX, member.id],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const visible = await listing(seller.id);
    expect(await save(member.identity, visible)).toMatchObject({
      status: 422,
      code: "LIMIT_REACHED",
    });
    expect(await favoriteRows(member.id, visible)).toEqual([]);
    expect(await dec86Count(member.id)).toBe(0);

    // One removed: a save fits again.
    const one = await scalar<string>(
      dbPool(),
      "select listing_id::text from public.favorite where user_id = $1 limit 1",
      [member.id],
    );
    expect(await remove(member.identity, one)).toMatchObject({ status: 204 });
    expect(await save(member.identity, visible)).toMatchObject({ status: 204 });
    await resetDec86(member.id);
  });
});

describe("API048: the member's favorites (FR15, UC05)", () => {
  it("UC05 a listing no longer public is «غير متاح» with nothing of it, and comes back when public again", async () => {
    const member = await newMember();
    const hiddenSeller = await newMember();
    const leavingSeller = await newMember();
    const word = uniqueWord();
    const shown = await listing(seller.id, { title: `محفوظ ظاهر ${word}`, publicImages: true });
    const sold = await listing(seller.id, { title: `محفوظ مباع ${word}`, status: "sold" });
    const archived = await listing(seller.id, { title: `محفوظ مؤرشف ${word}` });
    const hidden = await listing(seller.id, { title: `محفوظ مخفي ${word}` });
    const suspended = await listing(hiddenSeller.id, { title: `محفوظ موقوف ${word}` });
    const leaving = await listing(leavingSeller.id, { title: `محفوظ مغادر ${word}` });
    for (const id of [shown, sold, archived, hidden, suspended, leaving]) {
      expect(await save(member.identity, id)).toMatchObject({ status: 204 });
    }
    await setArchived(archived);
    await dbPool().query("update public.listing set moderation_hidden_at = now() where id = $1", [
      hidden,
    ]);
    await changeMember(hiddenSeller.id, SUSPEND);
    await changeMember(leavingSeller.id, REQUEST_DELETION);

    const page = await list(member.identity);
    const byId = new Map(page.items.map((item) => [item.listing_id, item]));
    expect(byId.get(shown)).toMatchObject({
      available: true,
      listing: { id: shown, title: `محفوظ ظاهر ${word}`, status: "active", is_favorite: true },
    });
    expect(byId.get(shown)?.listing?.primary_image).not.toBeNull();
    expect(byId.get(sold)).toMatchObject({ available: true, listing: { status: "sold" } });
    for (const id of [archived, hidden, suspended, leaving]) {
      const item = byId.get(id);
      expect(item).toEqual({
        listing_id: id,
        available: false,
        listing: null,
        saved_at: expect.any(String) as string,
      });
      expect(JSON.stringify(item)).not.toContain(word);
    }

    // The database row itself carries nothing of an unavailable listing (UC05).
    const raw = await db.withActor(member.identity.claims, trace(), async (tx) => {
      const result = await tx.query<Record<string, unknown>>(
        "select * from app.my_favorites(null, null, 20) where listing_id = $1",
        [hidden],
      );
      return result.rows[0];
    });
    expect(raw).toBeDefined();
    for (const [column, value] of Object.entries(raw ?? {})) {
      if (!["listing_id", "saved_at", "saved_key", "available"].includes(column)) {
        expect([column, value]).toEqual([column, null]);
      }
    }

    // Public again: available again, the row was kept.
    await setActive(archived);
    await setActive(hidden);
    await changeMember(hiddenSeller.id, UNSUSPEND);
    const after = new Map(
      (await list(member.identity)).items.map((item) => [item.listing_id, item]),
    );
    expect(after.get(archived)?.available).toBe(true);
    expect(after.get(hidden)?.available).toBe(true);
    expect(after.get(suspended)?.available).toBe(true);
    expect(after.get(leaving)?.available).toBe(false);
  });

  it("NFR14 the newest saved first, a stable cursor over pages, and a forged cursor refused", async () => {
    const member = await newMember();
    const ids: string[] = [];
    for (let n = 0; n < 3; n += 1) {
      const id = await listing(seller.id);
      await save(member.identity, id);
      ids.push(id);
    }
    const first = await list(member.identity, { limit: "2" });
    expect(first.items.map((item) => item.listing_id)).toEqual([ids[2], ids[1]]);
    expect(first.nextCursor).not.toBeNull();
    const second = await list(member.identity, { limit: "2", cursor: first.nextCursor ?? "" });
    expect(second.items.map((item) => item.listing_id)).toEqual([ids[0]]);
    expect(second.nextCursor).toBeNull();
    // A repeated save keeps the time it was saved: the order does not change.
    await save(member.identity, ids[0] ?? "");
    expect((await list(member.identity)).items.map((item) => item.listing_id)).toEqual([
      ids[2],
      ids[1],
      ids[0],
    ]);
    await expect(list(member.identity, { cursor: "forged" })).rejects.toMatchObject({
      code: "INVALID_CURSOR",
    });
    await expect(list(member.identity, { limit: "x" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("is_favorite on the public reads (item 4)", () => {
  it("API031 API032 is_favorite for a member, left out for a guest", async () => {
    const member = await newMember();
    const word = uniqueWord();
    const saved = await listing(seller.id, { title: `بطاقة محفوظة ${word}` });
    const notSaved = await listing(seller.id, { title: `بطاقة غير محفوظة ${word}` });
    await save(member.identity, saved);

    const mine = await searchListings(
      readContext(db, member.identity.claims),
      filtersOf({ q: word }),
      null,
      20,
    );
    expect(Object.fromEntries(mine.cards.map((card) => [card.id, card.is_favorite]))).toEqual({
      [saved]: true,
      [notSaved]: false,
    });
    const theirs = await searchListings(
      readContext(db, other.identity.claims),
      filtersOf({ q: word }),
      null,
      20,
    );
    expect(theirs.cards.map((card) => card.is_favorite)).toEqual([false, false]);
    const guest = await searchListings(readContext(db), filtersOf({ q: word }), null, 20);
    expect(guest.cards.map((card) => "is_favorite" in card)).toEqual([false, false]);

    expect(
      (await readPublicListing(readContext(db, member.identity.claims), saved))?.is_favorite,
    ).toBe(true);
    expect(
      (await readPublicListing(readContext(db, other.identity.claims), saved))?.is_favorite,
    ).toBe(false);
    expect(await readPublicListing(readContext(db), saved)).not.toHaveProperty("is_favorite");
  });
});

describe("DEC77: the favorite reads", () => {
  async function asCaller(identity: Identity | null, sql: string, values: unknown[]) {
    return db
      .withActor(
        identity?.claims ?? null,
        trace(),
        async (tx) => (await tx.query(sql, values)).rows,
      )
      .catch((error: unknown) => (error as { code?: string }).code);
  }

  const MINE = "select listing_id from app.my_favorites(null, null, 51)";
  const FLAGS = "select listing_id from app.favorite_flags($1::uuid[])";

  it("DEC77 app.my_favorites(): another member's session reads only its own favorites", async () => {
    const owner = await newMember();
    const third = await newMember();
    const id = await listing(seller.id);
    await save(owner.identity, id);
    expect(await asCaller(owner.identity, MINE, [])).toEqual([{ listing_id: id }]);
    expect(await asCaller(third.identity, MINE, [])).toEqual([]);
  });

  it("DEC77 app.my_favorites(): a guest is UNAUTHENTICATED", async () => {
    expect(await asCaller(null, MINE, [])).toBe("UNAUTHENTICATED");
  });

  it("DEC77 app.favorite_flags(): another member's session reads only its own saves", async () => {
    const owner = await newMember();
    const third = await newMember();
    const id = await listing(seller.id);
    await save(owner.identity, id);
    expect(await asCaller(owner.identity, FLAGS, [[id]])).toEqual([{ listing_id: id }]);
    expect(await asCaller(third.identity, FLAGS, [[id]])).toEqual([]);
    expect(await asCaller(owner.identity, FLAGS, [Array.from({ length: 52 }, () => id)])).toBe(
      "BAD_REQUEST",
    );
  });

  it("DEC77 app.favorite_flags(): a guest reads no row", async () => {
    const owner = await newMember();
    const id = await listing(seller.id);
    await save(owner.identity, id);
    expect(await asCaller(null, FLAGS, [[id]])).toEqual([]);
    const limited = await memberIdentity(await limitedSession());
    expect(await asCaller(limited.identity, FLAGS, [[id]])).toEqual([]);
  });
});
