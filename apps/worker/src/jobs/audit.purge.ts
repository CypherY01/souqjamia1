// RET08: audit events are kept 730 days, then deleted by this daily job only (task 2.4, owner
// condition on item 5; scheduled from task 2.5, item 7). app.purge_audit_events deletes at most
// one batch of rows older than 730 days per call.
// DEC71: idempotent. A repeated run finds nothing older than 730 days left and deletes nothing.
import { z } from "zod";
import { defineJob } from "../job.ts";

export const PURGE_BATCH = 1000;

export const auditPurge = defineJob({
  kind: "audit.purge",
  payload: z.strictObject({}),
  timeoutMs: 2 * 60_000,
  async run(_payload, { db, signal }) {
    let deleted = 0;
    for (;;) {
      signal.throwIfAborted();
      const result = await db.query<{ deleted: number }>(
        "select app.purge_audit_events($1) as deleted",
        [PURGE_BATCH],
      );
      const count = result.rows[0]?.deleted ?? 0;
      deleted += count;
      if (count < PURGE_BATCH) return { deleted };
    }
  },
});
