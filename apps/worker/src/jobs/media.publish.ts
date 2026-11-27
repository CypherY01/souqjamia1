// Tasks 4.2 and 4.4 (SEC08, DEC08, DEC71, item 1 of plan/task-4.4.md): the public copies of a
// listing's images follow the listing's state. Queued in the transaction that changes it:
// publication (4.2), an edit of the images (API035, with the images it detached), archive and
// restore (API036). The dedupe key carries the listing's version, so every change queues one job.
// An image may be public while its listing is active or sold and not hidden by moderation.
//  1. app.media_unpublish_files(): the fixed public keys of the images in scope that are not
//     eligible (the listing's, and the detached ones). Removed; a missing file is a success.
//  2. app.media_unpublished() with the images removed: under their locks, their public rows are
//     marked deleted, and the keys of those that became eligible meanwhile (attached to another
//     listing whose sync already ran) come back: they are copied again.
//  3. app.media_publish_files(): the private w150, w600 and w1200 files of an active listing not
//     hidden, copied inside Storage to the same fixed key in media-public, with their type and
//     Cache-Control (one hour, task 4.1). A copy a previous attempt made is kept (DEC71).
//  4. app.media_published() checks the listing again under its lock and records the public rows
//     (reviving one an archive removed). If the listing changed meanwhile, nothing is recorded and
//     the copies it lists are removed again. The master is never copied.
// Each step decides from the state at that moment, so jobs that run in any order end with what
// the current state allows. Removing the copies of a listing hidden by moderation comes with 7.5.
// Logs carry the listing id and the counts only.
import { MEDIA_BUCKETS } from "@souq/domain";
import { z } from "zod";
import { defineJob, type JobResult } from "../job.ts";
import { createMediaStorage, storageSettings } from "../media/storage.ts";
import type { StorageFactory } from "./image.process.ts";

interface KeyRow {
  object_key: string;
}

const defaultStorage: StorageFactory = (signal) => createMediaStorage(storageSettings(), signal);

export function createMediaPublish(storageFactory: StorageFactory = defaultStorage) {
  return defineJob({
    kind: "media.publish",
    payload: z.strictObject({
      listing_id: z.uuid(),
      detached_media_ids: z.array(z.uuid()).max(10).optional(),
    }),
    timeoutMs: 60_000,
    async run({ listing_id, detached_media_ids }, { db, signal }): Promise<JobResult> {
      const detached = detached_media_ids ?? [];
      let storage: ReturnType<StorageFactory> | null = null;
      const store = () => (storage ??= storageFactory(signal));
      let copied = 0;
      let removed = 0;

      const stale = await db.query<KeyRow & { media_id: string }>(
        "select media_id, object_key from app.media_unpublish_files($1, $2::uuid[])",
        [listing_id, detached],
      );
      if (stale.rows.length > 0) {
        await store().remove(
          MEDIA_BUCKETS.public,
          stale.rows.map((row) => row.object_key),
        );
        removed += stale.rows.length;
        const again = await db.query<KeyRow>(
          "select object_key from app.media_unpublished($1::uuid[])",
          [[...new Set(stale.rows.map((row) => row.media_id))]],
        );
        for (const row of again.rows) {
          signal.throwIfAborted();
          await store().copy(
            MEDIA_BUCKETS.private,
            row.object_key,
            MEDIA_BUCKETS.public,
            row.object_key,
          );
          copied += 1;
        }
      }

      const files = await db.query<KeyRow>("select object_key from app.media_publish_files($1)", [
        listing_id,
      ]);
      if (files.rows.length === 0) return { copied, removed };
      for (const file of files.rows) {
        signal.throwIfAborted();
        await store().copy(
          MEDIA_BUCKETS.private,
          file.object_key,
          MEDIA_BUCKETS.public,
          file.object_key,
        );
        copied += 1;
      }
      const after = await db.query<KeyRow>("select object_key from app.media_published($1)", [
        listing_id,
      ]);
      if (after.rows.length > 0) {
        await store().remove(
          MEDIA_BUCKETS.public,
          after.rows.map((row) => row.object_key),
        );
        removed += after.rows.length;
      }
      return { copied, removed };
    },
  });
}

export const mediaPublish = createMediaPublish();
