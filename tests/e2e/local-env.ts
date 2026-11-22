// apps/web/.env.local as `pnpm env:local` wrote it: the local stack's values, read by the E2E
// config (the servers' variables) and by global-setup.ts (the Turnstile check, task 4.0).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Task 4.0 (item D): where web-server.ts copies the output of the server on `port`. The
 * directory is new for each run (playwright.config.ts), outside the repository.
 */
export function serverLogFile(port: number): string {
  const dir = process.env.E2E_SERVER_LOG_DIR;
  if (dir === undefined || dir === "") throw new Error("E2E_SERVER_LOG_DIR is not set");
  return join(dir, `server-${String(port)}.log`);
}

export function localWebEnv(): Record<string, string> {
  const file = join(REPO_ROOT, "apps", "web", ".env.local");
  if (!existsSync(file)) {
    throw new Error("E2E needs the local Supabase stack: run pnpm db:e2e, then pnpm env:local.");
  }
  const values: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) values[match[1]] = match[2];
  }
  return values;
}
