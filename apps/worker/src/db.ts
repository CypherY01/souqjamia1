// The worker's database access (task 2.5): a small pool for the souq_worker role and the job
// entry points of 20261119130000_worker_jobs.sql. Job ids are bigint, kept as strings.
import pg from "pg";

/** A pool or a client: handlers and the job store only run single statements. */
export interface Queryable {
  query<R extends pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

export interface ClaimedJob {
  readonly id: string;
  readonly kind: string;
  readonly payload: unknown;
  /** Attempt number of this claim; it fences complete and fail (item 1). */
  readonly attempt: number;
  readonly maxAttempts: number;
}

export interface FailResult {
  readonly status: "queued" | "dead";
  readonly retryAt: Date | null;
}

export interface ReapedJob {
  readonly id: string;
  readonly kind: string;
  readonly attempts: number;
}

export interface JobStore {
  claim(kinds: readonly string[], limit: number): Promise<ClaimedJob[]>;
  /** False when another worker owns the job now (its lease ran out). */
  complete(job: ClaimedJob): Promise<boolean>;
  /** Null when another worker owns the job now. */
  fail(job: ClaimedJob, code: string, retryable: boolean): Promise<FailResult | null>;
  reapExpired(): Promise<ReapedJob[]>;
  schedule(kind: string, every: string): Promise<string>;
}

/** Four job slots and one for the scheduler (item 11). */
export const POOL_SIZE = 5;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: POOL_SIZE,
    application_name: "souq-worker",
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
}

export function createJobStore(db: Queryable): JobStore {
  return {
    async claim(kinds, limit) {
      const result = await db.query<{
        job_id: string;
        job_kind: string;
        job_payload: unknown;
        job_attempt: number;
        job_max_attempts: number;
      }>("select * from app.claim_jobs($1::text[], $2)", [kinds, limit]);
      return result.rows.map((row) => ({
        id: row.job_id,
        kind: row.job_kind,
        payload: row.job_payload,
        attempt: row.job_attempt,
        maxAttempts: row.job_max_attempts,
      }));
    },
    async complete(job) {
      const result = await db.query<{ done: boolean }>("select app.complete_job($1, $2) as done", [
        job.id,
        job.attempt,
      ]);
      return result.rows[0]?.done === true;
    },
    async fail(job, code, retryable) {
      const result = await db.query<{ job_status: "queued" | "dead"; retry_at: Date | null }>(
        "select * from app.fail_job($1, $2, $3, $4)",
        [job.id, job.attempt, code, retryable],
      );
      const row = result.rows[0];
      return row === undefined ? null : { status: row.job_status, retryAt: row.retry_at };
    },
    async reapExpired() {
      const result = await db.query<{ job_id: string; job_kind: string; job_attempts: number }>(
        "select * from app.reap_expired_jobs()",
      );
      return result.rows.map((row) => ({
        id: row.job_id,
        kind: row.job_kind,
        attempts: row.job_attempts,
      }));
    },
    async schedule(kind, every) {
      const result = await db.query<{ id: string }>(
        "select app.schedule_job($1, $2::interval) as id",
        [kind, every],
      );
      const id = result.rows[0]?.id;
      if (id === undefined) throw new Error("schedule_job returned no job");
      return id;
    },
  };
}
