// Task 3.1 (plan/task-3.1.md, items 9 to 13): the web server's database client as souq_web,
// error mapping with real database errors, DEC70 failure counters, DEC72 retries and /readyz.
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import {
  createAppDb,
  createPool,
  MAX_TRANSIENT_RETRIES,
  type Tx,
} from "../../apps/web/lib/db/app-client.ts";
import { ApiError } from "../../apps/web/lib/http/errors.ts";
import { fingerprint, rateLimitCheck, rateLimitHit } from "../../apps/web/lib/http/rate-limit.ts";
import { checkReadiness } from "../../apps/web/lib/http/readiness.ts";
import { closeDb, dbPool, scalar } from "./_harness/db.ts";
import { memberClaims } from "./_harness/roles.ts";
import { signUpMember, type TestMember } from "./_harness/users.ts";
import { stackConfig, webDb, webPool } from "./_harness/web.ts";

const pool = webPool(6);
const db = webDb(pool);
const trace = (): string => randomBytes(16).toString("hex");
let member: TestMember;

/** Entry points for these tests only, granted to souq_web; committed, and dropped below. */
const PROBES: Record<string, string> = {
  "app.probe_web_error(text, text, text)": `create function app.probe_web_error(p_code text, p_field text, p_rule text)
    returns void language plpgsql security definer set search_path = ''
    as $$ begin perform app.raise_api_error(p_code, p_field, p_rule); end; $$`,
  "app.probe_web_rate_limited(integer)": `create function app.probe_web_rate_limited(p integer)
    returns void language plpgsql security definer set search_path = ''
    as $$ begin perform app.raise_rate_limited(p); end; $$`,
  "app.probe_web_serialization()": `create function app.probe_web_serialization()
    returns void language plpgsql security definer set search_path = ''
    as $$ begin raise exception using errcode = '40001', message = 'probe'; end; $$`,
  "app.probe_web_unique()": `create function app.probe_web_unique()
    returns void language plpgsql security definer set search_path = ''
    as $$ begin
      insert into app.rate_limit_bucket (scope, key_hash, window_start, count, expires_at)
      select 'probe:unique', pg_catalog.sha256('probe'::bytea), '2000-01-01Z', 1, '2000-01-02Z'
        from pg_catalog.generate_series(1, 2);
    end; $$`,
  "app.probe_web_lock(uuid)": `create function app.probe_web_lock(p uuid)
    returns void language plpgsql security definer set search_path = ''
    as $$ begin perform 1 from public.account_control c where c.user_id = p for update nowait; end; $$`,
  "app.probe_web_audit()": `create function app.probe_web_audit()
    returns uuid language sql security definer set search_path = ''
    as $$ select app.audit('test.web_trace', 'profile', app.actor_id()) $$`,
  "app.probe_web_idem_claim(uuid, jsonb)": `create function app.probe_web_idem_claim(p_key uuid, p_input jsonb)
    returns jsonb language sql security definer set search_path = ''
    as $$ select app.idempotency_claim('POST /probe/dec72', p_key, p_input) $$`,
  "app.probe_web_idem_complete(uuid, jsonb)": `create function app.probe_web_idem_complete(p_key uuid, p_result jsonb)
    returns void language sql security definer set search_path = ''
    as $$ select app.idempotency_complete('POST /probe/dec72', p_key, p_result) $$`,
};

async function dropProbes(): Promise<void> {
  for (const signature of Object.keys(PROBES)) {
    await dbPool().query(`drop function if exists ${signature}`);
  }
}

beforeAll(async () => {
  member = await signUpMember();
  await dropProbes();
  for (const [signature, sql] of Object.entries(PROBES)) {
    await dbPool().query(sql);
    await dbPool().query(`grant execute on function ${signature} to souq_web`);
  }
});

afterAll(async () => {
  await dropProbes();
  await db.end();
  await closeDb();
});

/** The ApiError a call was refused with. */
async function refusal(run: () => Promise<unknown>): Promise<ApiError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected an ApiError");
}

