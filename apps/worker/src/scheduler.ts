// Recurring jobs (task 2.5, OPS03, items 6 and 8). Every 15 seconds the scheduler:
//  1. marks dead the jobs whose lease ran out on their last attempt, and logs job.dead for each;
//  2. queues the job of the current period of each entry with app.schedule_job. Periods are
//     fixed UTC slots that divide a day, and one dedupe key per slot means one job per slot,
//     whatever the number of workers or restarts. A daily job starts at 00:00 UTC (03:00 in
//     Riyadh). A worker that was down queues the current slot only; the job handles all that is
//     due.
import { log as defaultLog } from "@souq/log";
import type { JobStore } from "./db.ts";
import type { Logger } from "./loop.ts";
import type { Registry } from "./registry.ts";

export interface ScheduleEntry {
  readonly kind: string;
  /** A Postgres interval that divides a day: '1 minute', '15 minutes', '1 hour', '1 day'. */
  readonly every: string;
}

/** Add the recurring jobs of later tasks here (8.1 retention, 5.5 offer expiry...). */
export const SCHEDULE: readonly ScheduleEntry[] = [
  { kind: "audit.purge", every: "1 day" },
  // Task 4.1 (RET01, item 12): expired uploads, raw objects and the files of deleted images.
  { kind: "media.cleanup", every: "1 hour" },
];

export const SCHEDULER_INTERVAL_MS = 15_000;

/** Throws when a schedule entry has no handler, so the worker refuses to start. */
export function assertScheduleKnown(schedule: readonly ScheduleEntry[], registry: Registry): void {
  const unknown = schedule.filter((entry) => !registry.has(entry.kind)).map((e) => e.kind);
  if (unknown.length > 0)
    throw new Error(`scheduled kinds without a handler: ${unknown.join(", ")}`);
}

export interface SchedulerOptions {
  readonly store: JobStore;
  readonly schedule?: readonly ScheduleEntry[];
  readonly logger?: Logger;
  readonly intervalMs?: number;
  /** Called after each tick, to wake the job loop. */
  readonly onTick?: () => void;
}

export interface Scheduler {
  /** Stops after the tick in progress, if any. */
  stop(): Promise<void>;
}

export function startScheduler(options: SchedulerOptions): Scheduler {
  const { store, onTick } = options;
  const schedule = options.schedule ?? SCHEDULE;
  const logger = options.logger ?? defaultLog;
  const intervalMs = options.intervalMs ?? SCHEDULER_INTERVAL_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: Promise<void> = Promise.resolve();

  async function tick(): Promise<void> {
    try {
      for (const job of await store.reapExpired()) {
        logger.error("job.dead", {
          job_id: job.id,
          kind: job.kind,
          attempt: job.attempts,
          code: "LEASE_EXPIRED",
        });
      }
    } catch (error) {
      logger.error("worker.db_error", { error });
    }
    for (const entry of schedule) {
      if (stopped) return;
      try {
        await store.schedule(entry.kind, entry.every);
      } catch (error) {
        logger.error("worker.db_error", { kind: entry.kind, error });
      }
    }
    onTick?.();
  }

  function next(): void {
    if (stopped) return;
    current = tick().finally(() => {
      if (!stopped) timer = setTimeout(next, intervalMs);
    });
  }

  next();

  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await current;
    },
  };
}
