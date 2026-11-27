// Task 4.2 (plan/task-4.2.md): API034 with the real server code, the real database and real
// processed images. FR16 to FR22, BR04 to BR08, DEC04 to DEC08, DEC28, RL05, NFR09, TC07, TC08,
// TC09, TC25, TC65, DEC77. The public copies (media.publish, SEC08) are in
// listing-public-copies.test.ts, API030 in catalog.test.ts.
// Needs `pnpm db:start` (with Storage) and applied migrations; run with `pnpm test:integration`.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  LISTING_ACTIVE_MAX,
  LISTING_DESCRIPTION_MAX,
  LISTING_DESCRIPTION_MIN,
  LISTING_IMAGES_MAX,
  LISTING_PRICE_MAX_MINOR,
  LISTING_TITLE_MAX,
  LISTING_TITLE_MIN,
  RL05_PER_DAY,
  RL05_PER_HOUR,
} from "@souq/domain";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import { readOwnerListing } from "../../apps/web/lib/listings/owner.ts";
import { closeDb, dbPool, rolledBack, scalar } from "./_harness/db.ts";
import {
  categoryId,
  listingCount,
  listingInput,
  publish,
  publishOutcome,
  readyImage,
  readyImages,
  resetRl05,
} from "./_harness/listings.ts";
import { memberIdentity } from "./_harness/sessions.ts";
import { assertRan, runImageProcess, trace, uploadImage } from "./_harness/storage.ts";
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

let a: Member;
let b: Member;
let spare: string;

beforeAll(async () => {
  a = await newMember();
  b = await newMember();
  spare = await readyImage(db, a.identity);
});

afterAll(async () => {
  await db.end();
  await closeDb();
});

describe("task 4.2: the limits are the same in the database and @souq/domain", () => {
  it("the CHECKs and app.publish_listing() match packages/domain/src/listing.ts", async () => {
    const constraints = await scalar<string>(
      dbPool(),
      `select string_agg(pg_get_constraintdef(oid), ' ') from pg_constraint
        where conrelid = 'public.listing'::regclass`,
    );
    for (const rule of [
      `char_length(title) >= ${String(LISTING_TITLE_MIN)}`,
      `char_length(title) <= ${String(LISTING_TITLE_MAX)}`,
      `char_length(description) >= ${String(LISTING_DESCRIPTION_MIN)}`,
      `char_length(description) <= ${String(LISTING_DESCRIPTION_MAX)}`,
      `price_minor <= ${String(LISTING_PRICE_MAX_MINOR)}`,
    ]) {
      expect(constraints).toContain(rule);
    }
    const source = await scalar<string>(
      dbPool(),
      "select prosrc from pg_proc where oid = 'app.publish_listing(uuid, jsonb)'::regprocedure",
    );
    expect(source).toContain(`'RL05:hour', v_key_hash, ${String(RL05_PER_HOUR)},`);
    expect(source).toContain(`'RL05:day', v_key_hash, ${String(RL05_PER_DAY)},`);
    expect(source).toContain(`v_active >= ${String(LISTING_ACTIVE_MAX)}`);
    expect(source).toContain(`v_count > ${String(LISTING_IMAGES_MAX)}`);
    expect(source).toContain(`char_length(v_title) > ${String(LISTING_TITLE_MAX)}`);
    expect(source).toContain(`char_length(v_description) > ${String(LISTING_DESCRIPTION_MAX)}`);
  });
});

