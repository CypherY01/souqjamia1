// Reads the local Supabase stack (task 1.4) through the CLI pinned in packages/db.
// Local development values only; nothing here touches a hosted project.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DB_DIR = join(REPO_ROOT, "packages", "db");
export const CONFIG_TOML = join(DB_DIR, "supabase", "config.toml");

export interface LocalStack {
  readonly apiUrl: string;
  readonly publishableKey: string;
  /** Local-only key, used by integration tests for admin calls. Never written to app env files. */
  readonly secretKey: string;
  readonly mailpitUrl: string;
}

function supabaseCli(): string {
  const require = createRequire(join(DB_DIR, "package.json"));
  return join(dirname(require.resolve("supabase/package.json")), "dist", "supabase.js");
}

function asString(value: unknown, key: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(
      `supabase status did not report ${key}. Is the local stack running (pnpm db:start)?`,
    );
  }
  return value;
}

/** Runs `supabase status -o json` and returns the values the app and the tests need. */
export function readLocalStack(): LocalStack {
  const result = spawnSync(process.execPath, [supabaseCli(), "status", "-o", "json"], {
    cwd: DB_DIR,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error("The local Supabase stack is not running. Start it with `pnpm db:start`.");
  }
  const start = result.stdout.indexOf("{");
  const status: unknown = JSON.parse(result.stdout.slice(start));
  const record = (typeof status === "object" && status !== null ? status : {}) as Record<
    string,
    unknown
  >;
  return {
    apiUrl: asString(record.API_URL, "API_URL"),
    publishableKey: asString(record.PUBLISHABLE_KEY, "PUBLISHABLE_KEY"),
    secretKey: asString(record.SECRET_KEY, "SECRET_KEY"),
    mailpitUrl: asString(record.MAILPIT_URL ?? record.INBUCKET_URL, "MAILPIT_URL"),
  };
}

/** DEC63: email_confirmation_required, read from config.toml (the single local source). */
export function emailConfirmationRequired(configText = readFileSync(CONFIG_TOML, "utf8")): boolean {
  const config = parse(configText) as { auth?: { email?: { enable_confirmations?: unknown } } };
  const value = config.auth?.email?.enable_confirmations;
  if (typeof value !== "boolean")
    throw new Error("config.toml: auth.email.enable_confirmations is missing");
  return value;
}
