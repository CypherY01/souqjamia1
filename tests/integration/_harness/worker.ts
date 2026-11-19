// The real worker code against the local database (task 2.5).
// A worker pool logs in as postgres and starts every session as souq_worker (the `role` startup
// option), so the worker's queries run with exactly the worker role's grants. Tests check
// current_user once to be sure.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";
import type { Logger } from "../../../apps/worker/src/loop.ts";
import { dbPool } from "./db.ts";

export function workerPool(): pg.Pool {
  return new pg.Pool({
    connectionString: inject("dbUrl"),
    options: "-c role=souq_worker",
    max: 5,
  });
}

/** A job kind no other test uses, in the format of the job_kind constraint. */
export function testKind(name = "probe"): string {
  return `test.w${randomUUID().replaceAll("-", "").slice(0, 12)}.${name}`;
}

/** Queues `count` committed jobs of `kind` as the business transaction would, returning ids. */
export async function enqueueJobs(
  kind: string,
  count = 1,
  payload: (n: number) => unknown = (n) => ({ n }),
): Promise<string[]> {
  const ids: string[] = [];
  for (let n = 1; n <= count; n++) {
    const result = await dbPool().query<{ id: string }>(
      "select app.enqueue_job($1, $2::jsonb) as id",
      [kind, JSON.stringify(payload(n))],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) throw new Error("enqueue_job returned no id");
    ids.push(id);
  }
  return ids;
}

export interface JobRow {
  id: string;
  status: "queued" | "running" | "done" | "dead";
  attempts: number;
  last_error_code: string | null;
}

export async function jobRows(kind: string): Promise<JobRow[]> {
  const result = await dbPool().query<JobRow>(
    "select id, status, attempts, last_error_code from app.job where kind = $1 order by id",
    [kind],
  );
  return result.rows;
}

/** Committed test jobs are removed after each test (postgres may delete from app.job). */
export async function deleteJobs(kinds: Iterable<string>): Promise<void> {
  await dbPool().query("delete from app.job where kind = any($1::text[])", [[...kinds]]);
}

export async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeoutMs = 10_000,
  what = "condition",
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export interface LogLine {
  level: "info" | "warn" | "error";
  event: string;
  fields: Record<string, unknown>;
}

/** A logger that keeps the lines, for checking what the worker logs. */
export function captureLogger(): { logger: Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const keep =
    (level: LogLine["level"]) =>
    (event: string, fields: Record<string, unknown> = {}) => {
      lines.push({ level, event, fields });
    };
  return { logger: { info: keep("info"), warn: keep("warn"), error: keep("error") }, lines };
}