describe("API034: a published listing, as its seller sees it", () => {
  it("FR16 FR22 a valid listing is created once, active, with its images in order", async () => {
    const member = await newMember();
    const images = await readyImages(db, member.identity, 2);
    const published = await publishOutcome(db, member.identity, await listingInput(images));
    expect(published.status).toBe(201);
    const listing = (published.body as { data: Record<string, unknown> }).data;
    expect(listing).toMatchObject({
      title: "مكتب دراسة خشبي",
      condition: "good",
      price_minor: 35_000,
      is_negotiable: true,
      status: "active",
      location: null,
      primary_image: null,
      seller_student_badge: false,
      moderation_hidden: false,
      version: 1,
      images: [
        { media_id: images[0], position: 1, image: null },
        { media_id: images[1], position: 2, image: null },
      ],
    });
    expect(listing.category).toMatchObject({ key: "books_study", label_ar: "الكتب والدراسة" });
    // The seller is the session's member; the images are attached (no expiry, RET01).
    expect(
      await scalar<string>(dbPool(), "select seller_id::text from public.listing where id = $1", [
        listing.id,
      ]),
    ).toBe(member.id);
    expect(
      await scalar<string>(
        dbPool(),
        "select count(*)::text from public.media_asset where id = any($1::uuid[]) and expires_at is null",
        [images],
      ),
    ).toBe("2");
    // SEC08: the public copies are queued for after the commit, once.
    expect(
      await scalar<string>(
        dbPool(),
        "select count(*)::text from app.job where kind = 'media.publish' and dedupe_key = 'media.publish:' || $1",
        [listing.id],
      ),
    ).toBe("1");
  });

  it("DEC67 section 6.3 search_text is the normalized title and description; the text is kept as typed", async () => {
    const member = await newMember();
    const image = await readyImage(db, member.identity);
    const { listing } = await publish(
      db,
      member.identity,
      await listingInput([image], {
        title: "  آلة حاسبة ٣٥٠  ",
        description: "حالةٌ ممتازة\r\nمع الغطاء",
      }),
    );
    const row = (
      await dbPool().query<{ title: string; description: string; search_text: string }>(
        "select title, description, search_text from public.listing where id = $1",
        [listing.id],
      )
    ).rows[0];
    expect(row).toEqual({
      title: "آلة حاسبة ٣٥٠",
      description: "حالةٌ ممتازة\nمع الغطاء",
      search_text: await scalar<string>(dbPool(), "select app.search_normalize($1)", [
        "آلة حاسبة ٣٥٠ حالةٌ ممتازة\nمع الغطاء",
      ]),
    });
    expect(row?.search_text).toBe("اله حاسبه 350 حاله ممتازه مع الغطاء");
    expect(
      await scalar<string>(
        dbPool(),
        "select indexdef from pg_indexes where indexname = 'listing_search_trgm'",
      ),
    ).toContain("gin_trgm_ops");
  });
});

