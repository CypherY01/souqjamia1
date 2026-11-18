// API106 (/readyz): readiness of the required dependencies, for the hosting platform only.
// The probe sends X-Probe-Token; the answer has no member data, addresses or dependency errors.
// Task 3.1 adds the database check, task 2.4 the job queue.
import { timingSafeEqual } from "node:crypto";

export const PROBE_HEADER = "x-probe-token";
const CHECK_TIMEOUT_MS = 2000;

export function probeTokenMatches(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface Readiness {
  status: "ready" | "not_ready";
  checks: Record<string, boolean>;
}

interface ReadinessConfig {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string;
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

export async function checkReadiness(
  config: ReadinessConfig,
  fetcher: typeof fetch = fetch,
): Promise<Readiness> {
  const checks = { supabase_auth: await supabaseAuthHealthy(config, fetcher) };
  return { status: Object.values(checks).every(Boolean) ? "ready" : "not_ready", checks };
}
