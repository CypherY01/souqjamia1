// Task 3.2 (plan/task-3.2.md, item 4): API114 (app.current_policies), the college pick list
// (app.active_colleges) and API119 (app.acknowledge_policies, DEC69), through souq_web.
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDb } from "../../apps/web/lib/db/app-client.ts";
import { ApiError } from "../../apps/web/lib/http/errors.ts";
import {
  acknowledgePolicies,
  activeColleges,
  currentPolicies,
} from "../../apps/web/lib/auth/policies.ts";
import { setClock } from "./_harness/clock.ts";
import { closeDb, rolledBack, scalar } from "./_harness/db.ts";
import { actAs, passwordAmr, type Claims } from "./_harness/roles.ts";
import { currentPolicyVersions, signUpMember, type TestMember } from "./_harness/users.ts";
import { webDb } from "./_harness/web.ts";

const db = webDb();
let member: TestMember;

beforeAll(async () => {
  member = await signUpMember();
});

afterAll(async () => {
  await db.end();
  await closeDb();
});

function claimsOf(m: TestMember, overrides: Partial<Claims> = {}): Claims {
  return {
    sub: m.id,
    role: "authenticated",
    session_id: m.sessionId,
    aal: "aal1",
    amr: passwordAmr(),
    ...overrides,
  };
}

/** The contract code an entry point raises as souq_web, or "ok". */
async function asWeb(
  client: pg.ClientBase,
  claims: Claims | null,
  sql: string,
  params: unknown[] = [],
) {
  await client.query("savepoint as_web");
  try {
    // No claims: an empty setting, as the server sets for a guest.
    await actAs(client, "souq_web", claims ?? "");
    await client.query(sql, params);
    await client.query("release savepoint as_web");
    return "ok";
  } catch (error) {
    await client.query("rollback to savepoint as_web");
    if (error instanceof pg.DatabaseError && error.code === "SJ001") return error.message;
    throw error;
  } finally {
    await actAs(client, "postgres");
  }
}

describe("API114: the versions in force", () => {
  it("one version per policy type, with its date and path", async () => {
    const versions = await currentPolicyVersions();
    const policies = await currentPolicies(db, "trace");
    expect(policies.terms.version).toBe(versions.terms);
    expect(policies.privacy.version).toBe(versions.privacy);
    expect(policies.terms.path).toMatch(/^\//);
    expect(new Date(policies.terms.effective_at).toISOString()).toBe(policies.terms.effective_at);
  });

  it("a newer version takes over once it is in effect, never before", async () => {
    await rolledBack(async (client) => {
      await client.query(`insert into public.policy_version (policy_type, version, effective_at, path)
        values ('terms', 'terms-next', '2030-01-01T00:00:00Z', '/policies/terms')`);
      await actAs(client, "souq_web");
      const before = await client.query<{ policy_type: string; version: string }>(
        "select policy_type, version from app.current_policies() order by policy_type",
      );
      expect(before.rows.find((row) => row.policy_type === "terms")?.version).not.toBe(
        "terms-next",
      );
      await setClock(client, new Date("2030-01-02T00:00:00Z"));
      const after = await client.query<{ policy_type: string; version: string }>(
        "select policy_type, version from app.current_policies() order by policy_type",
      );
      expect(after.rows.map((row) => row.policy_type)).toEqual(["terms", "privacy"]);
      expect(after.rows.find((row) => row.policy_type === "terms")?.version).toBe("terms-next");
    });
  });

  it("before any version is in effect there is no row, and the server answers 503", async () => {
    await rolledBack(async (client) => {
      await setClock(client, new Date("2025-06-01T00:00:00Z"));
      await actAs(client, "souq_web");
      const rows = await client.query("select * from app.current_policies()");
      expect(rows.rowCount).toBe(0);
    });
    // The server side of the same case, with the database answering no privacy row.
    const onlyTerms: AppDb = {
      withActor: (_claims, _trace, fn) =>
        fn({
          query: () =>
            Promise.resolve({
              rows: [{ policy_type: "terms", version: "v", effective_at: new Date(), path: "/t" }],
            }),
        } as never),
      query: () => Promise.reject(new Error("unused")),
      end: () => Promise.resolve(),
    };
    await expect(currentPolicies(onlyTerms, "trace")).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      retryAfter: 60,
    });
  });
});

