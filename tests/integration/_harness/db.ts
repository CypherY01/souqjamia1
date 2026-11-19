// Connections to the local database for integration tests (task 2.1).
// The URL comes from global-setup.ts, which refuses any host that is not this machine.
import pg from "pg";
import { inject } from "vitest";

let pool: pg.Pool | undefined;

export function dbPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: inject("dbUrl"), max: 4 });
  return pool;
}

export async function closeDb(): Promise<void> {
  const current = pool;
  pool = undefined;
  await current?.end();
}

/** Runs `fn` on one connection inside a transaction that is always rolled back. */
export async function rolledBack<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await dbPool().connect();
  try {
    await client.query("begin");
    return await fn(client);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

/**
 * Runs one statement that must fail, inside a savepoint so the surrounding transaction stays
 * usable, and returns the database error.
 */
export async function dbError(
  client: pg.ClientBase,
  sql: string,
  params: unknown[] = [],
): Promise<pg.DatabaseError> {
  await client.query("savepoint expect_error");
  try {
    await client.query(sql, params);
  } catch (error) {
    await client.query("rollback to savepoint expect_error");
    if (error instanceof pg.DatabaseError) return error;
    throw error;
  }
  await client.query("release savepoint expect_error");
  throw new Error(`expected a database error from: ${sql}`);
}

/** A connection or the pool (each pool query is its own transaction). */
export type Queryable = pg.ClientBase | pg.Pool;

/** The single value of a one-row, one-column query. */
export async function scalar<T>(
  client: Queryable,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const result = await client.query<Record<string, T>>(sql, params);
  const row = result.rows[0];
  const field = result.fields[0];
  if (row === undefined || field === undefined) throw new Error(`no value from: ${sql}`);
  return row[field.name] as T;
}
