// Task 4.2 (plan/task-4.2.md, item 6): media.publish, the public copies of a published listing's
// images, with the worker's real handler and the real local Storage. SEC08, DEC08, DEC71, DEC77.
// Task 4.4 (item 1): the same job keeps the copies in step with archive, restore and image edits.
// Needs `pnpm db:start` (with Storage) and applied migrations; run with `pnpm test:integration`.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import { readOwnerListing } from "../../apps/web/lib/listings/owner.ts";
import type { StorageFactory } from "../../apps/worker/src/jobs/image.process.ts";
import { closeDb, dbPool, scalar } from "./_harness/db.ts";
import {
  editOutcome,
  listingInput,
  publicUrl,
  publish,
  readyImages,
  resetDec85,
  resetRl05,
  runMediaPublish,
  transitionOutcome,
} from "./_harness/listings.ts";
import { memberIdentity } from "./_harness/sessions.ts";
import { assertRan, objectExists, realStorage, trace } from "./_harness/storage.ts";
import { signUpMember } from "./_harness/users.ts";
import { webDb } from "./_harness/web.ts";
import { workerPool } from "./_harness/worker.ts";

const db = webDb();
const VARIANTS = ["w150", "w600", "w1200"] as const;

let member: { id: string; identity: Identity };

beforeAll(async () => {
  const signedUp = await signUpMember();
  member = { id: signedUp.id, identity: (await memberIdentity(signedUp)).identity };
});

// RL05 counts every publication; this file publishes more than five.
beforeEach(async () => {
  await resetRl05(member.id);
  await resetDec85(member.id);
});

afterAll(async () => {
  await db.end();
  await closeDb();
});

function publicRows(mediaIds: readonly string[]): Promise<string> {
  return scalar<string>(
    dbPool(),
    `select count(*)::text from public.media_derivative
      where media_id = any($1::uuid[]) and visibility = 'public' and deleted_at is null`,
    [mediaIds],
  );
}

async function publicFiles(mediaIds: readonly string[]): Promise<boolean[]> {
  const found: boolean[] = [];
  for (const id of mediaIds) {
    for (const variant of [...VARIANTS, "master"]) {
      found.push(await objectExists("media-public", `${id}/${variant}.webp`));
    }
  }
  return found;
}

async function ownerView(listingId: string) {
  return db.withActor(member.identity.claims, trace(), (tx) =>
    readOwnerListing(tx, listingId, inject("stack").apiUrl),
  );
}

