// Task 4.2 (plan/task-4.2.md, item 6): media.publish, the public copies of a published listing's
// images, with the worker's real handler and the real local Storage. SEC08, DEC08, DEC71, DEC77.
// Needs `pnpm db:start` (with Storage) and applied migrations; run with `pnpm test:integration`.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import { readOwnerListing } from "../../apps/web/lib/listings/owner.ts";
import type { StorageFactory } from "../../apps/worker/src/jobs/image.process.ts";
import { closeDb, dbPool, scalar } from "./_harness/db.ts";
import {
  listingInput,
  publicUrl,
  publish,
  readyImages,
  resetRl05,
  runMediaPublish,
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
    await dbPool().query("update public.listing set status = 'archived' where id = $1", [
      listing.id,
    ]);
    const run = await runMediaPublish(listing.id);
    assertRan(run);
    expect(run.result).toEqual({ copied: 0 });
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
    expect(run.result).toEqual({ copied: 0 });
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
