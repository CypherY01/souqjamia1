// FR74, SEC07, TC62 (database part), DEC70, item 3 of task 2.4: rate limit counters.
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { setClock } from "./_harness/clock.ts";
import { closeDb, dbError, dbPool, rolledBack, scalar, type Queryable } from "./_harness/db.ts";
import { withTwoConnections } from "./_harness/parallel.ts";
import { actAs } from "./_harness/roles.ts";

afterAll(closeDb);

/** A fresh scope and key, so committed counters never collide with another test. */
function bucket(): { scope: string; key: Buffer } {
  return { scope: `test:${randomUUID().slice(0, 8)}`, key: randomBytes(32) };
}

async function count(client: Queryable, scope: string, key: Buffer): Promise<number | null> {
  const result = await client.query<{ count: string }>(
    "select count::text from app.rate_limit_bucket where scope = $1 and key_hash = $2",
    [scope, key],
  );
  const row = result.rows[0];
  return row === undefined ? null : Number(row.count);
}

describe("success limits: app.rate_limit_take in the business transaction", () => {
  it("allows the limit, then RATE_LIMITED with the seconds left in the window", async () => {
    const { scope, key } = bucket();
    await rolledBack(async (client) => {
      await setClock(client, new Date("2026-12-01T12:00:20Z"));
      for (let i = 0; i < 3; i++) {
        await client.query("select app.rate_limit_take($1, $2, 3, '1 minute')", [scope, key]);
      }
      const error = await dbError(client, "select app.rate_limit_take($1, $2, 3, '1 minute')", [
        scope,
        key,
      ]);
      expect(error.code).toBe("SJ001");
      expect(error.message).toBe("RATE_LIMITED");
      expect(JSON.parse(error.detail ?? "{}")).toEqual({ retry_after: 40 });
    });
  });

  it("TC62: adjacent fixed windows, refused in the last second, allowed in the next", async () => {
    const { scope, key } = bucket();
    await rolledBack(async (client) => {
      await setClock(client, new Date("2026-12-01T12:00:59Z"));
      for (let i = 0; i < 3; i++) {
        await client.query("select app.rate_limit_take($1, $2, 3, '1 minute')", [scope, key]);
      }
      const last = await dbError(client, "select app.rate_limit_take($1, $2, 3, '1 minute')", [
        scope,
        key,
      ]);
      expect(JSON.parse(last.detail ?? "{}")).toEqual({ retry_after: 1 });
      await setClock(client, new Date("2026-12-01T12:01:00Z"));
      await client.query("select app.rate_limit_take($1, $2, 3, '1 minute')", [scope, key]);
    });
  });

  it("an operation that fails and rolls back is not counted", async () => {
    const { scope, key } = bucket();
    await rolledBack(async (client) => {
      await client.query("select app.rate_limit_take($1, $2, 5, '1 day')", [scope, key]);
    });
    expect(await count(dbPool(), scope, key)).toBeNull();
  });
});

describe("DEC70: failure limits are kept in their own transaction", () => {
  it("a failed attempt stays counted after its transaction is rolled back", async () => {
    const success = bucket();
    const failure = bucket();
    await withTwoConnections(async (operation, server) => {
      // The operation counts a success inside its transaction, then fails and rolls back.
      await operation.query("begin");
      await operation.query("select app.rate_limit_take($1, $2, 5, '1 day')", [
        success.scope,
        success.key,
      ]);
      await dbError(operation, "select app.raise_api_error('STATE_CONFLICT')");
      await operation.query("rollback");

      // The server records the failure on its own connection, in its own transaction.
      await server.query("begin");
      await actAs(server, "souq_web");
      expect(
        await scalar<number>(server, "select app.rate_limit_hit($1, $2, 5, '1 day')", [
          failure.scope,
          failure.key,
        ]),
      ).toBe(0);
      await server.query("commit");
    });
    expect(await count(dbPool(), success.scope, success.key)).toBeNull();
    expect(await count(dbPool(), failure.scope, failure.key)).toBe(1);
  });

  it("why it needs its own transaction: a hit inside the failed transaction is lost", async () => {
    const { scope, key } = bucket();
    await rolledBack(async (client) => {
      await client.query("select app.rate_limit_hit($1, $2, 5, '1 day')", [scope, key]);
    });
    expect(await count(dbPool(), scope, key)).toBeNull();
  });

  it("app.rate_limit_hit never raises, and returns the wait once over the limit", async () => {
    const { scope, key } = bucket();
    const hit = async () =>
      scalar<number>(dbPool(), "select app.rate_limit_hit($1, $2, 2, '1 day')", [scope, key]);
    expect(await hit()).toBe(0);
    expect(await hit()).toBe(0);
    const wait = await hit();
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(86400);
    expect(await count(dbPool(), scope, key)).toBe(3);
  });

  it("app.rate_limit_check reads without counting", async () => {
    const { scope, key } = bucket();
    const check = () =>
      scalar<number>(dbPool(), "select app.rate_limit_check($1, $2, 2, '1 day')", [scope, key]);
    expect(await check()).toBe(0);
    expect(await count(dbPool(), scope, key)).toBeNull();
    await dbPool().query("select app.rate_limit_hit($1, $2, 2, '1 day')", [scope, key]);
    await dbPool().query("select app.rate_limit_hit($1, $2, 2, '1 day')", [scope, key]);
    expect(await check()).toBeGreaterThan(0);
    expect(await count(dbPool(), scope, key)).toBe(2);
  });

  it("only souq_web may call the failure functions", async () => {
    const { scope, key } = bucket();
    for (const role of ["anon", "authenticated", "service_role", "souq_worker"] as const) {
      const error = await rolledBack(async (client) => {
        await actAs(client, role);
        return dbError(client, "select app.rate_limit_hit($1, $2, 5, '1 day')", [scope, key]);
      });
      expect(error.code, role).toBe("42501");
    }
  });
});

describe("TC62: counters are central and atomic", () => {
  it("concurrent hits from several connections lose no increment", async () => {
    const { scope, key } = bucket();
    await Promise.all(
      Array.from({ length: 20 }, () =>
        dbPool().query("select app.rate_limit_hit($1, $2, 1000, '1 hour')", [scope, key]),
      ),
    );
    expect(await count(dbPool(), scope, key)).toBe(20);
  });

  it("a daily window starts at midnight UTC and is kept until its end plus 24 hours", async () => {
    const { scope, key } = bucket();
    const row = await rolledBack(async (client) => {
      await setClock(client, new Date("2026-12-01T23:30:00Z"));
      await client.query("select app.rate_limit_take($1, $2, 5, '1 day')", [scope, key]);
      const result = await client.query<{ window_start: Date; expires_at: Date }>(
        "select window_start, expires_at from app.rate_limit_bucket where scope = $1 and key_hash = $2",
        [scope, key],
      );
      return result.rows[0];
    });
    expect(row?.window_start).toEqual(new Date("2026-12-01T00:00:00Z"));
    expect(row?.expires_at).toEqual(new Date("2026-12-03T00:00:00Z"));
  });

  it("refuses a window that does not divide a day", async () => {
    const { scope, key } = bucket();
    const error = await rolledBack((client) =>
      dbError(client, "select app.rate_limit_take($1, $2, 5, '7 minutes')", [scope, key]),
    );
    expect(error.code).toBe("XX000");
  });
});