function claimsOf(m: TestMember) {
  return { ...memberClaims(m.id), session_id: m.sessionId };
}

describe("item 9: withActor as souq_web", () => {
  it("runs as souq_web, with the claims and the trace id for that transaction only", async () => {
    const single = webPool(1);
    const singleDb = createAppDb(single);
    try {
      const claims = claimsOf(member);
      const traceId = trace();
      const inside = await singleDb.withActor(claims, traceId, async (tx) => {
        const result = await tx.query<{ role: string; claims: string; trace: string }>(
          `select current_user as role, current_setting('request.jwt.claims', true) as claims,
                  current_setting('app.trace_id', true) as trace`,
        );
        return result.rows[0];
      });
      expect(inside?.role).toBe("souq_web");
      expect(JSON.parse(inside?.claims ?? "null")).toEqual(claims);
      expect(inside?.trace).toBe(traceId);

      // The same connection (a pool of one), back from the pool: nothing is left on it (SEC02).
      const after = await singleDb.query<{ claims: string | null; trace: string | null }>(
        traceId,
        `select nullif(current_setting('request.jwt.claims', true), '') as claims,
                nullif(current_setting('app.trace_id', true), '') as trace`,
      );
      expect(after.rows[0]).toEqual({ claims: null, trace: null });
    } finally {
      await singleDb.end();
    }
  });

  it("a guest transaction has no identity, and member functions refuse it", async () => {
    const error = await refusal(() =>
      db.withActor(null, trace(), (tx) => tx.query("select * from app.session_context()")),
    );
    expect(error.code).toBe("UNAUTHENTICATED");
  });

  it("NFR13: the audit row of a write carries the request's trace id", async () => {
    const traceId = trace();
    const id = await db.withActor(claimsOf(member), traceId, async (tx) => {
      const result = await tx.query<{ id: string }>("select app.probe_web_audit() as id");
      return result.rows[0]?.id;
    });
    const row = await dbPool().query<{ trace_id: string; actor_id: string }>(
      "select trace_id, actor_id from app.audit_event where id = $1",
      [id],
    );
    expect(row.rows[0]).toEqual({ trace_id: traceId, actor_id: member.id });
  });

  it("task 2.4 fix: an idempotent write from souq_web commits (the deferred check runs as its owner)", async () => {
    const key = randomUUID();
    const result = await db.withActor(claimsOf(member), trace(), async (tx) => {
      await tx.query("select app.probe_web_idem_claim($1, '{}'::jsonb)", [key]);
      await tx.query("select app.probe_web_idem_complete($1, '{\"ok\":true}'::jsonb)", [key]);
      return "committed";
    });
    expect(result).toBe("committed");
    // A claim left open still fails at commit, as task 2.4 requires.
    const open = await refusal(() =>
      db.withActor(claimsOf(member), trace(), (tx) =>
        tx.query("select app.probe_web_idem_claim($1, '{}'::jsonb)", [randomUUID()]),
      ),
    );
    expect(open.code).toBe("INTERNAL_ERROR");
  });

  it("refuses a DATABASE_URL that logs in as another role", async () => {
    const asPostgres = createAppDb(new pg.Pool({ connectionString: inject("dbUrl"), max: 1 }));
    try {
      const error = await refusal(() =>
        asPostgres.withActor(null, trace(), (tx) => tx.query("select 1")),
      );
      expect(error.code).toBe("INTERNAL_ERROR");
      expect((await refusal(() => asPostgres.query(trace(), "select 1"))).code).toBe(
        "INTERNAL_ERROR",
      );
    } finally {
      await asPostgres.end();
    }
  });

  it("item 10: the time limits of souq_web are set for its own logins", async () => {
    const settings = await scalar<string[]>(
      dbPool(),
      `select s.setconfig from pg_catalog.pg_db_role_setting s
         join pg_catalog.pg_roles r on r.oid = s.setrole
        where r.rolname = 'souq_web' and s.setdatabase = 0`,
    );
    expect([...settings].sort()).toEqual([
      "idle_in_transaction_session_timeout=15s",
      "lock_timeout=3s",
      "statement_timeout=5s",
    ]);
  });
});

