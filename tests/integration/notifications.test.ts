// FR48, DEC49, DEC65, section 6.3, item 7 of task 2.4: notifications and email preferences.
// Task 3.8 (plan/task-3.8.md): the event list and the email job of app.notify (TC55), API078,
// API079, API115 and API029 with the real server code, and the third party and guest cases of
// DEC77 and TC20. The worker's email is in notification-email.test.ts.
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NOTIFICATION_EVENTS } from "@souq/domain";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import { encodeCursor } from "../../apps/web/lib/http/cursor.ts";
import { listNotifications, unreadCount } from "../../apps/web/lib/notifications/list.ts";
import { updatePreferences } from "../../apps/web/lib/notifications/preferences.ts";
import { markNotificationsRead } from "../../apps/web/lib/notifications/read.ts";
import { outcome, type Outcome } from "./_harness/auth-flow.ts";
import { closeDb, dbError, dbPool, rolledBack, scalar } from "./_harness/db.ts";
import { notify, testEvent, type TestEvent } from "./_harness/notifications.ts";
import { memberIdentity } from "./_harness/sessions.ts";
import { rest, restErrorCode, signUpMember, type TestMember } from "./_harness/users.ts";
import { changeMember, webDb, withdrawAcknowledgments } from "./_harness/web.ts";

const db = webDb();
const trace = (): string => randomBytes(16).toString("hex");
// Built at run time: the repository never holds a secret-like string.
const appSecret = randomBytes(32).toString("base64url");

const READABLE: Record<string, { anon: string[]; authenticated: string[] }> = {
  notification: {
    anon: [],
    authenticated: ["context_id", "context_type", "created_at", "event_type", "id", "read_at"],
  },
  notification_preference: {
    anon: [],
    authenticated: ["deals", "meetups", "offers", "reports", "reviews", "user_id", "version"],
  },
};

let a: TestMember;
let b: TestMember;
let ia: Identity;
let ib: Identity;
// Task 3.8 (item 12): every notification names a known event.
let silent: TestEvent;
let required: TestEvent;

beforeAll(async () => {
  a = await signUpMember();
  b = await signUpMember();
  ia = (await memberIdentity(a)).identity;
  ib = (await memberIdentity(b)).identity;
  silent = await testEvent("none");
  required = await testEvent("required");
});

afterAll(async () => {
  await silent.cleanup();
  await required.cleanup();
  await db.end();
  await closeDb();
});

/** Committed email.send jobs of a notification. */
async function jobsFor(id: string): Promise<number> {
  return Number(
    await scalar<string>(
      dbPool(),
      "select count(*)::text from app.job where dedupe_key = 'email.send:' || $1",
      [id],
    ),
  );
}

describe("FR48: app.notify", () => {
  it("creates one notification per recipient and dedupe_key", async () => {
    await rolledBack(async (client) => {
      const dedupe = `test:${randomUUID()}`;
      const make = () =>
        scalar<string>(client, "select app.notify($1, $2, 'account', $3, $4)", [
          a.id,
          silent.type,
          randomUUID(),
          dedupe,
        ]);
      const first = await make();
      expect(await make()).toBe(first);
      expect(
        await scalar<string>(
          client,
          "select count(*)::text from public.notification where dedupe_key = $1",
          [dedupe],
        ),
      ).toBe("1");
      expect(
        (
          await dbError(client, "select app.notify($1, 'Not A Type', 'offer', $2, 'x')", [
            a.id,
            randomUUID(),
          ])
        ).code,
      ).toBe("23514");
    });
  });

  it("task 3.8: an event type that is not in app.notification_event is refused", async () => {
    await rolledBack(async (client) => {
      const error = await dbError(
        client,
        "select app.notify($1, 'unknown.event', 'account', $1, 'x')",
        [a.id],
      );
      expect(error.code).toBe("23503");
    });
  });

  it("the recipient reads it through the Data API, nobody else does", async () => {
    const id = await notify(a.id, silent.type);
    const select = `/notification?select=id,event_type,context_type,read_at&id=eq.${id}`;
    const own = await rest(select, { token: a.accessToken });
    expect(await own.json()).toEqual([
      { id, event_type: silent.type, context_type: "account", read_at: null },
    ]);
    expect(await (await rest(select, { token: b.accessToken })).json()).toEqual([]);
    const anon = await rest(select);
    expect(anon.status).toBeGreaterThanOrEqual(400);
    expect(await restErrorCode(anon)).toBe("42501");
    const recipient = await rest(`/notification?select=recipient_id`, { token: a.accessToken });
    expect(await restErrorCode(recipient)).toBe("42501");
  });
});

