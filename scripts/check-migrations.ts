// `pnpm check:migrations` (task 2.1, item 10). Migrations are forward-only and never edited
// after they are merged (CLAUDE.md): compared with the base branch (origin/main by default),
// no merged migration may change or disappear, and every new one must sort after the last
// merged one. CI fetches main first.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./local-supabase.ts";

export const MIGRATIONS_PATH = "packages/db/supabase/migrations";
const NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;

/** File name to git blob hash. */
export type MigrationSet = ReadonlyMap<string, string>;

export function checkMigrations(base: MigrationSet, head: MigrationSet): string[] {
  const errors: string[] = [];
  const seen = new Map<string, string>();
  for (const name of head.keys()) {
    const match = NAME.exec(name);
    if (match?.[1] === undefined) {
      errors.push(`${name}: name must be <14-digit timestamp>_<snake_case>.sql`);
      continue;
    }
    const other = seen.get(match[1]);
    if (other !== undefined) errors.push(`${name}: same timestamp as ${other}`);
    seen.set(match[1], name);
  }
  for (const [name, hash] of base) {
    const now = head.get(name);
    if (now === undefined) errors.push(`${name}: merged migration was deleted`);
    else if (now !== hash)
      errors.push(`${name}: merged migration was edited; add a new one instead`);
  }
  const lastMerged = [...base.keys()].sort().at(-1);
  for (const name of [...head.keys()].sort()) {
    if (base.has(name) || lastMerged === undefined) continue;
    if (name.slice(0, 14) <= lastMerged.slice(0, 14)) {
      errors.push(`${name}: new migration must sort after the last merged one (${lastMerged})`);
    }
  }
  return errors;
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
}

export function baseMigrations(ref: string): MigrationSet {
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  } catch {
    throw new Error(`${ref} not found. Fetch it first: git fetch origin main`);
  }
  const set = new Map<string, string>();
  for (const line of git(["ls-tree", "-r", ref, "--", MIGRATIONS_PATH]).split("\n")) {
    const match = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      set.set(match[2].slice(MIGRATIONS_PATH.length + 1), match[1]);
    }
  }
  return set;
}

/** The working tree, hashed with the same filters git applies when committing. */
export function headMigrations(): MigrationSet {
  const names = readdirSync(join(REPO_ROOT, MIGRATIONS_PATH)).filter((name) => name !== ".gitkeep");
  const set = new Map<string, string>();
  for (const name of names) {
    set.set(name, git(["hash-object", `${MIGRATIONS_PATH}/${name}`]).trim());
  }
  return set;
}

if (import.meta.main) {
  try {
    const ref = process.env.MIGRATIONS_BASE_REF ?? "origin/main";
    const errors = checkMigrations(baseMigrations(ref), headMigrations());
    if (errors.length > 0) {
      for (const error of errors) console.error(`check:migrations: ${error}`);
      process.exitCode = 1;
    } else {
      console.log(`check:migrations: ok against ${ref}`);
    }
  } catch (error) {
    console.error(`check:migrations: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
