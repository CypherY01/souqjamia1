// API079 (task 3.8, FR48, TC20): marks the session member's own notifications read. Ids of
// another recipient, unknown ids and read ones change nothing and are not reported, so the
// answer is the same 204 whatever the ids. Framework-free, so integration tests run it as is.
import { z } from "zod";
import { requireMember, type GuardContext } from "../auth/guards.ts";
import type { AppDb } from "../db/app-client.ts";
import { readJson } from "../http/body.ts";

export const MarkReadBody = z.strictObject({
  ids: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, { message: "unique" }),
  read: z.literal(true),
});

export async function markNotificationsRead(
  request: Request,
  ctx: GuardContext & { db: AppDb },
): Promise<void> {
  const { identity } = await requireMember(ctx, { db: ctx.db });
  const input = await readJson(request, MarkReadBody);
  // DEC72: the whole body may run again; marking read twice changes nothing more.
  await ctx.db.withActor(identity.claims, ctx.traceId, async (tx) => {
    await tx.query("select app.mark_notifications_read($1::uuid[]) as changed", [input.ids]);
  });
}
