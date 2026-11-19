// FR75, OPS03, TC69 (worker part), items 1 to 4, 6, 8 and 11 of task 2.5: the job entry points
// of 20261119130000_worker_jobs.sql, with the test clock.
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { setClock } from "./_harness/clock.ts";
import { closeDb, dbError, dbPool, rolledBack, scalar } from "./_harness/db.ts";
import { withTwoConnections } from "./_harness/parallel.ts";
import { actAs, type CallerRole } from "./_harness/roles.ts";
import { deleteJobs, enqueueJobs, testKind } from "./_harness/worker.ts";

afterAll(closeDb);

const T0 = new Date("2026-11-19T10:00:00.000Z");
const at = (base: Date, seconds: number) => new Date(base.getTime() + seconds * 1000);
const MINUTE = 60;

interface Claimed {
  job_id: string;
  job_kind: string;
  job_payload: unknown;
  job_attempt: number;
  job_max_attempts: number;
}

async function enqueue(client: pg.ClientBase, kind: string, runAt: Date): Promise<string> {
  await actAs(client, "postgres");
  return scalar<string>(client, "select app.enqueue_job($1, '{}'::jsonb, null, $2)", [
    kind,
    runAt.toISOString(),
  ]);
}

async function claim(client: pg.ClientBase, kinds: string[], limit = 10): Promise<Claimed[]> {
  await actAs(client, "souq_worker");
  const result = await client.query<Claimed>("select * from app.claim_jobs($1::text[], $2)", [
    kinds,
    limit,
  ]);
  return result.rows.sort((a, b) => Number(a.job_id) - Number(b.job_id));
}

async function complete(client: pg.ClientBase, id: string, attempt: number): Promise<boolean> {
  await actAs(client, "souq_worker");
  return scalar<boolean>(client, "select app.complete_job($1, $2)", [id, attempt]);
}

async function fail(
  client: pg.ClientBase,
  id: string,
  attempt: number,
  code: string,
  retryable: boolean,
): Promise<{ job_status: string; retry_at: Date | null } | undefined> {
  await actAs(client, "souq_worker");
  const result = await client.query<{ job_status: string; retry_at: Date | null }>(
    "select * from app.fail_job($1, $2, $3, $4)",
    [id, attempt, code, retryable],
  );
  return result.rows[0];
}

interface Row {
  status: string;
  attempts: number;
  run_at: Date;
  locked_until: Date | null;
  completed_at: Date | null;
  last_error_code: string | null;
}

async function row(client: pg.ClientBase, id: string): Promise<Row> {
  await actAs(client, "postgres");
  const result = await client.query<Row>(
    "select status, attempts, run_at, locked_until, completed_at, last_error_code from app.job where id = $1",
    [id],
  );
  const found = result.rows[0];
  if (found === undefined) throw new Error(`no job ${id}`);
  return found;
}