describe("TC08: the exact boundaries are accepted, overflow and extra precision are not", () => {
  it("TC08 a title of 100 characters is accepted and 101 is rejected", async () => {
    const member = await newMember();
    const [first, second] = await readyImages(db, member.identity, 2);
    const hundred = "ق".repeat(LISTING_TITLE_MAX);
    // Code points, not UTF-16 units: 100 emoji are 200 units and still 100 characters.
    const emoji = String.fromCodePoint(0x1f4da).repeat(LISTING_TITLE_MAX);
    expect(
      (
        await publishOutcome(
          db,
          member.identity,
          await listingInput([first ?? ""], { title: hundred }),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await publishOutcome(
          db,
          member.identity,
          await listingInput([second ?? ""], { title: emoji }),
        )
      ).status,
    ).toBe(201);
    const over = await publishOutcome(
      db,
      member.identity,
      await listingInput([spare], { title: `${hundred}ق` }),
    );
    expect(over).toMatchObject({
      status: 422,
      code: "VALIDATION_FAILED",
      fieldErrors: [{ field: "title", code: "too_big" }],
    });
    const short = await publishOutcome(
      db,
      member.identity,
      await listingInput([spare], { title: "قققق" }),
    );
    expect(short.fieldErrors).toEqual([{ field: "title", code: "too_small" }]);
  });

  it("TC08 a description of 10 and 2000 is accepted, 9 and 2001 are rejected", async () => {
    const member = await newMember();
    const [first, second] = await readyImages(db, member.identity, 2);
    for (const [description, image] of [
      ["و".repeat(LISTING_DESCRIPTION_MIN), first],
      ["و".repeat(LISTING_DESCRIPTION_MAX), second],
    ] as const) {
      expect(
        (
          await publishOutcome(
            db,
            member.identity,
            await listingInput([image ?? ""], { description }),
          )
        ).status,
      ).toBe(201);
    }
    for (const [description, code] of [
      ["و".repeat(LISTING_DESCRIPTION_MIN - 1), "too_small"],
      ["و".repeat(LISTING_DESCRIPTION_MAX + 1), "too_big"],
      ["   ", "required"],
    ] as const) {
      const refused = await publishOutcome(
        db,
        member.identity,
        await listingInput([spare], { description }),
      );
      expect(refused.fieldErrors).toEqual([{ field: "description", code }]);
    }
  });

  it("TC08 price 0 publishes a free listing that cannot be negotiable", async () => {
    const member = await newMember();
    const image = await readyImage(db, member.identity);
    const negotiable = await publishOutcome(
      db,
      member.identity,
      await listingInput([image], { price_minor: 0, is_negotiable: true }),
    );
    expect(negotiable).toMatchObject({
      status: 422,
      fieldErrors: [{ field: "is_negotiable", code: "not_allowed" }],
    });
    const free = await publish(
      db,
      member.identity,
      await listingInput([image], { price_minor: 0, is_negotiable: false }),
    );
    expect(free.listing).toMatchObject({ price_minor: 0, is_negotiable: false });
  });

  it("TC08 50,000 riyals are accepted, 5,000,001 halalas and a fraction of a halala are rejected", async () => {
    const member = await newMember();
    const image = await readyImage(db, member.identity);
    for (const [price, status, code] of [
      [LISTING_PRICE_MAX_MINOR + 1, 422, "too_big"],
      [-1, 422, "too_small"],
      [100.5, 400, "invalid_type"],
    ] as const) {
      const refused = await publishOutcome(
        db,
        member.identity,
        await listingInput([image], { price_minor: price }),
      );
      expect(refused.status).toBe(status);
      expect(refused.fieldErrors?.[0]).toMatchObject({ field: "price_minor", code });
    }
    const max = await publish(
      db,
      member.identity,
      await listingInput([image], { price_minor: LISTING_PRICE_MAX_MINOR }),
    );
    expect(max.listing.price_minor).toBe(LISTING_PRICE_MAX_MINOR);
  });

  it("TC08 the database checks every rule again, without the server's checks", async () => {
    const member = await newMember();
    const image = await readyImage(db, member.identity);
    const call = (input: Record<string, unknown>) =>
      db
        .withActor(member.identity.claims, trace(), async (tx) => {
          await tx.query("select listing_id from app.publish_listing($1, $2::jsonb)", [
            randomUUID(),
            JSON.stringify(input),
          ]);
          return "ok";
        })
        .catch((error: unknown) => error as { code?: string; fieldErrors?: unknown });
    const cases: [Record<string, unknown>, string, string][] = [
      [{ title: "ق".repeat(101) }, "title", "too_big"],
      [{ description: "قصير" }, "description", "too_small"],
      [{ price_minor: 5_000_001 }, "price_minor", "too_big"],
      [{ price_minor: 0, is_negotiable: true }, "is_negotiable", "not_allowed"],
      [{ condition: "broken" }, "condition", "invalid_value"],
      [{ category_id: randomUUID() }, "category_id", "unavailable"],
      [{ location_id: randomUUID() }, "location_id", "unavailable"],
      [{ media_ids: [image, image] }, "media_ids", "duplicate"],
    ];
    for (const [override, field, code] of cases) {
      const error = await call(await listingInput([image], override));
      expect(error).toMatchObject({ code: "VALIDATION_FAILED", fieldErrors: [{ field, code }] });
    }
    // Unknown fields and wrong types are the structure: BAD_REQUEST.
    expect(await call(await listingInput([image], { seller_id: b.id }))).toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await call(await listingInput([image], { price_minor: "350" }))).toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await listingCount(member.id)).toBe("0");
  });
});

