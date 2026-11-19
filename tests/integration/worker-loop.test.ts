// FR75, OPS03, TC69 (worker part), DEC71, items 3, 5, 6, 7, 8 and 12 of task 2.5: the real
// worker loop, scheduler and audit.purge handler against the local database, as souq_worker.
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createJobStore } from "../../apps/worker/src/db.ts";
import {
  defineJob,
  PermanentJobError,
  type AnyJobDefinition,
  type JobContext,
} from "../../apps/worker/src/job.ts";
import { auditPurge, PURGE_BATCH } from "../../apps/worker/src/jobs/audit.purge.ts";
import { startJobLoop, type JobLoop } from "../../apps/worker/src/loop.ts";
import { createRegistry } from "../../apps/worker/src/registry.ts";
import { startScheduler } from "../../apps/worker/src/scheduler.ts";
import { closeDb, dbPool, rolledBack, scalar } from "./_harness/db.ts";
import { actAs } from "./_harness/roles.ts";
import {
  captureLogger,
  deleteJobs,
  enqueueJobs,
  jobRows,
  testKind,
  waitFor,
  workerPool,
  type LogLine,
} from "./_harness/worker.ts";

const kinds = new Set<string>();
const loops: JobLoop[] = [];
const pools: pg.Pool[] = [];

function kind(name?: string): string {
  const value = testKind(name);
  kinds.add(value);
  return value;
}

function pool(): pg.Pool {
  const created = workerPool();
  pools.push(created);
  return created;
}