describe("item 1 and 4: app.claim_jobs", () => {
  it("claims due jobs of the given kinds only, oldest first, under a five-minute lease", async () => {
    await rolledBack(async (client) => {
      await setClock(client, T0);
      const kind = testKind();
      const other = testKind("other");
      const older = await enqueue(client, kind, at(T0, -2 * MINUTE));
      const newer = await enqueue(client, kind, at(T0, -MINUTE));
      const future = await enqueue(client, kind, at(T0, MINUTE));
      await enqueue(client, other, at(T0, -3 * MINUTE));

      const first = await claim(client, [kind], 1);
      expect(first.map((j) => j.job_id)).toEqual([older]);
      const rest = await claim(client, [kind]);
      expect(rest.map((j) => j.job_id)).toEqual([newer]);
      expect(rest[0]).toMatchObject({
        job_kind: kind,
        job_payload: {},
        job_attempt: 1,
        job_max_attempts: 10,
      });
      expect(await row(client, newer)).toMatchObject({
        status: "running",
        attempts: 1,
        locked_until: at(T0, 5 * MINUTE),
      });
      expect((await row(client, future)).status).toBe("queued");
      // Nothing more is due: the running jobs hold their lease, the third is in the future.
      expect(await claim(client, [kind])).toEqual([]);
    });
  });

  it("refuses a limit outside 1 to 20", async () => {
    await rolledBack(async (client) => {
      await actAs(client, "souq_worker");
      for (const limit of [0, 21]) {
        expect(
          (await dbError(client, "select * from app.claim_jobs(array['a.b'], $1)", [limit])).code,
        ).toBe("XX000");
      }
    });
  });

  it("SKIP LOCKED: two workers never claim the same job, and the second does not wait", async () => {
    const kind = testKind();
    const [first, second] = await enqueueJobs(kind, 2);
    try {
      await withTwoConnections(async (a, b) => {
        await a.query("begin");
        await b.query("begin");
        const fromA = await claim(a, [kind], 1);
        const fromB = await Promise.race([
          claim(b, [kind], 5),
          new Promise<"blocked">((resolve) =>
            setTimeout(() => {
              resolve("blocked");
            }, 3000),
          ),
        ]);
        expect(fromA.map((j) => j.job_id)).toEqual([first]);
        expect(fromB === "blocked" ? fromB : fromB.map((j) => j.job_id)).toEqual([second]);
        await a.query("rollback");
        await b.query("rollback");
      });
    } finally {
      await deleteJobs([kind]);
    }
  });
});

describe("TC69 and item 1: resume after a worker stopped, fenced by the attempt number", () => {
  it("claims an expired lease again as attempt 2, and refuses the first attempt's result", async () => {
    await rolledBack(async (client) => {
      const kind = testKind();
      await setClock(client, T0);
      const id = await enqueue(client, kind, T0);
      expect((await claim(client, [kind]))[0]?.job_attempt).toBe(1);

      await setClock(client, at(T0, 5 * MINUTE - 1));
      expect(await claim(client, [kind])).toEqual([]);
      await setClock(client, at(T0, 5 * MINUTE));
      expect((await claim(client, [kind]))[0]).toMatchObject({ job_id: id, job_attempt: 2 });

      // The worker of attempt 1 comes back late: neither its success nor its failure counts.
      expect(await complete(client, id, 1)).toBe(false);
      expect(await fail(client, id, 1, "LATE", true)).toBeUndefined();
      expect(await complete(client, id, 2)).toBe(true);
      expect(await row(client, id)).toMatchObject({
        status: "done",
        attempts: 2,
        locked_until: null,
        completed_at: at(T0, 5 * MINUTE),
      });
      expect(await complete(client, id, 2)).toBe(false);
    });
  });

  it("a lease that runs out on the tenth attempt is dead with LEASE_EXPIRED, not claimed again", async () => {
    await rolledBack(async (client) => {
      const kind = testKind();
      await setClock(client, T0);
      const id = await enqueue(client, kind, T0);
      await client.query("update app.job set attempts = 9 where id = $1", [id]);
      expect((await claim(client, [kind]))[0]?.job_attempt).toBe(10);

      await setClock(client, at(T0, 6 * MINUTE));
      expect(await claim(client, [kind])).toEqual([]);
      await actAs(client, "souq_worker");
      const reaped = await client.query<{ job_id: string; job_kind: string; job_attempts: number }>(
        "select * from app.reap_expired_jobs() where job_id = $1",
        [id],
      );
      expect(reaped.rows).toEqual([{ job_id: id, job_kind: kind, job_attempts: 10 }]);
      expect(await row(client, id)).toMatchObject({
        status: "dead",
        last_error_code: "LEASE_EXPIRED",
        locked_until: null,
        completed_at: at(T0, 6 * MINUTE),
      });
    });
  });
});

