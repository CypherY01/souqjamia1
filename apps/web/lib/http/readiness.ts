// API106 (/readyz): readiness of the required dependencies, for the hosting platform only.
// The probe sends X-Probe-Token; the answer has no member data, addresses or dependency errors.
// Task 3.1, item 13:
//   supabase_auth  Supabase Auth answers its health check (task 1.6)
//   database       the database answers as souq_web within two seconds
//   job_queue      no due job waiting more than 10 minutes, and no job died in 24 hours
// Only supabase_auth and database decide the status (503). The worker is a separate service:
// taking the site down because the queue is late would add harm and fix nothing, and a late
// queue would block deploying a fix for the site. The queue is reported, and alerted on in 8.3.
import { timingSafeEqual } from "node:crypto";
import type { AppDb } from "../db/app-client.ts";

export const PROBE_HEADER = "x-probe-token";
const CHECK_TIMEOUT_MS = 2000;
/** The worker polls every 1 to 5 seconds; a due job untouched for 10 minutes means it stopped. */
export const JOB_QUEUE_MAX_DUE_SECONDS = 600;

export function probeTokenMatches(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface Readiness {
  status: "ready" | "not_ready";
  checks: { supabase_auth: boolean; database: boolean; job_queue: boolean };
}

interface ReadinessConfig {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string;
}

interface QueueHealth {
  oldest_due_seconds: number;
  dead_last_24h: number;
}

async function supabaseAuthHealthy(
  config: ReadinessConfig,
  fetcher: typeof fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(new URL("/auth/v1/health", config.NEXT_PUBLIC_SUPABASE_URL), {
      headers: { apikey: config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** The queue health from app.job_queue_health(), or null when the database did not answer. */
async function queueHealth(db: AppDb, traceId: string): Promise<QueueHealth | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null);
    }, CHECK_TIMEOUT_MS);
  });
  try {
    const query = db
      .query<QueueHealth>(traceId, "select * from app.job_queue_health()")
      .then((result) => result.rows[0] ?? null)
      .catch(() => null);
    return await Promise.race([query, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function queueHealthy(health: QueueHealth): boolean {
  return health.oldest_due_seconds <= JOB_QUEUE_MAX_DUE_SECONDS && health.dead_last_24h === 0;
}

export async function checkReadiness(
  config: ReadinessConfig,
  db: AppDb,
  traceId: string,
  fetcher: typeof fetch = fetch,
): Promise<Readiness> {
  const [auth, queue] = await Promise.all([
    supabaseAuthHealthy(config, fetcher),
    queueHealth(db, traceId),
  ]);
  const checks = {
    supabase_auth: auth,
    database: queue !== null,
    job_queue: queue !== null && queueHealthy(queue),
  };
  return { status: checks.supabase_auth && checks.database ? "ready" : "not_ready", checks };
}
