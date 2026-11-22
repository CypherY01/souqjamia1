// API078 and API115 (task 3.8): the session member's notifications of the last 90 days (FR48,
// RET07, TC20) and their unread count. Reads go through app.my_notifications() and
// app.unread_notification_count() (DEC77), which recheck member access in the database.
// Framework-free, so integration tests run it as is.
import type { enums } from "@souq/domain";
import { requireMember, type GuardContext } from "../auth/guards.ts";
import type { Identity } from "../auth/identity.ts";
import type { AppDb } from "../db/app-client.ts";
import { decodeCursor, encodeCursor, parseLimit } from "../http/cursor.ts";
import { ApiError } from "../http/errors.ts";
import { routes } from "../routes.ts";
import { notificationView } from "./events.ts";

/** The contract's Notification. */
export interface Notification {
  id: string;
  event_type: string;
  context_type: enums.NotificationContextType;
  context_id: string;
  /** A fixed local path; /notifications for one this build cannot open. */
  destination: string;
  read_at: string | null;
  created_at: string;
}

/** What the notifications page shows besides the contract fields. */
export interface NotificationItem extends Notification {
  text: string;
  available: boolean;
}

export interface NotificationPage {
  items: NotificationItem[];
  nextCursor: string | null;
}

interface NotificationRow {
  id: string;
  event_type: string;
  context_type: enums.NotificationContextType;
  context_id: string;
  read_at: Date | null;
  created_at: Date;
  /** Full precision (microseconds), so the cursor never skips or repeats a row. */
  created_key: string;
}

/** The cursor is bound to this list and order (NFR14). */
const CURSOR_FILTERS = { list: "API078", order: "created_at desc, id desc" } as const;

export interface PageRequest {
  cursor: string | null;
  limit: number;
  appSecret: string;
}

/** One page, newest first. A cursor from another list or a forged one is INVALID_CURSOR. */
export async function readNotificationPage(
  db: AppDb,
  identity: Identity,
  traceId: string,
  page: PageRequest,
): Promise<NotificationPage> {
  let before: [string, string] | [null, null] = [null, null];
  if (page.cursor !== null) {
    const keys = decodeCursor(page.appSecret, page.cursor, CURSOR_FILTERS);
    const [created, id] = keys;
    if (keys.length !== 2 || typeof created !== "string" || typeof id !== "string") {
      throw new ApiError("INVALID_CURSOR");
    }
    before = [created, id];
  }
  const rows = await db.withActor(identity.claims, traceId, async (tx) => {
    const result = await tx.query<NotificationRow>(
      `select id, event_type, context_type, context_id, read_at, created_at,
              created_at::text as created_key
         from app.my_notifications($1::timestamptz, $2::uuid, $3)`,
      [before[0], before[1], page.limit + 1],
    );
    return result.rows;
  });
  const shown = rows.slice(0, page.limit);
  const last = shown.at(-1);
  return {
    items: shown.map((row) => {
      const view = notificationView(row.event_type, row.context_type);
      return {
        id: row.id,
        event_type: row.event_type,
        context_type: row.context_type,
        context_id: row.context_id,
        destination: view.destination ?? routes.notifications,
        read_at: row.read_at?.toISOString() ?? null,
        created_at: row.created_at.toISOString(),
        text: view.text,
        available: view.destination !== null,
      };
    }),
    nextCursor:
      rows.length > page.limit && last !== undefined
        ? encodeCursor(page.appSecret, [last.created_key, last.id], CURSOR_FILTERS)
        : null,
  };
}

export interface NotificationsContext extends GuardContext {
  db: AppDb;
  appSecret: string;
}

/** API078: `cursor` and `limit` only (20 by default, 50 at most). */
export async function listNotifications(
  request: Request,
  ctx: NotificationsContext,
): Promise<{ data: Notification[]; meta: { next_cursor: string | null } }> {
  const { identity } = await requireMember(ctx, { db: ctx.db });
  const params = new URL(request.url).searchParams;
  for (const name of params.keys()) {
    if (name !== "cursor" && name !== "limit") throw new ApiError("BAD_REQUEST");
  }
  const page = await readNotificationPage(ctx.db, identity, ctx.traceId, {
    cursor: params.get("cursor"),
    limit: parseLimit(params.get("limit")),
    appSecret: ctx.appSecret,
  });
  return {
    // The contract's fields only: the page's text and availability stay on the server.
    data: page.items.map((item) => ({
      id: item.id,
      event_type: item.event_type,
      context_type: item.context_type,
      context_id: item.context_id,
      destination: item.destination,
      read_at: item.read_at,
      created_at: item.created_at,
    })),
    meta: { next_cursor: page.nextCursor },
  };
}

/** API115 for a member session that passed its guard. */
export async function readUnreadCount(
  db: AppDb,
  identity: Identity,
  traceId: string,
): Promise<number> {
  return db.withActor(identity.claims, traceId, async (tx) => {
    const result = await tx.query<{ count: number }>(
      "select app.unread_notification_count() as count",
    );
    return result.rows[0]?.count ?? 0;
  });
}

/** API115. */
export async function unreadCount(ctx: GuardContext & { db: AppDb }): Promise<{ count: number }> {
  const { identity } = await requireMember(ctx, { db: ctx.db });
  return { count: await readUnreadCount(ctx.db, identity, ctx.traceId) };
}
