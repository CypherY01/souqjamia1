// DEC35: one background worker process on Railway, next to the web app (task 2.5).
// Node 26 runs this TypeScript file directly (type stripping), so there is no build step.
//  1. OPS05: refuse to run with a missing or invalid configuration, or as any role other than
//     souq_worker (SEC02).
//  2. Run the job loop (loop.ts) and the scheduler (scheduler.ts).
//  3. SIGTERM or SIGINT: stop claiming, wait up to 20 seconds for running jobs, close the pool
//     and exit. A job still running is resumed after its lease by the next worker (item 12).
import { log } from "@souq/log";
import { createJobStore, createPool } from "./db.ts";
import { loadWorkerEnv, type WorkerEnv } from "./env.ts";
import { CONCURRENCY, startJobLoop } from "./loop.ts";
import { registry } from "./registry.ts";
import { assertScheduleKnown, SCHEDULE, startScheduler } from "./scheduler.ts";

const WORKER_ROLE = "souq_worker";
const STOP_GRACE_MS = 20_000;

let env: WorkerEnv;
try {
  env = loadWorkerEnv();
  assertScheduleKnown(SCHEDULE, registry);
} catch (error) {
  log.error("worker.config_invalid", {
    message: error instanceof Error ? error.message : "Invalid environment configuration.",
  });
  process.exit(1);
}

const pool = createPool(env.DATABASE_URL);
// An idle connection that breaks must not stop the process; the next query reconnects.
pool.on("error", (error) => {
  log.error("worker.db_error", { error });
});

try {
  const result = await pool.query<{ role: string }>("select current_user as role");
  const role = result.rows[0]?.role;
  if (role !== WORKER_ROLE) {
    log.error("worker.config_invalid", {
      message: `DATABASE_URL must use the ${WORKER_ROLE} role.`,
    });
    await pool.end();
    process.exit(1);
  }
} catch (error) {
  log.error("worker.db_unavailable", {
    error,
    // `pnpm db:reset` recreates the local database without the role's password.
    ...(env.APP_ENV === "development"
      ? { hint: "Run pnpm env:local after pnpm db:start or pnpm db:reset." }
      : {}),
  });
  await pool.end().catch(() => undefined);
  process.exit(1);
}

const loop = startJobLoop({ store: createJobStore(pool), registry, db: pool });
const scheduler = startScheduler({
  store: createJobStore(pool),
  onTick: () => {
    loop.wake();
  },
});

let stopping = false;

async function stop(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info("worker.stopping", { signal, running: loop.active });
  await scheduler.stop();
  const abandoned = await loop.stop(STOP_GRACE_MS);
  await pool.end().catch((error: unknown) => {
    log.error("worker.db_error", { error });
  });
  log.info("worker.stopped", { signal, abandoned });
  // An abandoned handler may still hold timers or sockets; its job resumes after the lease.
  if (abandoned > 0) process.exit(0);
}

process.once("SIGINT", (signal) => {
  void stop(signal);
});
process.once("SIGTERM", (signal) => {
  void stop(signal);
});

log.info("worker.started", {
  pid: process.pid,
  node: process.version,
  app_env: env.APP_ENV,
  kinds: [...registry.keys()],
  concurrency: CONCURRENCY,
});
