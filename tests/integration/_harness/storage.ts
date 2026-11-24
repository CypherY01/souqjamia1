// Task 4.1: uploads against the local stack with the real server code (lib/media/uploads.ts),
// the real Storage, and the worker's real handlers run on demand, as worker.ts and web.ts do for
// their parts. The secret key is the local stack's own (readLocalStack), never committed.
import { randomBytes } from "node:crypto";
import { inject } from "vitest";
import type { enums } from "@souq/domain";
import type { Identity } from "../../../apps/web/lib/auth/identity.ts";
import type { AppDb } from "../../../apps/web/lib/db/app-client.ts";
import { createMediaSigner, type MediaSigner } from "../../../apps/web/lib/media/storage.ts";
import {
  authorizeUpload,
  completeUpload,
  type Upload,
  type UploadAuthorization,
  type UploadContext,
} from "../../../apps/web/lib/media/uploads.ts";
import {
  createImageProcess,
  type StorageFactory,
} from "../../../apps/worker/src/jobs/image.process.ts";
import { createMediaCleanup } from "../../../apps/worker/src/jobs/media.cleanup.ts";
import type { JobResult } from "../../../apps/worker/src/job.ts";
import { sha256Hex } from "../../../apps/worker/src/media/process.ts";
import {
  createMediaStorage,
  type MediaStorage,
  type StorageSettings,
} from "../../../apps/worker/src/media/storage.ts";
import { jsonRequest } from "./auth-flow.ts";
import { dbPool, scalar } from "./db.ts";
import { captureLogger, workerPool } from "./worker.ts";

export const trace = (): string => randomBytes(16).toString("hex");

export function storageSettings(): StorageSettings {
  const stack = inject("stack");
  return { url: stack.apiUrl, secretKey: stack.secretKey };
}

export function signer(): MediaSigner {
  const stack = inject("stack");
  return createMediaSigner({
    NEXT_PUBLIC_SUPABASE_URL: stack.apiUrl,
    SUPABASE_SECRET_KEY: stack.secretKey,
  });
}

/** The worker's Storage access with the local secret key. */
export const realStorage: StorageFactory = (signal) =>
  createMediaStorage(storageSettings(), signal);

export function uploadContext(db: AppDb, identity: Identity | null): UploadContext {
  return { db, signer: signer(), traceId: trace(), identity: () => Promise.resolve(identity) };
}

export interface DeclaredUpload {
  purpose?: enums.MediaPurpose;
  bytes: number;
  mime: string;
  width: number;
  height: number;
  context_id?: string;
}

export function authorize(
  db: AppDb,
  identity: Identity | null,
  body: DeclaredUpload | Record<string, unknown>,
): Promise<UploadAuthorization> {
  return authorizeUpload(
    jsonRequest("/api/uploads/authorize", { purpose: "listing", ...body }),
    uploadContext(db, identity),
  );
}

/** PUT to the signed link, as the browser does. */
export function putBytes(signedUrl: string, bytes: Buffer, mime: string): Promise<Response> {
  return fetch(signedUrl, {
    method: "PUT",
    body: new Uint8Array(bytes),
    headers: { "content-type": mime, "x-upsert": "false" },
  });
}

export function complete(
  db: AppDb,
  identity: Identity | null,
  id: string,
  body: Record<string, unknown>,
): Promise<Upload> {
  return completeUpload(
    jsonRequest(`/api/uploads/${id}/complete`, body),
    id,
    uploadContext(db, identity),
  );
}

export interface Uploaded {
  id: string;
  authorization: UploadAuthorization;
  upload: Upload;
}

/**
 * Authorizes, uploads and announces one image. `declared` overrides what the client claims
 * (a lying client), the bytes stay real.
 */