describe("SEC08: listing variants become public after the publication only", () => {
  it("SEC08 media.publish copies the three variants of each image to media-public, never the master", async () => {
    const images = await readyImages(db, member.identity, 2);
    const { listing } = await publish(db, member.identity, await listingInput(images));
    // Before the job: nothing public, and the answer has no image (owner note 2).
    expect(await publicFiles(images)).toEqual(Array(8).fill(false));
    expect(listing.primary_image).toBeNull();

    const run = await runMediaPublish(listing.id);
    assertRan(run);
    expect(run.result).toEqual({ copied: 6, removed: 0 });
    expect(await publicFiles(images)).toEqual([true, true, true, false, true, true, true, false]);
    expect(await publicRows(images)).toBe("6");

    const response = await fetch(publicUrl(images[0] ?? "", "w600"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toContain("max-age=3600");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const view = await ownerView(listing.id);
    expect(view?.primary_image).toEqual({
      w150: publicUrl(images[0] ?? "", "w150"),
      w600: publicUrl(images[0] ?? "", "w600"),
      w1200: publicUrl(images[0] ?? "", "w1200"),
    });
    expect(view?.images.map((image) => image.image?.w600)).toEqual([
      publicUrl(images[0] ?? "", "w600"),
      publicUrl(images[1] ?? "", "w600"),
    ]);
  });

  it("DEC71 media.publish twice leaves one set of public copies", async () => {
    const images = await readyImages(db, member.identity, 1);
    const { listing } = await publish(db, member.identity, await listingInput(images));
    assertRan(await runMediaPublish(listing.id));
    const again = await runMediaPublish(listing.id);
    assertRan(again);
    expect(again.result).toEqual({ copied: 3, removed: 0 });
    expect(await publicRows(images)).toBe("3");
    expect(await publicFiles(images)).toEqual([true, true, true, false]);
  });

  it("SEC08 a listing that is no longer active gets no public file", async () => {
    const images = await readyImages(db, member.identity, 1);
    const { listing } = await publish(db, member.identity, await listingInput(images));
    await dbPool().query(
      `update public.listing
          set status = 'archived', previous_status = 'active', archive_reason = 'owner',
              archived_at = now()
        where id = $1`,
      [listing.id],
    );
    const run = await runMediaPublish(listing.id);
    assertRan(run);
    // Task 4.4: the sync removes the fixed public keys of an image no longer eligible (none exist).
    expect(run.result).toEqual({ copied: 0, removed: 3 });
    expect(await publicFiles(images)).toEqual([false, false, false, false]);
    expect(await publicRows(images)).toBe("0");
  });

  it("SEC08 a listing hidden while its copies were made keeps no public file", async () => {
    const images = await readyImages(db, member.identity, 1);
    const { listing } = await publish(db, member.identity, await listingInput(images));
    let hidden = false;
    // The real Storage, and the listing hidden by moderation right after the first copy.
    const hidingStorage: StorageFactory = (signal) => {
      const real = realStorage(signal);
      return {
        ...real,
        async copy(from, key, to, toKey) {
          await real.copy(from, key, to, toKey);
          if (!hidden) {
            hidden = true;
            await dbPool().query(
              "update public.listing set moderation_hidden_at = now() where id = $1",
              [listing.id],
            );
          }
        },
      };
    };
    const run = await runMediaPublish(listing.id, hidingStorage);
    assertRan(run);
    expect(run.result).toEqual({ copied: 3, removed: 3 });
    expect(await publicFiles(images)).toEqual([false, false, false, false]);
    expect(await publicRows(images)).toBe("0");
  });

  it("DEC71 a listing that does not exist is nothing to do", async () => {
    const run = await runMediaPublish(randomUUID());
    assertRan(run);
    expect(run.result).toEqual({ copied: 0, removed: 0 });
  });
});

describe("DEC77: app.media_publish_files()", () => {
  async function asWorker(claims: object | null, listingId: string): Promise<string[]> {
    const pool = workerPool();
    const client = await pool.connect();
    try {
      await client.query("begin");
      if (claims !== null) {
        await client.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify(claims),
        ]);
      }
      const result = await client.query<{ object_key: string }>(
        "select object_key from app.media_publish_files($1)",
        [listingId],
      );
      await client.query("rollback");
      return result.rows.map((row) => row.object_key);
    } finally {
      client.release();
      await pool.end();
    }
  }

  it("DEC77 app.media_publish_files(): a member's identity changes nothing", async () => {
    const images = await readyImages(db, member.identity, 1);
    const { listing } = await publish(db, member.identity, await listingInput(images));
    const other = await signUpMember();
    const { identity } = await memberIdentity(other);
    expect(await asWorker(identity.claims, listing.id)).toEqual(await asWorker(null, listing.id));
  });

  it("DEC77 app.media_publish_files(): a guest reads the files of an active listing only", async () => {
    const images = await readyImages(db, member.identity, 1);
    const { listing } = await publish(db, member.identity, await listingInput(images));
    const id = images[0] ?? "";
    expect((await asWorker(null, listing.id)).sort()).toEqual(
      [`${id}/w1200.webp`, `${id}/w150.webp`, `${id}/w600.webp`].sort(),
    );
    expect(await asWorker(null, randomUUID())).toEqual([]);
    // Only the worker role may call it.
    const refused = await db
      .withActor(null, trace(), async (tx) => {
        await tx.query("select object_key from app.media_publish_files($1)", [listing.id]);
        return "ok";
      })
      .catch(() => "refused");
    expect(refused).toBe("refused");
  });
});