/** One worker: its own pool, store and loop, like a separate process. */
function startWorker(definitions: AnyJobDefinition[]): { loop: JobLoop; lines: LogLine[] } {
  const db = pool();
  const { logger, lines } = captureLogger();
  const loop = startJobLoop({
    store: createJobStore(db),
    registry: createRegistry(definitions),
    db,
    logger,
  });
  loops.push(loop);
  return { loop, lines };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A promise and its resolver, to hold a handler in the middle of its work. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

/** What a worker that stopped looks like after five minutes: its lease is over. */
async function expireLease(id: string): Promise<void> {
  await dbPool().query(
    "update app.job set locked_until = now() - interval '1 second' where id = $1 and status = 'running'",
    [id],
  );
}

async function status(id: string): Promise<string> {
  return scalar<string>(dbPool(), "select status::text from app.job where id = $1", [id]);
}

afterEach(async () => {
  await Promise.all(loops.splice(0).map((loop) => loop.stop(1000)));
  await deleteJobs(kinds);
  kinds.clear();
});

afterAll(async () => {
  await Promise.all(pools.splice(0).map((p) => p.end()));
  await closeDb();
});

let ready = false;
beforeAll(async () => {
  // The harness pool really runs as souq_worker, with only that role's grants.
  const probe = pool();
  ready = (await scalar<string>(probe, "select current_user")) === "souq_worker";
});

describe("SEC02: the worker's connection", () => {
  it("runs as souq_worker", () => {
    expect(ready).toBe(true);
  });
});

describe("item 5 and SKIP LOCKED: two workers on one queue", () => {
  it("two workers run 50 jobs, each exactly once", async () => {
    const probeKind = kind();
    const runs = new Map<string, number>();
    const probe = defineJob({
      kind: probeKind,
      payload: z.strictObject({ n: z.number() }),
      async run(_payload, context) {
        runs.set(context.jobId, (runs.get(context.jobId) ?? 0) + 1);
        await sleep(5 + Math.random() * 20);
        return undefined;
      },
    });
    const ids = await enqueueJobs(probeKind, 50);
    const a = startWorker([probe]);
    const b = startWorker([probe]);

    await waitFor(
      async () => (await jobRows(probeKind)).every((r) => r.status === "done"),
      20_000,
      "50 jobs done",
    );
    expect([...runs.keys()].sort()).toEqual([...ids].sort());
    expect([...runs.values()].every((count) => count === 1)).toBe(true);
    const done = [...a.lines, ...b.lines].filter((line) => line.event === "job.done");
    expect(done).toHaveLength(50);
    expect((await jobRows(probeKind)).every((r) => r.attempts === 1)).toBe(true);
  });
});

describe("DEC71 and TC69: at-least-once delivery with an idempotent handler", () => {
  it("a probe handler runs twice on one job after a worker stopped, and leaves one effect", async () => {
    const probeKind = kind();
    // An outside service that honours idempotency keys, like an email provider.
    const effects = new Map<string, number>();
    let calls = 0;
    const deliver = (idempotencyKey: string): void => {
      calls++;
      if (!effects.has(idempotencyKey)) effects.set(idempotencyKey, effects.size + 1);
    };
    const attempts: number[] = [];
    const held = gate();
    const probe = defineJob({
      kind: probeKind,
      payload: z.strictObject({ n: z.number() }),
      async run(_payload, context: JobContext) {
        attempts.push(context.attempt);
        deliver(context.idempotencyKey);
        // The first worker does the work, then stops before it can mark the job done.
        if (context.attempt === 1) await held.wait;
        return undefined;
      },
    });
    const [id] = await enqueueJobs(probeKind);
    if (id === undefined) throw new Error("no job");

    const first = startWorker([probe]);
    await waitFor(() => attempts.length === 1, 10_000, "the first run");
    await expireLease(id);
    const second = startWorker([probe]);
    await waitFor(async () => (await status(id)) === "done", 10_000, "the second run");

    // The first worker comes back: its result no longer counts (fenced by the attempt number).
    held.open();
    await waitFor(
      () => first.lines.some((line) => line.event === "job.lease_lost"),
      10_000,
      "job.lease_lost",
    );

    expect(attempts).toEqual([1, 2]);
    expect(calls).toBe(2);
    expect([...effects.keys()]).toEqual([`job:${id}`]);
    expect(second.lines.filter((line) => line.event === "job.done")).toHaveLength(1);
    expect(first.lines.some((line) => line.event === "job.done")).toBe(false);
    expect(await jobRows(probeKind)).toEqual([
      { id, status: "done", attempts: 2, last_error_code: null },
    ]);
  });

  it("audit.purge run twice deletes once: only events older than 730 days", async () => {
    await rolledBack(async (client) => {
      const action = `test.purge_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      await client.query(
        `insert into app.audit_event (action, occurred_at) values
           ($1, now() - interval '731 days'), ($1, now() - interval '800 days'),
           ($1, now() - interval '729 days')`,
        [action],
      );
      await actAs(client, "souq_worker");
      const context: JobContext = {
        jobId: "1",
        attempt: 1,
        idempotencyKey: "job:1",
        signal: new AbortController().signal,
        db: client,
      };
      const first = await auditPurge.run({}, context);
      const second = await auditPurge.run({}, { ...context, attempt: 2 });
      expect(first?.deleted).toBeGreaterThanOrEqual(2);
      expect(first?.deleted).toBeLessThan(PURGE_BATCH);
      expect(second).toEqual({ deleted: 0 });
      await actAs(client, "postgres");
      expect(
        await scalar<number>(
          client,
          "select count(*)::int from app.audit_event where action = $1",
          [action],
        ),
      ).toBe(1);
    });
  });
});

describe("item 3: failures through the loop", () => {
  it("retries, dead jobs, invalid payloads and timeouts, with codes and no payload in the logs", async () => {
    const marker = `payload-marker-${randomUUID()}`;
    const kinds3 = {
      retry: kind("retry"),
      permanent: kind("permanent"),
      invalid: kind("invalid"),
      timeout: kind("timeout"),
      unexpected: kind("unexpected"),
    };
    const payload = z.strictObject({ n: z.number(), note: z.string().optional() });
    const definitions = [
      defineJob({
        kind: kinds3.retry,
        payload,
        run: () => Promise.reject(Object.assign(new Error("provider busy"), { code: "TEST_BUSY" })),
      }),
      defineJob({
        kind: kinds3.permanent,
        payload,
        run: () => Promise.reject(new PermanentJobError("TEST_GONE")),
      }),
      defineJob({ kind: kinds3.invalid, payload, run: () => Promise.resolve(undefined) }),
      defineJob({
        kind: kinds3.timeout,
        payload,
        timeoutMs: 50,
        run: (_payload, context) =>
          new Promise((_resolve, reject) => {
            context.signal.addEventListener("abort", () => {
              reject(new Error("aborted"));
            });
          }),
      }),
      defineJob({
        kind: kinds3.unexpected,
        payload,
        run: () => Promise.reject(new TypeError("a bug")),
      }),
    ];
    await enqueueJobs(kinds3.retry, 1, (n) => ({ n, note: marker }));
    await enqueueJobs(kinds3.permanent, 1, (n) => ({ n, note: marker }));
    await enqueueJobs(kinds3.invalid, 1, () => ({ n: "not a number", note: marker }));
    await enqueueJobs(kinds3.timeout, 1, (n) => ({ n, note: marker }));
    await enqueueJobs(kinds3.unexpected, 1, (n) => ({ n, note: marker }));
    const { lines } = startWorker(definitions);

    const settled = async (k: string) => (await jobRows(k)).every((r) => r.status !== "running");
    await waitFor(
      async () => {
        for (const k of Object.values(kinds3)) if (!(await settled(k))) return false;
        return lines.length >= 5;
      },
      10_000,
      "five settled jobs",
    );

    const expectRow = async (k: string, statusValue: string, code: string) => {
      expect((await jobRows(k))[0], k).toMatchObject({
        status: statusValue,
        attempts: 1,
        last_error_code: code,
      });
    };
    await expectRow(kinds3.retry, "queued", "TEST_BUSY");
    await expectRow(kinds3.permanent, "dead", "TEST_GONE");
    await expectRow(kinds3.invalid, "dead", "INVALID_PAYLOAD");
    await expectRow(kinds3.timeout, "queued", "TIMEOUT");
    await expectRow(kinds3.unexpected, "queued", "INTERNAL");

    // OPS03: the first retry waits one minute.
    const wait = await scalar<number>(
      dbPool(),
      "select extract(epoch from run_at - now())::int from app.job where kind = $1",
      [kinds3.retry],
    );
    expect(wait).toBeGreaterThan(50);
    expect(wait).toBeLessThanOrEqual(60);

    const byKind = (k: string) => lines.find((line) => line.fields.kind === k);
    expect(byKind(kinds3.retry)).toMatchObject({ level: "warn", event: "job.retry" });
    expect(byKind(kinds3.permanent)).toMatchObject({ level: "error", event: "job.dead" });
    expect(byKind(kinds3.invalid)).toMatchObject({ level: "error", event: "job.dead" });
    expect(byKind(kinds3.timeout)?.fields).toMatchObject({ code: "TIMEOUT" });
    expect(byKind(kinds3.unexpected)?.fields).toMatchObject({
      code: "INTERNAL",
      error_name: "TypeError",
    });
    // Item 8: job.dead names the job, its kind, the attempt and the code.
    expect(byKind(kinds3.permanent)?.fields).toMatchObject({ attempt: 1, code: "TEST_GONE" });
    expect(JSON.stringify(lines)).not.toContain(marker);
  });
});

describe("item 12 and TC69: stopping the worker", () => {
  it("stops claiming at once and waits for the running job", async () => {
    const probeKind = kind();
    let started = 0;
    const probe = defineJob({
      kind: probeKind,
      payload: z.strictObject({ n: z.number() }),
      async run() {
        started++;
        await sleep(300);
        return undefined;
      },
    });
    const [first] = await enqueueJobs(probeKind);
    const { loop } = startWorker([probe]);
    await waitFor(() => started === 1, 10_000, "the first job");

    const stopped = loop.stop(5000);
    const [second] = await enqueueJobs(probeKind);
    expect(await stopped).toBe(0);
    expect(await status(first ?? "")).toBe("done");
    await sleep(1200);
    expect(await status(second ?? "")).toBe("queued");
    expect(started).toBe(1);
  });

  it("a job still running after the grace period is resumed by the next worker", async () => {
    const probeKind = kind();
    const attempts: number[] = [];
    const probe = defineJob({
      kind: probeKind,
      payload: z.strictObject({ n: z.number() }),
      run(_payload, context) {
        attempts.push(context.attempt);
        if (context.attempt > 1) return Promise.resolve(undefined);
        // Stuck until the worker gives up on it.
        return new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () => {
            reject(new Error("stopped"));
          });
        });
      },
    });
    const [id] = await enqueueJobs(probeKind);
    if (id === undefined) throw new Error("no job");
    const first = startWorker([probe]);
    await waitFor(() => attempts.length === 1, 10_000, "the first run");

    expect(await first.loop.stop(200)).toBe(1);
    // Left to its lease: nothing was recorded for the abandoned attempt.
    expect(await jobRows(probeKind)).toEqual([
      { id, status: "running", attempts: 1, last_error_code: null },
    ]);
    expect(first.lines).toEqual([]);

    await expireLease(id);
    startWorker([probe]);
    await waitFor(async () => (await status(id)) === "done", 10_000, "the resumed job");
    expect(attempts).toEqual([1, 2]);
  });
});

describe("items 6 and 8: the scheduler", () => {
  it("queues one job per slot over many ticks, and marks dead an expired last attempt", async () => {
    const dailyKind = kind("daily");
    const stuckKind = kind("stuck");
    const stuck = await scalar<string>(
      dbPool(),
      `insert into app.job (kind, status, attempts, max_attempts, locked_until)
       values ($1, 'running', 10, 10, now() - interval '1 second') returning id`,
      [stuckKind],
    );
    const db = pool();
    const { logger, lines } = captureLogger();
    let ticks = 0;
    const scheduler = startScheduler({
      store: createJobStore(db),
      schedule: [{ kind: dailyKind, every: "1 day" }],
      logger,
      intervalMs: 20,
      onTick: () => {
        ticks++;
      },
    });
    try {
      await waitFor(() => ticks >= 5, 10_000, "five ticks");
    } finally {
      await scheduler.stop();
    }
    const today = new Date().toISOString().slice(0, 10);
    const rows = await dbPool().query<{ dedupe_key: string; run_at: Date; status: string }>(
      "select dedupe_key, run_at, status::text from app.job where kind = $1",
      [dailyKind],
    );
    expect(rows.rows).toEqual([
      {
        dedupe_key: `schedule:${dailyKind}:${today}T00:00Z`,
        run_at: new Date(`${today}T00:00:00Z`),
        status: "queued",
      },
    ]);
    expect(await status(stuck)).toBe("dead");
    expect(lines).toContainEqual({
      level: "error",
      event: "job.dead",
      fields: { job_id: stuck, kind: stuckKind, attempt: 10, code: "LEASE_EXPIRED" },
    });
  });
});