describe("TC09 FR22 NFR09: one listing per logical request", () => {
  it("TC09 the same Idempotency-Key returns the same listing", async () => {
    const member = await newMember();
    const image = await readyImage(db, member.identity);
    const body = await listingInput([image]);
    const key = randomUUID();
    const first = await publishOutcome(db, member.identity, body, key);
    const again = await publishOutcome(db, member.identity, body, key);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    const id = (first.body as { data: { id: string } }).data.id;
    expect((again.body as { data: { id: string } }).data.id).toBe(id);
    expect(await listingCount(member.id)).toBe("1");
    // The retry costs nothing: one publication counted (RL05).
    expect(
      await scalar<string>(
        dbPool(),
        `select coalesce(sum(count), 0)::text from app.rate_limit_bucket
          where scope = 'RL05:hour' and key_hash = sha256(convert_to($1::text, 'UTF8'))`,
        [member.id],
      ),
    ).toBe("1");
  });

  it("TC09 two requests with the same key at once publish one listing", async () => {
    const member = await newMember();
    const image = await readyImage(db, member.identity);
    const body = await listingInput([image]);
    const key = randomUUID();
    const [one, two] = await Promise.all([
      publish(db, member.identity, body, key),
      publish(db, member.identity, body, key),
    ]);
    expect(one.listing.id).toBe(two.listing.id);
    expect([one.created, two.created].sort()).toEqual([false, true]);
    expect(await listingCount(member.id)).toBe("1");
  });

  it("TC09 a different payload with the same key is IDEMPOTENCY_CONFLICT", async () => {
    const member = await newMember();
    const image = await readyImage(db, member.identity);
    const key = randomUUID();
    await publish(db, member.identity, await listingInput([image]), key);
    const changed = await publishOutcome(
      db,
      member.identity,
      await listingInput([image], { title: "عنوان آخر للإعلان" }),
      key,
    );
    expect(changed).toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
    expect(await listingCount(member.id)).toBe("1");
  });

  it("TC09 a key reused after a validation failure publishes once", async () => {
    const member = await newMember();
    const image = await readyImage(db, member.identity);
    const key = randomUUID();
    const refused = await publishOutcome(
      db,
      member.identity,
      await listingInput([image], { category_id: randomUUID() }),
      key,
    );
    expect(refused.fieldErrors).toEqual([{ field: "category_id", code: "unavailable" }]);
    const corrected = await publishOutcome(db, member.identity, await listingInput([image]), key);
    expect(corrected.status).toBe(201);
    expect(await listingCount(member.id)).toBe("1");
  });

  it("BR32 API034 without a valid Idempotency-Key is BAD_REQUEST", async () => {
    const body = await listingInput([spare]);
    expect(await publishOutcome(db, a.identity, body, null)).toMatchObject({
      status: 400,
      fieldErrors: [{ field: "Idempotency-Key", code: "required" }],
    });
    expect(await publishOutcome(db, a.identity, body, "not-a-uuid")).toMatchObject({
      status: 400,
      fieldErrors: [{ field: "Idempotency-Key", code: "invalid_format" }],
    });
  });
});

describe("TC07 BR06: the images are checked on the server", () => {
  it("TC07 eleven images are rejected on the server", async () => {
    const eleven = Array.from({ length: LISTING_IMAGES_MAX + 1 }, () => randomUUID());
    expect(await publishOutcome(db, a.identity, await listingInput(eleven))).toMatchObject({
      status: 422,
      fieldErrors: [{ field: "media_ids", code: "too_big" }],
    });
    expect(await publishOutcome(db, a.identity, await listingInput([]))).toMatchObject({
      status: 422,
      fieldErrors: [{ field: "media_ids", code: "too_small" }],
    });
    expect(await publishOutcome(db, a.identity, await listingInput([spare, spare]))).toMatchObject({
      status: 422,
      fieldErrors: [{ field: "media_ids", code: "duplicate" }],
    });
  });

  it("TC07 an image that is not processed yet is MEDIA_NOT_READY", async () => {
    const member = await newMember();
    const ready = await readyImage(db, member.identity);
    const bytes = await png(400, 300);
    const { id } = await uploadImage(db, member.identity, bytes, "image/png", {
      width: 400,
      height: 300,
    });
    const refused = await publishOutcome(db, member.identity, await listingInput([ready, id]));
    expect(refused).toMatchObject({
      status: 422,
      code: "MEDIA_NOT_READY",
      fieldErrors: [{ field: "media_ids.1", code: "not_ready" }],
    });
    expect(await listingCount(member.id)).toBe("0");
  });

  it("TC07 another member's, an avatar, an attached, a rejected, an expired and an unknown image are MEDIA_INVALID", async () => {
    const member = await newMember();
    const ready = await readyImage(db, member.identity);
    const others = await readyImage(db, b.identity);
    const avatarBytes = await png(400, 300);
    const avatar = await uploadImage(db, member.identity, avatarBytes, "image/png", {
      purpose: "avatar",
      width: 400,
      height: 300,
    });
    assertRan(await runImageProcess(avatar.id));
    const attached = await readyImage(db, member.identity);
    await publish(db, member.identity, await listingInput([attached]));
    const rejected = await uploadImage(
      db,
      member.identity,
      Buffer.from("plain text, not an image"),
      "image/png",
    );
    assertRan(await runImageProcess(rejected.id));
    const expired = await readyImage(db, member.identity);
    await dbPool().query(
      "update public.media_asset set expires_at = app.app_now() - interval '1 second' where id = $1",
      [expired],
    );
    for (const bad of [others, avatar.id, attached, rejected.id, expired, randomUUID()]) {
      const refused = await publishOutcome(db, member.identity, await listingInput([ready, bad]));
      expect(refused).toMatchObject({
        status: 422,
        code: "MEDIA_INVALID",
        fieldErrors: [{ field: "media_ids.1", code: "invalid" }],
      });
    }
    expect(await listingCount(member.id)).toBe("1");
  });
});

