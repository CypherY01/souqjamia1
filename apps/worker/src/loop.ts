// The job loop (task 2.5, FR75, OPS03, items 1, 3 and 5): claims due jobs of the registered
// kinds, runs each handler with its timeout outside any transaction, then marks the attempt done
// or failed. Delivery is at least once (DEC71, see registry.ts).
//  - Up to four jobs at a time. A claim asks for as many jobs as there are free slots.
//  - After a claim that found jobs, ask again at once. After an empty one, wait: one second
//    first, then one second longer each time, up to five (owner's improvement on item 5).
//  - Stopping: no new claims, wait for running jobs up to the grace period. A job still running
//    then is left to its lease and resumed by the next worker (item 12, TC69).
import { log as defaultLog } from "@souq/log";
import type { ClaimedJob, JobStore, Queryable } from "./db.ts";
import {
  ERROR_CODE,
  PermanentJobError,
  type AnyJobDefinition,
  type JobContext,
  type JobResult,
} from "./job.ts";
import type { Registry } from "./registry.ts";

export type Logger = Pick<typeof defaultLog, "info" | "warn" | "error">;

export const CONCURRENCY = 4;
export const IDLE_MIN_MS = 1000;
export const IDLE_MAX_MS = 5000;
const IDLE_STEP_MS = 1000;

/** The wait after an empty claim: 1, 2, 3, 4, then 5 seconds. */
export function nextIdleDelay(currentMs: number): number {
  return Math.min(IDLE_MAX_MS, currentMs + IDLE_STEP_MS);
}

export class JobTimeoutError extends Error {
  override name = "JobTimeoutError";
  readonly code = "TIMEOUT";
}

export class WorkerStoppingError extends Error {
  override name = "WorkerStoppingError";
}

/** The code kept in app.job.last_error_code: a short code, never the error text. */
export function jobErrorCode(error: unknown): string {
  if (error instanceof PermanentJobError) return error.code;
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error;
    if (typeof code === "string" && ERROR_CODE.test(code)) return code;
  }
  return "INTERNAL";
}

export interface LoopOptions {
  readonly store: JobStore;
  readonly registry: Registry;
  /** Given to handlers as context.db. */
  readonly db: Queryable;
  readonly logger?: Logger;
  readonly concurrency?: number;
}

export interface JobLoop {
  /** Claim now instead of waiting for the idle delay, for example after the scheduler ran. */
  wake(): void;
  /** Stops claiming and waits up to graceMs for running jobs. Returns how many were left. */
  stop(graceMs: number): Promise<number>;
  /** Jobs running now. */
  readonly active: number;
}

interface Running {
  readonly promise: Promise<void>;
  readonly controller: AbortController;
}

function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

