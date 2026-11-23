// Task 4.1: API037 to API040, the member's image uploads (FR17, FR61, FR80, SEC08, RL09, DEC83).
// The database decides (app.authorize_upload, app.complete_upload, app.upload_status,
// app.delete_upload), and Storage is only asked for signed links afterwards, outside the
// transaction (DEC72). Framework-free, so integration tests run it as is.
//  - API037: the declared values are checked here and again in the database. 201 with a
//    create-only upload link to the quarantine bucket and the five-minute deadline.
//  - API038: the owner announces the bytes. 202 with the state: the worker decides readiness.
//  - API039: the owner's state, with a 60-second preview link once ready (none for a student
//    card, DEC83).
//  - API040: removes an unattached upload. 204.
// Another member's upload, an unknown id or a malformed one is NOT_FOUND (no disclosure).
import { IMAGE_MAX_BYTES, IMAGE_MAX_PIXELS, IMAGE_MIME_TYPES, enums } from "@souq/domain";
import { z } from "zod";
import { requireMember, type GuardContext } from "../auth/guards.ts";
import type { AppDb, Tx } from "../db/app-client.ts";
import { readJson } from "../http/body.ts";
import { ApiError } from "../http/errors.ts";
import { StorageUnavailableError, type MediaSigner } from "./storage.ts";

export interface UploadContext extends GuardContext {
  db: AppDb;
  signer: MediaSigner;
}

export const AuthorizeBody = z.strictObject({
  purpose: z.enum(enums.MediaPurpose),
  bytes: z.int().min(1).max(IMAGE_MAX_BYTES),
  mime: z.enum(IMAGE_MIME_TYPES),
  width: z.int().min(1).max(IMAGE_MAX_PIXELS),
  height: z.int().min(1).max(IMAGE_MAX_PIXELS),
  context_id: z.uuid().optional(),
});

export const CompleteBody = z.strictObject({
  checksum_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  expected_size: z.int().min(1).max(IMAGE_MAX_BYTES),
});

/** The contract's UploadAuthorization. */
export interface UploadAuthorization {
  upload_id: string;
  signed_url: string;
  token: string;
  expires_at: string;
}

/** The contract's Upload. */
export interface Upload {
  id: string;
  purpose: enums.MediaPurpose;
  status: enums.MediaStatus;
  rejection_reason: enums.MediaRejectionReason | null;
  preview: { url: string; expires_at: string } | null;
  created_at: string;
  expires_at: string;
}

interface StatusRow {
  media_id: string;
  media_purpose: enums.MediaPurpose;
  media_status: enums.MediaStatus;
  reason: enums.MediaRejectionReason | null;
  created: Date;
  expires: Date | null;
  preview_key: string | null;
}

const uploadId = z.uuid();

/** A malformed id is an unknown upload: NOT_FOUND, like another member's. */
export function parseUploadId(value: string): string {
  const parsed = uploadId.safeParse(value);
  if (!parsed.success) throw new ApiError("NOT_FOUND");
  return parsed.data;
}

function unavailable(error: unknown): never {
  if (error instanceof StorageUnavailableError) throw new ApiError("SERVICE_UNAVAILABLE");
  throw error;
}

async function readStatus(tx: Tx, id: string): Promise<StatusRow | undefined> {
  const result = await tx.query<StatusRow>(
    `select media_id, media_purpose, media_status, reason, created, expires, preview_key
       from app.upload_status($1::uuid)`,
    [id],
  );
  return result.rows[0];
}

async function toUpload(row: StatusRow, signer: MediaSigner): Promise<Upload> {
  let preview: Upload["preview"] = null;
  if (row.preview_key !== null) {
    try {
      const link = await signer.signPrivate(row.preview_key);
      preview = { url: link.url, expires_at: link.expiresAt.toISOString() };
    } catch (error) {
      unavailable(error);
    }
  }
  return {
    id: row.media_id,
    purpose: row.media_purpose,
    status: row.media_status,
    rejection_reason: row.reason,
    preview,
    created_at: row.created.toISOString(),
    // Null only once a later task attaches the image; until then the 24-hour deletion (RET01).
    expires_at: (row.expires ?? row.created).toISOString(),
  };
}

/** API037. */
export async function authorizeUpload(
  request: Request,
  ctx: UploadContext,
): Promise<UploadAuthorization> {
  const { identity } = await requireMember(ctx, { db: ctx.db });
  const input = await readJson(request, AuthorizeBody);
  if (input.width * input.height > IMAGE_MAX_PIXELS) {
    throw new ApiError("VALIDATION_FAILED", {
      fieldErrors: [{ field: "width", code: "too_many_pixels" }],
    });
  }
  const row = await ctx.db.withActor(identity.claims, ctx.traceId, async (tx) => {
    const result = await tx.query<{ media_id: string; object_name: string; deadline: Date }>(
      `select media_id, object_name, deadline
         from app.authorize_upload($1::public.media_purpose, $2, $3, $4, $5, $6::uuid)`,
      [input.purpose, input.bytes, input.mime, input.width, input.height, input.context_id ?? null],
    );
    const authorized = result.rows[0];
    if (authorized === undefined) throw new Error("authorize_upload returned no row");
    return authorized;
  });
  // DEC72: after the commit. A failure leaves a pending row that media.cleanup deletes.
  let signed;
  try {
    signed = await ctx.signer.signUpload(row.object_name);
  } catch (error) {
    unavailable(error);
  }
  return {
    upload_id: row.media_id,
    signed_url: signed.signedUrl,
    token: signed.token,
    expires_at: row.deadline.toISOString(),
  };
}

/** API038. */
export async function completeUpload(
  request: Request,
  id: string,
  ctx: UploadContext,
): Promise<Upload> {
  const { identity } = await requireMember(ctx, { db: ctx.db });
  const mediaId = parseUploadId(id);
  const input = await readJson(request, CompleteBody);
  const row = await ctx.db.withActor(identity.claims, ctx.traceId, async (tx) => {
    await tx.query("select app.complete_upload($1::uuid, decode($2, 'hex'), $3) as done", [
      mediaId,
      input.checksum_sha256,
      input.expected_size,
    ]);
    return readStatus(tx, mediaId);
  });
  if (row === undefined) throw new ApiError("NOT_FOUND");
  return toUpload(row, ctx.signer);
}

/** API039. */
export async function getUpload(id: string, ctx: UploadContext): Promise<Upload> {
  const { identity } = await requireMember(ctx, { db: ctx.db });
  const mediaId = parseUploadId(id);
  const row = await ctx.db.withActor(identity.claims, ctx.traceId, (tx) => readStatus(tx, mediaId));
  if (row === undefined) throw new ApiError("NOT_FOUND");
  return toUpload(row, ctx.signer);
}

/** API040. */
export async function deleteUpload(id: string, ctx: UploadContext): Promise<void> {
  const { identity } = await requireMember(ctx, { db: ctx.db });
  const mediaId = parseUploadId(id);
  await ctx.db.withActor(identity.claims, ctx.traceId, async (tx) => {
    await tx.query("select app.delete_upload($1::uuid) as done", [mediaId]);
  });
}
