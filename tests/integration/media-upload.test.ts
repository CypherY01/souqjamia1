// Task 4.1 (plan/task-4.1.md): API037 to API040 with the real server code, the real database and
// the real local Storage. FR17, FR61, FR80, SEC08, RL09, DEC83, TC25, TC66, TC75, DEC77.
// The worker's processing is in media-processing.test.ts, the cleanup in media-cleanup.test.ts,
// direct Storage access in storage-access.test.ts.
// Needs `pnpm db:start` (with Storage) and applied migrations; run with `pnpm test:integration`.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  IMAGE_MAX_BYTES,
  IMAGE_MAX_PIXELS,
  IMAGE_MIME_TYPES,
  RL09_BYTES_PER_DAY,
  RL09_UPLOADS_PER_HOUR,
  UPLOAD_TOKEN_LIFETIME_SECONDS,
  UPLOAD_WINDOW_SECONDS,
} from "@souq/domain";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import { deleteUpload, getUpload } from "../../apps/web/lib/media/uploads.ts";
import { sha256Hex } from "../../apps/worker/src/media/process.ts";
import { jpeg, png } from "../fixtures/images/index.ts";
import { outcome } from "./_harness/auth-flow.ts";
import { closeDb, dbPool, scalar } from "./_harness/db.ts";
import { memberIdentity } from "./_harness/sessions.ts";
import {
  assetRow,
  authorize,
  complete,
  objectExists,
  putBytes,
  trace,
  uploadContext,
  uploadImage,
} from "./_harness/storage.ts";
import { signUpMember } from "./_harness/users.ts";
import { changeMember, webDb, withdrawAcknowledgments } from "./_harness/web.ts";

const db = webDb();

async function newMember(): Promise<{ id: string; identity: Identity }> {
  const member = await signUpMember();
  const { identity } = await memberIdentity(member);
  return { id: member.id, identity };
}

let a: { id: string; identity: Identity };
let b: { id: string; identity: Identity };
let image: Buffer;

beforeAll(async () => {
  a = await newMember();
  b = await newMember();
  image = await jpeg();
});

afterAll(async () => {
  await db.end();
  await closeDb();
});

/** The JWT payload of a Storage token. */
function tokenPayload(token: string): { iat: number; exp: number } {
  const part = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as {
    iat: number;
    exp: number;
  };
}

describe("task 4.1: the limits are the same in the database and @souq/domain", () => {
  it("bucket limits, constraints and RL09 numbers match packages/domain/src/media.ts", async () => {
    const buckets = await dbPool().query<{
      id: string;
      public: boolean;
      file_size_limit: string | null;
      allowed_mime_types: string[] | null;
    }>(
      `select id, public, file_size_limit::text, allowed_mime_types
         from storage.buckets where id in ('quarantine', 'media-private', 'media-public')
        order by id`,
    );
    const quarantine = buckets.rows.find((row) => row.id === "quarantine");
    expect(quarantine).toMatchObject({ public: false, file_size_limit: String(IMAGE_MAX_BYTES) });
    expect(quarantine?.allowed_mime_types).toEqual([...IMAGE_MIME_TYPES]);
    expect(buckets.rows.map((row) => [row.id, row.public])).toEqual([
      ["media-private", false],
      ["media-public", true],
      ["quarantine", false],
    ]);
    const constraints = await scalar<string>(
      dbPool(),
      `select string_agg(pg_get_constraintdef(oid), ' ') from pg_constraint
        where conrelid = 'public.media_asset'::regclass`,
    );
    expect(constraints).toContain(String(IMAGE_MAX_BYTES));
    expect(constraints).toContain(String(IMAGE_MAX_PIXELS));
    const source = await scalar<string>(
      dbPool(),
      "select prosrc from pg_proc where oid = 'app.authorize_upload(public.media_purpose, integer, text, integer, integer, uuid)'::regprocedure",
    );
    expect(source).toContain(`'RL09:hour', v_key_hash, ${String(RL09_UPLOADS_PER_HOUR)},`);
    expect(source).toContain(`p_bytes, ${String(RL09_BYTES_PER_DAY)},`);
    expect(source).toContain(`interval '${String(UPLOAD_WINDOW_SECONDS / 60)} minutes'`);
  });
});

