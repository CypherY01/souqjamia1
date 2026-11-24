// Task 4.2 (SEC08, DEC08, DEC71, item 6): the public copies of a published listing's images.
// app.publish_listing() queues one job per listing in the publication's transaction, so it runs
// only after the commit (SEC08: listing variants become public after publication only).
//  1. app.media_publish_files(): the private w150, w600 and w1200 files of the listing's images,
//     only while the listing is active and not hidden. No row: nothing to do, a success.
//  2. Each one is copied inside Storage to the same fixed key in media-public, with its type and
//     Cache-Control (one hour, task 4.1). A copy a previous attempt made is kept (DEC71).
//  3. app.media_published() checks the listing again under its lock and records the public rows.
//     If it was archived or hidden meanwhile, nothing is recorded and the copies it lists are
//     removed again. The master is never copied.
// Removing the public copies when a listing is archived or hidden comes with tasks 4.4 and 7.5.
// Logs carry the listing id and the counts only.
import { MEDIA_BUCKETS } from "@souq/domain";
import { z } from "zod";
import { defineJob, type JobResult } from "../job.ts";
import { createMediaStorage, storageSettings } from "../media/storage.ts";
import type { StorageFactory } from "./image.process.ts";

interface FileRow {
  media_id: string;
  variant: string;
  object_key: string;
}

const defaultStorage: StorageFactory = (signal) => createMediaStorage(storageSettings(), signal);

export function createMediaPublish(storageFactory: StorageFactory = defaultStorage) {
  return defineJob({
    kind: "media.publish",
    payload: z.strictObject({ listing_id: z.uuid() }),
    timeoutMs: 60_000,
    async run({ listing_id }, { db, signal }): Promise<JobResult> {
      const files = await db.query<FileRow>(
        `select media_id, variant::text as variant, object_key
           from app.media_publish_files($1)`,
        [listing_id],
      );
      if (files.rows.length === 0) return { copied: 0 };
      const storage = storageFactory(signal);
      for (const file of files.rows) {
        signal.throwIfAborted();
        await storage.copy(
          MEDIA_BUCKETS.private,
          file.object_key,
          MEDIA_BUCKETS.public,
          file.object_key,
        );
      }
      const removed = await db.query<{ object_key: string }>(
        "select object_key from app.media_published($1)",
        [listing_id],
      );
      await storage.remove(
        MEDIA_BUCKETS.public,
        removed.rows.map((row) => row.object_key),
      );
      return { copied: files.rows.length, removed: removed.rows.length };
    },
  });
}

export const mediaPublish = createMediaPublish();
