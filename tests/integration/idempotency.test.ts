// BR32, NFR09, item 1 of task 2.4: app.idempotency_claim and app.idempotency_complete.
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setClock } from "./_harness/clock.ts";
import { closeDb, dbError, dbPool, rolledBack, scalar } from "./_harness/db.ts";
import { withTwoConnections } from "./_harness/parallel.ts";
import { actAs, memberClaims } from "./_harness/roles.ts";
import { signUpMember, type TestMember } from "./_harness/users.ts";

afterAll(closeDb);

const ROUTE = "POST /api/test-effect";
let member: TestMember;

beforeAll(async () => {
  member = await signUpMember();
});

/**
 * What an entry point does: claim, then one visible effect (a notification whose context_id
 * is the request key), then complete with the effect's id. Returns the stored result on a
 * repeat, without a second effect.
 */
async function runOnce(client: pg.ClientBase, key: string, input: object): Promise<unknown> {
  const prior = await scalar<unknown>(client, "select app.idempotency_claim($1, $2, $3::jsonb)", [
    ROUTE,
    key,
    JSON.stringify(input),
  ]);
  if (prior !== null) return prior;
  const effect = await scalar<string>(
    client,
    "select app.notify($1, 'test.effect', 'account', $2, $3)",
    [member.id, key, randomUUID()],
  );
  const result = { notification_id: effect };
  await client.query("select app.idempotency_complete($1, $2, $3::jsonb)", [
    ROUTE,
    key,
    JSON.stringify(result),
  ]);
  return result;
}

async function effects(key: string): Promise<number> {
  const count = await scalar<string>(
    dbPool(),
    "select count(*)::text from public.notification where context_id = $1",
    [key],
  );
  return Number(count);
}

describe("BR32 and NFR09: one effect per idempotency key", () => {
  it("two concurrent requests with the same key: the second waits, then gets the first one's result", async () => {
    const key = randomUUID();
    const input = { title: "إعلان", price_minor: 35000 };
    await withTwoConnections(async (a, b) => {
      await a.query("begin");
      await actAs(a, "postgres", memberClaims(member.id));
      const first = await runOnce(a, key, input);

      await b.query("begin");
      await actAs(b, "postgres", memberClaims(member.id));
      let settled = false;
      const second = runOnce(b, key, input).finally(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);

      await a.query("commit");
      expect(await second).toEqual(first);
      await b.query("commit");
    });
    expect(await effects(key)).toBe(1);
  });

  it("the same key with another payload is IDEMPOTENCY_CONFLICT", async () => {
    const key = randomUUID();
    await withTwoConnections(async (a) => {
      await a.query("begin");
      await actAs(a, "postgres", memberClaims(member.id));
      await runOnce(a, key, { n: 1 });
      await a.query("commit");
    });
    const error = await rolledBack(async (client) => {
      await actAs(client, "postgres", memberClaims(member.id));
      return dbError(client, "select app.idempotency_claim($1, $2, $3::jsonb)", [
        ROUTE,
        key,
        JSON.stringify({ n: 2 }),
      ]);
    });
    expect(error.code).toBe("SJ001");
    expect(error.message).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("when the first request fails and rolls back, the waiting one runs as new", async () => {
    const key = randomUUID();
    await withTwoConnections(async (a, b) => {
      await a.query("begin");
      await actAs(a, "postgres", memberClaims(member.id));
      await runOnce(a, key, { n: 1 });

      await b.query("begin");
      await actAs(b, "postgres", memberClaims(member.id));
      const second = scalar<unknown>(b, "select app.idempotency_claim($1, $2, $3::jsonb)", [
        ROUTE,
        key,
        JSON.stringify({ n: 1 }),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await a.query("rollback");
      expect(await second).toBeNull();
      await b.query("rollback");
    });
    expect(await effects(key)).toBe(0);
  });

  it("another member, another route, or a key older than 24 hours is new", async () => {
    const key = randomUUID();
    await withTwoConnections(async (a) => {
      await a.query("begin");
      await actAs(a, "postgres", memberClaims(member.id));
      await runOnce(a, key, { n: 1 });
      await a.query("commit");
    });
    await rolledBack(async (client) => {
      const claim = (route: string) =>
        scalar<unknown>(client, "select app.idempotency_claim($1, $2, $3::jsonb)", [
          route,
          key,
          JSON.stringify({ n: 1 }),
        ]);
      await actAs(client, "postgres", memberClaims());
      expect(await claim(ROUTE)).toBeNull();
      await actAs(client, "postgres", memberClaims(member.id));
      expect(await claim("POST /api/other")).toBeNull();
      expect(await claim(ROUTE)).not.toBeNull();
      await setClock(client, new Date(Date.now() + 25 * 3600 * 1000));
      expect(await claim(ROUTE)).toBeNull();
    });
  });

  it("a claim cannot be committed without its result", async () => {
    const error = await rolledBack(async (client) => {
      await actAs(client, "postgres", memberClaims(member.id));
      await client.query("select app.idempotency_claim($1, $2, '{}'::jsonb)", [
        ROUTE,
        randomUUID(),
      ]);
      return dbError(client, "set constraints all immediate");
    });
    expect(error.code).toBe("23514");
  });

  it("needs the member's verified claims", async () => {
    const error = await rolledBack((client) =>
      dbError(client, "select app.idempotency_claim($1, $2, '{}'::jsonb)", [ROUTE, randomUUID()]),
    );
    expect(error.message).toBe("UNAUTHENTICATED");
  });
});