describe("TC25 TC65: who may publish, and what the client may not decide", () => {
  it("TC25 a guest, an unconfirmed, an unacknowledged, a banned and a deletion-pending account cannot publish", async () => {
    const body = await listingInput([spare]);
    expect(await publishOutcome(db, null, body)).toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
    const cases: [string, string, string][] = [
      ["TERMS_NOT_ACKNOWLEDGED", "", ""],
      ["EMAIL_NOT_CONFIRMED", "update auth.users set email_confirmed_at = null where id = $1", ""],
      [
        "ACCOUNT_RESTRICTED",
        "update public.account_control set status = 'banned' where user_id = $1",
        "",
      ],
      [
        "DELETION_PENDING",
        "update public.account_control set deletion_requested_at = now() where user_id = $1",
        "",
      ],
    ];
    for (const [code, sql] of cases) {
      const member = await newMember();
      const image = await readyImage(db, member.identity);
      if (code === "TERMS_NOT_ACKNOWLEDGED") await withdrawAcknowledgments(member.id);
      else await changeMember(member.id, sql);
      const refused = await publishOutcome(db, member.identity, await listingInput([image]));
      expect(refused).toMatchObject({ status: 403, code });
      expect(await listingCount(member.id)).toBe("0");
    }
  });

  it("TC65 seller_id, status and badge fields are rejected and the seller comes from the session", async () => {
    for (const injected of [
      { seller_id: b.id },
      { status: "sold" },
      { seller_student_badge: true },
      { version: 7 },
    ]) {
      const refused = await publishOutcome(db, a.identity, await listingInput([spare], injected));
      expect(refused).toMatchObject({
        status: 400,
        code: "BAD_REQUEST",
        fieldErrors: [{ field: Object.keys(injected)[0], code: "unknown_field" }],
      });
    }
    const own = await readyImage(db, a.identity);
    const { listing } = await publish(db, a.identity, await listingInput([own]));
    expect(
      await scalar<string>(dbPool(), "select seller_id::text from public.listing where id = $1", [
        listing.id,
      ]),
    ).toBe(a.id);
  });
});

describe("RL05: publications per hour and day, and active listings", () => {
  it("RL05 the sixth publication in an hour is RATE_LIMITED", async () => {
    const member = await newMember();
    const image = await readyImage(db, member.identity);
    await dbPool().query(
      `insert into app.rate_limit_bucket (scope, key_hash, window_start, count, expires_at)
       values ('RL05:hour', sha256(convert_to($1::text, 'UTF8')),
               date_bin('1 hour', app.app_now(), '2000-01-01 00:00:00+00'), $2,
               date_bin('1 hour', app.app_now(), '2000-01-01 00:00:00+00') + interval '2 days')`,
      [member.id, RL05_PER_HOUR],
    );
    const refused = await publishOutcome(db, member.identity, await listingInput([image]));
    expect(refused).toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect(refused.retryAfter).toBeGreaterThan(0);
    expect(await listingCount(member.id)).toBe("0");
  });

  it("RL05 the twenty-first publication in a day is RATE_LIMITED", async () => {
    const member = await newMember();
    const image = await readyImage(db, member.identity);
    await dbPool().query(
      `insert into app.rate_limit_bucket (scope, key_hash, window_start, count, expires_at)
       values ('RL05:day', sha256(convert_to($1::text, 'UTF8')),
               date_bin('1 day', app.app_now(), '2000-01-01 00:00:00+00'), $2,
               date_bin('1 day', app.app_now(), '2000-01-01 00:00:00+00') + interval '2 days')`,
      [member.id, RL05_PER_DAY],
    );
    const refused = await publishOutcome(db, member.identity, await listingInput([image]));
    expect(refused).toMatchObject({ status: 429, code: "RATE_LIMITED" });
  });

  it("RL05 the 201st active listing is LIMIT_REACHED, and an archived one does not count", async () => {
    const member = await newMember();
    const image = await readyImage(db, member.identity);
    // 200 active listings with an image each, written directly (one transaction, BR06).
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
    const refused = await publishOutcome(db, member.identity, await listingInput([image]));
    expect(refused).toMatchObject({ status: 422, code: "LIMIT_REACHED" });
    await dbPool().query(
      `update public.listing
          set status = 'archived', previous_status = 'active', archive_reason = 'owner',
              archived_at = now()
        where id = (select id from public.listing where seller_id = $1 limit 1)`,
      [member.id],
    );
    expect((await publishOutcome(db, member.identity, await listingInput([image]))).status).toBe(
      201,
    );
    await resetRl05(member.id);
  });
});