describe("API037: a five-minute, create-only upload to the quarantine bucket", () => {
  it("SEC08 the link writes one unpredictable quarantine path, once, with no overwrite", async () => {
    const before = Date.now();
    const authorization = await authorize(db, a.identity, {
      bytes: image.length,
      mime: "image/jpeg",
      width: 40,
      height: 30,
    });
    const deadline = new Date(authorization.expires_at).getTime();
    expect(deadline - before).toBeGreaterThan((UPLOAD_WINDOW_SECONDS - 5) * 1000);
    expect(deadline - before).toBeLessThanOrEqual((UPLOAD_WINDOW_SECONDS + 5) * 1000);
    const row = await assetRow(authorization.upload_id);
    expect(row).toMatchObject({ status: "pending" });
    expect(row?.quarantine_key).toMatch(/^[0-9a-f]{32}$/);
    expect(authorization.signed_url).toContain(`/quarantine/${String(row?.quarantine_key)}`);

    expect((await putBytes(authorization.signed_url, image, "image/jpeg")).status).toBe(200);
    expect(await objectExists("quarantine", String(row?.quarantine_key))).toBe(true);
    const again = await putBytes(authorization.signed_url, await png(), "image/jpeg");
    expect(again.ok).toBe(false);
    expect(await again.text()).toContain("409");
  });

  it("DEC83 the signed upload token lives at most two hours", async () => {
    const authorization = await authorize(db, a.identity, {
      bytes: 100,
      mime: "image/png",
      width: 10,
      height: 10,
    });
    const { iat, exp } = tokenPayload(authorization.token);
    expect(exp - iat).toBeLessThanOrEqual(UPLOAD_TOKEN_LIFETIME_SECONDS);
  });

  it("TC66 a declared size over 5 MiB, over 24 megapixels or another type is refused", async () => {
    const big = await outcome(async () => {
      await authorize(db, a.identity, {
        bytes: IMAGE_MAX_BYTES + 1,
        mime: "image/jpeg",
        width: 10,
        height: 10,
      });
      return new Response(null);
    });
    expect(big).toMatchObject({ status: 422, code: "VALIDATION_FAILED" });
    expect(big.fieldErrors).toEqual([{ field: "bytes", code: "too_big" }]);

    const pixels = await outcome(async () => {
      await authorize(db, a.identity, { bytes: 100, mime: "image/png", width: 6000, height: 4001 });
      return new Response(null);
    });
    expect(pixels).toMatchObject({ status: 422, code: "VALIDATION_FAILED" });
    expect(pixels.fieldErrors).toEqual([{ field: "width", code: "too_many_pixels" }]);

    for (const mime of ["image/gif", "image/svg+xml", "image/heic"]) {
      const other = await outcome(async () => {
        await authorize(db, a.identity, { bytes: 100, mime, width: 10, height: 10 });
        return new Response(null);
      });
      expect(other).toMatchObject({ status: 422, code: "VALIDATION_FAILED" });
      expect(other.fieldErrors?.[0]?.field).toBe("mime");
    }
  });

  it("TC66 the database refuses the same declared values on its own", async () => {
    const result = await outcome(() =>
      db.withActor(a.identity.claims, trace(), async (tx) => {
        await tx.query(
          "select * from app.authorize_upload('listing', 5242881, 'image/jpeg', 10, 10, null)",
        );
        return new Response(null);
      }),
    );
    expect(result).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(result.fieldErrors).toEqual([{ field: "bytes", code: "too_big" }]);
    const pixels = await outcome(() =>
      db.withActor(a.identity.claims, trace(), async (tx) => {
        await tx.query(
          "select * from app.authorize_upload('listing', 100, 'image/png', 6000, 4001, null)",
        );
        return new Response(null);
      }),
    );
    expect(pixels.fieldErrors).toEqual([{ field: "width", code: "too_many_pixels" }]);
  });

  it("TC66 Storage refuses bytes over 5 MiB and a type the bucket does not take", async () => {
    const authorization = await authorize(db, a.identity, {
      bytes: IMAGE_MAX_BYTES,
      mime: "image/jpeg",
      width: 10,
      height: 10,
    });
    const tooBig = await putBytes(
      authorization.signed_url,
      Buffer.alloc(IMAGE_MAX_BYTES + 1, 1),
      "image/jpeg",
    );
    expect(tooBig.ok).toBe(false);
    expect(await tooBig.text()).toContain("413");
    const gif = await putBytes(authorization.signed_url, Buffer.alloc(10, 1), "image/gif");
    expect(gif.ok).toBe(false);
    expect(await gif.text()).toContain("415");
  });

  it("item 9: chat needs its conversation (task 5.3), the other purposes take no context", async () => {
    const chat = await outcome(async () => {
      await authorize(db, a.identity, {
        purpose: "chat",
        bytes: 100,
        mime: "image/png",
        width: 10,
        height: 10,
        context_id: randomUUID(),
      });
      return new Response(null);
    });
    expect(chat).toMatchObject({ status: 422, code: "VALIDATION_FAILED" });
    expect(chat.fieldErrors).toEqual([{ field: "context_id", code: "not_found" }]);
    for (const purpose of ["listing", "avatar", "student_card"] as const) {
      const withContext = await outcome(async () => {
        await authorize(db, a.identity, {
          purpose,
          bytes: 100,
          mime: "image/png",
          width: 10,
          height: 10,
          context_id: randomUUID(),
        });
        return new Response(null);
      });
      expect(withContext.fieldErrors).toEqual([{ field: "context_id", code: "not_allowed" }]);
    }
  });

  it("TC66 the 61st authorization within an hour is RATE_LIMITED (RL09)", async () => {
    const member = await newMember();
    for (let i = 0; i < RL09_UPLOADS_PER_HOUR; i += 1) {
      await authorize(db, member.identity, {
        bytes: 100,
        mime: "image/png",
        width: 10,
        height: 10,
      });
    }
    const over = await outcome(async () => {
      await authorize(db, member.identity, {
        bytes: 100,
        mime: "image/png",
        width: 10,
        height: 10,
      });
      return new Response(null);
    });
    expect(over).toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect(over.retryAfter).toBeGreaterThan(0);
    expect(
      await scalar<string>(
        dbPool(),
        "select count(*)::text from public.media_asset where owner_id = $1",
        [member.id],
      ),
    ).toBe(String(RL09_UPLOADS_PER_HOUR));
  });

  it("TC66 declared bytes over 200 MiB within a day are RATE_LIMITED (RL09)", async () => {
    const member = await newMember();
    // The day's counter, as 41 earlier uploads of 5 MiB would leave it: 5 MiB short of the limit.
    await dbPool().query(
      `insert into app.rate_limit_bucket (scope, key_hash, window_start, count, expires_at)
       values ('RL09:bytes', sha256(convert_to($1::text, 'UTF8')),
               date_bin('1 day', now(), '2000-01-01 00:00:00+00'), $2,
               date_bin('1 day', now(), '2000-01-01 00:00:00+00') + interval '2 days')`,
      [member.id, RL09_BYTES_PER_DAY - IMAGE_MAX_BYTES],
    );
    await authorize(db, member.identity, {
      bytes: IMAGE_MAX_BYTES,
      mime: "image/jpeg",
      width: 10,
      height: 10,
    });
    const over = await outcome(async () => {
      await authorize(db, member.identity, { bytes: 1, mime: "image/png", width: 1, height: 1 });
      return new Response(null);
    });
    expect(over).toMatchObject({ status: 429, code: "RATE_LIMITED" });
  });

  it("TC25 a guest, an account without the current terms and a restricted account get no upload", async () => {
    const guest = await outcome(async () => {
      await authorize(db, null, { bytes: 100, mime: "image/png", width: 10, height: 10 });
      return new Response(null);
    });
    expect(guest).toMatchObject({ status: 401, code: "UNAUTHENTICATED" });

    const terms = await newMember();
    await withdrawAcknowledgments(terms.id);
    const unacknowledged = await outcome(async () => {
      await authorize(db, terms.identity, { bytes: 100, mime: "image/png", width: 10, height: 10 });
      return new Response(null);
    });
    expect(unacknowledged).toMatchObject({ status: 403, code: "TERMS_NOT_ACKNOWLEDGED" });

    const banned = await newMember();
    await changeMember(
      banned.id,
      "update public.account_control set status = 'banned' where user_id = $1",
    );
    const restricted = await outcome(async () => {
      await authorize(db, banned.identity, {
        bytes: 100,
        mime: "image/png",
        width: 10,
        height: 10,
      });
      return new Response(null);
    });
    expect(restricted).toMatchObject({ status: 403, code: "ACCOUNT_RESTRICTED" });
  });
});

