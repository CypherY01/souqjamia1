// FR04, BR01, DEC36, item 6 of task 2.2: app.assert_active_member() through an entry point.
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setClock } from "./_harness/clock.ts";
import { closeDb, dbError, rolledBack, scalar } from "./_harness/db.ts";
import { withTwoConnections } from "./_harness/parallel.ts";
import { actAs, passwordAmr, type Claims } from "./_harness/roles.ts";
import { signUpMember, type TestMember } from "./_harness/users.ts";

afterAll(closeDb);

let member: TestMember;

beforeAll(async () => {
  member = await signUpMember();
});

function claimsOf(m: TestMember, sessionId = m.sessionId): Claims {
  return {
    sub: m.id,
    role: "authenticated",
    session_id: sessionId,
    aal: "aal1",
    amr: passwordAmr(),
  };
}

/**
 * In the current transaction: published versions terms-1 and privacy-1 (effective 1 January
 * 2026), the member's acknowledgment of both, and an entry point that runs the guard.
 */
async function prepare(client: pg.ClientBase, acknowledge = true): Promise<void> {
  await client.query(`insert into public.policy_version (policy_type, version, effective_at, path)
    values ('terms', 'terms-1', '2026-01-01T00:00:00Z', '/policies/terms'),
           ('privacy', 'privacy-1', '2026-01-01T00:00:00Z', '/policies/privacy')`);
  if (acknowledge) {
    await client.query(
      `insert into public.policy_acknowledgment (user_id, policy_type, policy_version)
       values ($1, 'terms', 'terms-1'), ($1, 'privacy', 'privacy-1')`,
      [member.id],
    );
  }
  await client.query(`create function app.probe_guard() returns uuid
    language sql security definer set search_path = ''
    as 'select app.assert_active_member()'`);
  await client.query("grant execute on function app.probe_guard() to souq_web");
}

/** Runs the entry point as the server would, then returns to postgres. */
async function guard(client: pg.ClientBase, claims?: Claims | string): Promise<string> {
  await client.query("savepoint as_server");
  try {
    await actAs(client, "souq_web", claims);
    try {
      return await scalar<string>(client, "select app.probe_guard()");
    } catch (error) {
      if (!(error instanceof pg.DatabaseError)) throw error;
      return error.code === "SJ001" ? error.message : `${error.code ?? "?"}: ${error.message}`;
    }
  } finally {
    await client.query("rollback to savepoint as_server");
  }
}

async function change(client: pg.ClientBase, sql: string): Promise<void> {
  await client.query(sql, [member.id]);
}