describe("DEC28: the meeting point is optional", () => {
  it("DEC28 a suggested point is kept, an inactive one is unavailable", async () => {
    const member = await newMember();
    const [first] = await readyImages(db, member.identity, 1);
    // A fixture of seed.sql, deactivated for this test only (the files run one at a time, and
    // reference-data.test.ts checks that seed.sql's rows are the only ones).
    const key = "test_point_1";
    const point = await scalar<string>(
      dbPool(),
      "select id::text from public.meeting_point where key = $1",
      [key],
    );
    const label = await scalar<string>(
      dbPool(),
      "select label_ar from public.meeting_point where id = $1",
      [point],
    );
    try {
      const { listing } = await publish(
        db,
        member.identity,
        await listingInput([first ?? ""], { location_id: point }),
      );
      expect(listing.location).toMatchObject({ id: point, key, kind: "campus" });
      await dbPool().query("update public.meeting_point set is_active = false where id = $1", [
        point,
      ]);
      const refused = await publishOutcome(
        db,
        member.identity,
        await listingInput([spare], { location_id: point }),
      );
      expect(refused.fieldErrors).toEqual([{ field: "location_id", code: "unavailable" }]);
      // TC80: the listing that used it keeps its label.
      const kept = await db.withActor(member.identity.claims, trace(), (tx) =>
        readOwnerListing(tx, listing.id, inject("stack").apiUrl),
      );
      expect(kept?.location?.label_ar).toBe(label);
    } finally {
      await dbPool().query("update public.meeting_point set is_active = true where id = $1", [
        point,
      ]);
    }
  });

  it("owner note 1 on task 4.2: with no active meeting point, «حسب الاتفاق» publishes", async () => {
    const member = await newMember();
    const image = await readyImage(db, member.identity);
    const active = await dbPool().query<{ id: string }>(
      "update public.meeting_point set is_active = false where is_active returning id",
    );
    try {
      const points = await db.withActor(
        null,
        trace(),
        async (tx) => (await tx.query("select id from app.active_meeting_points()")).rows,
      );
      expect(points).toEqual([]);
      const { listing } = await publish(
        db,
        member.identity,
        await listingInput([image], { location_id: null }),
      );
      expect(listing.location).toBeNull();
    } finally {
      await dbPool().query(
        "update public.meeting_point set is_active = true where id = any($1::uuid[])",
        [active.rows.map((row) => row.id)],
      );
    }
  });
});

