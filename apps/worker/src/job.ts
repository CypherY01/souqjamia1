// Job definitions (task 2.5). The list of jobs and the DEC71 rule are in registry.ts.
import type { z } from "zod";
import type { Queryable } from "./db.ts";

/** Same format as the job_kind constraint of app.job (task 2.4). */
export const JOB_KIND = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
/** Same format as the job_error_code constraint of app.job. */
export const ERROR_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** The claim lease of app.claim_jobs. A handler always ends before it (item 1). */
export const LEASE_MS = 5 * 60_000;
export const DEFAULT_TIMEOUT_MS = 60_000;
export const MAX_TIMEOUT_MS = 4 * 60_000;

export interface JobContext {
  readonly jobId: string;
  readonly attempt: number;
  /**
   * DEC71: the same for every attempt of this job. Send it as the idempotency key of any call to
   * an outside service, so a repeated attempt does not repeat the effect.
   */
  readonly idempotencyKey: string;
  /** Fires at the handler's timeout and when the worker stops. */
  readonly signal: AbortSignal;
  /** The souq_worker pool: call app entry points only. */
  readonly db: Queryable;
}

/** Counts a handler may report; they are logged with job.done. Never content. */
export type JobResult = Readonly<Record<string, number>>;

export interface JobDefinition<P = unknown> {
  readonly kind: string;
  readonly payload: z.ZodType<P>;
  readonly timeoutMs: number;
  /** At most this many jobs of this kind run at once (task 4.1). Unset: only the loop's limit. */
  readonly concurrency?: number;
  readonly run: (payload: P, context: JobContext) => Promise<JobResult | undefined>;
}

/** A definition with its payload type erased, as the registry and the loop keep it. */
export interface AnyJobDefinition {
  readonly kind: string;
  readonly payload: z.ZodType;
  readonly timeoutMs: number;
  readonly concurrency?: number;
  readonly run: (payload: never, context: JobContext) => Promise<JobResult | undefined>;
}

/** A failure that no retry can fix (item 3): the job is dead at once. */
export class PermanentJobError extends Error {
  override name = "PermanentJobError";
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    if (!ERROR_CODE.test(code)) throw new Error(`invalid job error code: ${code}`);
    this.code = code;
  }
}

export function defineJob<P>(definition: {
  kind: string;
  payload: z.ZodType<P>;
  timeoutMs?: number;
  concurrency?: number;
  run: (payload: P, context: JobContext) => Promise<JobResult | undefined>;
}): JobDefinition<P> {
  const timeoutMs = definition.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!JOB_KIND.test(definition.kind)) throw new Error(`invalid job kind: ${definition.kind}`);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`job ${definition.kind}: timeout must be 1 ms to 4 minutes`);
  }
  const { concurrency } = definition;
  if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1)) {
    throw new Error(`job ${definition.kind}: concurrency must be a positive integer`);
  }
  return { ...definition, timeoutMs };
}