describe("task 3.8: the event list and the email job (SEC11, TC55)", () => {
  it("SEC11 the events in the database are NOTIFICATION_EVENTS with the same email channel", async () => {
    const result = await dbPool().query<{ event_type: string; email: string }>(
      `select event_type, email from app.notification_event
        where event_type not like 'test.%' order by event_type`,
    );
    const expected = Object.entries(NOTIFICATION_EVENTS)
      .map(([event_type, definition]) => ({ event_type, email: definition.email }))
      .sort((x, y) => (x.event_type < y.event_type ? -1 : 1));
    expect(result.rows).toEqual(expected);
  });

  it("TC55 a duplicate event keeps one notification and one email job", async () => {
    await rolledBack(async (client) => {
      const dedupe = `test:${randomUUID()}`;
      const make = () =>
        scalar<string>(client, "select app.notify($1, $2, 'account', $1, $3)::text", [
          a.id,
          required.type,
          dedupe,
        ]);
      const id = await make();
      expect(await make()).toBe(id);
      const jobs = await client.query<{ kind: string; payload: unknown; count: string }>(
        `select kind, payload, count(*) over ()::text as count
           from app.job where dedupe_key = 'email.send:' || $1`,
        [id],
      );
      expect(jobs.rows).toEqual([
        { kind: "email.send", payload: { notification_id: id }, count: "1" },
      ]);
    });
  });

  it("TC55 an in-app only event queues no email job, and a rolled back one leaves nothing", async () => {
    const quiet = await rolledBack((client) =>
      scalar<string>(client, "select app.notify($1, $2, 'account', $1, $3)::text", [
        a.id,
        silent.type,
        `test:${randomUUID()}`,
      ]).then(async (id) => {
        expect(
          await scalar<string>(
            client,
            "select count(*)::text from app.job where dedupe_key = 'email.send:' || $1",
            [id],
          ),
        ).toBe("0");
        return id;
      }),
    );
    const undone = await rolledBack((client) =>
      scalar<string>(client, "select app.notify($1, $2, 'account', $1, $3)::text", [
        a.id,
        required.type,
        `test:${randomUUID()}`,
      ]),
    );
    expect(await jobsFor(quiet)).toBe(0);
    expect(await jobsFor(undone)).toBe(0);
    expect(
      await scalar<string>(
        dbPool(),
        "select count(*)::text from public.notification where id = $1",
        [undone],
      ),
    ).toBe("0");
  });
});

/** API078 as the route runs it. */
function list(identity: Identity | null, query = ""): Promise<Outcome> {
  return outcome(async () => {
    const page = await listNotifications(
      new Request(`http://localhost:3000/api/notifications${query}`),
      { db, traceId: trace(), identity: () => Promise.resolve(identity), appSecret },
    );
    return Response.json({ data: page.data, meta: page.meta });
  });
}

interface ListBody {
  data: { id: string; event_type: string; destination: string; read_at: string | null }[];
  meta: { next_cursor: string | null };
}

function ids(result: Outcome): string[] {
  return (result.body as ListBody).data.map((item) => item.id);
}

