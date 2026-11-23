// Task 4.1 (plan/task-4.1.md): image.process with the real worker code, the real Storage and the
// worker's role. FR61, FR80, DEC08, DEC45, DEC71, DEC83, SEC08, TC07, TC32.
// Each test uploads through the real server code (API037, API038) and runs the job on demand.
// Needs `pnpm db:start` (with Storage) and applied migrations; run with `pnpm test:integration`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRIVATE_LINK_SECONDS, privateObjectKey } from "@souq/domain";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import { deleteUpload, getUpload } from "../../apps/web/lib/media/uploads.ts";
import {
  animatedWebp,
  apng,
  gif,
  heicHeader,
  jpegWithGps,
  largeJpeg,
  metadataOf,
  png,
  svg,
  textAsImage,
  tooManyPixels,
  truncatedJpeg,
  webp,
} from "../fixtures/images/index.ts";
import { closeDb, dbPool } from "./_harness/db.ts";
import { memberIdentity } from "./_harness/sessions.ts";
import {
  assertRan,
  assetRow,
  downloadPrivate,
  failingStorage,
  objectExists,
  runImageProcess,
  uploadContext,
  uploadFailsStorage,
  uploadImage,
} from "./_harness/storage.ts";
import { signUpMember } from "./_harness/users.ts";
import { webDb } from "./_harness/web.ts";

const db = webDb();
let identity: Identity;

beforeAll(async () => {
  const member = await signUpMember();
  identity = (await memberIdentity(member)).identity;
});

afterAll(async () => {
  await db.end();
  await closeDb();
});

interface DerivativeRow {
  variant: string;
  visibility: string;
  bucket: string;
  object_key: string;
  width: number;
  height: number;
  deleted_at: Date | null;
}

async function derivatives(id: string): Promise<DerivativeRow[]> {
  const result = await dbPool().query<DerivativeRow>(
    `select variant::text, visibility::text, bucket, object_key, width, height, deleted_at
       from public.media_derivative where media_id = $1 order by media_derivative.variant`,
    [id],
  );
  return result.rows;
}

/** Uploads `bytes` declared as `mime`, runs the job once, and returns the image's state. */
async function processed(
  bytes: Buffer,
  mime: string,
  declared: {
    width?: number;
    height?: number;
    purpose?: "listing" | "avatar" | "student_card";
  } = {},
) {
  const { id } = await uploadImage(db, identity, bytes, mime, declared);
  const run = await runImageProcess(id);
  assertRan(run);
  return { id, run, row: await assetRow(id) };
}

async function expectRejected(bytes: Buffer, mime: string, reason: string, declared = {}) {
  const { id, row } = await processed(bytes, mime, declared);
  expect(row).toMatchObject({ status: "rejected", rejection_reason: reason });
  expect(await derivatives(id)).toEqual([]);
  for (const variant of ["master", "w150", "w600", "w1200"] as const) {
    expect(await objectExists("media-private", privateObjectKey(id, variant))).toBe(false);
  }
  const upload = await getUpload(id, uploadContext(db, identity));
  expect(upload).toMatchObject({ status: "rejected", rejection_reason: reason, preview: null });
}

