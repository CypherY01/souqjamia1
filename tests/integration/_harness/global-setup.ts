// Vitest global setup for the integration project (task 2.1).
// Checks that the local stack runs and has every migration, installs the test clock, and hands
// the local addresses to the tests. Teardown puts the migration's app.app_now() back.
// Task 4.0 (DEC82): refuses a stack whose Auth does not verify Turnstile tokens (pnpm db:e2e),
// so the DEC52 tests never pass against the wrong mode.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import type { TestProject } from "vitest/node";
import {
  DB_DIR,
  localCaptchaCheck,
  readLocalStack,
  type LocalStack,
} from "../../../scripts/local-supabase.ts";
import { installTestClock, restoreProductionClock } from "./clock.ts";

declare module "vitest" {
  export interface ProvidedContext {
    stack: LocalStack;
    dbUrl: string;
    /** Body of app.app_now() as the migrations left it, before the test clock replaced it. */
    appNowMigrationBody: string;
  }
}

export const MIGRATIONS_DIR = join(DB_DIR, "supabase", "migrations");

async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const stack = readLocalStack();
  const check = await localCaptchaCheck(stack);
  if (check !== "on") {
    throw new Error(
      check === "off"
        ? "Local Supabase Auth does not verify Turnstile tokens (started with pnpm db:e2e). The integration tests need the check (DEC52): run pnpm db:restart."
        : "Could not reach local Supabase Auth. Run pnpm db:start.",
    );
  }
  const migrationBody = await withClient(stack.dbUrl, async (client) => {
    const local = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith(".sql"))
      .map((file) => file.slice(0, 14));
    const applied = new Set(
      (
        await client.query<{ version: string }>(
          "select version from supabase_migrations.schema_migrations",
        )
      ).rows.map((row) => row.version),
    );
    const missing = local.filter((version) => !applied.has(version));
    if (missing.length > 0) {
      throw new Error(
        `Migrations not applied to the local database: ${missing.join(", ")}. Run pnpm db:reset.`,
      );
    }
    return installTestClock(client);
  });

  project.provide("stack", stack);
  project.provide("dbUrl", stack.dbUrl);
  project.provide("appNowMigrationBody", migrationBody);

  return async () => {
    await withClient(stack.dbUrl, restoreProductionClock);
  };
}
