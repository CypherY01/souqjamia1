// Identity tables (task 2.2): FR01, RET06, DEC29, items 1 to 5 of plan/task-2.2.md.
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseDisplayName } from "@souq/domain";
import { closeDb, dbError, dbPool, rolledBack, scalar } from "./_harness/db.ts";
import { actAs, memberClaims } from "./_harness/roles.ts";
import {
  authSignup,
  deleteAuthUser,
  rest,
  restErrorCode,
  signUpMember,
  testEmail,
  type TestMember,
} from "./_harness/users.ts";

afterAll(closeDb);

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);

/** The only columns anon and authenticated may read (item 3). Everything else is private. */
const READABLE: Record<string, { anon: string[]; authenticated: string[] }> = {
  profile: {
    anon: ["display_name", "id", "joined_at", "locale", "version"],
    authenticated: ["display_name", "id", "joined_at", "locale", "version"],
  },
  account_control: {
    anon: [],
    authenticated: ["deletion_requested_at", "status", "suspended_until", "user_id", "version"],
  },
  role_grant: { anon: [], authenticated: ["granted_at", "revoked_at", "role", "user_id"] },
  policy_version: {
    anon: ["effective_at", "path", "policy_type", "version"],
    authenticated: ["effective_at", "path", "policy_type", "version"],
  },
  policy_acknowledgment: {
    anon: [],
    authenticated: ["acknowledged_at", "policy_type", "policy_version", "user_id"],
  },
};

async function columns(table: string): Promise<string[]> {
  return rolledBack(async (client) => {
    const result = await client.query<{ name: string }>(
      `select column_name::text as name from information_schema.columns
        where table_schema = 'public' and table_name = $1 order by 1`,
      [table],
    );
    return result.rows.map((row) => row.name);
  });
}

async function commit(sql: string, params: unknown[] = []): Promise<void> {
  await dbPool().query(sql, params);
}

describe("FR01 and items 4-5: the profile is created with the login identity", () => {
  it("creates one profile and one account_control row with the auth id, name after NFC and trim", async () => {
    const member = await signUpMember(`  ${cp(0x627, 0x653)}دم تجريبي  `);
    const row = await rolledBack(async (client) => {
      const result = await client.query<{
        display_name: string;
        auth_user_id: string;
        status: string;
        hidden: boolean;
        profiles: string;
      }>(
        `select p.display_name, p.auth_user_id, c.status, p.hidden_from_public as hidden,
                (select count(*) from public.profile x where x.id = $1)::text as profiles
           from public.profile p join public.account_control c on c.user_id = p.id
          where p.id = $1`,
        [member.id],
      );
      return result.rows[0];
    });
    expect(row).toEqual({
      display_name: `${cp(0x622)}دم تجريبي`,
      auth_user_id: member.id,
      status: "active",
      hidden: false,
      profiles: "1",
    });
  });

  it.each([
    ["no name", undefined],
    ["one letter", "س"],
    ["51 letters", "ن".repeat(51)],
    ["a bidi override", `اسم${cp(0x202e)}عضو`],
    ["a line break", "اسم\nعضو"],
  ])("refuses a signup with %s and leaves no login identity", async (_name, displayName) => {
    const email = testEmail("bad-name");
    const res = await authSignup(email, displayName);
    expect(res.status).toBe(500);
    // Supabase Auth gets a plain contract error, never the failing row.
    expect(await res.text()).not.toContain("Failing row");
    const users = await rolledBack((client) =>
      scalar<string>(client, "select count(*)::text from auth.users where email = $1", [email]),
    );
    expect(users).toBe("0");
  });

  it("the database CHECK and parseDisplayName in packages/domain agree", async () => {
    const samples = [
      "سارة",
      "  سارة  ",
      "ab",
      "س",
      " س ",
      "ن".repeat(50),
      "ن".repeat(51),
      `${cp(0x627, 0x653)}دم`,
      cp(0x1f600, 0x1f600),
      `اسم${cp(0x200c)}عضو`,
      `اسم${cp(0x200f)}عضو`,
      ...[0x01, 0x0a, 0x1b, 0x7f, 0x85, 0x202a, 0x202e, 0x2066, 0x2069].map(
        (code) => `اسم${cp(code)}عضو`,
      ),
    ];
    await rolledBack(async (client) => {
      for (const input of samples) {
        const domain = parseDisplayName(input);
        await client.query("savepoint name_check");
        let stored: string | undefined;
        try {
          const result = await client.query<{ display_name: string }>(
            `insert into public.profile (id, display_name)
             values (gen_random_uuid(), app.normalize_text($1)) returning display_name`,
            [input],
          );
          stored = result.rows[0]?.display_name;
          await client.query("release savepoint name_check");
        } catch {
          await client.query("rollback to savepoint name_check");
        }
        expect(stored, JSON.stringify(input)).toBe(domain.ok ? domain.value : undefined);
      }
    });
  });

  it("a second profile for the same id is refused", async () => {
    const member = await signUpMember();
    const error = await rolledBack((client) =>
      dbError(client, "insert into public.profile (id, display_name) values ($1, 'اسم آخر')", [
        member.id,
      ]),
    );
    expect(error.code).toBe("23505");
  });
});

