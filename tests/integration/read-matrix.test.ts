// DEC77 (task 3.5): the third-party and guest tests of the read functions that existed before
// the decision, registered in _harness/read-matrix.ts. app.me() has its own in account.test.ts.
// Every call runs as souq_web through the server's own withActor, with real sessions.
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Identity } from "../../apps/web/lib/auth/identity.ts";
import { ApiError } from "../../apps/web/lib/http/errors.ts";
import { closeDb, dbPool } from "./_harness/db.ts";
import { memberIdentity } from "./_harness/sessions.ts";
import { signUpMember } from "./_harness/users.ts";
import { webDb } from "./_harness/web.ts";

const db = webDb();
const trace = (): string => randomBytes(16).toString("hex");

afterAll(async () => {
  await db.end();
  await closeDb();
});

async function asCaller<R extends object>(
  identity: Identity | null,
  sql: string,
  values: unknown[] = [],
): Promise<R[]> {
  return db.withActor(identity?.claims ?? null, trace(), async (tx) => {
    return (await tx.query<R>(sql, values)).rows;
  });
}

async function errorCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "ok";
  } catch (error) {
    if (error instanceof ApiError) return error.code;
    throw error;
  }
}

async function newIdentity(name: string): Promise<{ id: string; identity: Identity }> {
  const member = await signUpMember(name);
  return { id: member.id, identity: (await memberIdentity(member)).identity };
}

const SESSION_CONTEXT = "select user_id, display_name from app.session_context()";

describe("DEC77: app.session_context()", () => {
  it("DEC77 app.session_context(): a guest is UNAUTHENTICATED", async () => {
    expect(await errorCode(() => asCaller(null, SESSION_CONTEXT))).toBe("UNAUTHENTICATED");
  });

  it("DEC77 app.session_context(): another member's session reads only its own state", async () => {
    const a = await newIdentity("العضو الأول للمصفوفة");
    const b = await newIdentity("العضو الثاني للمصفوفة");
    expect(await asCaller(b.identity, SESSION_CONTEXT)).toEqual([
      { user_id: b.id, display_name: "العضو الثاني للمصفوفة" },
    ]);
    // B's session with A's id: the session row belongs to B, so nothing of A is read.
    const forged = { ...b.identity.claims, sub: a.id };
    expect(
      await errorCode(() => db.withActor(forged, trace(), (tx) => tx.query(SESSION_CONTEXT))),
    ).toBe("UNAUTHENTICATED");
  });
});

const POLICIES = "select policy_type, version, effective_at, path from app.current_policies()";

describe("DEC77: app.current_policies()", () => {
  it("DEC77 app.current_policies(): a guest reads the versions in force", async () => {
    const rows = await asCaller<{ policy_type: string }>(null, POLICIES);
    expect(rows.map((r) => r.policy_type).sort()).toEqual(["privacy", "terms"]);
  });

  it("DEC77 app.current_policies(): a member gets the same public rows as a guest", async () => {
    const { identity } = await newIdentity("عضو لنسخ السياسات");
    expect(await asCaller(identity, POLICIES)).toEqual(await asCaller(null, POLICIES));
  });
});

const COLLEGES = "select id, key, label_ar, label_en from app.active_colleges()";

describe("DEC77: app.active_colleges()", () => {
  it("DEC77 app.active_colleges(): a guest reads the active colleges only", async () => {
    const rows = await asCaller<{ id: string }>(null, COLLEGES);
    const active = await dbPool().query<{ id: string }>(
      "select id from public.college where is_active order by id",
    );
    expect(rows.map((r) => r.id).sort()).toEqual(active.rows.map((r) => r.id).sort());
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["id", "key", "label_ar", "label_en"]);
  });

  it("DEC77 app.active_colleges(): a member gets the same public rows as a guest", async () => {
    const { identity } = await newIdentity("عضو لقائمة الكليات");
    expect(await asCaller(identity, COLLEGES)).toEqual(await asCaller(null, COLLEGES));
  });
});

const QUEUE = "select oldest_due_seconds, dead_last_24h from app.job_queue_health()";

describe("DEC77: app.job_queue_health()", () => {
  it("DEC77 app.job_queue_health(): a guest reads two counts only", async () => {
    const rows = await asCaller<Record<string, unknown>>(null, QUEUE);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["dead_last_24h", "oldest_due_seconds"]);
  });

  it("DEC77 app.job_queue_health(): a member's identity changes nothing", async () => {
    const { identity } = await newIdentity("عضو لصحة الطابور");
    const [member] = await asCaller<{ dead_last_24h: number }>(identity, QUEUE);
    const [guest] = await asCaller<{ dead_last_24h: number }>(null, QUEUE);
    expect(member?.dead_last_24h).toBe(guest?.dead_last_24h);
  });
});

const CHECK = "select app.rate_limit_check($1, $2, 1, '1 day') as wait";

describe("DEC77: app.rate_limit_check()", () => {
  const key = (): Buffer => randomBytes(32);

  it("DEC77 app.rate_limit_check(): a guest reads one number for the given key", async () => {
    expect(await asCaller(null, CHECK, ["DEC77:probe", key()])).toEqual([{ wait: 0 }]);
  });

  it("DEC77 app.rate_limit_check(): a member's identity changes nothing", async () => {
    const { identity } = await newIdentity("عضو لفحص الحد");
    const used = key();
    await db.withActor(null, trace(), (tx) =>
      tx.query("select app.rate_limit_hit('DEC77:probe', $1, 1, '1 day')", [used]),
    );
    await db.withActor(null, trace(), (tx) =>
      tx.query("select app.rate_limit_hit('DEC77:probe', $1, 1, '1 day')", [used]),
    );
    const [asMember] = await asCaller<{ wait: number }>(identity, CHECK, ["DEC77:probe", used]);
    const [asGuest] = await asCaller<{ wait: number }>(null, CHECK, ["DEC77:probe", used]);
    expect(asMember?.wait).toBeGreaterThan(0);
    expect(asMember).toEqual(asGuest);
    // Another key reads nothing of this one.
    expect(await asCaller(identity, CHECK, ["DEC77:probe", key()])).toEqual([{ wait: 0 }]);
  });
});