/** API079 as the route runs it. */
function markRead(identity: Identity | null, body: unknown): Promise<Outcome> {
  return outcome(async () => {
    await markNotificationsRead(
      new Request("http://localhost:3000/api/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { db, traceId: trace(), identity: () => Promise.resolve(identity) },
    );
    return new Response(null, { status: 204 });
  });
}

async function readAt(id: string): Promise<string | null> {
  return scalar<string | null>(
    dbPool(),
    "select read_at::text from public.notification where id = $1",
    [id],
  );
}

describe("FR48 and TC20: API078, API079 and API115", () => {
  it("TC20 a member never lists another member's notifications", async () => {
    const own = [await notify(a.id, required.type), await notify(a.id, required.type)];
    const other = await notify(b.id, required.type);
    const mine = await list(ia, "?limit=50");
    expect(mine.status).toBe(200);
    expect(ids(mine)).toEqual(expect.arrayContaining(own));
    expect(ids(mine)).not.toContain(other);
    const theirs = await list(ib, "?limit=50");
    expect(ids(theirs)).toContain(other);
    expect(ids(theirs)).not.toEqual(expect.arrayContaining(own));
  });

  it("TC20 the destination is derived on the server", async () => {
    const known = await notify(a.id, "account.deletion_recovered");
    const unknown = await notify(a.id, silent.type);
    const body = (await list(ia, "?limit=50")).body as ListBody;
    // FR48: a known event opens its own fixed page; one this build cannot open goes nowhere new.
    expect(body.data.find((item) => item.id === known)?.destination).toBe("/account");
    expect(body.data.find((item) => item.id === unknown)?.destination).toBe("/notifications");
    for (const item of body.data) expect(item.destination.startsWith("/")).toBe(true);
    await dbPool().query("delete from app.job where dedupe_key = 'email.send:' || $1", [known]);
    await dbPool().query("delete from public.notification where id = $1", [known]);
  });

  it("TC20 marking another member's notification changes nothing and reveals nothing", async () => {
    const theirs = await notify(b.id, required.type);
    const mine = await notify(a.id, required.type);
    const unknown = randomUUID();
    for (const body of [
      { ids: [theirs], read: true },
      { ids: [unknown], read: true },
    ]) {
      expect((await markRead(ia, body)).status).toBe(204);
    }
    expect(await readAt(theirs)).toBeNull();
    expect((await markRead(ia, { ids: [mine, theirs], read: true })).status).toBe(204);
    expect(await readAt(mine)).not.toBeNull();
    expect(await readAt(theirs)).toBeNull();
    // Marking again keeps the first time (no second change).
    const first = await readAt(mine);
    expect((await markRead(ia, { ids: [mine], read: true })).status).toBe(204);
    expect(await readAt(mine)).toBe(first);
  });

  it("API079 refuses a body outside the contract", async () => {
    const id = randomUUID();
    expect((await markRead(ia, { ids: [], read: true })).code).toBe("VALIDATION_FAILED");
    expect((await markRead(ia, { ids: [id, id], read: true })).code).toBe("VALIDATION_FAILED");
    expect((await markRead(ia, { ids: [id], read: false })).code).toBe("VALIDATION_FAILED");
    expect((await markRead(ia, { ids: ["not-a-uuid"], read: true })).code).toBe(
      "VALIDATION_FAILED",
    );
    expect((await markRead(ia, { ids: [id], read: true, recipient_id: b.id })).code).toBe(
      "BAD_REQUEST",
    );
    const many = Array.from({ length: 101 }, () => randomUUID());
    expect((await markRead(ia, { ids: many, read: true })).code).toBe("VALIDATION_FAILED");
    expect((await markRead(null, { ids: [id], read: true })).code).toBe("UNAUTHENTICATED");
  });

  it("API115 counts the member's own unread notifications of the last 90 days", async () => {
    const member = await signUpMember();
    const { identity } = await memberIdentity(member);
    const ctx = (who: Identity | null) => ({
      db,
      traceId: trace(),
      identity: () => Promise.resolve(who),
    });
    expect(await unreadCount(ctx(identity))).toEqual({ count: 0 });
    const first = await notify(member.id, required.type);
    await notify(member.id, required.type);
    await notify(b.id, required.type);
    expect(await unreadCount(ctx(identity))).toEqual({ count: 2 });
    await markRead(identity, { ids: [first], read: true });
    expect(await unreadCount(ctx(identity))).toEqual({ count: 1 });
    // RET07: older than 90 days is neither listed nor counted (task 8.1 deletes it).
    const old = await notify(member.id, required.type);
    await dbPool().query(
      "update public.notification set created_at = now() - interval '91 days' where id = $1",
      [old],
    );
    expect(await unreadCount(ctx(identity))).toEqual({ count: 1 });
    expect(ids(await list(identity))).not.toContain(old);
    expect((await outcome(async () => Response.json(await unreadCount(ctx(null))))).code).toBe(
      "UNAUTHENTICATED",
    );
  });

  it("NFR14 pages newest first with a signed cursor bound to this list", async () => {
    const member = await signUpMember();
    const { identity } = await memberIdentity(member);
    const made: string[] = [];
    for (let n = 0; n < 5; n++) made.push(await notify(member.id, silent.type));
    const first = await list(identity, "?limit=2");
    const page1 = first.body as ListBody;
    expect(page1.data).toHaveLength(2);
    expect(page1.meta.next_cursor).not.toBeNull();
    const seen = [...ids(first)];
    let cursor = page1.meta.next_cursor;
    while (cursor !== null) {
      const next = await list(identity, `?limit=2&cursor=${encodeURIComponent(cursor)}`);
      expect(next.status).toBe(200);
      seen.push(...ids(next));
      cursor = (next.body as ListBody).meta.next_cursor;
    }
    expect([...seen].sort()).toEqual([...made].sort());
    expect(new Set(seen).size).toBe(5);
    // Newest first: the last made is shown first.
    expect(seen[0]).toBe(made[4]);

    const forged = encodeCursor(appSecret, ["2026-01-01 00:00:00+00", randomUUID()], {
      list: "API077",
    });
    expect((await list(identity, `?cursor=${forged}`)).code).toBe("INVALID_CURSOR");
    expect((await list(identity, "?cursor=abc.def")).code).toBe("INVALID_CURSOR");
    expect((await list(identity, "?limit=51")).code).toBe("BAD_REQUEST");
    expect((await list(identity, "?status=unread")).code).toBe("BAD_REQUEST");
    expect((await list(null)).code).toBe("UNAUTHENTICATED");
  });

  it("member access: unconfirmed, new terms, restricted and awaiting deletion are refused", async () => {
    const member = await signUpMember();
    const { identity } = await memberIdentity(member);
    await withdrawAcknowledgments(member.id);
    expect((await list(identity)).code).toBe("TERMS_NOT_ACKNOWLEDGED");
    const direct = await outcome(() =>
      db.withActor(identity.claims, trace(), async (tx) => {
        await tx.query("select id from app.my_notifications(null, null, 20)");
        return new Response(null);
      }),
    );
    expect(direct.code).toBe("TERMS_NOT_ACKNOWLEDGED");
    await changeMember(
      member.id,
      "update public.account_control set status = 'banned' where user_id = $1",
    );
    expect((await list(identity)).code).toBe("ACCOUNT_RESTRICTED");
  });
});

describe("DEC77: the read functions of task 3.8", () => {
  it("DEC77 app.my_notifications(): another member's session reads only its own notifications", async () => {
    const theirs = await notify(a.id, required.type);
    const rows = await db.withActor(ib.claims, trace(), async (tx) => {
      const result = await tx.query<{ id: string }>(
        "select id from app.my_notifications(null, null, 51)",
      );
      return result.rows.map((row) => row.id);
    });
    expect(rows).not.toContain(theirs);
  });

  it("DEC77 app.my_notifications(): a guest is UNAUTHENTICATED", async () => {
    const guest = await outcome(() =>
      db.withActor(null, trace(), async (tx) => {
        await tx.query("select id from app.my_notifications(null, null, 20)");
        return new Response(null);
      }),
    );
    expect(guest.code).toBe("UNAUTHENTICATED");
  });

  it("DEC77 app.unread_notification_count(): another member's session counts only its own", async () => {
    const member = await signUpMember();
    const { identity } = await memberIdentity(member);
    await notify(a.id, required.type);
    const count = await db.withActor(identity.claims, trace(), async (tx) => {
      const result = await tx.query<{ count: number }>(
        "select app.unread_notification_count() as count",
      );
      return result.rows[0]?.count;
    });
    expect(count).toBe(0);
  });

  it("DEC77 app.unread_notification_count(): a guest is UNAUTHENTICATED", async () => {
    const guest = await outcome(() =>
      db.withActor(null, trace(), async (tx) => {
        await tx.query("select app.unread_notification_count() as count");
        return new Response(null);
      }),
    );
    expect(guest.code).toBe("UNAUTHENTICATED");
  });
});

/** API029 as the route runs it. */
function patchPreferences(identity: Identity | null, body: unknown): Promise<Outcome> {
  return outcome(async () => {
    const data = await updatePreferences(
      new Request("http://localhost:3000/api/me/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { db, traceId: trace(), identity: () => Promise.resolve(identity) },
    );
    return Response.json({ data });
  });
}

interface PreferenceRow {
  offers: boolean;
  meetups: boolean;
  deals: boolean;
  reports: boolean;
  reviews: boolean;
  version: number;
}

async function preferencesOf(id: string): Promise<PreferenceRow> {
  const result = await dbPool().query<PreferenceRow>(
    `select offers, meetups, deals, reports, reviews, version
       from public.notification_preference where user_id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("no preference row");
  return row;
}

describe("FR68, BR38, DEC49 and DEC65: API029", () => {
  it("DEC65 a member turns optional groups on one at a time, from all off", async () => {
    const member = await signUpMember();
    const { identity } = await memberIdentity(member);
    expect(await preferencesOf(member.id)).toEqual({
      offers: false,
      meetups: false,
      deals: false,
      reports: false,
      reviews: false,
      version: 1,
    });
    const saved = await patchPreferences(identity, {
      email_groups: { offers: true },
      expected_version: 1,
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({
      data: {
        email_groups: {
          offers: true,
          meetups: false,
          deals: false,
          reviews: false,
          reports: false,
        },
        version: 2,
      },
    });
    // Nothing changed: the same version, no new one.
    const same = await patchPreferences(identity, {
      email_groups: { offers: true },
      expected_version: 2,
    });
    expect((same.body as { data: { version: number } }).data.version).toBe(2);
    // A stale version is 409, and changes nothing.
    const stale = await patchPreferences(identity, {
      email_groups: { deals: true },
      expected_version: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.code).toBe("STATE_CONFLICT");
    expect((await preferencesOf(member.id)).deals).toBe(false);
  });

  it("BR38 security email has no field: any other group is refused", async () => {
    const member = await signUpMember();
    const { identity } = await memberIdentity(member);
    for (const email_groups of [{ security: false }, { messages: true }, { offers: "yes" }]) {
      const refused = await patchPreferences(identity, { email_groups, expected_version: 1 });
      expect(refused.status, JSON.stringify(email_groups)).toBe(400);
      expect(refused.code).toBe("BAD_REQUEST");
    }
    expect(
      (await patchPreferences(identity, { email_groups: {}, expected_version: 1, locale: "ar" }))
        .code,
    ).toBe("BAD_REQUEST");
    // The database refuses the same, whatever the server sent.
    const direct = await outcome(() =>
      db.withActor(identity.claims, trace(), async (tx) => {
        await tx.query(
          "select preferences_version from app.update_notification_preferences(1, $1::jsonb)",
          [JSON.stringify({ security: false })],
        );
        return new Response(null);
      }),
    );
    expect(direct.code).toBe("BAD_REQUEST");
    expect((await preferencesOf(member.id)).version).toBe(1);
  });

  it("a member changes only its own preferences, and a guest none", async () => {
    const before = await preferencesOf(a.id);
    const result = await patchPreferences(ib, {
      email_groups: { reviews: true },
      expected_version: (await preferencesOf(b.id)).version,
    });
    expect(result.status).toBe(200);
    expect(await preferencesOf(a.id)).toEqual(before);
    expect((await preferencesOf(b.id)).reviews).toBe(true);
    expect(
      (await patchPreferences(null, { email_groups: { offers: true }, expected_version: 1 })).code,
    ).toBe("UNAUTHENTICATED");
  });

  it("member access: new terms are refused before any change", async () => {
    const member = await signUpMember();
    const { identity } = await memberIdentity(member);
    await withdrawAcknowledgments(member.id);
    const refused = await patchPreferences(identity, {
      email_groups: { offers: true },
      expected_version: 1,
    });
    expect(refused.code).toBe("TERMS_NOT_ACKNOWLEDGED");
    expect((await preferencesOf(member.id)).offers).toBe(false);
  });
});

describe("DEC49 and DEC65: email preferences", () => {
  it("a new member gets a row with the five optional groups off", async () => {
    const res = await rest(
      `/notification_preference?select=offers,meetups,deals,reports,reviews,version&user_id=eq.${a.id}`,
      { token: a.accessToken },
    );
    expect(await res.json()).toEqual([
      { offers: false, meetups: false, deals: false, reports: false, reviews: false, version: 1 },
    ]);
    expect(
      await (
        await rest(`/notification_preference?select=user_id&user_id=eq.${a.id}`, {
          token: b.accessToken,
        })
      ).json(),
    ).toEqual([]);
  });

  it("every profile has its preference row", async () => {
    const missing = await scalar<string>(
      dbPool(),
      `select count(*)::text from public.profile p
        where not exists (select 1 from public.notification_preference n where n.user_id = p.id)`,
    );
    expect(missing).toBe("0");
  });
});

describe("who reads and writes", () => {
  it.each(Object.keys(READABLE))(
    "%s: anon and authenticated may read exactly the listed columns",
    async (table) => {
      const readable = await rolledBack(async (client) => {
        const result = await client.query<{ role: string; name: string }>(
          `select r.role, c.column_name::text as name
             from information_schema.columns c
            cross join unnest(array['anon', 'authenticated']) as r(role)
            where c.table_schema = 'public' and c.table_name = $1
              and has_column_privilege(r.role, format('public.%I', $1), c.column_name, 'SELECT')
            order by 1, 2`,
          [table],
        );
        return result.rows;
      });
      expect(readable.filter((r) => r.role === "anon").map((r) => r.name)).toEqual(
        READABLE[table]?.anon,
      );
      expect(readable.filter((r) => r.role === "authenticated").map((r) => r.name)).toEqual(
        READABLE[table]?.authenticated,
      );
    },
  );

  it("no member writes notifications or preferences through the Data API", async () => {
    for (const [method, path, body] of [
      ["POST", "/notification", { recipient_id: a.id, event_type: "x.y", context_type: "offer" }],
      ["PATCH", `/notification?recipient_id=eq.${a.id}`, { read_at: new Date().toISOString() }],
      ["PATCH", `/notification_preference?user_id=eq.${a.id}`, { offers: true }],
    ] as const) {
      const res = await rest(path, { method, token: a.accessToken, body });
      expect(res.status, `${method} ${path}`).toBeGreaterThanOrEqual(400);
      expect(await restErrorCode(res)).toBe("42501");
    }
  });
});