describe("FR61, DEC08: a valid image becomes ready with its private derivatives", () => {
  it("DEC08 a large image gets a master and the 150, 600 and 1200 variants, all private WebP", async () => {
    const { id, row } = await processed(await largeJpeg(), "image/jpeg", {
      width: 1600,
      height: 900,
    });
    expect(row).toMatchObject({ status: "ready", rejection_reason: null });
    const rows = await derivatives(id);
    expect(rows.map((r) => [r.variant, r.width, r.height])).toEqual([
      ["master", 1600, 900],
      ["w150", 150, 84],
      ["w600", 600, 338],
      ["w1200", 1200, 675],
    ]);
    for (const r of rows) {
      expect(r).toMatchObject({ visibility: "private", bucket: "media-private", deleted_at: null });
      expect(r.object_key).toBe(privateObjectKey(id, r.variant as "master"));
      const data = await downloadPrivate(r.object_key);
      expect(data).not.toBeNull();
      expect((await metadataOf(data ?? Buffer.alloc(0))).format).toBe("webp");
    }
    expect(await objectExists("media-public", privateObjectKey(id, "w600"))).toBe(false);
  });

  it("DEC08 a small image is never enlarged", async () => {
    const { id } = await processed(await png(40, 30), "image/png", { width: 40, height: 30 });
    const rows = await derivatives(id);
    expect(rows.map((r) => [r.variant, r.width, r.height])).toEqual([
      ["master", 40, 30],
      ["w150", 40, 30],
      ["w600", 40, 30],
      ["w1200", 40, 30],
    ]);
  });

  it("FR17 WebP input is accepted", async () => {
    const { row } = await processed(await webp(), "image/webp", { width: 40, height: 30 });
    expect(row).toMatchObject({ status: "ready" });
  });

  it("BR26 API039 gives the owner a preview link of 60 seconds at most once ready", async () => {
    const { id } = await processed(await png(), "image/png", { width: 40, height: 30 });
    const before = Date.now();
    const upload = await getUpload(id, uploadContext(db, identity));
    expect(upload.status).toBe("ready");
    expect(upload.preview).not.toBeNull();
    const expiresIn = new Date(upload.preview?.expires_at ?? 0).getTime() - before;
    expect(expiresIn).toBeLessThanOrEqual(PRIVATE_LINK_SECONDS * 1000 + 1000);
    const response = await fetch(upload.preview?.url ?? "");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/webp");
    const token = new URL(upload.preview?.url ?? "").searchParams.get("token") ?? "";
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { iat: number; exp: number; url: string };
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(PRIVATE_LINK_SECONDS);
    expect(payload.url).toBe(`media-private/${privateObjectKey(id, "w600")}`);
  });

  it("DEC45 a student card keeps one private master and no variants, and no preview (DEC83)", async () => {
    const { id, row } = await processed(await largeJpeg(), "image/jpeg", {
      purpose: "student_card",
      width: 1600,
      height: 900,
    });
    expect(row).toMatchObject({ status: "ready" });
    expect((await derivatives(id)).map((r) => [r.variant, r.visibility])).toEqual([
      ["master", "private"],
    ]);
    expect(await objectExists("media-private", privateObjectKey(id, "w600"))).toBe(false);
    const upload = await getUpload(id, uploadContext(db, identity));
    expect(upload).toMatchObject({ purpose: "student_card", status: "ready", preview: null });
  });

  it("DEC54 an avatar gets the same variants as a listing image", async () => {
    const { id } = await processed(await largeJpeg(), "image/jpeg", {
      purpose: "avatar",
      width: 1600,
      height: 900,
    });
    expect((await derivatives(id)).map((r) => r.variant)).toEqual([
      "master",
      "w150",
      "w600",
      "w1200",
    ]);
  });
});

describe("TC32: metadata is removed and orientation applied", () => {
  it("TC32 EXIF and GPS are removed from every derivative", async () => {
    const input = await jpegWithGps();
    const inputMeta = await metadataOf(input);
    // The input carries EXIF with the GPS IFD pointer (tag 0x8825) and a camera name.
    const exif = inputMeta.exif ?? Buffer.alloc(0);
    expect(
      exif.includes(Buffer.from([0x25, 0x88])) || exif.includes(Buffer.from([0x88, 0x25])),
    ).toBe(true);
    expect(input.includes(Buffer.from("TestCamera"))).toBe(true);
    expect(inputMeta.orientation).toBe(6);
    const { id, row } = await processed(input, "image/jpeg", { width: 64, height: 32 });
    expect(row).toMatchObject({ status: "ready" });
    for (const r of await derivatives(id)) {
      const data = (await downloadPrivate(r.object_key)) ?? Buffer.alloc(0);
      const meta = await metadataOf(data);
      expect(meta).toMatchObject({
        exif: undefined,
        icc: undefined,
        xmp: undefined,
        iptc: undefined,
      });
      expect(data.includes(Buffer.from("Exif"))).toBe(false);
      expect(data.includes(Buffer.from("TestCamera"))).toBe(false);
    }
  });

  it("TC32 orientation is applied before metadata is stripped", async () => {
    const { id } = await processed(await jpegWithGps(64, 32), "image/jpeg", {
      width: 64,
      height: 32,
    });
    const master = (await derivatives(id)).find((r) => r.variant === "master");
    // Orientation 6 turns the 64 x 32 pixels a quarter turn: the image as seen is 32 x 64.
    expect([master?.width, master?.height]).toEqual([32, 64]);
    const meta = await metadataOf(
      (await downloadPrivate(master?.object_key ?? "")) ?? Buffer.alloc(0),
    );
    expect(meta.orientation).toBeUndefined();
  });
});

