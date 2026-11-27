// Task 4.4 (plan/task-4.4.md): the seller manages their listings with the real server code
// (lib/listings/manage.ts) and the real database. FR23, FR24, BR27, BR28, DEC09, DEC85, RET01,
// API033, API035, API036, TC10, TC34, TC35, DEC77. The public copies (media.publish) are in
// listing-public-copies.test.ts.
// Needs `pnpm db:start` (with Storage) and applied migrations; run with `pnpm test:integration`.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LISTING_ACTIVE_MAX,
  LISTING_EDITS_PER_HOUR,
  LISTING_RESTORE_DAYS,
  UNATTACHED_LIFETIME_HOURS,
} from "@souq/domain";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import { closeDb, dbPool, scalar } from "./_harness/db.ts";
import {
  categoryId,
  editOutcome,
  listingInput,
  listingRow,
  myListings,
  publish,
  publishJobs,
  readyImage,
  readyImages,
  resetDec85,
  resetRl05,
  transitionOutcome,
} from "./_harness/listings.ts";
import { fixtureListing, type FixtureListing } from "./_harness/market.ts";
import { limitedSession, memberIdentity } from "./_harness/sessions.ts";
import { trace, uploadImage } from "./_harness/storage.ts";
import { signUpMember } from "./_harness/users.ts";
import { changeMember, webDb, withdrawAcknowledgments } from "./_harness/web.ts";
import { png } from "../fixtures/images/index.ts";

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

const sellers: string[] = [];

async function seller(): Promise<Member> {
  const member = await newMember();
  sellers.push(member.id);
  return member;
}

let owner: Member;
let other: Member;

beforeAll(async () => {
  owner = await seller();
  other = await seller();
});

afterAll(async () => {
  // The fixtures leave the local market and the owner's tabs.
  await dbPool().query(
    `update public.listing
        set status = 'archived', archive_reason = 'owner', archived_at = now(),
            previous_status = case when sold_at is null then 'active' else 'sold' end::public.listing_status
      where seller_id = any($1::uuid[]) and status <> 'archived'`,
    [sellers],
  );
  await db.end();
  await closeDb();
});

function listing(sellerId: string, overrides: Partial<FixtureListing> = {}): Promise<string> {
  return fixtureListing(sellerId, { title: "إعلان إدارة تجريبي", ...overrides });
}

async function setArchivedAgo(id: string, interval: string): Promise<void> {
  await dbPool().query(
    `update public.listing set archived_at = now() - $2::interval where id = $1`,
    [id, interval],
  );
}

describe("task 4.4: the limits are the same in the database and @souq/domain", () => {
  it("app.update_listing() and app.listing_restorable_until() match listing-lifecycle.ts", async () => {
    const update = await scalar<string>(
      dbPool(),
      "select prosrc from pg_proc where oid = 'app.update_listing(uuid, integer, jsonb)'::regprocedure",
    );
    expect(update).toContain(`'DEC85:hour',`);
    expect(update).toContain(`    ${String(LISTING_EDITS_PER_HOUR)},\n    '1 hour'`);
    expect(update).toContain(`interval '${String(UNATTACHED_LIFETIME_HOURS)} hours'`);
    const restore = await scalar<string>(
      dbPool(),
      `select prosrc from pg_proc
        where proname = 'listing_restorable_until' and pronamespace = 'app'::regnamespace`,
    );
    expect(restore).toContain(`interval '${String(LISTING_RESTORE_DAYS)} days'`);
    const transition = await scalar<string>(
      dbPool(),
      "select prosrc from pg_proc where oid = 'app.transition_listing(uuid, text, integer)'::regprocedure",
    );
    expect(transition).toContain(`v_active >= ${String(LISTING_ACTIVE_MAX)}`);
  });

  it("BR27 DEC09 the CHECK refuses a status without its columns", async () => {
    const id = await listing(owner.id);
    for (const sql of [
      "update public.listing set status = 'sold' where id = $1",
      "update public.listing set status = 'archived' where id = $1",
      "update public.listing set status = 'archived', archive_reason = 'owner', archived_at = now(), previous_status = 'archived' where id = $1",
      "update public.listing set archived_at = now() where id = $1",
    ]) {
      await expect(dbPool().query(sql, [id])).rejects.toMatchObject({
        constraint: "listing_lifecycle_columns",
      });
    }
  });
});

