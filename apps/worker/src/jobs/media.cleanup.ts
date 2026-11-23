// Task 4.1 (RET01, DEC71, DEC83): hourly removal of what no longer needs to exist.
// app.media_cleanup_claim() first deletes the images whose time ran out (pending past their five
// minutes, unattached past 24 hours), then lists, a batch at a time:
//  - raw objects to take out of the quarantine bucket, once the upload token can no longer
//    create them again (two hours) and processing is over;
//  - the private files of deleted images, at their fixed keys <media_id>/<variant>.webp.
// The worker removes them through Storage, then records it with app.media_cleanup_done(). A
// repeated run, or a file already gone, removes and records nothing more (DEC71).
import { MEDIA_BUCKETS, privateObjectKey, enums } from "@souq/domain";
import { z } from "zod";
import { defineJob, type JobResult } from "../job.ts";
import { createMediaStorage, storageSettings } from "../media/storage.ts";
import type { StorageFactory } from "./image.process.ts";

export const CLEANUP_BATCH = 100;
const MAX_BATCHES = 20;

interface ClaimRow {
  media_id: string;
  object_name: string;
  raw_due: boolean;
  purge_due: boolean;
}

const defaultStorage: StorageFactory = (signal) => createMediaStorage(storageSettings(), signal);

export function createMediaCleanup(storageFactory: StorageFactory = defaultStorage) {
  return defineJob({
    kind: "media.cleanup",
    payload: z.strictObject({}),
    timeoutMs: 3 * 60_000,
    async run(_payload, { db, signal }): Promise<JobResult> {
      const storage = storageFactory(signal);
      let raw = 0;
      let purged = 0;
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        signal.throwIfAborted();
        const claimed = await db.query<ClaimRow>(
          `select media_id, object_name, raw_due, purge_due
             from app.media_cleanup_claim($1)`,
          [CLEANUP_BATCH],
        );
        const rows = claimed.rows;
        const rawRows = rows.filter((row) => row.raw_due);
        const purgeRows = rows.filter((row) => row.purge_due);
        await storage.remove(
          MEDIA_BUCKETS.quarantine,
          rawRows.map((row) => row.object_name),
        );
        await storage.remove(
          MEDIA_BUCKETS.private,
          purgeRows.flatMap((row) =>
            enums.MediaVariant.map((variant) => privateObjectKey(row.media_id, variant)),
          ),
        );
        await db.query("select app.media_cleanup_done($1::uuid[], $2::uuid[]) as recorded", [
          rawRows.map((row) => row.media_id),
          purgeRows.map((row) => row.media_id),
        ]);
        raw += rawRows.length;
        purged += purgeRows.length;
        if (rows.length < CLEANUP_BATCH) break;
      }
      return { raw, purged };
    },
  });
}

export const mediaCleanup = createMediaCleanup();
