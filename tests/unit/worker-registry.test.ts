// Task 2.5: the worker's registry, schedule, idle delay and error codes, without a database.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineJob,
  JOB_KIND,
  LEASE_MS,
  MAX_TIMEOUT_MS,
  PermanentJobError,
} from "../../apps/worker/src/job.ts";
import {
  IDLE_MAX_MS,
  IDLE_MIN_MS,
  jobErrorCode,
  JobTimeoutError,
  nextIdleDelay,
} from "../../apps/worker/src/loop.ts";
import { createRegistry, registry } from "../../apps/worker/src/registry.ts";
import { assertScheduleKnown, SCHEDULE } from "../../apps/worker/src/scheduler.ts";

const MIGRATIONS = join(
  import.meta.dirname,
  "..",
  "..",
  "packages",
  "db",
  "supabase",
  "migrations",
);
const WORKER_MIGRATION = join(MIGRATIONS, "20261119130000_worker_jobs.sql");

/** Kinds that SQL queues by name: app.enqueue_job('<kind>' ...) and app.schedule_job('<kind>' ...). */
function queuedKinds(sql: string): string[] {
  const kinds = new Set<string>();
  for (const match of sql.matchAll(/app\.(?:enqueue_job|schedule_job)\(\s*'([^']+)'/g)) {
    if (match[1] !== undefined) kinds.add(match[1]);
  }
  return [...kinds];
}

const noop = () => Promise.resolve(undefined);

describe("item 4: every queued kind has a handler", () => {
  it("finds the kinds in SQL text", () => {
    expect(
      queuedKinds(
        "perform app.enqueue_job('email.send', x, 'k'); select app.schedule_job( 'offer.expire', '1 minute')",
      ),
    ).toEqual(["email.send", "offer.expire"]);
  });

  it("each kind queued by a migration is in the registry", () => {
    const sql = readdirSync(MIGRATIONS)
      .filter((file) => file.endsWith(".sql"))
      .map((file) => readFileSync(join(MIGRATIONS, file), "utf8"))
      .join("\n");
    const missing = queuedKinds(sql).filter((kind) => !registry.has(kind));
    expect(missing).toEqual([]);
  });

  it("each scheduled kind is in the registry, and an unknown one stops the worker", () => {
    expect(() => {
      assertScheduleKnown(SCHEDULE, registry);
    }).not.toThrow();
    expect(() => {
      assertScheduleKnown([{ kind: "missing.kind", every: "1 day" }], registry);
    }).toThrow("scheduled kinds without a handler: missing.kind");
  });

  it("item 7: audit.purge runs daily", () => {
    expect(SCHEDULE).toContainEqual({ kind: "audit.purge", every: "1 day" });
    expect(registry.get("audit.purge")?.timeoutMs).toBe(2 * 60_000);
  });
});

describe("item 1: definitions and the lease", () => {
  it("every registered kind has the job_kind format and a timeout shorter than the lease", () => {
    for (const [kind, definition] of registry) {
      expect(kind).toMatch(JOB_KIND);
      expect(definition.timeoutMs).toBeLessThanOrEqual(MAX_TIMEOUT_MS);
    }
    expect(MAX_TIMEOUT_MS).toBeLessThan(LEASE_MS);
  });

  it("the lease matches app.claim_jobs", () => {
    const sql = readFileSync(WORKER_MIGRATION, "utf8");
    expect(sql).toContain("locked_until = v_now + interval '5 minutes'");
    expect(LEASE_MS).toBe(5 * 60_000);
  });

  it("refuses a bad kind, a timeout over 4 minutes, a bad error code and a duplicate kind", () => {
    const payload = z.strictObject({});
    expect(() => defineJob({ kind: "NoDot", payload, run: noop })).toThrow("invalid job kind");
    expect(() =>
      defineJob({ kind: "a.b", payload, timeoutMs: MAX_TIMEOUT_MS + 1, run: noop }),
    ).toThrow("timeout must be");
    expect(() => new PermanentJobError("has space")).toThrow("invalid job error code");
    const job = defineJob({ kind: "a.b", payload, run: noop });
    expect(job.timeoutMs).toBe(60_000);
    expect(() => createRegistry([job, job])).toThrow("duplicate job kind: a.b");
  });
});

describe("owner's improvement on item 5: the idle delay", () => {
  it("grows by one second per empty claim, from 1 to 5 seconds", () => {
    const delays = [IDLE_MIN_MS];
    while (delays.length < 7) delays.push(nextIdleDelay(delays.at(-1) ?? IDLE_MIN_MS));
    expect(delays).toEqual([1000, 2000, 3000, 4000, 5000, 5000, 5000]);
    expect(IDLE_MAX_MS).toBe(5000);
  });
});

describe("item 3: error codes kept in app.job", () => {
  it("keeps short codes only, never the error text", () => {
    expect(jobErrorCode(new PermanentJobError("TEST_GONE", "the listing was deleted"))).toBe(
      "TEST_GONE",
    );
    expect(jobErrorCode(new JobTimeoutError("slow"))).toBe("TIMEOUT");
    expect(jobErrorCode(Object.assign(new Error("x"), { code: "57014" }))).toBe("57014");
    expect(jobErrorCode(Object.assign(new Error("x"), { code: "not a code!" }))).toBe("INTERNAL");
    expect(jobErrorCode(Object.assign(new Error("x"), { code: 20 }))).toBe("INTERNAL");
    expect(jobErrorCode(new TypeError("member@example.test"))).toBe("INTERNAL");
    expect(jobErrorCode("thrown string")).toBe("INTERNAL");
  });
});
