// Test clock for app.app_now() (task 2.1, item 5).
// The migration's app.app_now() returns the transaction time only, so no hosted database can
// ever move its clock. For the tests, global-setup.ts replaces it locally with a version that
// reads the per-connection setting app_test.now, and global teardown puts the migration
// version back. The setting is per connection, so `pnpm dev` and parallel tests are unaffected.
import type pg from "pg";

/** Body of app.app_now() in 20261119090200_helpers.sql. db-helpers.test.ts checks the file. */
export const PRODUCTION_APP_NOW_BODY = "select pg_catalog.now()";

const TEST_APP_NOW_BODY =
  "select coalesce(nullif(pg_catalog.current_setting('app_test.now', true), '')::timestamptz, pg_catalog.now())";

function defineAppNow(body: string): string {
  return `create or replace function app.app_now()
returns timestamptz
language sql
stable
set search_path = ''
as $fn$ ${body} $fn$`;
}

async function appNowBody(client: pg.ClientBase): Promise<string> {
  const result = await client.query<{ body: string }>(
    "select prosrc as body from pg_catalog.pg_proc where oid = 'app.app_now()'::regprocedure",
  );
  return (result.rows[0]?.body ?? "").trim();
}

/**
 * Installs the test clock and returns the body it replaced. A test clock left behind by an
 * interrupted run is replaced too. Any other body means the migration changed this function,
 * and this file has to follow it.
 */
export async function installTestClock(client: pg.ClientBase): Promise<string> {
  const body = await appNowBody(client);
  if (body !== PRODUCTION_APP_NOW_BODY && body !== TEST_APP_NOW_BODY) {
    throw new Error(
      "app.app_now() differs from tests/integration/_harness/clock.ts. Update the harness.",
    );
  }
  await client.query(defineAppNow(TEST_APP_NOW_BODY));
  return body === TEST_APP_NOW_BODY ? PRODUCTION_APP_NOW_BODY : body;
}

export async function restoreProductionClock(client: pg.ClientBase): Promise<void> {
  await client.query(defineAppNow(PRODUCTION_APP_NOW_BODY));
}

/** Freezes app.app_now() at `at` on this connection, for the current transaction only. */
export async function setClock(client: pg.ClientBase, at: Date): Promise<void> {
  await client.query("select set_config('app_test.now', $1, true)", [at.toISOString()]);
}

/** Moves this connection's frozen clock forward, for the current transaction only. */
export async function advanceClock(client: pg.ClientBase, interval: string): Promise<void> {
  await client.query(
    "select set_config('app_test.now', (app.app_now() + $1::interval)::text, true)",
    [interval],
  );
}
