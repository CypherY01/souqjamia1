// FR48, DEC49, DEC65, section 6.3, item 7 of task 2.4: notifications and email preferences.
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, dbError, dbPool, rolledBack, scalar } from "./_harness/db.ts";
import { rest, restErrorCode, signUpMember, type TestMember } from "./_harness/users.ts";

afterAll(closeDb);

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

beforeAll(async () => {
  a = await signUpMember();
  b = await signUpMember();
});

describe("FR48: app.notify", () => {
  it("creates one notification per recipient and dedupe_key", async () => {
    await rolledBack(async (client) => {
      const dedupe = `test:${randomUUID()}`;
      const notify = () =>
        scalar<string>(client, "select app.notify($1, 'offer.received', 'offer', $2, $3)", [
          a.id,
          randomUUID(),
          dedupe,
        ]);
      const first = await notify();
      expect(await notify()).toBe(first);
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

  it("the recipient reads it through the Data API, nobody else does", async () => {
    const id = await scalar<string>(
      dbPool(),
      "select app.notify($1, 'offer.received', 'offer', $2, $3)",
      [a.id, randomUUID(), `test:${randomUUID()}`],
    );
    const select = `/notification?select=id,event_type,context_type,read_at&id=eq.${id}`;
    const own = await rest(select, { token: a.accessToken });
    expect(await own.json()).toEqual([
      { id, event_type: "offer.received", context_type: "offer", read_at: null },
    ]);
    expect(await (await rest(select, { token: b.accessToken })).json()).toEqual([]);
    const anon = await rest(select);
    expect(anon.status).toBeGreaterThanOrEqual(400);
    expect(await restErrorCode(anon)).toBe("42501");
    const recipient = await rest(`/notification?select=recipient_id`, { token: a.accessToken });
    expect(await restErrorCode(recipient)).toBe("42501");
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