describe("the college pick list", () => {
  it("active colleges only, in display order", async () => {
    const colleges = await activeColleges(db, "trace");
    expect(colleges.length).toBeGreaterThan(0);
    const inactive = await rolledBack(async (client) => {
      const first = colleges[0]?.id;
      await client.query("update public.college set is_active = false where id = $1", [first]);
      await actAs(client, "souq_web");
      const result = await client.query<{ id: string }>("select id from app.active_colleges()");
      return { first, ids: result.rows.map((row) => row.id) };
    });
    expect(inactive.ids).not.toContain(inactive.first);
    expect(inactive.ids).toHaveLength(colleges.length - 1);
  });
});

describe("API119: acknowledging the versions in force (DEC69)", () => {
  it("the current versions: ok, and again with no new row", async () => {
    const versions = await currentPolicyVersions();
    const input = { terms_version: versions.terms, privacy_version: versions.privacy };
    await acknowledgePolicies(db, { ...claimsOf(member) }, "trace", input);
    await acknowledgePolicies(db, { ...claimsOf(member) }, "trace", input);
    const count = await rolledBack((client) =>
      scalar<string>(
        client,
        "select count(*)::text from public.policy_acknowledgment where user_id = $1",
        [member.id],
      ),
    );
    expect(count).toBe("2");
  });

  it("other versions are a 409 STATE_CONFLICT", async () => {
    const versions = await currentPolicyVersions();
    await expect(
      acknowledgePolicies(db, { ...claimsOf(member) }, "trace", {
        terms_version: "old-terms",
        privacy_version: versions.privacy,
      }),
    ).rejects.toSatisfy((error) => error instanceof ApiError && error.code === "STATE_CONFLICT");
  });

  it("a new terms version: TERMS_NOT_ACKNOWLEDGED until acknowledged, then the member writes", async () => {
    await rolledBack(async (client) => {
      await client.query(`insert into public.policy_version (policy_type, version, effective_at, path)
        values ('terms', 'terms-next', '2030-01-01T00:00:00Z', '/policies/terms')`);
      await client.query(`create function app.probe_policy_guard() returns uuid
        language sql security definer set search_path = '' as 'select app.assert_active_member()'`);
      await client.query("grant execute on function app.probe_policy_guard() to souq_web");
      await setClock(client, new Date("2030-01-02T00:00:00Z"));
      const versions = await currentPolicyVersions();
      const claims = claimsOf(member);
      expect(await asWeb(client, claims, "select app.probe_policy_guard()")).toBe(
        "TERMS_NOT_ACKNOWLEDGED",
      );
      expect(
        await asWeb(client, claims, "select app.acknowledge_policies($1, $2)", [
          versions.terms,
          versions.privacy,
        ]),
      ).toBe("STATE_CONFLICT");
      expect(
        await asWeb(client, claims, "select app.acknowledge_policies($1, $2)", [
          "terms-next",
          versions.privacy,
        ]),
      ).toBe("ok");
      expect(await asWeb(client, claims, "select app.probe_policy_guard()")).toBe("ok");
    });
  });

  it("any account state may acknowledge (session level), never a limited or ended session", async () => {
    const versions = await currentPolicyVersions();
    const params = [versions.terms, versions.privacy];
    const sql = "select app.acknowledge_policies($1, $2)";
    await rolledBack(async (client) => {
      await client.query(
        "update public.account_control set status = 'suspended', suspended_until = now() + interval '1 day' where user_id = $1",
        [member.id],
      );
      expect(await asWeb(client, claimsOf(member), sql, params)).toBe("ok");
      // DEC73: a recovery link session.
      const limited = claimsOf(member, {
        amr: [{ method: "otp", timestamp: Math.floor(Date.now() / 1000) }],
      });
      expect(await asWeb(client, limited, sql, params)).toBe("RECOVERY_SESSION_ONLY");
      const ended = claimsOf(member, { session_id: "00000000-0000-4000-8000-000000000000" });
      expect(await asWeb(client, ended, sql, params)).toBe("UNAUTHENTICATED");
      expect(await asWeb(client, null, sql, params)).toBe("UNAUTHENTICATED");
    });
  });
});