describe("OPS03 and items 2 and 3: app.fail_job", () => {
  it("retries after 1, 5, 15, then 60 minutes, and the tenth failure is dead", async () => {
    await rolledBack(async (client) => {
      const kind = testKind();
      let now = T0;
      await setClock(client, now);
      const id = await enqueue(client, kind, now);
      const delays = [1, 5, 15, 60, 60, 60, 60, 60, 60];

      for (const [index, delay] of delays.entries()) {
        const attempt = index + 1;
        await setClock(client, now);
        expect((await claim(client, [kind]))[0]?.job_attempt).toBe(attempt);
        const outcome = await fail(client, id, attempt, "TEST_FAIL", true);
        const retryAt = at(now, delay * MINUTE);
        expect(outcome, `attempt ${String(attempt)}`).toEqual({
          job_status: "queued",
          retry_at: retryAt,
        });
        expect(await row(client, id)).toMatchObject({
          status: "queued",
          run_at: retryAt,
          locked_until: null,
          last_error_code: "TEST_FAIL",
        });
        await setClock(client, at(retryAt, -1));
        expect(await claim(client, [kind])).toEqual([]);
        now = retryAt;
      }
      // About 6 hours and 21 minutes after the first failure.
      expect((now.getTime() - T0.getTime()) / 60_000).toBe(381);

      await setClock(client, now);
      expect((await claim(client, [kind]))[0]?.job_attempt).toBe(10);
      expect(await fail(client, id, 10, "TEST_FAIL", true)).toEqual({
        job_status: "dead",
        retry_at: null,
      });
      expect(await row(client, id)).toMatchObject({
        status: "dead",
        attempts: 10,
        completed_at: now,
        last_error_code: "TEST_FAIL",
      });
      await setClock(client, at(now, 24 * 60 * MINUTE));
      expect(await claim(client, [kind])).toEqual([]);
    });
  });

  it("a permanent failure is dead at the first attempt", async () => {
    await rolledBack(async (client) => {
      const kind = testKind();
      await setClock(client, T0);
      const id = await enqueue(client, kind, T0);
      await claim(client, [kind]);
      expect(await fail(client, id, 1, "INVALID_PAYLOAD", false)).toEqual({
        job_status: "dead",
        retry_at: null,
      });
      expect(await row(client, id)).toMatchObject({ status: "dead", attempts: 1 });
    });
  });
});

describe("item 6: app.schedule_job", () => {
  it("one job per fixed UTC slot, whatever the number of calls", async () => {
    await rolledBack(async (client) => {
      const kind = testKind("daily");
      await actAs(client, "souq_worker");
      await setClock(client, new Date("2026-11-19T13:45:10Z"));
      const first = await scalar<string>(client, "select app.schedule_job($1, '1 day')", [kind]);
      const again = await scalar<string>(client, "select app.schedule_job($1, '1 day')", [kind]);
      expect(again).toBe(first);
      await setClock(client, new Date("2026-11-19T23:59:59Z"));
      expect(await scalar<string>(client, "select app.schedule_job($1, '1 day')", [kind])).toBe(
        first,
      );
      await setClock(client, new Date("2026-11-20T00:00:00Z"));
      const next = await scalar<string>(client, "select app.schedule_job($1, '1 day')", [kind]);
      expect(next).not.toBe(first);

      await actAs(client, "postgres");
      const rows = await client.query<{
        id: string;
        run_at: Date;
        dedupe_key: string;
        payload: unknown;
      }>("select id, run_at, dedupe_key, payload from app.job where kind = $1 order by id", [kind]);
      expect(rows.rows).toEqual([
        {
          id: first,
          run_at: new Date("2026-11-19T00:00:00Z"),
          dedupe_key: `schedule:${kind}:2026-11-19T00:00Z`,
          payload: {},
        },
        {
          id: next,
          run_at: new Date("2026-11-20T00:00:00Z"),
          dedupe_key: `schedule:${kind}:2026-11-20T00:00Z`,
          payload: {},
        },
      ]);
    });
  });

  it("a 15-minute slot starts on the quarter hour; a period that does not divide a day is refused", async () => {
    await rolledBack(async (client) => {
      const kind = testKind("quarter");
      await actAs(client, "souq_worker");
      await setClock(client, new Date("2026-11-19T13:52:00Z"));
      const id = await scalar<string>(client, "select app.schedule_job($1, '15 minutes')", [kind]);
      await actAs(client, "postgres");
      expect(await scalar<Date>(client, "select run_at from app.job where id = $1", [id])).toEqual(
        new Date("2026-11-19T13:45:00Z"),
      );
      await actAs(client, "souq_worker");
      for (const every of ["7 minutes", "30 seconds", "2 days"]) {
        expect(
          (await dbError(client, "select app.schedule_job($1, $2::interval)", [kind, every])).code,
          every,
        ).toBe("XX000");
      }
    });
  });
});

