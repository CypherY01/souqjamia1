// Task 4.1 (FR61, FR80, DEC08, DEC45, DEC71, DEC83, SEC08, TC32): one announced upload. API038
// (app.complete_upload) queues it once per image, after checking the stored object's size.
//  1. app.media_begin_processing(): no row means nothing to do (deleted, already ready or
//     rejected), a success (DEC71).
//  2. The raw object from the quarantine bucket must have the declared size and checksum.
//  3. media/process.ts checks the real bytes and makes the derivatives.
//  4. They are written to media-private at fixed keys (a repeated attempt writes the same files),
//     then app.media_processed() records them and makes the image ready. If the image changed
//     meanwhile (deleted by its owner), the files just written are removed.
// A problem with the image itself rejects it at once with a safe reason (app.media_rejected).
// Any other failure is retried after 1 and then 5 minutes, and the third failed attempt rejects
// the image as processing_failed, so the member can upload it again (DEC83). The raw object stays
// in the quarantine bucket until media.cleanup removes it after the upload token's lifetime.
// Logs carry the image id, the reason and the timings only, never the bytes.
import { privateObjectKey, MEDIA_BUCKETS, type enums } from "@souq/domain";
import { log as defaultLog } from "@souq/log";
import { z } from "zod";
import { defineJob, type JobResult } from "../job.ts";
import type { Logger } from "../loop.ts";
import { ImageRejected, processImage, sha256Hex } from "../media/process.ts";
import { createMediaStorage, storageSettings, type MediaStorage } from "../media/storage.ts";

/** DEC83: the attempt whose failure ends the image as processing_failed. */
export const IMAGE_MAX_ATTEMPTS = 3;
/** SEC08: two images at a time (item 7). */
export const IMAGE_CONCURRENCY = 2;

interface BeginRow {
  media_purpose: enums.MediaPurpose;
  declared_mime: string;
  declared_bytes: number;
  checksum: Buffer;
  object_name: string;
}

export type StorageFactory = (signal: AbortSignal) => MediaStorage;

const defaultStorage: StorageFactory = (signal) => createMediaStorage(storageSettings(), signal);

export function createImageProcess(
  storageFactory: StorageFactory = defaultStorage,
  logger: Logger = defaultLog,
) {
  return defineJob({
    kind: "image.process",
    payload: z.strictObject({ media_id: z.uuid() }),
    timeoutMs: 60_000,
    concurrency: IMAGE_CONCURRENCY,
    async run({ media_id }, { db, signal, attempt }): Promise<JobResult> {
      async function reject(reason: enums.MediaRejectionReason): Promise<JobResult> {
        await db.query("select app.media_rejected($1, $2::public.media_rejection_reason)", [
          media_id,
          reason,
        ]);
        logger.info("image.rejected", { media_id, reason, attempt });
        return { rejected: 1 };
      }

      const begun = await db.query<BeginRow>(
        `select media_purpose, declared_mime, declared_bytes, checksum, object_name
           from app.media_begin_processing($1)`,
        [media_id],
      );
      const row = begun.rows[0];
      if (row === undefined) return { skipped: 1 };
      // A job that timed out on its third attempt comes back once more: end it now (DEC83).
      if (attempt > IMAGE_MAX_ATTEMPTS) return reject("processing_failed");

      const startedAt = performance.now();
      const storage = storageFactory(signal);
      try {
        const raw = await storage.download(MEDIA_BUCKETS.quarantine, row.object_name);
        if (raw === null) return await reject("processing_failed");
        if (raw.length !== row.declared_bytes) return await reject("corrupt");
        if (sha256Hex(raw) !== row.checksum.toString("hex")) return await reject("corrupt");

        const files = await processImage({
          bytes: raw,
          declaredMime: row.declared_mime,
          purpose: row.media_purpose,
        });
        signal.throwIfAborted();
        const keys = files.map((file) => privateObjectKey(media_id, file.variant));
        for (const file of files) {
          await storage.upload(
            MEDIA_BUCKETS.private,
            privateObjectKey(media_id, file.variant),
            file.data,
            "image/webp",
          );
        }
        const derivatives = files.map((file) => ({
          variant: file.variant,
          bytes: file.data.length,
          sha256: file.sha256,
          width: file.width,
          height: file.height,
        }));
        const done = await db.query<{ done: boolean }>(
          "select app.media_processed($1, $2::jsonb) as done",
          [media_id, JSON.stringify(derivatives)],
        );
        if (done.rows[0]?.done !== true) {
          await storage.remove(MEDIA_BUCKETS.private, keys);
          return { superseded: 1 };
        }
        logger.info("image.ready", {
          media_id,
          attempt,
          variants: files.length,
          duration_ms: Math.round(performance.now() - startedAt),
        });
        return { ready: 1, variants: files.length };
      } catch (error) {
        if (error instanceof ImageRejected) return await reject(error.reason);
        if (attempt >= IMAGE_MAX_ATTEMPTS && !signal.aborted) {
          logger.warn("image.failed", {
            media_id,
            attempt,
            error_name: error instanceof Error ? error.name : typeof error,
          });
          return await reject("processing_failed");
        }
        throw error;
      }
    },
  });
}

export const imageProcess = createImageProcess();
