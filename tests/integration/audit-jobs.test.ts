// FR75, RET08, items 5 and 6 of task 2.4: the audit log and the job table.
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setClock } from "./_harness/clock.ts";
import { closeDb, dbError, dbPool, rolledBack, scalar } from "./_harness/db.ts";
import { actAs, memberClaims } from "./_harness/roles.ts";
import { signUpMember, type TestMember } from "./_harness/users.ts";

afterAll(closeDb);

let member: TestMember;

beforeAll(async () => {
  member = await signUpMember();
});

describe("FR75: app.audit", () => {
  it("records the member from the claims and the trace id of the request", async () => {
    const row = await rolledBack(async (client) => {
      await actAs(client, "postgres", memberClaims(member.id));
      await client.query("select set_config('app.trace_id', 'trace-0001', true)");
      const id = await scalar<string>(
        client,
        `select app.audit('role.grant', 'profile', $1, null, '{"role":"moderator"}')`,
        [member.id],
      );
      const result = await client.query<{ actor_id: string; trace_id: string; action: string }>(
        "select actor_id, trace_id, action from app.audit_event where id = $1",
        [id],
      );
      return result.rows[0];
    });
    expect(row).toEqual({ actor_id: member.id, trace_id: "trace-0001", action: "role.grant" });
  });

  it("records no actor for worker jobs, and refuses metadata over 4 KiB", async () => {
    await rolledBack(async (client) => {
      const id = await scalar<string>(client, "select app.audit('job.retention_run')");
      expect(
        await scalar<string | null>(client, "select actor_id from app.audit_event where id = $1", [
          id,
        ]),
      ).toBeNull();
      const big = JSON.stringify({ text: "x".repeat(5000) });
      expect(
        (
          await dbError(
            client,
            "select app.audit('job.retention_run', null, null, null, $1::jsonb)",
            [big],
          )
        ).code,
      ).toBe("23514");
    });
  });
});

describe("RET08 and the owner condition on item 5: the audit log is append-only", () => {
  it("refuses update, delete and truncate, even for postgres", async () => {
    await rolledBack(async (client) => {
      const id = await scalar<string>(client, "select app.audit('test.audit_guard')");
      await client.query(
        "insert into app.audit_event (action, occurred_at) values ('test.old_row', '2024-01-01T00:00:00Z')",
      );
      for (const sql of [
        "update app.audit_event set action = 'test.changed' where id = $1",
        "delete from app.audit_event where id = $1",
      ]) {
        expect((await dbError(client, sql, [id])).code, sql).toBe("55000");
      }
      expect(
        (await dbError(client, "delete from app.audit_event where action = 'test.old_row'")).code,
      ).toBe("55000");
      expect((await dbError(client, "truncate app.audit_event")).code).toBe("55000");
    });
  });

  it("only the worker's cleanup deletes, and only rows older than 730 days", async () => {
    await rolledBack(async (client) => {
      await setClock(client, new Date("2026-12-01T00:00:00Z"));
      await client.query(`insert into app.audit_event (action, occurred_at) values
        ('test.purge_due', '2024-12-01T00:00:00Z'),
        ('test.purge_kept', '2024-12-02T00:00:00Z')`);

      for (const role of ["souq_web", "authenticated", "anon"] as const) {
        await client.query("savepoint not_worker");
        await actAs(client, role);
        expect((await dbError(client, "select app.purge_audit_events(100)")).code, role).toBe(
          "42501",
        );
        await client.query("rollback to savepoint not_worker");
      }

      await client.query("savepoint worker_direct");
      await actAs(client, "souq_worker");
      expect((await dbError(client, "delete from app.audit_event")).code).toBe("42501");
      await client.query("rollback to savepoint worker_direct");

      await client.query("savepoint worker");
      await actAs(client, "souq_worker");
      expect(await scalar<number>(client, "select app.purge_audit_events(100)")).toBe(1);
      await client.query("release savepoint worker");
      await actAs(client, "postgres");
      const left = await client.query<{ action: string }>(
        "select action from app.audit_event where action like 'test.purge_%' order by 1",
      );
      expect(left.rows).toEqual([{ action: "test.purge_kept" }]);
      // The purge flag does not outlive the cleanup call.
      expect(
        (await dbError(client, "delete from app.audit_event where action = 'test.purge_kept'"))
          .code,
      ).toBe("55000");
    });
  });
});

describe("FR75 and item 6: app.enqueue_job", () => {
  it("a job enqueued in a rolled-back transaction does not remain", async () => {
    const dedupe = `test:${randomUUID()}`;
    await rolledBack((client) =>
      client.query("select app.enqueue_job('test.job', '{}'::jsonb, $1)", [dedupe]),
    );
    expect(
      await scalar<string>(dbPool(), "select count(*)::text from app.job where dedupe_key = $1", [
        dedupe,
      ]),
    ).toBe("0");
  });

  it("the same dedupe_key gives one job, queued with ten attempts allowed", async () => {
    await rolledBack(async (client) => {
      const dedupe = `test:${randomUUID()}`;
      const first = await scalar<string>(
        client,
        `select app.enqueue_job('test.job', '{"id":1}'::jsonb, $1)::text`,
        [dedupe],
      );
      const second = await scalar<string>(
        client,
        `select app.enqueue_job('test.job', '{"id":2}'::jsonb, $1)::text`,
        [dedupe],
      );
      expect(second).toBe(first);
      const rows = await client.query<{ status: string; attempts: number; max_attempts: number }>(
        "select status::text, attempts, max_attempts from app.job where dedupe_key = $1",
        [dedupe],
      );
      expect(rows.rows).toEqual([{ status: "queued", attempts: 0, max_attempts: 10 }]);
    });
  });

  it("refuses a payload over 8 KiB and a kind outside the format", async () => {
    await rolledBack(async (client) => {
      const big = JSON.stringify({ text: "x".repeat(9000) });
      expect(
        (await dbError(client, "select app.enqueue_job('test.job', $1::jsonb)", [big])).code,
      ).toBe("23514");
      expect((await dbError(client, "select app.enqueue_job('BadKind')")).code).toBe("23514");
    });
  });
});