describe("FR04 and BR01: app.assert_active_member()", () => {
  it("returns the member id when every check passes", async () => {
    await rolledBack(async (client) => {
      await prepare(client);
      expect(await guard(client, claimsOf(member))).toBe(member.id);
    });
  });

  it("UNAUTHENTICATED without claims, with an unknown, missing or ended session, or an unlinked profile", async () => {
    await rolledBack(async (client) => {
      await prepare(client);
      expect(await guard(client)).toBe("UNAUTHENTICATED");
      expect(await guard(client, claimsOf(member, randomUUID()))).toBe("UNAUTHENTICATED");
      const withoutSession = JSON.stringify({ sub: member.id, role: "authenticated", aal: "aal1" });
      expect(await guard(client, withoutSession)).toBe("UNAUTHENTICATED");

      await client.query("savepoint ended");
      await client.query(
        "update auth.sessions set not_after = now() - interval '1 hour' where id = $1",
        [member.sessionId],
      );
      expect(await guard(client, claimsOf(member))).toBe("UNAUTHENTICATED");
      await client.query("rollback to savepoint ended");

      await client.query("savepoint signed_out");
      await client.query("delete from auth.sessions where id = $1", [member.sessionId]);
      expect(await guard(client, claimsOf(member))).toBe("UNAUTHENTICATED");
      await client.query("rollback to savepoint signed_out");

      await client.query("savepoint unlinked");
      await change(client, "update public.profile set auth_user_id = null where id = $1");
      expect(await guard(client, claimsOf(member))).toBe("UNAUTHENTICATED");
      await client.query("rollback to savepoint unlinked");
    });
  });

  it("DEC73 (task 3.1, item 7): RECOVERY_SESSION_ONLY without the password method in amr, before deletion and restriction", async () => {
    await rolledBack(async (client) => {
      await prepare(client);
      const now = Math.floor(Date.now() / 1000);
      // A recovery link signs in with amr = otp only (checked on local Supabase, task 3.1).
      const recovery = { ...claimsOf(member), amr: [{ method: "otp", timestamp: now }] };
      expect(await guard(client, recovery)).toBe("RECOVERY_SESSION_ONLY");
      expect(await guard(client, { ...claimsOf(member), amr: [] })).toBe("RECOVERY_SESSION_ONLY");
      const withoutAmr = JSON.stringify({ ...claimsOf(member), amr: undefined });
      expect(await guard(client, withoutAmr)).toBe("RECOVERY_SESSION_ONLY");
      const notAList = JSON.stringify({ ...claimsOf(member), amr: "password" });
      expect(await guard(client, notAList)).toBe("RECOVERY_SESSION_ONLY");

      await change(
        client,
        "update public.account_control set deletion_requested_at = now(), status = 'banned' where user_id = $1",
      );
      expect(await guard(client, recovery)).toBe("RECOVERY_SESSION_ONLY");
      // An MFA session keeps password next to totp, so it is an ordinary session.
      const mfa = {
        ...claimsOf(member),
        aal: "aal2" as const,
        amr: [
          { method: "totp", timestamp: now },
          { method: "password", timestamp: now - 60 },
        ],
      };
      expect(await guard(client, mfa)).toBe("DELETION_PENDING");
    });
  });

  it("DELETION_PENDING comes before a restriction (item 6)", async () => {
    await rolledBack(async (client) => {
      await prepare(client);
      await change(
        client,
        "update public.account_control set deletion_requested_at = now(), status = 'banned' where user_id = $1",
      );
      expect(await guard(client, claimsOf(member))).toBe("DELETION_PENDING");
    });
  });

  it("ACCOUNT_RESTRICTED while banned or suspended, and passes once a suspension has ended", async () => {
    await rolledBack(async (client) => {
      await prepare(client);
      await change(
        client,
        "update public.account_control set status = 'banned' where user_id = $1",
      );
      expect(await guard(client, claimsOf(member))).toBe("ACCOUNT_RESTRICTED");

      await change(
        client,
        "update public.account_control set status = 'suspended', suspended_until = '2026-12-08T00:00:00Z' where user_id = $1",
      );
      await setClock(client, new Date("2026-12-07T23:59:00Z"));
      expect(await guard(client, claimsOf(member))).toBe("ACCOUNT_RESTRICTED");
      await setClock(client, new Date("2026-12-08T00:00:00Z"));
      expect(await guard(client, claimsOf(member))).toBe(member.id);
    });
  });

  it("EMAIL_NOT_CONFIRMED without email_confirmed_at (DEC63 sets it at signup while off)", async () => {
    await rolledBack(async (client) => {
      await prepare(client);
      expect(
        await scalar<boolean>(
          client,
          "select email_confirmed_at is not null from auth.users where id = $1",
          [member.id],
        ),
      ).toBe(true);
      await change(client, "update auth.users set email_confirmed_at = null where id = $1");
      expect(await guard(client, claimsOf(member))).toBe("EMAIL_NOT_CONFIRMED");
    });
  });

  it("DEC36: TERMS_NOT_ACKNOWLEDGED unless both current versions are acknowledged", async () => {
    await rolledBack(async (client) => {
      await prepare(client, false);
      expect(await guard(client, claimsOf(member))).toBe("TERMS_NOT_ACKNOWLEDGED");
      await client.query(
        "insert into public.policy_acknowledgment (user_id, policy_type, policy_version) values ($1, 'terms', 'terms-1')",
        [member.id],
      );
      expect(await guard(client, claimsOf(member))).toBe("TERMS_NOT_ACKNOWLEDGED");
      await client.query(
        "insert into public.policy_acknowledgment (user_id, policy_type, policy_version) values ($1, 'privacy', 'privacy-1')",
        [member.id],
      );
      expect(await guard(client, claimsOf(member))).toBe(member.id);

      // A newer terms version in force needs a new acknowledgment (DEC69: API119).
      await client.query(`insert into public.policy_version (policy_type, version, effective_at, path)
        values ('terms', 'terms-2', '2026-06-01T00:00:00Z', '/policies/terms')`);
      expect(await guard(client, claimsOf(member))).toBe("TERMS_NOT_ACKNOWLEDGED");
      // ... but not before it takes effect.
      await setClock(client, new Date("2026-05-31T00:00:00Z"));
      expect(await guard(client, claimsOf(member))).toBe(member.id);
    });
  });

  it("TERMS_NOT_ACKNOWLEDGED while no policy version is published at all", async () => {
    await rolledBack(async (client) => {
      await client.query("delete from public.policy_acknowledgment");
      await client.query("delete from public.policy_version");
      await client.query(`create function app.probe_guard() returns uuid
        language sql security definer set search_path = ''
        as 'select app.assert_active_member()'`);
      await client.query("grant execute on function app.probe_guard() to souq_web");
      expect(await guard(client, claimsOf(member))).toBe("TERMS_NOT_ACKNOWLEDGED");
    });
  });

  it("chapter 07 lock order: a suspension waits for a write that passed the guard", async () => {
    await withTwoConnections(async (writer, moderator) => {
      await writer.query("begin");
      await prepare(writer);
      await actAs(writer, "souq_web", claimsOf(member));
      expect(await scalar<string>(writer, "select app.probe_guard()")).toBe(member.id);

      await moderator.query("begin");
      await moderator.query("set local lock_timeout = '300ms'");
      const blocked = await dbError(
        moderator,
        "update public.account_control set status = 'banned' where user_id = $1",
        [member.id],
      );
      expect(blocked.code).toBe("55P03");
      await moderator.query("rollback");

      await writer.query("rollback");
      await moderator.query("begin");
      await moderator.query("set local lock_timeout = '300ms'");
      const updated = await moderator.query(
        "update public.account_control set status = 'banned' where user_id = $1",
        [member.id],
      );
      expect(updated.rowCount).toBe(1);
      await moderator.query("rollback");
    });
  });
});
