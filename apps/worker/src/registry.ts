// The jobs this worker runs (task 2.5, FR75, OPS03). The worker claims only these kinds (item 4),
// so an older worker leaves a newer kind queued for the version that knows it (TC69).
//
// DEC71: delivery is AT LEAST ONCE. A job is claimed under a five-minute lease and run outside
// the claim's transaction. If the worker stops, or the lease runs out before the job is marked
// done, another worker runs the same job again. EVERY HANDLER MUST BE IDEMPOTENT: running it
// twice for the same job leaves one effect.
//  - Database writes go through app functions that deduplicate (dedupe_key) or check the state
//    before a transition, so a second run changes nothing.
//  - Calls to an outside service send context.idempotencyKey, which is the same for every
//    attempt of the job.
//  - Nothing to do (the target is gone or already in the wanted state) is success, not an error.
// tests/integration/worker-loop.test.ts runs a probe handler twice on one job (DEC71).
//
// Adding a job: write it in jobs/<kind>.ts with defineJob, add it to JOBS below, and add a
// recurring one to SCHEDULE in scheduler.ts. tests/unit/worker-registry.test.ts fails when a
// kind queued by a migration or the schedule has no handler here.
import type { AnyJobDefinition } from "./job.ts";
import { auditPurge } from "./jobs/audit.purge.ts";
import { emailSend } from "./jobs/email.send.ts";

export type Registry = ReadonlyMap<string, AnyJobDefinition>;

export function createRegistry(definitions: readonly AnyJobDefinition[]): Registry {
  const registry = new Map<string, AnyJobDefinition>();
  for (const definition of definitions) {
    if (registry.has(definition.kind)) throw new Error(`duplicate job kind: ${definition.kind}`);
    registry.set(definition.kind, definition);
  }
  return registry;
}

export const JOBS = [auditPurge, emailSend] as const;

export const registry: Registry = createRegistry(JOBS);
