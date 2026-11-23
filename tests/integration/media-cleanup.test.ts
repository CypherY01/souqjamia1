// Task 4.1 (plan/task-4.1.md): media.cleanup with the real worker code, the worker's role and the
// real Storage. RET01, DEC71, DEC83. Times are moved back on the rows themselves (as postgres),
// since the cleanup and Storage both use the real clock.
// Needs `pnpm db:start` (with Storage) and applied migrations; run with `pnpm test:integration`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { privateObjectKey } from "@souq/domain";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import { deleteUpload } from "../../apps/web/lib/media/uploads.ts";
import { SCHEDULE } from "../../apps/worker/src/scheduler.ts";
import { png } from "../fixtures/images/index.ts";
import { closeDb, dbPool } from "./_harness/db.ts";
import { memberIdentity } from "./_harness/sessions.ts";
import {
  assertRan,
  assetRow,
  authorize,
  objectExists,
  putBytes,
  runImageProcess,
  runMediaCleanup,
  uploadContext,
  uploadImage,
} from "./_harness/storage.ts";
import { signUpMember } from "./_harness/users.ts";
import { webDb } from "./_harness/web.ts";

const db = webDb();
let identity: Identity;
let image: Buffer;

beforeAll(async () => {
  const member = await signUpMember();
  identity = (await memberIdentity(member)).identity;
  image = await png();
});

afterAll(async () => {
  await db.end();
  await closeDb();
});

async function ready(): Promise<string> {
  const { id } = await uploadImage(db, identity, image, "image/png", { width: 40, height: 30 });
  const run = await runImageProcess(id);
  assertRan(run);
  return id;
}

/** Moves the image's creation (and so its upload token) back by `interval`. */
async function age(id: string, interval: string): Promise<void> {
  await dbPool().query(
    "update public.media_asset set created_at = created_at - $2::interval where id = $1",
    [id, interval],
  );
}

async function privateFiles(id: string): Promise<boolean[]> {
  return Promise.all(
    (["master", "w150", "w600", "w1200"] as const).map((variant) =>
      objectExists("media-private", privateObjectKey(id, variant)),
    ),
  );
}

describe("RET01: media.cleanup", () => {
  it("item 12: media.cleanup runs every hour", () => {
    expect(SCHEDULE).toContainEqual({ kind: "media.cleanup", every: "1 hour" });
  });

  it("RET01 a pending upload past its five minutes is deleted, and its late raw file removed", async () => {
    const authorization = await authorize(db, identity, {
      bytes: image.length,
      mime: "image/png",
      width: 40,
      height: 30,
    });
    await putBytes(authorization.signed_url, image, "image/png");
    const id = authorization.upload_id;
    await dbPool().query(
      "update public.media_asset set upload_expires_at = now() - interval '1 minute' where id = $1",
      [id],
    );
    await runMediaCleanup();
    const row = await assetRow(id);
    expect(row).toMatchObject({ status: "deleted", raw_removed_at: null });
    // DEC83: the raw file stays until the token can no longer create it again.
    expect(await objectExists("quarantine", String(row?.quarantine_key))).toBe(true);
    await age(id, "2 hours 6 minutes");
    await runMediaCleanup();
    expect(await objectExists("quarantine", String(row?.quarantine_key))).toBe(false);
    expect((await assetRow(id))?.raw_removed_at).not.toBeNull();
  });

  it("DEC83 the raw upload stays while the token can still create it", async () => {
    const id = await ready();
    await age(id, "1 hour");
    await runMediaCleanup();
    const row = await assetRow(id);
    expect(row).toMatchObject({ status: "ready", raw_removed_at: null });
    expect(await objectExists("quarantine", String(row?.quarantine_key))).toBe(true);
  });

  it("RET01 the raw upload leaves the quarantine after the token's lifetime, the image stays", async () => {
    const id = await ready();
    await age(id, "2 hours 6 minutes");
    await runMediaCleanup();
    const row = await assetRow(id);
    expect(row).toMatchObject({ status: "ready" });
    expect(row?.raw_removed_at).not.toBeNull();
    expect(await objectExists("quarantine", String(row?.quarantine_key))).toBe(false);
    expect(await privateFiles(id)).toEqual([true, true, true, true]);
  });

  it("RET01 an unattached image is deleted after 24 hours, with its files", async () => {
    const id = await ready();
    await dbPool().query(
      `update public.media_asset
          set created_at = now() - interval '25 hours', expires_at = now() - interval '1 hour'
        where id = $1`,
      [id],
    );
    await runMediaCleanup();
    const row = await assetRow(id);
    expect(row).toMatchObject({ status: "deleted" });
    expect(row?.purged_at).not.toBeNull();
    expect(row?.raw_removed_at).not.toBeNull();
    expect(await privateFiles(id)).toEqual([false, false, false, false]);
    expect(await objectExists("quarantine", String(row?.quarantine_key))).toBe(false);
    const live = await dbPool().query(
      "select count(*)::int as n from public.media_derivative where media_id = $1 and deleted_at is null",
      [id],
    );
    expect(live.rows[0]).toEqual({ n: 0 });
  });

  it("RET01 the files of an upload its owner deleted are removed", async () => {
    const id = await ready();
    await deleteUpload(id, uploadContext(db, identity));
    expect(await privateFiles(id)).toEqual([true, true, true, true]);
    await runMediaCleanup();
    expect(await privateFiles(id)).toEqual([false, false, false, false]);
    expect((await assetRow(id))?.purged_at).not.toBeNull();
  });

  it("DEC71 a second cleanup run changes nothing more", async () => {
    const id = await ready();
    await deleteUpload(id, uploadContext(db, identity));
    await age(id, "2 hours 6 minutes");
    await runMediaCleanup();
    const first = await assetRow(id);
    await runMediaCleanup();
    expect(await assetRow(id)).toEqual(first);
  });

  it("RET01 an image stuck in processing for 24 hours is deleted", async () => {
    const { id } = await uploadImage(db, identity, image, "image/png", { width: 40, height: 30 });
    await dbPool().query(
      `update public.media_asset
          set status = 'processing', created_at = now() - interval '25 hours',
              expires_at = now() - interval '1 hour'
        where id = $1`,
      [id],
    );
    await runMediaCleanup();
    expect(await assetRow(id)).toMatchObject({ status: "deleted" });
    expect((await assetRow(id))?.purged_at).not.toBeNull();
  });
});
