// SEC02, DEC36: the security baseline holds on the live database (task 2.1).
// Needs `pnpm db:start` and applied migrations; run with `pnpm test:integration`.
import { afterAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { closeDb, rolledBack } from "./_harness/db.ts";
import { securityViolations, type Rule, type Violation } from "./_harness/security.ts";

afterAll(closeDb);

function rulesOf(violations: Violation[]): Set<Rule> {
  return new Set(violations.map((v) => v.rule));
}

function has(violations: Violation[], rule: Rule, object: string, detail?: string): boolean {
  return violations.some(
    (v) =>
      v.rule === rule && v.object.includes(object) && (detail === undefined || v.detail === detail),
  );
}

describe("SEC02 and DEC36: comprehensive security check", () => {
  it("finds no violation in the migrated database", async () => {
    const violations = await rolledBack((client) => securityViolations(client));
    expect(violations).toEqual([]);
  });

  it("finds every planted violation (the check really detects)", async () => {
    const violations = await rolledBack(async (client) => {
      const plant = async (sql: string) => {
        await client.query(sql);
      };
      // Relations
      await plant("create table public.planted_no_rls (id int)");
      await plant("create table public.planted_grants (id int)");
      await plant("alter table public.planted_grants enable row level security");
      await plant("grant insert on public.planted_grants to anon");
      await plant("grant truncate on public.planted_grants to authenticated");
      await plant("grant update (id) on public.planted_grants to authenticated");
      await plant("grant select on public.planted_grants to souq_web");
      await plant("create view public.planted_view as select 1 as x");
      await plant("create materialized view public.planted_matview as select 1 as x");
      await plant("create sequence public.planted_seq");
      await plant("grant usage on sequence public.planted_seq to anon");
      // Functions
      await plant(
        "create function app.planted_open() returns int language sql set search_path = '' as 'select 1'",
      );
      await plant("grant execute on function app.planted_open() to authenticated");
      await plant(
        "create function app.planted_definer() returns int language sql security definer as 'select 1'",
      );
      await plant("grant execute on function app.planted_definer() to public");
      await plant(
        "create function app.planted_invoker() returns int language sql set search_path = '' as 'select 1'",
      );
      await plant("grant execute on function app.planted_invoker() to souq_web");
      await plant(
        "create function app.planted_both() returns int language sql security definer set search_path = '' as 'select 1'",
      );
      await plant("grant execute on function app.planted_both() to souq_web, souq_worker");
      await plant(
        "create function public.planted_rpc() returns int language sql set search_path = '' as 'select 1'",
      );
      await plant(
        "create function public.planted_server() returns int language sql security definer set search_path = '' as 'select 1'",
      );
      await plant("grant execute on function public.planted_server() to souq_worker");
      // RLS helpers (task 2.2): invoker and read only
      await plant(
        "create function rls.planted_definer() returns boolean language sql stable security definer set search_path = '' as 'select true'",
      );
      await plant(
        "create function rls.planted_volatile() returns boolean language sql volatile set search_path = '' as 'select true'",
      );
      await plant("grant usage on schema rls to souq_web");
      // Time: built-in clock in a body and in a column default
      await plant(
        "create function app.planted_clock() returns timestamptz language sql set search_path = '' as 'select pg_catalog.now()'",
      );
      await plant("create table app.planted_default (at timestamptz default current_timestamp)");
      await plant("alter table app.planted_default enable row level security");
      // Schemas and roles
      await plant("grant usage on schema app to authenticated");
      await plant("grant create on schema public to souq_web");
      await plant("alter role souq_web bypassrls");
      await plant("grant authenticated to souq_worker");
      await plant("create table public.planted_owner (id int)");
      await plant("alter table public.planted_owner enable row level security");
      // ALTER OWNER needs CREATE on the schema for the new owner, granted to souq_web above.
      await plant("alter table public.planted_owner owner to souq_web");
      // Default privileges for future objects
      await plant(
        "alter default privileges for role postgres in schema public grant insert on tables to anon",
      );
      await plant(
        "alter default privileges for role postgres grant execute on functions to public",
      );
      return securityViolations(client);
    });

    expect(has(violations, "rls_disabled", "public.planted_no_rls")).toBe(true);
    expect(has(violations, "table_privilege", "public.planted_grants", "anon INSERT")).toBe(true);
    expect(
      has(violations, "table_privilege", "public.planted_grants", "authenticated TRUNCATE"),
    ).toBe(true);
    expect(
      has(violations, "table_privilege", "public.planted_grants", "authenticated UPDATE"),
    ).toBe(true);
    expect(has(violations, "table_privilege", "public.planted_grants", "souq_web SELECT")).toBe(
      true,
    );
    expect(has(violations, "view_without_security_invoker", "public.planted_view")).toBe(true);
    expect(has(violations, "relation_without_rls", "public.planted_matview")).toBe(true);
    expect(has(violations, "sequence_privilege", "public.planted_seq", "anon USAGE")).toBe(true);
    expect(has(violations, "app_function_executable_by_public_roles", "app.planted_open()")).toBe(
      true,
    );
    expect(has(violations, "function_search_path", "app.planted_definer()")).toBe(true);
    expect(has(violations, "definer_executable_by_public_roles", "app.planted_definer()")).toBe(
      true,
    );
    expect(has(violations, "server_function_not_definer", "app.planted_invoker()")).toBe(true);
    expect(has(violations, "function_for_web_and_worker", "app.planted_both()")).toBe(true);
    expect(has(violations, "function_in_public", "public.planted_rpc()")).toBe(true);
    expect(has(violations, "server_function_outside_app", "public.planted_server()")).toBe(true);
    expect(has(violations, "rls_function_definer", "rls.planted_definer()")).toBe(true);
    expect(has(violations, "rls_function_volatile", "rls.planted_volatile()")).toBe(true);
    expect(has(violations, "schema_privilege", "rls", "souq_web USAGE")).toBe(true);
    expect(has(violations, "time_source", "app.planted_clock()")).toBe(true);
    expect(has(violations, "time_source", "app.planted_default.at")).toBe(true);
    expect(has(violations, "schema_privilege", "app", "authenticated USAGE")).toBe(true);
    expect(has(violations, "schema_privilege", "public", "souq_web CREATE")).toBe(true);
    expect(has(violations, "server_role_create", "souq_web", "CREATE on public")).toBe(true);
    expect(has(violations, "server_role_attribute", "souq_web", "BYPASSRLS")).toBe(true);
    expect(has(violations, "server_role_member", "souq_worker", "member of authenticated")).toBe(
      true,
    );
    expect(has(violations, "server_role_owns", "souq_web", "relation public.planted_owner")).toBe(
      true,
    );
    expect(has(violations, "owner_not_postgres", "public.planted_owner")).toBe(true);
    expect(
      has(violations, "default_privileges", "security_probe_t", "anon INSERT by default"),
    ).toBe(true);
    expect(
      has(violations, "default_privileges", "security_probe_f", "anon EXECUTE by default"),
    ).toBe(true);

    // Every rule fired at least once, except "server_role_missing" (the roles exist).
    const fired = rulesOf(violations);
    const expected: Rule[] = [
      "rls_disabled",
      "view_without_security_invoker",
      "relation_without_rls",
      "table_privilege",
      "sequence_privilege",
      "function_search_path",
      "definer_executable_by_public_roles",
      "app_function_executable_by_public_roles",
      "server_function_not_definer",
      "server_function_outside_app",
      "function_for_web_and_worker",
      "function_in_public",
      "schema_privilege",
      "server_role_attribute",
      "server_role_owns",
      "server_role_member",
      "server_role_create",
      "owner_not_postgres",
      "time_source",
      "default_privileges",
      "rls_function_definer",
      "rls_function_volatile",
    ];
    expect([...fired].sort()).toEqual([...expected].sort());
  });

  it("reports a missing server role", async () => {
    const violations = await rolledBack(async (client) => {
      // Every grant to the role first (task 2.4 gives it the audit cleanup function).
      await client.query("revoke execute on all functions in schema app from souq_worker");
      await client.query("revoke usage on schema app from souq_worker");
      await client.query("revoke souq_worker from postgres");
      await client.query("drop role souq_worker");
      return securityViolations(client);
    });
    expect(has(violations, "server_role_missing", "souq_worker")).toBe(true);
  });
});

describe("DEC36: PostgREST does not expose the app schema", () => {
  const rest = (
    path: string,
    init: { method?: string; headers: Record<string, string>; body?: string },
  ) => {
    const stack = inject("stack");
    return fetch(`${stack.apiUrl}/rest/v1${path}`, {
      ...init,
      headers: { apikey: stack.publishableKey, ...init.headers },
    });
  };

  it("rejects reads with Accept-Profile: app (PGRST106)", async () => {
    const res = await rest("/", { headers: { "Accept-Profile": "app" } });
    expect(res.status).toBe(406);
    expect(((await res.json()) as { code?: string }).code).toBe("PGRST106");
  });

  it("rejects calls to app functions with Content-Profile: app (PGRST106)", async () => {
    const res = await rest("/rpc/app_now", {
      method: "POST",
      headers: { "Content-Profile": "app", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(406);
    expect(((await res.json()) as { code?: string }).code).toBe("PGRST106");
  });

  it("finds no app function through the public schema either", async () => {
    const res = await rest("/rpc/actor_id", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(404);
  });
});