describe("BR06 DEC08: the constraints hold for any writer", () => {
  it("a listing without an image, an image in two listings and the text rules are refused by the database", async () => {
    await rolledBack(async (client) => {
      const category = await categoryId();
      const insert = (title: string, description: string) =>
        client.query(
          `insert into public.listing (seller_id, category_id, title, description, condition, price_minor, is_negotiable)
           values ($1, $2, $3, $4, 'good', 100, false) returning id`,
          [a.id, category, title, description],
        );
      for (const [title, description, constraint] of [
        [" عنوان بمسافة ", "وصف صحيح للإعلان", "listing_title_rules"],
        ["عنوان صحيح", "قصير", "listing_description_rules"],
        [`عنوان${String.fromCodePoint(0x202e)}مقلوب`, "وصف صحيح للإعلان", "listing_title_rules"],
      ] as const) {
        await client.query("savepoint s");
        const error = await insert(title, description).then(
          () => null,
          (caught: unknown) => caught as { constraint?: string },
        );
        await client.query("rollback to savepoint s");
        expect(error?.constraint).toBe(constraint);
      }
      await client.query("savepoint s");
      const free = await client
        .query(
          `insert into public.listing (seller_id, category_id, title, description, condition, price_minor, is_negotiable)
           values ($1, $2, 'عنوان صحيح', 'وصف صحيح للإعلان', 'good', 0, true)`,
          [a.id, category],
        )
        .then(
          () => null,
          (caught: unknown) => caught as { constraint?: string },
        );
      await client.query("rollback to savepoint s");
      expect(free?.constraint).toBe("listing_free_not_negotiable");
    });

    // No image at commit: the deferred check refuses the whole transaction.
    const client = await dbPool().connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into public.listing (seller_id, category_id, title, description, condition, price_minor, is_negotiable)
         values ($1, $2, 'عنوان صحيح', 'وصف صحيح للإعلان', 'good', 100, false)`,
        [a.id, await categoryId()],
      );
      const error = await client.query("commit").then(
        () => null,
        (caught: unknown) => caught as { constraint?: string },
      );
      expect(error?.constraint).toBe("listing_images_required");
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }

    // The same image in a second listing: listing_image_media_once.
    const member = await newMember();
    const image = await readyImage(db, member.identity);
    const { listing } = await publish(db, member.identity, await listingInput([image]));
    const second = await rolledBack(async (inner) => {
      const id = await scalar<string>(
        inner,
        `insert into public.listing (seller_id, category_id, title, description, condition, price_minor, is_negotiable)
         values ($1, $2, 'عنوان صحيح', 'وصف صحيح للإعلان', 'good', 100, false) returning id::text`,
        [member.id, await categoryId()],
      );
      return inner
        .query(
          "insert into public.listing_image (listing_id, media_id, position) values ($1, $2, 1)",
          [id, image],
        )
        .then(
          () => null,
          (caught: unknown) => caught as { constraint?: string },
        );
    });
    expect(second?.constraint).toBe("listing_image_media_once");
    expect(listing.images).toHaveLength(1);
  });
});

describe("DEC77: the seller's own reads", () => {
  async function asCaller(
    identity: Identity | null,
    sql: string,
    values: unknown[],
  ): Promise<unknown> {
    return db
      .withActor(
        identity?.claims ?? null,
        trace(),
        async (tx) => (await tx.query(sql, values)).rows,
      )
      .catch((error: unknown) => (error as { code?: string }).code);
  }

  it("DEC77 app.owner_listing(): another member's session reads no row of a listing it does not own", async () => {
    const { listing } = await publish(
      db,
      a.identity,
      await listingInput([await readyImage(db, a.identity)]),
    );
    const sql = "select listing_id, title from app.owner_listing($1)";
    expect(await asCaller(b.identity, sql, [listing.id])).toEqual([]);
    expect(await asCaller(a.identity, sql, [listing.id])).toEqual([
      { listing_id: listing.id, title: listing.title },
    ]);
  });

  it("DEC77 app.owner_listing(): a guest is UNAUTHENTICATED", async () => {
    expect(
      await asCaller(null, "select listing_id from app.owner_listing($1)", [randomUUID()]),
    ).toBe("UNAUTHENTICATED");
  });

  it("DEC77 app.owner_listing_images(): another member's session reads no image of a listing it does not own", async () => {
    const image = await readyImage(db, a.identity);
    const { listing } = await publish(db, a.identity, await listingInput([image]));
    const sql = "select media_id, image_position, public_ready from app.owner_listing_images($1)";
    expect(await asCaller(b.identity, sql, [listing.id])).toEqual([]);
    expect(await asCaller(a.identity, sql, [listing.id])).toEqual([
      { media_id: image, image_position: 1, public_ready: false },
    ]);
  });

  it("DEC77 app.owner_listing_images(): a guest is UNAUTHENTICATED", async () => {
    expect(
      await asCaller(null, "select media_id from app.owner_listing_images($1)", [randomUUID()]),
    ).toBe("UNAUTHENTICATED");
  });
});
