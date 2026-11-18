// Two concurrent connections for race tests (task 2.1; first real use in task 2.4).
import type pg from "pg";
import { dbPool } from "./db.ts";

/**
 * Gives `fn` two separate connections. Nothing is rolled back automatically: tests that commit
 * must use data that cannot collide with other tests (random ids).
 */
export async function withTwoConnections<T>(
  fn: (a: pg.PoolClient, b: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const a = await dbPool().connect();
  const b = await dbPool().connect();
  try {
    return await fn(a, b);
  } finally {
    await a.query("rollback").catch(() => undefined);
    await b.query("rollback").catch(() => undefined);
    a.release();
    b.release();
  }
}