describe("item 1 and RET06: deleting the login identity keeps the profile", () => {
  it("no foreign key from our tables to auth.users deletes anything (no CASCADE)", async () => {
    const keys = await rolledBack(async (client) => {
      const result = await client.query<{ name: string; on_delete: string }>(
        `select c.conname::text as name, c.confdeltype::text as on_delete
           from pg_constraint c
          where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
            and c.connamespace in ('public'::regnamespace, 'app'::regnamespace)`,
      );
      return result.rows;
    });
    expect(keys).toEqual([{ name: "profile_auth_user_id_fkey", on_delete: "n" }]);
  });

  it("the profile and its account_control row stay, unlinked", async () => {
    const member = await signUpMember();
    expect((await deleteAuthUser(member.id)).status).toBe(200);
    const row = await rolledBack(async (client) => {
      const result = await client.query<{ auth_user_id: string | null; status: string }>(
        `select p.auth_user_id, c.status from public.profile p
           join public.account_control c on c.user_id = p.id where p.id = $1`,
        [member.id],
      );
      return result.rows;
    });
    expect(row).toEqual([{ auth_user_id: null, status: "active" }]);
  });
});

describe("item 3: only public columns, and only allowed rows", () => {
  let a: TestMember;
  let b: TestMember;

  beforeAll(async () => {
    a = await signUpMember();
    b = await signUpMember();
  });

  it.each(Object.keys(READABLE))(
    "%s: anon and authenticated may read exactly the listed columns",
    async (table) => {
      const all = await columns(table);
      const readable = await rolledBack(async (client) => {
        const result = await client.query<{ role: string; name: string }>(
          `select r.role, c.column_name::text as name
             from information_schema.columns c
            cross join unnest(array['anon', 'authenticated']) as r(role)
            where c.table_schema = 'public' and c.table_name = $1
              and has_column_privilege(r.role, format('public.%I', $1), c.column_name, 'SELECT')
            order by 1, 2`,
          [table],
        );
        return result.rows;
      });
      const expected = READABLE[table];
      expect(readable.filter((r) => r.role === "anon").map((r) => r.name)).toEqual(expected?.anon);
      expect(readable.filter((r) => r.role === "authenticated").map((r) => r.name)).toEqual(
        expected?.authenticated,
      );
      // Sanity: the private part is not empty for tables with private fields.
      expect(all.length).toBeGreaterThanOrEqual(expected?.authenticated.length ?? 0);
    },
  );

  it("owner addition: no private profile column is readable by anon or another member", async () => {
    const privateColumns = (await columns("profile")).filter(
      (name) => !READABLE.profile?.anon.includes(name),
    );
    expect(privateColumns).toEqual([
      "auth_user_id",
      "created_at",
      "deleted_at",
      "hidden_from_public",
      "updated_at",
    ]);
    for (const column of privateColumns) {
      for (const token of [undefined, b.accessToken]) {
        const res = await rest(`/profile?select=${column}&id=eq.${a.id}`, { token });
        expect(
          res.status,
          `${column} as ${token === undefined ? "anon" : "member"}`,
        ).toBeGreaterThanOrEqual(400);
        expect(await restErrorCode(res)).toBe("42501");
      }
    }
  });

  it("anon and another member read the public profile columns", async () => {
    for (const token of [undefined, b.accessToken]) {
      const res = await rest(
        `/profile?select=id,display_name,joined_at,locale,version&id=eq.${a.id}`,
        {
          token,
        },
      );
      expect(res.status).toBe(200);
      expect(((await res.json()) as unknown[]).length).toBe(1);
    }
  });

  it("another member sees none of a member's account state, roles or acknowledgments", async () => {
    for (const [table, key] of [
      ["account_control", "user_id"],
      ["role_grant", "user_id"],
      ["policy_acknowledgment", "user_id"],
    ] as const) {
      const other = await rest(`/${table}?select=${key}&${key}=eq.${a.id}`, {
        token: b.accessToken,
      });
      expect(other.status).toBe(200);
      expect(await other.json()).toEqual([]);
      const anon = await rest(`/${table}?select=${key}`);
      expect(anon.status).toBeGreaterThanOrEqual(400);
      expect(await restErrorCode(anon)).toBe("42501");
    }
    const own = await rest(`/account_control?select=user_id,status&user_id=eq.${a.id}`, {
      token: a.accessToken,
    });
    expect(await own.json()).toEqual([{ user_id: a.id, status: "active" }]);
  });
});