describe("TC32, TC07: bad inputs are rejected on the server with a safe reason", () => {
  it("TC32 forged image bytes are rejected as an unsupported type", async () => {
    await expectRejected(textAsImage(), "image/jpeg", "unsupported_type");
  });

  it("TC07 a forged media type is rejected on the server", async () => {
    // Real PNG bytes declared as JPEG (DEC83: the real type must equal the declared one).
    await expectRejected(await png(), "image/jpeg", "unsupported_type");
  });

  it("TC07 a corrupt image is rejected on the server", async () => {
    await expectRejected(await truncatedJpeg(), "image/jpeg", "corrupt");
  });

  it("TC32 an image over 24 megapixels is rejected", async () => {
    // The client lies about the size; the worker reads the real header.
    await expectRejected(await tooManyPixels(), "image/png", "too_many_pixels", {
      width: 100,
      height: 100,
    });
  });

  it("TC32 animated WebP and APNG are rejected", async () => {
    await expectRejected(await animatedWebp(), "image/webp", "animated");
    await expectRejected(await apng(), "image/png", "animated");
  });

  it("TC32 GIF, SVG and HEIC are rejected", async () => {
    // The bucket refuses these types by header, so a client would have to lie about them.
    await expectRejected(await gif(), "image/png", "unsupported_type");
    await expectRejected(svg(), "image/png", "unsupported_type");
    await expectRejected(heicHeader(), "image/jpeg", "unsupported_type");
  });
});

describe("TC32, DEC83, DEC71: worker failures and repeated jobs", () => {
  it("TC32 a worker failure never leaves an unready image with derivatives", async () => {
    const { id } = await uploadImage(db, identity, await png(), "image/png", {
      width: 40,
      height: 30,
    });
    const run = await runImageProcess(id, { attempt: 1, storage: uploadFailsStorage });
    expect(run.error).toBeDefined();
    expect(await assetRow(id)).toMatchObject({ status: "processing", rejection_reason: null });
    expect(await derivatives(id)).toEqual([]);
    const upload = await getUpload(id, uploadContext(db, identity));
    expect(upload).toMatchObject({ status: "processing", preview: null });
    // The retry (attempt 2) with Storage back completes the image.
    const retry = await runImageProcess(id, { attempt: 2 });
    expect(retry.error).toBeUndefined();
    expect(await assetRow(id)).toMatchObject({ status: "ready" });
  });

  it("TC32 a third failed attempt ends as processing_failed", async () => {
    const { id } = await uploadImage(db, identity, await png(), "image/png", {
      width: 40,
      height: 30,
    });
    expect(
      (await runImageProcess(id, { attempt: 2, storage: failingStorage })).error,
    ).toBeDefined();
    const third = await runImageProcess(id, { attempt: 3, storage: failingStorage });
    expect(third.error).toBeUndefined();
    expect(third.result).toEqual({ rejected: 1 });
    expect(await assetRow(id)).toMatchObject({
      status: "rejected",
      rejection_reason: "processing_failed",
    });
    expect(third.lines.map((line) => line.event)).toContain("image.failed");
  });

  it("DEC83 an attempt after the third ends the image at once", async () => {
    const { id } = await uploadImage(db, identity, await png(), "image/png", {
      width: 40,
      height: 30,
    });
    const late = await runImageProcess(id, { attempt: 4 });
    expect(late.result).toEqual({ rejected: 1 });
    expect(await assetRow(id)).toMatchObject({ rejection_reason: "processing_failed" });
  });

  it("DEC71 image.process run twice on one job leaves one set of derivatives", async () => {
    const { id } = await uploadImage(db, identity, await png(), "image/png", {
      width: 40,
      height: 30,
    });
    expect((await runImageProcess(id)).result).toMatchObject({ ready: 1 });
    const before = await assetRow(id);
    expect((await runImageProcess(id)).result).toEqual({ skipped: 1 });
    expect(await derivatives(id)).toHaveLength(4);
    expect(await assetRow(id)).toMatchObject({ status: "ready", version: before?.version });
  });

  it("FR61 an upload deleted by its owner is not processed", async () => {
    const { id } = await uploadImage(db, identity, await png(), "image/png", {
      width: 40,
      height: 30,
    });
    await deleteUpload(id, uploadContext(db, identity));
    expect((await runImageProcess(id)).result).toEqual({ skipped: 1 });
    expect(await derivatives(id)).toEqual([]);
    expect(await objectExists("media-private", privateObjectKey(id, "master"))).toBe(false);
  });

  it("SEC08 the raw upload stays private in the quarantine bucket after processing", async () => {
    const { id } = await processed(await png(), "image/png", { width: 40, height: 30 });
    const row = await assetRow(id);
    expect(await objectExists("quarantine", String(row?.quarantine_key))).toBe(true);
    expect(await objectExists("media-public", String(row?.quarantine_key))).toBe(false);
  });
});