export async function uploadImage(
  db: AppDb,
  identity: Identity,
  bytes: Buffer,
  mime: string,
  declared: Partial<DeclaredUpload> = {},
): Promise<Uploaded> {
  const authorization = await authorize(db, identity, {
    purpose: "listing",
    bytes: bytes.length,
    mime,
    width: 10,
    height: 10,
    ...declared,
  });
  const put = await putBytes(authorization.signed_url, bytes, declared.mime ?? mime);
  if (!put.ok) throw new Error(`upload PUT failed with ${String(put.status)}`);
  const upload = await complete(db, identity, authorization.upload_id, {
    checksum_sha256: sha256Hex(bytes),
    expected_size: bytes.length,
  });
  return { id: authorization.upload_id, authorization, upload };
}

export interface JobRun {
  result?: JobResult;
  error?: unknown;
  lines: ReturnType<typeof captureLogger>["lines"];
}

/** Fails the test when a job run threw. */
export function assertRan(run: JobRun): void {
  if (run.error === undefined) return;
  throw run.error instanceof Error ? run.error : new Error("the job run failed");
}

/** Runs image.process for one image, as the worker would on the given attempt. */
export async function runImageProcess(
  mediaId: string,
  options: { attempt?: number; storage?: StorageFactory } = {},
): Promise<JobRun> {
  const logs = captureLogger();
  const pool = workerPool();
  const job = createImageProcess(options.storage ?? realStorage, logs.logger);
  try {
    const result = await job.run(job.payload.parse({ media_id: mediaId }), {
      jobId: "0",
      attempt: options.attempt ?? 1,
      idempotencyKey: `job:test-${mediaId}`,
      signal: new AbortController().signal,
      db: pool,
    });
    return { result, lines: logs.lines };
  } catch (error) {
    return { error, lines: logs.lines };
  } finally {
    await pool.end();
  }
}

/** Runs one media.cleanup job with the worker's role. */
export async function runMediaCleanup(storage: StorageFactory = realStorage): Promise<JobResult> {
  const pool = workerPool();
  const job = createMediaCleanup(storage);
  try {
    const result = await job.run(job.payload.parse({}), {
      jobId: "0",
      attempt: 1,
      idempotencyKey: "job:test-cleanup",
      signal: new AbortController().signal,
      db: pool,
    });
    return result ?? {};
  } finally {
    await pool.end();
  }
}

/** Whether Storage holds this object (read as postgres from storage.objects). */
export async function objectExists(bucket: string, key: string): Promise<boolean> {
  return scalar<boolean>(
    dbPool(),
    "select exists (select 1 from storage.objects where bucket_id = $1 and name = $2)",
    [bucket, key],
  );
}

/** One row of the asset, as postgres sees it. */
export async function assetRow(id: string): Promise<Record<string, unknown> | undefined> {
  const result = await dbPool().query(
    `select status::text, rejection_reason::text, raw_removed_at, purged_at, expires_at,
            upload_expires_at, created_at, quarantine_key, version
       from public.media_asset where id = $1`,
    [id],
  );
  return result.rows[0] as Record<string, unknown> | undefined;
}

/** A storage that fails every call, for the worker failure cases (TC32). */
export const failingStorage: StorageFactory = () => {
  const fail = (): Promise<never> =>
    Promise.reject(Object.assign(new Error("down"), { code: "STORAGE_FAILED" }));
  const storage: MediaStorage = { download: fail, upload: fail, remove: fail, copy: fail };
  return storage;
};

/** Storage that downloads from the real one and fails on upload. */
export const uploadFailsStorage: StorageFactory = (signal) => {
  const real = realStorage(signal);
  return {
    download: (bucket, key) => real.download(bucket, key),
    upload: () => Promise.reject(Object.assign(new Error("down"), { code: "STORAGE_FAILED" })),
    remove: (bucket, keys) => real.remove(bucket, keys),
    copy: (from, key, to, toKey) => real.copy(from, key, to, toKey),
  };
};

/** Downloads a private derivative with the secret key (for the TC32 metadata checks). */
export async function downloadPrivate(key: string): Promise<Buffer | null> {
  return realStorage(new AbortController().signal).download("media-private", key);
}