describe("item 2: hidden_from_public always matches account_control", () => {
  it("a restricted member's profile disappears for anon and others, not for its owner", async () => {
    const a = await signUpMember();
    const b = await signUpMember();
    const select = `/profile?select=id&id=eq.${a.id}`;
    await commit(
      "update public.account_control set status = 'suspended', suspended_until = now() + interval '7 days' where user_id = $1",
      [a.id],
    );
    expect(await (await rest(select)).json()).toEqual([]);
    expect(await (await rest(select, { token: b.accessToken })).json()).toEqual([]);
    expect(await (await rest(select, { token: a.accessToken })).json()).toEqual([{ id: a.id }]);
    await commit(
      "update public.account_control set status = 'active', suspended_until = null where user_id = $1",
      [a.id],
    );
    expect(await (await rest(select)).json()).toEqual([{ id: a.id }]);
  });

  it("follows every change in the same transaction", async () => {
    const member = await signUpMember();
    const steps: [string, boolean][] = [
      ["status = 'suspended', suspended_until = now() + interval '7 days'", true],
      ["status = 'active', suspended_until = null", false],
      ["status = 'banned'", true],
      ["status = 'active'", false],
      ["deletion_requested_at = now()", true],
      ["status = 'suspended', suspended_until = now() + interval '30 days'", true],
      ["status = 'active', suspended_until = null", true],
      ["deletion_requested_at = null", false],
    ];
    await rolledBack(async (client) => {
      for (const [change, hidden] of steps) {
        await client.query(`update public.account_control set ${change} where user_id = $1`, [
          member.id,
        ]);
        expect(
          await scalar<boolean>(
            client,
            "select hidden_from_public from public.profile where id = $1",
            [member.id],
          ),
          change,
        ).toBe(hidden);
        // The commit-time check passes after each step.
        await client.query("set constraints all immediate");
        await client.query("set constraints all deferred");
      }
    });
  });

  it("no profile in the database differs from its account_control row", async () => {
    const mismatches = await rolledBack((client) =>
      scalar<string>(
        client,
        `select count(*)::text from public.profile p
           left join public.account_control c on c.user_id = p.id
          where c.user_id is null
             or p.hidden_from_public
                is distinct from (c.status <> 'active' or c.deletion_requested_at is not null)`,
      ),
    );
    expect(mismatches).toBe("0");
  });

  it("refuses at commit a direct change of the column, and a profile without account_control", async () => {
    const member = await signUpMember();
    const direct = await rolledBack(async (client) => {
      await client.query("update public.profile set hidden_from_public = true where id = $1", [
        member.id,
      ]);
      return dbError(client, "set constraints all immediate");
    });
    expect(direct.code).toBe("23514");
    const orphan = await rolledBack(async (client) => {
      await client.query(
        "insert into public.profile (id, display_name) values (gen_random_uuid(), 'بلا حالة')",
      );
      return dbError(client, "set constraints all immediate");
    });
    expect(orphan.code).toBe("23514");
  });
});