describe("item 11: database errors to contract errors", () => {
  /** Runs `body` once through withActor and returns the error and the number of attempts. */
  async function attempt(body: (tx: Tx) => Promise<unknown>) {
    let attempts = 0;
    const error = await refusal(() =>
      db.withActor(claimsOf(member), trace(), async (tx) => {
        attempts++;
        return body(tx);
      }),
    );
    return { error, attempts };
  }

  it("SJ001 with a contract code, with and without a field", async () => {
    const field = await attempt((tx) =>
      tx.query("select app.probe_web_error('VALIDATION_FAILED', 'title', 'too_small')"),
    );
    expect(field.error.status).toBe(422);
    expect(field.error.code).toBe("VALIDATION_FAILED");
    expect(field.error.fieldErrors).toEqual([{ field: "title", code: "too_small" }]);

    const plain = await attempt((tx) =>
      tx.query("select app.probe_web_error('STATE_CONFLICT', null, null)"),
    );
    expect([plain.error.status, plain.error.code, plain.error.fieldErrors]).toEqual([
      409,
      "STATE_CONFLICT",
      [],
    ]);
  });

  it("SJ001 with a code the contract does not have is a 500", async () => {
    const { error } = await attempt((tx) =>
      tx.query("select app.probe_web_error('NOT_A_CONTRACT_CODE', null, null)"),
    );
    expect([error.status, error.code]).toEqual([500, "INTERNAL_ERROR"]);
  });

  it("RATE_LIMITED is 429 with Retry-After from the detail", async () => {
    const { error } = await attempt((tx) => tx.query("select app.probe_web_rate_limited(42)"));
    expect([error.status, error.code, error.retryAfter]).toEqual([429, "RATE_LIMITED", 42]);
  });

  it("an unregistered unique violation is a 500", async () => {
    const { error } = await attempt((tx) => tx.query("select app.probe_web_unique()"));
    expect([error.status, error.code]).toEqual([500, "INTERNAL_ERROR"]);
  });

  it("a lock not available (55P03) is 503 with Retry-After 1, without a retry", async () => {
    const holder = await dbPool().connect();
    try {
      await holder.query("begin");
      await holder.query("select 1 from public.account_control where user_id = $1 for update", [
        member.id,
      ]);
      const { error, attempts } = await attempt((tx) =>
        tx.query("select app.probe_web_lock($1)", [member.id]),
      );
      expect([error.status, error.code, error.retryAfter, attempts]).toEqual([
        503,
        "SERVICE_UNAVAILABLE",
        1,
        1,
      ]);
    } finally {
      await holder.query("rollback");
      holder.release();
    }
  });

  it("a statement timeout (57014) is 503, without a retry", async () => {
    const { error, attempts } = await attempt(async (tx) => {
      await tx.query("set local statement_timeout = '50ms'");
      return tx.query("select pg_catalog.pg_sleep(1)");
    });
    expect([error.status, error.code, attempts]).toEqual([503, "SERVICE_UNAVAILABLE", 1]);
  });

  it("any other database error is a 500", async () => {
    const { error, attempts } = await attempt((tx) => tx.query("select 1 / 0"));
    expect([error.status, error.code, attempts]).toEqual([500, "INTERNAL_ERROR", 1]);
  });

  it("a database that does not answer is 503", async () => {
    const down = createAppDb(createPool("postgresql://souq_web@127.0.0.1:1/postgres"));
    try {
      const error = await refusal(() =>
        down.withActor(null, trace(), (tx) => tx.query("select 1")),
      );
      expect([error.status, error.code, error.retryAfter]).toEqual([503, "SERVICE_UNAVAILABLE", 1]);
    } finally {
      await down.end();
    }
  });
});