describe("API036: mark_sold, archive and restore (FR24, BR27, DEC09)", () => {
  it("FR24 mark_sold makes an active listing sold, final: nothing makes it active again", async () => {
    const id = await listing(owner.id);
    const sold = await transitionOutcome(db, owner.identity, id, {
      action: "mark_sold",
      expected_version: 1,
    });
    expect(sold.status).toBe(200);
    expect((sold.body as { data: Record<string, unknown> }).data).toMatchObject({
      status: "sold",
      version: 2,
      restorable_until: null,
    });
    expect((await listingRow(id)).sold_at).not.toBeNull();
    for (const action of ["mark_sold", "restore"]) {
      expect(
        await transitionOutcome(db, owner.identity, id, { action, expected_version: 2 }),
      ).toMatchObject({ status: 409, code: "STATE_CONFLICT" });
    }
    expect(
      await editOutcome(db, owner.identity, id, { title: "عنوان بعد البيع", expected_version: 2 }),
    ).toMatchObject({ status: 409, code: "STATE_CONFLICT" });
    expect((await listingRow(id)).status).toBe("sold");
  });

  it("TC34 an archived sale keeps where it came from and is never restored", async () => {
    const id = await listing(owner.id, { title: "مباع ثم مؤرشف", status: "sold" });
    const archived = await transitionOutcome(db, owner.identity, id, {
      action: "archive",
      expected_version: 1,
    });
    expect(archived.status).toBe(200);
    expect((archived.body as { data: Record<string, unknown> }).data).toMatchObject({
      status: "archived",
      previous_status: "sold",
      archive_reason: "owner",
      restorable_until: null,
    });
    expect(
      await transitionOutcome(db, owner.identity, id, { action: "restore", expected_version: 2 }),
    ).toMatchObject({ status: 409, code: "STATE_CONFLICT" });
    expect((await listingRow(id)).status).toBe("archived");
  });

  it("TC34 an active archive is restored within 90 days, and refused after without being purged", async () => {
    const id = await listing(owner.id);
    const archived = await transitionOutcome(db, owner.identity, id, {
      action: "archive",
      expected_version: 1,
    });
    const data = (archived.body as { data: { archived_at: string; restorable_until: string } })
      .data;
    expect(data).toMatchObject({ status: "archived", previous_status: "active" });
    expect(Date.parse(data.restorable_until) - Date.parse(data.archived_at)).toBe(
      LISTING_RESTORE_DAYS * 86_400_000,
    );

    // Just inside the window: restored, with the archive columns cleared.
    await setArchivedAgo(id, "89 days 23 hours");
    const restored = await transitionOutcome(db, owner.identity, id, {
      action: "restore",
      expected_version: 2,
    });
    expect(restored.status).toBe(200);
    expect(await listingRow(id)).toMatchObject({
      status: "active",
      previous_status: null,
      archive_reason: null,
      archived_at: null,
      version: 3,
    });

    // Past the window: DEADLINE_PASSED, and the listing is still there, archived.
    await transitionOutcome(db, owner.identity, id, { action: "archive", expected_version: 3 });
    await setArchivedAgo(id, "90 days 1 second");
    expect(
      await transitionOutcome(db, owner.identity, id, { action: "restore", expected_version: 4 }),
    ).toMatchObject({ status: 422, code: "DEADLINE_PASSED" });
    expect(await listingRow(id)).toMatchObject({ status: "archived", version: 4 });
  });

  it("BR27 a restore past 200 active listings is LIMIT_REACHED", async () => {
    const member = await seller();
    const archived = await listing(member.id, { title: "مؤرشف قبل السقف", status: "archived" });
    await dbPool().query(
      `with m as (
         insert into public.media_asset
           (owner_id, purpose, quarantine_key, status, bytes, mime, width, height,
            checksum_sha256, upload_expires_at, expires_at, processed_at)
         select $1, 'listing', md5(gen_random_uuid()::text), 'ready', 100, 'image/png', 10, 10,
                sha256(convert_to(g::text, 'UTF8')), now(), null, now()
           from generate_series(1, $3::int) g
         returning id
       ), l as (
         insert into public.listing
           (seller_id, category_id, title, description, condition, price_minor, is_negotiable)
         select $1, $2, 'إعلان تجريبي ' || g, 'وصف تجريبي للإعلان رقم ' || g, 'good', 100, false
           from generate_series(1, $3::int) g
         returning id
       ), mm as (select id, row_number() over () as n from m),
          ll as (select id, row_number() over () as n from l)
       insert into public.listing_image (listing_id, media_id, position)
       select ll.id, mm.id, 1 from ll join mm using (n)`,
      [member.id, await categoryId(), LISTING_ACTIVE_MAX],
    );
    expect(
      await transitionOutcome(db, member.identity, archived, {
        action: "restore",
        expected_version: 1,
      }),
    ).toMatchObject({ status: 422, code: "LIMIT_REACHED" });
    expect((await listingRow(archived)).status).toBe("archived");
  });

  it("STATE_CONFLICT a stale expected_version and two transitions at once", async () => {
    const id = await listing(owner.id);
    expect(
      await transitionOutcome(db, owner.identity, id, { action: "archive", expected_version: 2 }),
    ).toMatchObject({ status: 409, code: "STATE_CONFLICT" });
    const [first, second] = await Promise.all([
      transitionOutcome(db, owner.identity, id, { action: "archive", expected_version: 1 }),
      transitionOutcome(db, owner.identity, id, { action: "mark_sold", expected_version: 1 }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect((await listingRow(id)).version).toBe(2);
  });

  it("API036 an unknown action is VALIDATION_FAILED and an extra field BAD_REQUEST", async () => {
    const id = await listing(owner.id);
    expect(
      await transitionOutcome(db, owner.identity, id, { action: "delete", expected_version: 1 }),
    ).toMatchObject({
      status: 422,
      code: "VALIDATION_FAILED",
      fieldErrors: [{ field: "action", code: "invalid_value" }],
    });
    expect(
      await transitionOutcome(db, owner.identity, id, {
        action: "archive",
        expected_version: 1,
        status: "active",
      }),
    ).toMatchObject({ status: 400, code: "BAD_REQUEST" });
  });
});

describe("TC10 TC35: who may act on a listing", () => {
  it("TC10 another member cannot edit or move a listing, and the record does not change", async () => {
    const id = await listing(owner.id);
    const before = await listingRow(id);
    expect(
      await editOutcome(db, other.identity, id, { title: "عنوان من عضو آخر", expected_version: 1 }),
    ).toMatchObject({ status: 404, code: "NOT_FOUND" });
    for (const action of ["mark_sold", "archive", "restore"]) {
      expect(
        await transitionOutcome(db, other.identity, id, { action, expected_version: 1 }),
      ).toMatchObject({ status: 404, code: "NOT_FOUND" });
    }
    expect(await listingRow(id)).toEqual(before);
    // An unknown or malformed id looks the same.
    for (const missing of [randomUUID(), "not-a-uuid"]) {
      expect(
        await editOutcome(db, owner.identity, missing, { title: "عنوان آخر", expected_version: 1 }),
      ).toMatchObject({ status: 404, code: "NOT_FOUND" });
    }
  });

  it("TC35 every owner action on a listing hidden by moderation is FORBIDDEN, state kept", async () => {
    const active = await listing(owner.id, { title: "مخفي نشط", hidden: true });
    const archived = await listing(owner.id, {
      title: "مخفي مؤرشف",
      status: "archived",
      hidden: true,
    });
    const before = [await listingRow(active), await listingRow(archived)];
    expect(
      await editOutcome(db, owner.identity, active, { title: "عنوان جديد", expected_version: 1 }),
    ).toMatchObject({ status: 403, code: "FORBIDDEN" });
    for (const action of ["mark_sold", "archive"]) {
      expect(
        await transitionOutcome(db, owner.identity, active, { action, expected_version: 1 }),
      ).toMatchObject({ status: 403, code: "FORBIDDEN" });
    }
    expect(
      await transitionOutcome(db, owner.identity, archived, {
        action: "restore",
        expected_version: 1,
      }),
    ).toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect([await listingRow(active), await listingRow(archived)]).toEqual(before);
  });

  it("TC25 a guest, a limited session and ineligible accounts cannot manage listings", async () => {
    const id = await listing(owner.id);
    const edit = { title: "عنوان جديد", expected_version: 1 };
    const move = { action: "archive", expected_version: 1 };
    expect(await editOutcome(db, null, id, edit)).toMatchObject({ status: 401 });
    expect(await transitionOutcome(db, null, id, move)).toMatchObject({ status: 401 });
    await expect(myListings(db, null)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    const limited = await memberIdentity(await limitedSession());
    expect(await editOutcome(db, limited.identity, id, edit)).toMatchObject({
      status: 403,
      code: "RECOVERY_SESSION_ONLY",
    });

    const cases: [string, string][] = [
      ["TERMS_NOT_ACKNOWLEDGED", ""],
      [
        "ACCOUNT_RESTRICTED",
        "update public.account_control set status = 'banned' where user_id = $1",
      ],
      [
        "DELETION_PENDING",
        "update public.account_control set deletion_requested_at = now() where user_id = $1",
      ],
    ];
    for (const [code, sql] of cases) {
      const member = await seller();
      const own = await listing(member.id);
      if (code === "TERMS_NOT_ACKNOWLEDGED") await withdrawAcknowledgments(member.id);
      else await changeMember(member.id, sql);
      expect(await editOutcome(db, member.identity, own, edit)).toMatchObject({
        status: 403,
        code,
      });
      expect(await transitionOutcome(db, member.identity, own, move)).toMatchObject({
        status: 403,
        code,
      });
      await expect(myListings(db, member.identity)).rejects.toMatchObject({ code });
      expect((await listingRow(own)).version).toBe(1);
    }
  });
});

describe("API035: editing an active listing (FR23, BR05 to BR08, DEC85)", () => {
  it("FR23 the sent fields change, created_at stays, and the version goes up", async () => {
    const id = await listing(owner.id);
    const before = await listingRow(id);
    const edited = await editOutcome(db, owner.identity, id, {
      title: "  عنوان معدّل للإعلان  ",
      description: "وصف جديد\r\nبسطرين.",
      condition: "like_new",
      price_minor: 12_050,
      is_negotiable: false,
      expected_version: 1,
    });
    expect(edited.status).toBe(200);
    expect((edited.body as { data: Record<string, unknown> }).data).toMatchObject({
      title: "عنوان معدّل للإعلان",
      description: "وصف جديد\nبسطرين.",
      condition: "like_new",
      price_minor: 12_050,
      is_negotiable: false,
      version: 2,
      status: "active",
    });
    const after = await listingRow(id);
    expect(after.created_at).toEqual(before.created_at);
    expect((after.updated_at as Date).getTime()).toBeGreaterThanOrEqual(
      (before.updated_at as Date).getTime(),
    );
  });

  it("FR23 a request that changes nothing returns the same version and costs nothing", async () => {
    const id = await listing(owner.id, { title: "إعلان بلا تغيير" });
    const same = await editOutcome(db, owner.identity, id, {
      title: "إعلان بلا تغيير",
      expected_version: 1,
    });
    expect(same.status).toBe(200);
    expect((await listingRow(id)).version).toBe(1);
    expect(await editOutcome(db, owner.identity, id, { expected_version: 1 })).toMatchObject({
      status: 200,
    });
    expect(
      await editOutcome(db, owner.identity, id, { title: "عنوان آخر", expected_version: 7 }),
    ).toMatchObject({ status: 409, code: "STATE_CONFLICT" });
  });

  it("BR05 BR08 field codes, BR08 on the merged listing, and unknown fields", async () => {
    const id = await listing(owner.id, { priceMinor: 0, negotiable: false });
    expect(
      await editOutcome(db, owner.identity, id, {
        title: "قصير",
        description: "قصير",
        expected_version: 1,
      }),
    ).toMatchObject({
      status: 422,
      code: "VALIDATION_FAILED",
      fieldErrors: [
        { field: "title", code: "too_small" },
        { field: "description", code: "too_small" },
      ],
    });
    // The stored price is 0: making it negotiable alone is refused by the database (BR08).
    expect(
      await editOutcome(db, owner.identity, id, { is_negotiable: true, expected_version: 1 }),
    ).toMatchObject({
      status: 422,
      code: "VALIDATION_FAILED",
      fieldErrors: [{ field: "is_negotiable", code: "not_allowed" }],
    });
    for (const injected of [{ status: "sold" }, { seller_id: other.id }, { version: 9 }]) {
      expect(
        await editOutcome(db, owner.identity, id, { ...injected, expected_version: 1 }),
      ).toMatchObject({ status: 400, code: "BAD_REQUEST" });
    }
    expect((await listingRow(id)).version).toBe(1);
  });

  it("TC80 a deactivated category stays while unchanged, and cannot be chosen", async () => {
    const id = await listing(owner.id, { category: "books_study" });
    const books = await categoryId("books_study");
    const furniture = await categoryId("room_furniture");
    await dbPool().query("update public.category set is_active = false where id = $1", [books]);
    try {
      expect(
        await editOutcome(db, owner.identity, id, {
          category_id: books,
          title: "عنوان مع فئة معطلة",
          expected_version: 1,
        }),
      ).toMatchObject({ status: 200 });
      await editOutcome(db, owner.identity, id, { category_id: furniture, expected_version: 2 });
      expect(
        await editOutcome(db, owner.identity, id, { category_id: books, expected_version: 3 }),
      ).toMatchObject({
        status: 422,
        fieldErrors: [{ field: "category_id", code: "unavailable" }],
      });
    } finally {
      await dbPool().query("update public.category set is_active = true where id = $1", [books]);
    }
  });

  it("DEC85 the 31st successful edit in an hour is RATE_LIMITED, and a refused one does not count", async () => {
    const member = await seller();
    const id = await listing(member.id);
    try {
      let version = 1;
      for (let index = 0; index < LISTING_EDITS_PER_HOUR; index += 1) {
        const edited = await editOutcome(db, member.identity, id, {
          price_minor: 10_000 + index,
          expected_version: version,
        });
        expect(edited.status).toBe(200);
        version += 1;
        // A refused edit in between costs nothing.
        if (index === 0) {
          await editOutcome(db, member.identity, id, { title: "قصير", expected_version: version });
        }
      }
      const refused = await editOutcome(db, member.identity, id, {
        price_minor: 99_999,
        expected_version: version,
      });
      expect(refused).toMatchObject({ status: 429, code: "RATE_LIMITED" });
      expect(refused.retryAfter).toBeGreaterThan(0);
      expect((await listingRow(id)).version).toBe(version);
      // The transitions are not counted (DEC85).
      expect(
        await transitionOutcome(db, member.identity, id, {
          action: "archive",
          expected_version: version,
        }),
      ).toMatchObject({ status: 200 });
    } finally {
      await resetDec85(member.id);
    }
  });
});

describe("API035: the images of an edit (BR06, DEC08, RET01, SEC08)", () => {
  it("BR06 images are added, removed and reordered; a detached one expires in 24 hours", async () => {
    const member = await seller();
    const [first, second, added] = await readyImages(db, member.identity, 3);
    const { listing: published } = await publish(
      db,
      member.identity,
      await listingInput([first ?? "", second ?? ""]),
    );
    const edited = await editOutcome(db, member.identity, published.id, {
      media_ids: [added, first],
      expected_version: 1,
    });
    expect(edited.status).toBe(200);
    const data = (edited.body as { data: { images: { media_id: string; position: number }[] } })
      .data;
    expect(data.images.map((image) => [image.media_id, image.position])).toEqual([
      [added, 1],
      [first, 2],
    ]);
    const expires = await scalar<Date | null>(
      dbPool(),
      "select expires_at from public.media_asset where id = $1",
      [second],
    );
    expect(expires).not.toBeNull();
    const hours = ((expires as Date).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(UNATTACHED_LIFETIME_HOURS - 0.1);
    expect(hours).toBeLessThanOrEqual(UNATTACHED_LIFETIME_HOURS);
    expect(
      await scalar<Date | null>(
        dbPool(),
        "select expires_at from public.media_asset where id = $1",
        [added],
      ),
    ).toBeNull();

    // The sync is queued with the version and the detached image.
    expect(await publishJobs(published.id)).toEqual([
      { key: `media.publish:${published.id}`, payload: { listing_id: published.id } },
      {
        key: `media.publish:${published.id}:2`,
        payload: { listing_id: published.id, detached_media_ids: [second] },
      },
    ]);

    // Within its 24 hours, the detached image can come back.
    expect(
      await editOutcome(db, member.identity, published.id, {
        media_ids: [added, first, second],
        expected_version: 2,
      }),
    ).toMatchObject({ status: 200 });
    expect(
      await scalar<Date | null>(
        dbPool(),
        "select expires_at from public.media_asset where id = $1",
        [second],
      ),
    ).toBeNull();
    await resetRl05(member.id);
  });

  it("FR23 a text-only edit queues no image job", async () => {
    const member = await seller();
    const [image] = await readyImages(db, member.identity, 1);
    const { listing: published } = await publish(
      db,
      member.identity,
      await listingInput([image ?? ""]),
    );
    await editOutcome(db, member.identity, published.id, {
      title: "عنوان نصي فقط",
      media_ids: [image],
      expected_version: 1,
    });
    expect((await publishJobs(published.id)).map((job) => job.key)).toEqual([
      `media.publish:${published.id}`,
    ]);
    await resetRl05(member.id);
  });

  it("TC07 another member's image is MEDIA_INVALID and an unprocessed one MEDIA_NOT_READY", async () => {
    const member = await seller();
    const [own] = await readyImages(db, member.identity, 1);
    const { listing: published } = await publish(
      db,
      member.identity,
      await listingInput([own ?? ""]),
    );
    const foreign = await readyImage(db, other.identity);
    expect(
      await editOutcome(db, member.identity, published.id, {
        media_ids: [own, foreign],
        expected_version: 1,
      }),
    ).toMatchObject({
      status: 422,
      code: "MEDIA_INVALID",
      fieldErrors: [{ field: "media_ids.1", code: "invalid" }],
    });
    const bytes = await png(400, 300);
    const pending = await uploadImage(db, member.identity, bytes, "image/png", {
      width: 400,
      height: 300,
    });
    expect(
      await editOutcome(db, member.identity, published.id, {
        media_ids: [pending.id],
        expected_version: 1,
      }),
    ).toMatchObject({
      status: 422,
      code: "MEDIA_NOT_READY",
      fieldErrors: [{ field: "media_ids.0", code: "not_ready" }],
    });
    expect(
      await editOutcome(db, member.identity, published.id, { media_ids: [], expected_version: 1 }),
    ).toMatchObject({ status: 422, fieldErrors: [{ field: "media_ids", code: "too_small" }] });
    expect((await listingRow(published.id)).version).toBe(1);
    await resetRl05(member.id);
  });
});

describe("API033: the member's tabs (FR23, FR24, BR27)", () => {
  it("FR24 each tab lists its own listings, newest first, with the cursor", async () => {
    const member = await seller();
    const now = Date.now();
    const older = await listing(member.id, {
      title: "نشط أقدم",
      createdAt: new Date(now - 60_000),
    });
    const newer = await listing(member.id, { title: "نشط أحدث", createdAt: new Date(now - 1_000) });
    const hidden = await listing(member.id, {
      title: "نشط مخفي",
      hidden: true,
      createdAt: new Date(now - 30_000),
    });
    const sold = await listing(member.id, { title: "إعلان مباع", status: "sold" });
    const archived = await listing(member.id, { title: "إعلان مؤرشف", status: "archived" });

    const active = await myListings(db, member.identity);
    expect(active.items.map((item) => item.id)).toEqual([newer, hidden, older]);
    expect(active.items.find((item) => item.id === hidden)?.moderation_hidden).toBe(true);
    expect(active.nextCursor).toBeNull();
    expect(
      (await myListings(db, member.identity, { status: "sold" })).items.map((i) => i.id),
    ).toEqual([sold]);
    const archive = await myListings(db, member.identity, { status: "archived" });
    expect(archive.items.map((item) => item.id)).toEqual([archived]);
    expect(archive.items[0]?.restorable_until).not.toBeNull();

    const first = await myListings(db, member.identity, { limit: "2" });
    expect(first.items.map((item) => item.id)).toEqual([newer, hidden]);
    const second = await myListings(db, member.identity, {
      limit: "2",
      cursor: first.nextCursor ?? "",
    });
    expect(second.items.map((item) => item.id)).toEqual([older]);
    expect(second.nextCursor).toBeNull();

    // A cursor of another tab, a forged one and an unknown status are refused.
    await expect(
      myListings(db, member.identity, { status: "sold", cursor: first.nextCursor ?? "" }),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(
      myListings(db, member.identity, { cursor: "bm90LmEuY3Vyc29y" }),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    expect(() => myListings(db, member.identity, { status: "deleted" })).toThrow();
  });

  it("DEC77 app.my_listings(): another member's session reads only its own listings", async () => {
    const mine = await listing(owner.id, { title: "إعلاني أنا" });
    const page = await myListings(db, other.identity);
    expect(page.items.map((item) => item.id)).not.toContain(mine);
    const direct = await db.withActor(other.identity.claims, trace(), async (tx) => {
      const result = await tx.query<{ listing_id: string }>(
        "select listing_id from app.my_listings('active', null, null, 51)",
      );
      return result.rows.map((row) => row.listing_id);
    });
    expect(direct).not.toContain(mine);
    const owned = await scalar<string>(
      dbPool(),
      "select count(*)::text from public.listing where seller_id = $1 and id = any($2::uuid[])",
      [other.id, direct.length === 0 ? [randomUUID()] : direct],
    );
    expect(owned).toBe(String(direct.length));
  });

  it("DEC77 app.my_listings(): a guest is UNAUTHENTICATED", async () => {
    const refused = await db
      .withActor(null, trace(), async (tx) => {
        await tx.query("select listing_id from app.my_listings('active', null, null, 20)");
        return "read";
      })
      .catch((error: unknown) => (error as { code?: string }).code);
    expect(refused).toBe("UNAUTHENTICATED");
  });
});
