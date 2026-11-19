// The web server's database access (task 3.1, DEC36, SEC02): a direct Postgres connection as the
// souq_web role, which owns nothing, has no table privileges and no BYPASSRLS, and may only run
// the app entry points granted to it.
//
// withActor runs one business transaction. The verified JWT claims (lib/auth/identity.ts) and
// the trace id are set for that transaction only, with set_config(..., true), exactly as
// PostgREST does, so app.actor_id() and auth.uid() see the same member and nothing is left on
// the connection when it returns to the pool, also behind a transaction-mode pooler.
//
// DEC72: serialization failures and deadlocks roll the whole transaction back, so withActor runs
// it again from the start, at most three times with a short growing delay, with the same inputs
// and the same Idempotency-Key. Every other error is mapped once (lib/db/errors.ts).
import { log } from "@souq/log";
import pg from "pg";
import { serverEnv } from "../env.ts";
import { ApiError } from "../http/errors.ts";
import { apiErrorFromDb, isDatabaseFailure, isTransient, sqlstateOf } from "./errors.ts";

export const WEB_ROLE = "souq_web";
/** Item 9. The web app runs as one instance at first (chapter 07). */
export const POOL_SIZE = 10;
/** DEC72: retries after the first attempt. */
export const MAX_TRANSIENT_RETRIES = 3;

/** What a transaction body may use: single statements on the transaction's connection. */
export interface Tx {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>>;
}

export interface WithActorOptions {
  /** Test hook for the DEC72 delay. */
  sleep?: (ms: number) => Promise<void>;
}

export interface AppDb {
  /**
   * One business transaction as souq_web for `claims` (null: a guest). `fn` may run more than
   * once (DEC72): everything it does must happen inside the transaction, through `tx`, with the
   * same inputs, so a retry repeats nothing outside it. Throws ApiError for database errors.
   */
  withActor<T>(
    claims: Readonly<Record<string, unknown>> | null,
    traceId: string,
    fn: (tx: Tx) => Promise<T>,
    options?: WithActorOptions,
  ): Promise<T>;
  /**
   * One statement in its own transaction, outside any business transaction: DEC70 failure
   * counters and readiness. No identity is set. Throws ApiError for database errors.
   */
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    traceId: string,
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>>;
  end(): Promise<void>;
}

export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: POOL_SIZE,
    application_name: "souq-web",
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  // An idle connection that drops (database restart) emits on the pool; unhandled, it would end
  // the process. The pool replaces the connection on next use.
  pool.on("error", (error) => {
    log.warn("db.idle_connection_lost", { sqlstate: sqlstateOf(error), name: error.name });
  });
  return pool;
}

/** DEC72: about 20, 40 and 80 ms, each with up to as much again of random jitter. */
export function retryDelayMs(retry: number): number {
  const base = 20 * 2 ** (retry - 1);
  return base + Math.floor(Math.random() * base);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Thrown when DATABASE_URL logs in as another role: a configuration error (item 9). */
export class WrongRoleError extends Error {
  override name = "WrongRoleError";
}

export function createAppDb(pool: pg.Pool): AppDb {
  let roleChecked: Promise<void> | undefined;

  // Item 9: the first use checks the role once, as the worker does at start-up. A failed check
  // is not cached, so the server recovers once the database is reachable.
  function checkRole(): Promise<void> {
    roleChecked ??= pool
      .query<{ role: string }>("select current_user as role")
      .then((result) => {
        if (result.rows[0]?.role !== WEB_ROLE) {
          throw new WrongRoleError(`DATABASE_URL must use the ${WEB_ROLE} role.`);
        }
      })
      .catch((error: unknown) => {
        roleChecked = undefined;
        throw error;
      });
    return roleChecked;
  }

  function fail(error: unknown, traceId: string): never {
    if (error instanceof WrongRoleError) {
      log.error("db.config_invalid", { trace_id: traceId, message: error.message });
      throw new ApiError("INTERNAL_ERROR");
    }
    if (error instanceof ApiError || isDatabaseFailure(error)) {
      throw apiErrorFromDb(error, traceId);
    }
    throw error;
  }

  async function runOnce<T>(
    claims: Readonly<Record<string, unknown>> | null,
    traceId: string,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    let broken: Error | undefined;
    try {
      await client.query("begin");
      await client.query(
        "select set_config('request.jwt.claims', $1, true), set_config('app.trace_id', $2, true)",
        [claims === null ? "" : JSON.stringify(claims), traceId],
      );
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (error) {
      try {
        await client.query("rollback");
      } catch (rollbackError) {
        broken = rollbackError instanceof Error ? rollbackError : new Error("rollback failed");
      }
      throw error;
    } finally {
      // A connection that could not roll back is destroyed instead of reused.
      client.release(broken);
    }
  }

  return {
    async withActor(claims, traceId, fn, options = {}) {
      const sleep = options.sleep ?? defaultSleep;
      try {
        await checkRole();
      } catch (error) {
        fail(error, traceId);
      }
      for (let retry = 0; ; retry++) {
        try {
          return await runOnce(claims, traceId, fn);
        } catch (error) {
          if (isTransient(error) && retry < MAX_TRANSIENT_RETRIES) {
            log.warn("db.retry", {
              trace_id: traceId,
              sqlstate: sqlstateOf(error),
              retry: retry + 1,
            });
            await sleep(retryDelayMs(retry + 1));
            continue;
          }
          fail(error, traceId);
        }
      }
    },

    async query(traceId, text, values) {
      try {
        await checkRole();
        return await pool.query(text, values);
      } catch (error) {
        fail(error, traceId);
      }
    },

    end() {
      return pool.end();
    },
  };
}

const POOL_KEY = Symbol.for("souq.web.pool");
let moduleDb: AppDb | undefined;

/**
 * The process's database client, from DATABASE_URL.
 * Next.js bundles server code per route, so this module can exist more than once in one process
 * (and again after a reload in `pnpm dev`). The pool is shared through globalThis, so the process
 * keeps one set of POOL_SIZE connections. The client around it is per module copy: the errors it
 * throws are then this copy's ApiError, and `instanceof ApiError` holds in the code that called
 * it. A client shared through globalThis threw another route's ApiError class, and a page then
 * showed its error state for a plain UNAUTHENTICATED (found in the local review of task 3.1).
 */
export function appDb(): AppDb {
  const holder = globalThis as unknown as Record<symbol, pg.Pool | undefined>;
  holder[POOL_KEY] ??= createPool(serverEnv().DATABASE_URL);
  moduleDb ??= createAppDb(holder[POOL_KEY]);
  return moduleDb;
}