describe("DEC72: transient failures are retried, at most three times", () => {
  it("a serialization failure (40001) is retried three times with growing delays, then 503", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const error = await refusal(() =>
      db.withActor(
        claimsOf(member),
        trace(),
        async (tx) => {
          attempts++;
          return tx.query("select app.probe_web_serialization()");
        },
        {
          sleep: (ms) => {
            delays.push(ms);
            return Promise.resolve();
          },
        },
      ),
    );
    expect(attempts).toBe(1 + MAX_TRANSIENT_RETRIES);
    expect(delays).toHaveLength(MAX_TRANSIENT_RETRIES);
    expect(delays[0]).toBeGreaterThanOrEqual(20);
    expect(delays[0]).toBeLessThan(40);
    expect(delays[2]).toBeGreaterThanOrEqual(80);
    expect(delays[2]).toBeLessThan(160);
    expect([error.status, error.code, error.retryAfter]).toEqual([503, "SERVICE_UNAVAILABLE", 1]);
  });

  it("a deadlock between two requests: the victim succeeds on retry, and every effect happens once", async () => {
    const scope = "test:dec72";
    const keyA = randomBytes(32);
    const keyB = randomBytes(32);
    const claims = claimsOf(member);

    // Both transactions take their first lock, then wait for each other's (the deadlock).
    let firstLocks = 0;
    let release: () => void = () => undefined;
    const bothLocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const attempts = { one: 0, two: 0 };
    const keys: Record<"one" | "two", string[]> = { one: [], two: [] };
    let sleeps = 0;

    function request(name: "one" | "two", requestKey: string, first: Buffer, second: Buffer) {
      return db.withActor(
        claims,
        trace(),
        async (tx) => {
          attempts[name]++;
          keys[name].push(requestKey);
          const input = JSON.stringify({ request: name });
          const prior = await tx.query<{ r: unknown }>(
            "select app.probe_web_idem_claim($1, $2::jsonb) as r",
            [requestKey, input],
          );
          if (prior.rows[0]?.r !== null) return prior.rows[0]?.r;
          const hit = (key: Buffer) =>
            tx.query("select app.rate_limit_hit($1, $2, 1000, '1 day')", [scope, key]);
          await hit(first);
          if (attempts[name] === 1) {
            firstLocks++;
            if (firstLocks === 2) release();
            await bothLocked;
          }
          await hit(second);
          const result = { done: name };
          await tx.query("select app.probe_web_idem_complete($1, $2::jsonb)", [
            requestKey,
            JSON.stringify(result),
          ]);
          return result;
        },
        {
          sleep: () => {
            sleeps++;
            return Promise.resolve();
          },
        },
      );
    }

    const keyOne = randomUUID();
    const keyTwo = randomUUID();
    const results = await Promise.all([
      request("one", keyOne, keyA, keyB),
      request("two", keyTwo, keyB, keyA),
    ]);
    expect(results).toEqual([{ done: "one" }, { done: "two" }]);
    // Postgres picked one victim; it ran once more, with the same request key.
    expect(attempts.one + attempts.two).toBe(3);
    expect(sleeps).toBe(1);
    expect(new Set(keys.one)).toEqual(new Set([keyOne]));
    expect(new Set(keys.two)).toEqual(new Set([keyTwo]));

    async function count(key: Buffer): Promise<number> {
      return Number(
        await scalar<string>(
          dbPool(),
          "select coalesce(sum(count), 0)::text from app.rate_limit_bucket where scope = $1 and key_hash = $2",
          [scope, key],
        ),
      );
    }
    // One increment per request on each key: the rolled-back attempt left nothing.
    expect(await count(keyA)).toBe(2);
    expect(await count(keyB)).toBe(2);

    // The same request again with the same key returns the stored result and changes nothing.
    const victim = attempts.one === 2 ? "one" : "two";
    const again = await request(
      victim,
      victim === "one" ? keyOne : keyTwo,
      victim === "one" ? keyA : keyB,
      victim === "one" ? keyB : keyA,
    );
    expect(again).toEqual({ done: victim });
    expect(await count(keyA)).toBe(2);
    expect(await count(keyB)).toBe(2);
  });
});