describe("API038: the owner announces the bytes; the worker decides", () => {
  it("SEC08 a matching upload becomes uploaded and queues image.process once", async () => {
    const { id, upload } = await uploadImage(db, a.identity, image, "image/jpeg");
    expect(upload).toMatchObject({ id, status: "uploaded", rejection_reason: null, preview: null });
    expect(
      await scalar<string>(
        dbPool(),
        "select count(*)::text from app.job where kind = 'image.process' and dedupe_key = 'image.process:' || $1",
        [id],
      ),
    ).toBe("1");
    // The same announcement again: the same state, no second job.
    const again = await complete(db, a.identity, id, {
      checksum_sha256: sha256Hex(image),
      expected_size: image.length,
    });
    expect(again.status).toBe("uploaded");
    const other = await outcome(async () => {
      await complete(db, a.identity, id, {
        checksum_sha256: sha256Hex(Buffer.from("other")),
        expected_size: image.length,
      });
      return new Response(null);
    });
    expect(other).toMatchObject({ status: 409, code: "STATE_CONFLICT" });
  });

  it("TC66 the announced size must be the declared size and the stored size", async () => {
    const declared = await outcome(async () => {
      await uploadImage(db, a.identity, image, "image/jpeg", { bytes: image.length + 1 });
      return new Response(null);
    });
    // The upload itself is smaller than declared: the stored object does not match.
    expect(declared).toMatchObject({ status: 422, code: "VALIDATION_FAILED" });
    expect(declared.fieldErrors).toEqual([{ field: "expected_size", code: "mismatch" }]);
  });

  it("SEC08 announcing before the bytes are stored is STATE_CONFLICT", async () => {
    const authorization = await authorize(db, a.identity, {
      bytes: image.length,
      mime: "image/jpeg",
      width: 40,
      height: 30,
    });
    const early = await outcome(async () => {
      await complete(db, a.identity, authorization.upload_id, {
        checksum_sha256: sha256Hex(image),
        expected_size: image.length,
      });
      return new Response(null);
    });
    expect(early).toMatchObject({ status: 409, code: "STATE_CONFLICT" });
  });

  it("DEC83 an announcement after the five minutes is DEADLINE_PASSED", async () => {
    const authorization = await authorize(db, a.identity, {
      bytes: image.length,
      mime: "image/jpeg",
      width: 40,
      height: 30,
    });
    await putBytes(authorization.signed_url, image, "image/jpeg");
    await dbPool().query(
      "update public.media_asset set upload_expires_at = now() - interval '1 second' where id = $1",
      [authorization.upload_id],
    );
    const late = await outcome(async () => {
      await complete(db, a.identity, authorization.upload_id, {
        checksum_sha256: sha256Hex(image),
        expected_size: image.length,
      });
      return new Response(null);
    });
    expect(late).toMatchObject({ status: 422, code: "DEADLINE_PASSED" });
    expect(await assetRow(authorization.upload_id)).toMatchObject({ status: "pending" });
  });

  it("TC75 another member's upload is NOT_FOUND for API038, API039 and API040", async () => {
    const { id } = await uploadImage(db, a.identity, image, "image/jpeg");
    const ctx = uploadContext(db, b.identity);
    const announce = await outcome(async () => {
      await complete(db, b.identity, id, {
        checksum_sha256: sha256Hex(image),
        expected_size: image.length,
      });
      return new Response(null);
    });
    const read = await outcome(async () => {
      await getUpload(id, ctx);
      return new Response(null);
    });
    const remove = await outcome(async () => {
      await deleteUpload(id, ctx);
      return new Response(null);
    });
    for (const result of [announce, read, remove]) {
      expect(result).toMatchObject({ status: 404, code: "NOT_FOUND" });
    }
    expect(await assetRow(id)).toMatchObject({ status: "uploaded" });
    const malformed = await outcome(async () => {
      await getUpload("not-a-uuid", uploadContext(db, a.identity));
      return new Response(null);
    });
    expect(malformed).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});

describe("API039 and API040: the owner's state, and removing an unattached upload", () => {
  it("FR80 the owner reads the state, with no preview before the image is ready", async () => {
    const { id } = await uploadImage(db, a.identity, image, "image/jpeg");
    const upload = await getUpload(id, uploadContext(db, a.identity));
    expect(upload).toMatchObject({
      id,
      purpose: "listing",
      status: "uploaded",
      rejection_reason: null,
      preview: null,
    });
    const expires = new Date(upload.expires_at).getTime() - new Date(upload.created_at).getTime();
    expect(expires).toBe(24 * 60 * 60 * 1000);
  });

  it("FR61 API040 deletes an unattached upload, again with no error, and never an attached one", async () => {
    const ctx = uploadContext(db, a.identity);
    const { id } = await uploadImage(db, a.identity, image, "image/jpeg");
    await deleteUpload(id, ctx);
    expect(await assetRow(id)).toMatchObject({ status: "deleted" });
    await deleteUpload(id, ctx);
    expect((await getUpload(id, ctx)).status).toBe("deleted");

    const attached = await uploadImage(db, a.identity, image, "image/jpeg");
    // As the tasks that attach images will leave it (expires_at null).
    await dbPool().query("update public.media_asset set expires_at = null where id = $1", [
      attached.id,
    ]);
    const conflict = await outcome(async () => {
      await deleteUpload(attached.id, ctx);
      return new Response(null);
    });
    expect(conflict).toMatchObject({ status: 409, code: "STATE_CONFLICT" });
  });

  it("DEC77 app.upload_status(): another member's session reads only its own uploads", async () => {
    const { id } = await uploadImage(db, a.identity, image, "image/jpeg");
    const rows = await db.withActor(b.identity.claims, trace(), async (tx) => {
      const result = await tx.query<{ media_id: string }>(
        "select media_id from app.upload_status($1::uuid)",
        [id],
      );
      return result.rows;
    });
    expect(rows).toEqual([]);
  });

  it("DEC77 app.upload_status(): a guest is UNAUTHENTICATED", async () => {
    const { id } = await uploadImage(db, a.identity, image, "image/jpeg");
    const guest = await outcome(() =>
      db.withActor(null, trace(), async (tx) => {
        await tx.query("select media_id from app.upload_status($1::uuid)", [id]);
        return new Response(null);
      }),
    );
    expect(guest.code).toBe("UNAUTHENTICATED");
  });
});