describe("TC65 and TC87 basis: a member cannot write identity tables", () => {
  it("is refused through the Data API", async () => {
    const member = await signUpMember();
    const attempts: [string, string, unknown][] = [
      ["POST", "/role_grant", { user_id: member.id, role: "owner", reason: "x" }],
      ["PATCH", `/profile?id=eq.${member.id}`, { display_name: "اسم جديد" }],
      ["PATCH", `/account_control?user_id=eq.${member.id}`, { status: "active" }],
      [
        "POST",
        "/policy_acknowledgment",
        { user_id: member.id, policy_type: "terms", policy_version: "x" },
      ],
      ["DELETE", `/profile?id=eq.${member.id}`, undefined],
    ];
    for (const [method, path, body] of attempts) {
      const res = await rest(path, { method, token: member.accessToken, body });
      expect(res.status, `${method} ${path}`).toBeGreaterThanOrEqual(400);
      expect(await restErrorCode(res)).toBe("42501");
    }
  });

  it("is refused for the authenticated role in SQL too", async () => {
    const member = await signUpMember();
    const error = await rolledBack(async (client) => {
      await actAs(client, "authenticated", memberClaims(member.id));
      return dbError(
        client,
        "insert into public.role_grant (user_id, role, reason) values ($1, 'owner', 'x')",
        [member.id],
      );
    });
    expect(error.code).toBe("42501");
  });
});

describe("DEC29: role grants", () => {
  it("allows one active grant per member and role, and a new one after revocation", async () => {
    const member = await signUpMember();
    await rolledBack(async (client) => {
      const grant =
        "insert into public.role_grant (user_id, role, reason) values ($1, 'moderator', 'test') returning id";
      const first = await scalar<string>(client, grant, [member.id]);
      expect((await dbError(client, grant, [member.id])).code).toBe("23505");
      await client.query(
        "update public.role_grant set revoked_at = now(), revoked_by = user_id where id = $1",
        [first],
      );
      expect(typeof (await scalar<string>(client, grant, [member.id]))).toBe("string");
    });
  });

  it("rls.has_role follows the member's own active grants only", async () => {
    const holder = await signUpMember();
    const other = await signUpMember();
    await rolledBack(async (client) => {
      const id = await scalar<string>(
        client,
        "insert into public.role_grant (user_id, role, reason) values ($1, 'moderator', 'test') returning id",
        [holder.id],
      );
      const check = async (sub: string, role: string): Promise<boolean> => {
        await client.query("savepoint as_member");
        await actAs(client, "authenticated", memberClaims(sub));
        const value = await scalar<boolean>(client, "select rls.has_role($1::public.app_role)", [
          role,
        ]);
        await client.query("rollback to savepoint as_member");
        return value;
      };
      expect(await check(holder.id, "moderator")).toBe(true);
      expect(await check(holder.id, "owner")).toBe(false);
      expect(await check(other.id, "moderator")).toBe(false);
      await client.query(
        "update public.role_grant set revoked_at = now(), revoked_by = user_id where id = $1",
        [id],
      );
      expect(await check(holder.id, "moderator")).toBe(false);

      await client.query("savepoint as_anon");
      await actAs(client, "anon");
      expect((await dbError(client, "select rls.has_role('owner')")).code).toBe("42501");
      await client.query("rollback to savepoint as_anon");
    });
  });
});