describe("SEC08 task 4.4: the public copies follow the listing's state", () => {
  async function published(count: number) {
    const images = await readyImages(db, member.identity, count);
    const { listing } = await publish(db, member.identity, await listingInput(images));
    assertRan(await runMediaPublish(listing.id));
    return { id: listing.id, images };
  }

  async function move(id: string, action: string, version: number) {
    const result = await transitionOutcome(db, member.identity, id, {
      action,
      expected_version: version,
    });
    expect(result.status).toBe(200);
  }

  it("SEC08 archiving removes the public files and rows, and restoring brings them back", async () => {
    const { id, images } = await published(1);
    await move(id, "archive", 1);
    const archived = await runMediaPublish(id);
    assertRan(archived);
    expect(archived.result).toEqual({ copied: 0, removed: 3 });
    expect(await publicFiles(images)).toEqual([false, false, false, false]);
    expect(await publicRows(images)).toBe("0");

    await move(id, "restore", 2);
    const restored = await runMediaPublish(id);
    assertRan(restored);
    expect(restored.result).toEqual({ copied: 3, removed: 0 });
    expect(await publicFiles(images)).toEqual([true, true, true, false]);
    expect(await publicRows(images)).toBe("3");
    expect((await ownerView(id))?.primary_image?.w600).toBe(publicUrl(images[0] ?? "", "w600"));
  });

  it("DEC84 a sold listing keeps its public files, and archiving it removes them", async () => {
    const { id, images } = await published(1);
    await move(id, "mark_sold", 1);
    assertRan(await runMediaPublish(id));
    expect(await publicFiles(images)).toEqual([true, true, true, false]);
    await move(id, "archive", 2);
    assertRan(await runMediaPublish(id));
    expect(await publicFiles(images)).toEqual([false, false, false, false]);
  });

  it("SEC08 an edit copies the added image and removes the detached one", async () => {
    const { id, images } = await published(2);
    const [added] = await readyImages(db, member.identity, 1);
    const edited = await editOutcome(db, member.identity, id, {
      media_ids: [added, images[0]],
      expected_version: 1,
    });
    expect(edited.status).toBe(200);
    assertRan(await runMediaPublish(id, realStorage, [images[1] ?? ""]));
    expect(await publicFiles([added ?? ""])).toEqual([true, true, true, false]);
    expect(await publicFiles([images[1] ?? ""])).toEqual([false, false, false, false]);
    expect(await publicRows([images[1] ?? ""])).toBe("0");
    expect(await publicRows([added ?? "", images[0] ?? ""])).toBe("6");
  });

  it("DEC71 two syncs in the reverse order end with the current state", async () => {
    const { id, images } = await published(1);
    await move(id, "archive", 1);
    await move(id, "restore", 2);
    // The restore's job runs first, then the archive's late job: the listing is active.
    assertRan(await runMediaPublish(id));
    assertRan(await runMediaPublish(id));
    expect(await publicFiles(images)).toEqual([true, true, true, false]);
    expect(await publicRows(images)).toBe("3");
  });

  it("DEC71 a detached image attached to another listing meanwhile keeps its public files", async () => {
    const first = await published(2);
    const moved = first.images[1] ?? "";
    const edited = await editOutcome(db, member.identity, first.id, {
      media_ids: [first.images[0]],
      expected_version: 1,
    });
    expect(edited.status).toBe(200);
    const [own] = await readyImages(db, member.identity, 1);
    const { listing: second } = await publish(
      db,
      member.identity,
      await listingInput([own ?? "", moved]),
    );
    assertRan(await runMediaPublish(second.id));
    // The first listing's late sync must not remove the image the second one now shows.
    assertRan(await runMediaPublish(first.id, realStorage, [moved]));
    expect(await publicFiles([moved])).toEqual([true, true, true, false]);
    expect(await publicRows([moved])).toBe("3");
  });
});

describe("DEC77: app.media_unpublish_files()", () => {
  async function asWorker(claims: object | null, listingId: string): Promise<string[]> {
    const pool = workerPool();
    const client = await pool.connect();
    try {
      await client.query("begin");
      if (claims !== null) {
        await client.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify(claims),
        ]);
      }
      const result = await client.query<{ object_key: string }>(
        "select object_key from app.media_unpublish_files($1, '{}'::uuid[])",
        [listingId],
      );
      await client.query("rollback");
      return result.rows.map((row) => row.object_key);
    } finally {
      client.release();
      await pool.end();
    }
  }

  it("DEC77 app.media_unpublish_files(): a member's identity changes nothing", async () => {
    const images = await readyImages(db, member.identity, 1);
    const { listing } = await publish(db, member.identity, await listingInput(images));
    await transitionOutcome(db, member.identity, listing.id, {
      action: "archive",
      expected_version: 1,
    });
    const other = await signUpMember();
    const { identity } = await memberIdentity(other);
    expect(await asWorker(identity.claims, listing.id)).toEqual(await asWorker(null, listing.id));
  });

  it("DEC77 app.media_unpublish_files(): a guest reads the keys of images no longer eligible only", async () => {
    const images = await readyImages(db, member.identity, 1);
    const { listing } = await publish(db, member.identity, await listingInput(images));
    const id = images[0] ?? "";
    expect(await asWorker(null, listing.id)).toEqual([]);
    await transitionOutcome(db, member.identity, listing.id, {
      action: "archive",
      expected_version: 1,
    });
    expect((await asWorker(null, listing.id)).sort()).toEqual(
      [`${id}/w1200.webp`, `${id}/w150.webp`, `${id}/w600.webp`].sort(),
    );
    expect(await asWorker(null, randomUUID())).toEqual([]);
    const refused = await db
      .withActor(null, trace(), async (tx) => {
        await tx.query("select object_key from app.media_unpublish_files($1, '{}'::uuid[])", [
          listing.id,
        ]);
        return "ok";
      })
      .catch(() => "refused");
    expect(refused).toBe("refused");
  });
});