describe("item 8: app.job_queue_health for /readyz", () => {
  it("reports the age of the oldest due job and the jobs that died in the last 24 hours", async () => {
    await rolledBack(async (client) => {
      // Only this transaction's jobs, so other rows cannot change the numbers.
      await client.query("delete from app.job");
      await actAs(client, "souq_web");
      await setClock(client, T0);
      expect((await client.query("select * from app.job_queue_health()")).rows[0]).toEqual({
        oldest_due_seconds: 0,
        dead_last_24h: 0,
      });

      await actAs(client, "postgres");
      const kind = testKind();
      await client.query(
        `insert into app.job (kind, status, run_at, locked_until, completed_at, attempts) values
           ($1, 'queued',  $2, null, null, 0),
           ($1, 'queued',  $3, null, null, 0),
           ($1, 'running', $4, $5,   null, 1),
           ($1, 'dead',    $4, null, $6,   10),
           ($1, 'dead',    $4, null, $7,   10),
           ($1, 'done',    $4, null, $6,   1)`,
        [
          kind,
          at(T0, -90),
          at(T0, 3600),
          at(T0, -3 * 3600),
          at(T0, -200),
          at(T0, -3600),
          at(T0, -25 * 3600),
        ],
      );
      await actAs(client, "souq_web");
      // The running job's lease ended 200 seconds ago: it is due since then.
      expect((await client.query("select * from app.job_queue_health()")).rows[0]).toEqual({
        oldest_due_seconds: 200,
        dead_last_24h: 1,
      });
    });
  });
});

describe("SEC02 and owner condition 4 of task 2.1: who runs the job functions", () => {
  const workerOnly = [
    "select * from app.claim_jobs(array['a.b'], 1)",
    "select app.complete_job(1, 1)",
    "select * from app.fail_job(1, 1, 'X', true)",
    "select * from app.reap_expired_jobs()",
    "select app.schedule_job('a.b', '1 day')",
    "select app.purge_audit_events(1)",
  ];
  const webOnly = ["select * from app.job_queue_health()"];
  const internal = ["select app.job_retry_delay(1)"];

  async function refused(role: CallerRole, sql: string): Promise<void> {
    await rolledBack(async (client) => {
      await actAs(client, role);
      expect((await dbError(client, sql)).code, `${role}: ${sql}`).toBe("42501");
    });
  }

  it("souq_worker only for the job functions, souq_web only for the health check", async () => {
    for (const sql of workerOnly) {
      for (const role of ["anon", "authenticated", "service_role", "souq_web"] as const) {
        await refused(role, sql);
      }
    }
    for (const sql of webOnly) {
      for (const role of ["anon", "authenticated", "service_role", "souq_worker"] as const) {
        await refused(role, sql);
      }
    }
    for (const sql of internal) {
      for (const role of ["souq_web", "souq_worker"] as const) await refused(role, sql);
    }
  });

  it("item 11: souq_worker sessions have statement and idle-transaction time limits", async () => {
    const settings = await dbPool().query<{ setting: string }>(
      `select unnest(setconfig) as setting from pg_catalog.pg_db_role_setting
        where setrole = 'souq_worker'::regrole and setdatabase = 0`,
    );
    expect(settings.rows.map((r) => r.setting).sort()).toEqual([
      "idle_in_transaction_session_timeout=60s",
      "statement_timeout=30s",
    ]);
  });
});