describe("item 12, DEC70: failure counters outside the business transaction", () => {
  const limit = { scope: "RL01:email", limit: 2, window: "15 minutes" };

  async function bucket(key: Buffer): Promise<number> {
    return Number(
      await scalar<string>(
        dbPool(),
        "select coalesce(sum(count), 0)::text from app.rate_limit_bucket where scope = $1 and key_hash = $2",
        [limit.scope, key],
      ),
    );
  }

  it("a failure counted after the attempt survives the attempt's rollback; one inside it does not", async () => {
    const secret = randomBytes(32).toString("base64url");
    const key = fingerprint(secret, "email", `dec70-${randomUUID()}@example.test`);
    await refusal(() =>
      db.withActor(claimsOf(member), trace(), async (tx) => {
        await tx.query("select app.rate_limit_hit($1, $2, $3, $4::interval)", [
          limit.scope,
          key,
          limit.limit,
          limit.window,
        ]);
        throw new ApiError("UNAUTHENTICATED");
      }),
    );
    expect(await bucket(key)).toBe(0);

    await refusal(() =>
      db.withActor(claimsOf(member), trace(), () =>
        Promise.reject(new ApiError("UNAUTHENTICATED")),
      ),
    );
    expect(await rateLimitHit(db, trace(), limit, key)).toBe(0);
    expect(await bucket(key)).toBe(1);
  });

  it("checks before an attempt without counting, and reports the wait once the limit is reached", async () => {
    const key = fingerprint(randomBytes(32).toString("base64url"), "ip", "203.0.113.7");
    expect(await rateLimitCheck(db, trace(), limit, key)).toBe(0);
    expect(await rateLimitHit(db, trace(), limit, key)).toBe(0);
    expect(await rateLimitHit(db, trace(), limit, key)).toBe(0);
    const wait = await rateLimitCheck(db, trace(), limit, key);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(15 * 60);
    expect(await bucket(key)).toBe(2);
  });

  it("SEC07: a counter that cannot be reached refuses with 503", async () => {
    const down = createAppDb(createPool("postgresql://souq_web@127.0.0.1:1/postgres"));
    try {
      const key = fingerprint(randomBytes(32).toString("base64url"), "guest", "g".repeat(43));
      const error = await refusal(() => rateLimitHit(down, trace(), limit, key));
      expect([error.status, error.code]).toEqual([503, "SERVICE_UNAVAILABLE"]);
    } finally {
      await down.end();
    }
  });
});

describe("item 13: /readyz checks", () => {
  it("the database and the queue as souq_web; a late job marks the queue and the site stays ready", async () => {
    const health = await dbPool().query<{ oldest_due_seconds: number; dead_last_24h: number }>(
      "select * from app.job_queue_health()",
    );
    const queueNow = health.rows[0];
    const ready = await checkReadiness(stackConfig(), db, trace());
    expect(ready.checks.supabase_auth).toBe(true);
    expect(ready.checks.database).toBe(true);
    expect(ready.status).toBe("ready");
    // Other tests leave dead jobs behind, so the queue's state is compared, not assumed.
    expect(ready.checks.job_queue).toBe(
      queueNow !== undefined && queueNow.oldest_due_seconds <= 600 && queueNow.dead_last_24h === 0,
    );

    const late = await scalar<string>(
      dbPool(),
      "select app.enqueue_job('test.readyz_late', '{}'::jsonb, null, now() - interval '11 minutes')::text",
    );
    try {
      const withLateJob = await checkReadiness(stackConfig(), db, trace());
      expect(withLateJob.status).toBe("ready");
      expect(withLateJob.checks).toEqual({ supabase_auth: true, database: true, job_queue: false });
    } finally {
      await dbPool().query("delete from app.job where id = $1", [late]);
    }
  });

  it("not ready when the database does not answer", async () => {
    const down = createAppDb(createPool("postgresql://souq_web@127.0.0.1:1/postgres"));
    try {
      const result = await checkReadiness(stackConfig(), down, trace());
      expect(result).toEqual({
        status: "not_ready",
        checks: { supabase_auth: true, database: false, job_queue: false },
      });
    } finally {
      await down.end();
    }
  });
});