export function startJobLoop(options: LoopOptions): JobLoop {
  const { store, registry, db } = options;
  const logger = options.logger ?? defaultLog;
  const concurrency = options.concurrency ?? CONCURRENCY;
  const kinds = [...registry.keys()];
  const running = new Map<string, Running>();
  let stopping = false;
  // Set at the end of the grace period: abandoned jobs no longer touch the database.
  let closed = false;
  let idleMs = IDLE_MIN_MS;
  let woken = false;
  let wakeUp: (() => void) | undefined;

  function wake(): void {
    woken = true;
    const resolve = wakeUp;
    wakeUp = undefined;
    resolve?.();
  }

  function pause(ms: number): Promise<void> {
    if (woken) {
      woken = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        wakeUp = undefined;
        woken = false;
        resolve();
      };
      const timer = setTimeout(finish, ms);
      wakeUp = finish;
    });
  }

  async function runHandler(
    definition: AnyJobDefinition,
    payload: unknown,
    job: ClaimedJob,
    controller: AbortController,
  ): Promise<JobResult | undefined> {
    const context: JobContext = {
      jobId: job.id,
      attempt: job.attempt,
      idempotencyKey: `job:${job.id}`,
      signal: controller.signal,
      db,
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new JobTimeoutError(
          `job ${job.kind} exceeded ${String(definition.timeoutMs)} ms`,
        );
        reject(error);
        controller.abort(error);
      }, definition.timeoutMs);
    });
    try {
      return await Promise.race([definition.run(payload as never, context), timeout]);
    } catch (error) {
      // A handler that rejects as soon as it sees the abort still counts as a timeout.
      const reason: unknown = controller.signal.reason;
      throw reason instanceof JobTimeoutError ? reason : error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function recordFailure(job: ClaimedJob, error: unknown, startedAt: number): Promise<void> {
    if (closed) return;
    const code = jobErrorCode(error);
    const fields = {
      job_id: job.id,
      kind: job.kind,
      attempt: job.attempt,
      duration_ms: elapsedMs(startedAt),
      code,
      error_name: error instanceof Error ? error.name : typeof error,
      // Our own unexpected errors only. Handlers never put member data in error messages.
      ...(code === "INTERNAL" ? { error } : {}),
    };
    let outcome;
    try {
      outcome = await store.fail(job, code, !(error instanceof PermanentJobError));
    } catch (dbError) {
      logger.error("worker.db_error", { job_id: job.id, kind: job.kind, error: dbError });
      return;
    }
    if (outcome === null) logger.warn("job.lease_lost", fields);
    else if (outcome.status === "queued") {
      logger.warn("job.retry", { ...fields, retry_at: outcome.retryAt?.toISOString() });
    } else logger.error("job.dead", fields);
  }

  async function execute(job: ClaimedJob, controller: AbortController): Promise<void> {
    const startedAt = performance.now();
    let result: JobResult | undefined;
    try {
      const definition = registry.get(job.kind);
      if (definition === undefined) throw new PermanentJobError("UNKNOWN_KIND");
      const parsed = definition.payload.safeParse(job.payload);
      if (!parsed.success) throw new PermanentJobError("INVALID_PAYLOAD");
      result = await runHandler(definition, parsed.data, job, controller);
    } catch (error) {
      await recordFailure(job, error, startedAt);
      return;
    }
    if (closed) return;
    const fields = {
      job_id: job.id,
      kind: job.kind,
      attempt: job.attempt,
      duration_ms: elapsedMs(startedAt),
    };
    try {
      if (await store.complete(job)) {
        logger.info("job.done", result === undefined ? fields : { ...fields, result });
      } else {
        logger.warn("job.lease_lost", fields);
      }
    } catch (error) {
      // The job stays running and is resumed after its lease (DEC71).
      logger.error("worker.db_error", { job_id: job.id, kind: job.kind, error });
    }
  }

  function launch(job: ClaimedJob): void {
    const controller = new AbortController();
    const promise = execute(job, controller).finally(() => {
      running.delete(job.id);
      wake();
    });
    running.set(job.id, { promise, controller });
  }

  async function claimLoop(): Promise<void> {
    while (!stopping) {
      const free = concurrency - running.size;
      if (free <= 0) {
        // A finishing job wakes the loop.
        await pause(IDLE_MAX_MS);
        continue;
      }
      let jobs: ClaimedJob[];
      try {
        jobs = await store.claim(kinds, free);
      } catch (error) {
        logger.error("worker.db_error", { error });
        idleMs = IDLE_MAX_MS;
        await pause(idleMs);
        continue;
      }
      for (const job of jobs) launch(job);
      if (jobs.length > 0) {
        idleMs = IDLE_MIN_MS;
        continue;
      }
      await pause(idleMs);
      idleMs = nextIdleDelay(idleMs);
    }
  }

  const loopDone = claimLoop();

  return {
    wake,
    get active() {
      return running.size;
    },
    async stop(graceMs) {
      stopping = true;
      wake();
      await loopDone;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const graceOver = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, graceMs);
      });
      await Promise.race([
        Promise.allSettled([...running.values()].map((entry) => entry.promise)),
        graceOver,
      ]);
      clearTimeout(timer);
      const left = running.size;
      if (left > 0) {
        closed = true;
        for (const entry of running.values()) entry.controller.abort(new WorkerStoppingError());
      }
      return left;
    },
  };
}
