// The comprehensive SEC02 / DEC36 check (task 2.1). Reads the live catalog and returns every
// violation. sec02-baseline.test.ts expects none, and plants one of each to prove each rule
// fires. Run it as postgres inside a transaction: the default-privileges probe creates objects
// in a savepoint and rolls them back.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { READ_MATRIX, type ReadFunctionTests } from "./read-matrix.ts";
import { CALLER_ROLES, SERVER_ROLES } from "./roles.ts";

/**
 * Schemas our migrations own. Supabase's own schemas (auth, storage, realtime...) are not ours.
 * rls (task 2.2): SECURITY INVOKER, read-only helpers that RLS policies call.
 */
export const OUR_SCHEMAS = ["public", "app", "rls"] as const;

/**
 * Functions allowed in `public`. Every function there is a Data API (RPC) endpoint, so each
 * entry needs an explicit decision. Empty in task 2.1.
 */
export const PUBLIC_FUNCTION_ALLOWLIST: readonly string[] = [];

/** The only owner of objects in our schemas (question 30, plan/phase-1.md). */
const OWNER = "postgres";

export type Rule =
  | "rls_disabled"
  | "view_without_security_invoker"
  | "relation_without_rls"
  | "table_privilege"
  | "sequence_privilege"
  | "function_search_path"
  | "definer_executable_by_public_roles"
  | "app_function_executable_by_public_roles"
  | "server_function_not_definer"
  | "server_function_outside_app"
  | "function_for_web_and_worker"
  | "function_in_public"
  | "schema_privilege"
  | "server_role_missing"
  | "server_role_attribute"
  | "server_role_owns"
  | "server_role_member"
  | "server_role_create"
  | "owner_not_postgres"
  | "time_source"
  | "default_privileges"
  | "rls_function_definer"
  | "rls_function_volatile"
  | "read_function_whole_row"
  | "read_function_unregistered"
  | "read_function_untested"
  | "read_matrix_stale";

export interface Violation {
  rule: Rule;
  object: string;
  detail: string;
}

const TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "MAINTAIN",
] as const;

/** anon and authenticated may read through RLS once a slice grants SELECT. Nobody else may. */
const RLS_READERS: readonly string[] = ["anon", "authenticated"];
/** Roles that must never run app functions or any SECURITY DEFINER function. */
const BROWSER_ROLES: readonly string[] = ["anon", "authenticated"];
const NOT_SERVER_ROLES: readonly string[] = ["anon", "authenticated", "service_role"];

/** The built-in clock. Only app.app_now() may use it (item 5). */
const BUILT_IN_CLOCK =
  /\b(now|clock_timestamp|statement_timestamp|transaction_timestamp|timeofday)\s*\(|\b(current_timestamp|current_date|current_time|localtimestamp|localtime)\b/i;

const schemas = [...OUR_SCHEMAS];

async function rows<T extends object>(
  client: pg.ClientBase,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await client.query<T>(sql, params)).rows;
}

async function relationRules(
  client: pg.ClientBase,
  callers: string[],
  out: Violation[],
): Promise<void> {
  const relations = await rows<{ object: string; kind: string; rls: boolean; invoker: boolean }>(
    client,
    `select (n.nspname || '.' || c.relname) as object, c.relkind::text as kind, c.relrowsecurity as rls,
            coalesce((select o.option_value::boolean
                        from pg_catalog.pg_options_to_table(c.reloptions) o
                       where o.option_name = 'security_invoker'), false) as invoker
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1) and c.relkind in ('r', 'p', 'v', 'm', 'f')`,
    [schemas],
  );
  for (const r of relations) {
    if ((r.kind === "r" || r.kind === "p") && !r.rls) {
      out.push({ rule: "rls_disabled", object: r.object, detail: "row level security is off" });
    }
    if (r.kind === "v" && !r.invoker) {
      out.push({
        rule: "view_without_security_invoker",
        object: r.object,
        detail: "a view without security_invoker runs as its owner and bypasses RLS",
      });
    }
    if (r.kind === "m" || r.kind === "f") {
      out.push({
        rule: "relation_without_rls",
        object: r.object,
        detail: "materialized views and foreign tables cannot have RLS",
      });
    }
  }

  // Table and column privileges (has_any_column_privilege also sees column-level grants).
  const grants = await rows<{ object: string; role: string; privilege: string }>(
    client,
    `select (n.nspname || '.' || c.relname) as object, r.role, p.privilege
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      cross join unnest($2::text[]) as r(role)
      cross join unnest($3::text[]) as p(privilege)
      where n.nspname = any($1) and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and case when p.privilege in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                 then pg_catalog.has_any_column_privilege(r.role, c.oid, p.privilege)
                 else pg_catalog.has_table_privilege(r.role, c.oid, p.privilege) end
      order by 1, 2, 3`,
    [schemas, callers, [...TABLE_PRIVILEGES]],
  );
  for (const g of grants) {
    if (g.privilege === "SELECT" && RLS_READERS.includes(g.role)) continue;
    out.push({ rule: "table_privilege", object: g.object, detail: `${g.role} ${g.privilege}` });
  }

  const sequences = await rows<{ object: string; role: string; privilege: string }>(
    client,
    `select (n.nspname || '.' || c.relname) as object, r.role, p.privilege
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      cross join unnest($2::text[]) as r(role)
      cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) as p(privilege)
      where n.nspname = any($1) and c.relkind = 'S'
        and pg_catalog.has_sequence_privilege(r.role, c.oid, p.privilege)
      order by 1, 2, 3`,
    [schemas, callers],
  );
  for (const s of sequences) {
    out.push({ rule: "sequence_privilege", object: s.object, detail: `${s.role} ${s.privilege}` });
  }
}

interface FunctionRow {
  fn: string;
  schema: string;
  definer: boolean;
  config: string[] | null;
  source: string;
  language: string;
  public_execute: boolean;
  executors: string[];
  grantees: string[];
  volatility: string;
}

async function functionRules(
  client: pg.ClientBase,
  callers: string[],
  out: Violation[],
): Promise<void> {
  const functions = await rows<FunctionRow>(
    client,
    `select (n.nspname || '.' || p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')') as fn, n.nspname as schema, p.prosecdef as definer,
            p.proconfig as config, p.prosrc as source, l.lanname as language,
            p.provolatile::text as volatility,
            exists (select 1 from pg_catalog.aclexplode(
                      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
                     where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_execute,
            array(select r from unnest($2::text[]) r
                   where pg_catalog.has_function_privilege(r, p.oid, 'EXECUTE')) as executors,
            array(select pg_catalog.pg_get_userbyid(a.grantee)::text
                    from pg_catalog.aclexplode(
                           coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
                   where a.privilege_type = 'EXECUTE' and a.grantee <> 0
                     and a.grantee <> p.proowner) as grantees
       from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       join pg_catalog.pg_language l on l.oid = p.prolang
      where n.nspname = any($1)
        and not exists (select 1 from pg_catalog.pg_depend d
                         where d.classid = 'pg_catalog.pg_proc'::regclass
                           and d.objid = p.oid and d.deptype = 'e')
      order by 1`,
    [schemas, callers],
  );

  for (const f of functions) {
    const kind = f.definer ? "SECURITY DEFINER" : "SECURITY INVOKER";
    // Owner condition 3: search_path = '' on every function (stored as search_path="").
    if (!(f.config ?? []).includes('search_path=""')) {
      out.push({
        rule: "function_search_path",
        object: f.fn,
        detail: `${kind} function without SET search_path = ''`,
      });
    }
    const browserOrPublic = [
      ...(f.public_execute ? ["PUBLIC"] : []),
      ...f.executors.filter((r) => BROWSER_ROLES.includes(r)),
    ];
    if (f.definer && browserOrPublic.length > 0) {
      out.push({
        rule: "definer_executable_by_public_roles",
        object: f.fn,
        detail: `SECURITY DEFINER executable by ${browserOrPublic.join(", ")}`,
      });
    }
    if (f.schema === "app") {
      const open = [
        ...(f.public_execute ? ["PUBLIC"] : []),
        ...f.executors.filter((r) => NOT_SERVER_ROLES.includes(r)),
      ];
      if (open.length > 0) {
        out.push({
          rule: "app_function_executable_by_public_roles",
          object: f.fn,
          detail: `executable by ${open.join(", ")}`,
        });
      }
    }
    const servers = f.grantees.filter((r) => (SERVER_ROLES as readonly string[]).includes(r));
    if (servers.length > 0 && !f.definer) {
      out.push({
        rule: "server_function_not_definer",
        object: f.fn,
        detail: `granted to ${servers.join(", ")} but SECURITY INVOKER`,
      });
    }
    if (servers.length > 0 && f.schema !== "app") {
      out.push({
        rule: "server_function_outside_app",
        object: f.fn,
        detail: `granted to ${servers.join(", ")} outside the app schema`,
      });
    }
    if (servers.length === SERVER_ROLES.length) {
      out.push({
        rule: "function_for_web_and_worker",
        object: f.fn,
        detail: "granted to both souq_web and souq_worker (owner condition 4)",
      });
    }
    // Owner condition 3 on task 2.1 for the RLS helpers of task 2.2: invoker, read only.
    if (f.schema === "rls" && f.definer) {
      out.push({
        rule: "rls_function_definer",
        object: f.fn,
        detail: "RLS helpers must be SECURITY INVOKER",
      });
    }
    if (f.schema === "rls" && f.volatility === "v") {
      out.push({
        rule: "rls_function_volatile",
        object: f.fn,
        detail: "RLS helpers must be STABLE or IMMUTABLE (read only)",
      });
    }
    if (f.schema === "public" && !PUBLIC_FUNCTION_ALLOWLIST.includes(f.fn)) {
      out.push({
        rule: "function_in_public",
        object: f.fn,
        detail: "every function in public is a Data API endpoint; none is allowed yet",
      });
    }
    if (
      f.fn !== "app.app_now()" &&
      (f.language === "sql" || f.language === "plpgsql") &&
      BUILT_IN_CLOCK.test(f.source)
    ) {
      out.push({
        rule: "time_source",
        object: f.fn,
        detail: "uses the built-in clock; use app.app_now()",
      });
    }
  }

  const defaults = await rows<{ object: string; expression: string }>(
    client,
    `select n.nspname || '.' || c.relname || '.' || a.attname as object,
            pg_catalog.pg_get_expr(d.adbin, d.adrelid) as expression
       from pg_catalog.pg_attrdef d
       join pg_catalog.pg_class c on c.oid = d.adrelid
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
      where n.nspname = any($1)`,
    [schemas],
  );
  for (const d of defaults) {
    if (BUILT_IN_CLOCK.test(d.expression)) {
      out.push({
        rule: "time_source",
        object: d.object,
        detail: `column default ${d.expression}; use app.app_now()`,
      });
    }
  }
}

async function schemaRules(
  client: pg.ClientBase,
  callers: string[],
  out: Violation[],
): Promise<void> {
  const privileges = await rows<{ schema: string; role: string; privilege: string }>(
    client,
    `select n.nspname as schema, r.role, p.privilege
       from pg_catalog.pg_namespace n
      cross join unnest($2::text[]) as r(role)
      cross join unnest(array['USAGE', 'CREATE']) as p(privilege)
      where n.nspname = any($1) and pg_catalog.has_schema_privilege(r.role, n.oid, p.privilege)
     union all
     select n.nspname, 'PUBLIC', a.privilege_type
       from pg_catalog.pg_namespace n,
            pg_catalog.aclexplode(coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) a
      where n.nspname in ('app', 'rls') and a.grantee = 0
      order by 1, 2, 3`,
    [schemas, callers],
  );
  for (const p of privileges) {
    const allowed =
      p.privilege === "USAGE" &&
      (p.schema === "public" ||
        (p.schema === "app" && (SERVER_ROLES as readonly string[]).includes(p.role)) ||
        (p.schema === "rls" && RLS_READERS.includes(p.role)));
    if (!allowed) {
      out.push({ rule: "schema_privilege", object: p.schema, detail: `${p.role} ${p.privilege}` });
    }
  }
}

async function serverRoleRules(client: pg.ClientBase, out: Violation[]): Promise<void> {
  const server: string[] = [...SERVER_ROLES];
  const roles = await rows<{
    name: string;
    super: boolean;
    bypassrls: boolean;
    createrole: boolean;
    createdb: boolean;
    replication: boolean;
  }>(
    client,
    `select rolname as name, rolsuper as super, rolbypassrls as bypassrls,
            rolcreaterole as createrole, rolcreatedb as createdb, rolreplication as replication
       from pg_catalog.pg_roles where rolname = any($1)`,
    [server],
  );
  for (const name of server) {
    const role = roles.find((r) => r.name === name);
    if (role === undefined) {
      out.push({ rule: "server_role_missing", object: name, detail: "role does not exist" });
      continue;
    }
    const attributes = [
      role.super && "SUPERUSER",
      role.bypassrls && "BYPASSRLS",
      role.createrole && "CREATEROLE",
      role.createdb && "CREATEDB",
      role.replication && "REPLICATION",
    ].filter((a): a is string => typeof a === "string");
    for (const attribute of attributes) {
      out.push({ rule: "server_role_attribute", object: name, detail: attribute });
    }
  }

  const owned = await rows<{ role: string; object: string }>(
    client,
    `select pg_catalog.pg_get_userbyid(c.relowner) as role, 'relation ' || c.relnamespace::regnamespace::text || '.' || c.relname as object
       from pg_catalog.pg_class c where pg_catalog.pg_get_userbyid(c.relowner) = any($1)
     union all
     select pg_catalog.pg_get_userbyid(p.proowner), 'function ' || p.pronamespace::regnamespace::text || '.' || p.proname
              || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')'
       from pg_catalog.pg_proc p where pg_catalog.pg_get_userbyid(p.proowner) = any($1)
     union all
     select pg_catalog.pg_get_userbyid(n.nspowner), 'schema ' || n.nspname
       from pg_catalog.pg_namespace n where pg_catalog.pg_get_userbyid(n.nspowner) = any($1)
     union all
     select pg_catalog.pg_get_userbyid(t.typowner), 'type ' || t.typnamespace::regnamespace::text || '.' || t.typname
       from pg_catalog.pg_type t where pg_catalog.pg_get_userbyid(t.typowner) = any($1)`,
    [server],
  );
  for (const o of owned) {
    out.push({ rule: "server_role_owns", object: o.role, detail: o.object });
  }

  const memberships = await rows<{ member: string; role: string }>(
    client,
    `select m.rolname as member, r.rolname as role
       from pg_catalog.pg_auth_members am
       join pg_catalog.pg_roles r on r.oid = am.roleid
       join pg_catalog.pg_roles m on m.oid = am.member
      where m.rolname = any($1)`,
    [server],
  );
  for (const m of memberships) {
    out.push({ rule: "server_role_member", object: m.member, detail: `member of ${m.role}` });
  }

  const creates = await rows<{ role: string; schema: string }>(
    client,
    `select r.role, n.nspname as schema
       from pg_catalog.pg_namespace n
      cross join unnest($1::text[]) as r(role)
      where pg_catalog.has_schema_privilege(r.role, n.oid, 'CREATE')`,
    [server.filter((name) => roles.some((r) => r.name === name))],
  );
  for (const c of creates) {
    out.push({ rule: "server_role_create", object: c.role, detail: `CREATE on ${c.schema}` });
  }
}

async function ownerRules(client: pg.ClientBase, out: Violation[]): Promise<void> {
  const foreign = await rows<{ object: string; owner: string }>(
    client,
    `select 'relation ' || (n.nspname || '.' || c.relname) as object, pg_catalog.pg_get_userbyid(c.relowner) as owner
       from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1) and c.relowner <> $2::regrole
     union all
     select 'function ' || (n.nspname || '.' || p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')'), pg_catalog.pg_get_userbyid(p.proowner)
       from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = any($1) and p.proowner <> $2::regrole
     union all
     select 'type ' || n.nspname || '.' || t.typname, pg_catalog.pg_get_userbyid(t.typowner)
       from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid = t.typnamespace
      where n.nspname = any($1) and t.typowner <> $2::regrole and t.typcategory <> 'A'
     union all
     select 'schema ' || n.nspname, pg_catalog.pg_get_userbyid(n.nspowner)
       from pg_catalog.pg_namespace n
      where n.nspname in ('app', 'rls') and n.nspowner <> $2::regrole`,
    [schemas, OWNER],
  );
  for (const f of foreign) {
    out.push({ rule: "owner_not_postgres", object: f.object, detail: `owned by ${f.owner}` });
  }
}

/**
 * Creates one table (with an identity sequence), view and function in each of our schemas as
 * the current role (postgres, the migration role), reads what the caller roles may do with
 * them, and rolls them back. This measures the default privileges that are actually in force.
 */
async function defaultPrivilegeRules(
  client: pg.ClientBase,
  callers: string[],
  out: Violation[],
): Promise<void> {
  await client.query("savepoint security_probe");
  try {
    for (const schema of schemas) {
      await client.query(
        `create table ${schema}.security_probe_t (id bigint generated always as identity primary key)`,
      );
      await client.query(
        `create view ${schema}.security_probe_v with (security_invoker = true) as select 1 as x`,
      );
      await client.query(
        `create function ${schema}.security_probe_f() returns int language sql set search_path = '' as 'select 1'`,
      );
    }
    const found = await rows<{ object: string; role: string; privilege: string }>(
      client,
      `select (n.nspname || '.' || c.relname) as object, r.role, p.privilege
         from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        cross join unnest($2::text[]) as r(role)
        cross join unnest($3::text[]) as p(privilege)
        where n.nspname = any($1) and c.relname in ('security_probe_t', 'security_probe_v')
          and case when p.privilege in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                   then pg_catalog.has_any_column_privilege(r.role, c.oid, p.privilege)
                   else pg_catalog.has_table_privilege(r.role, c.oid, p.privilege) end
       union all
       select (n.nspname || '.' || c.relname), r.role, p.privilege
         from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        cross join unnest($2::text[]) as r(role)
        cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) as p(privilege)
        where n.nspname = any($1) and c.relkind = 'S' and c.relname like 'security_probe_t%'
          and pg_catalog.has_sequence_privilege(r.role, c.oid, p.privilege)
       union all
       select (n.nspname || '.' || p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')'), r.role, 'EXECUTE'
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        cross join unnest($2::text[]) as r(role)
        where n.nspname = any($1) and p.proname = 'security_probe_f'
          and pg_catalog.has_function_privilege(r.role, p.oid, 'EXECUTE')
        order by 1, 2, 3`,
      [schemas, callers, [...TABLE_PRIVILEGES]],
    );
    for (const f of found) {
      out.push({
        rule: "default_privileges",
        object: `new object like ${f.object}`,
        detail: `${f.role} ${f.privilege} by default`,
      });
    }
  } finally {
    await client.query("rollback to savepoint security_probe");
    await client.query("release savepoint security_probe");
  }
}

/**
 * DEC77, owner condition 1: a read function returns named columns, never a whole row, so a
 * private column added to a table later cannot leak through it. These patterns in its body
 * read or return a whole row: `select *`, `alias.*`, row_to_json, and to_json/to_jsonb/json_agg/
 * jsonb_agg of a bare name (a row alias, or a variable to write another way). Comments count.
 */
export const WHOLE_ROW_PATTERNS: readonly RegExp[] = [
  /\bselect\s+(?:distinct\s+)?\*/i,
  /\b[a-z_][a-z0-9_$]*\s*\.\s*\*/i,
  /\brow_to_json\s*\(/i,
  /\b(?:to_jsonb?|jsonb?_agg)\s*\(\s*[a-z_][a-z0-9_$]*\s*\)/i,
];

export interface ReadFunction {
  fn: string;
  source: string;
  /** The relation whose row type it returns, or null. */
  returnsRowOf: string | null;
}

/** Integration test files, the place where the matrix's test titles must be found. */
export function integrationTestSources(): string[] {
  const dir = fileURLToPath(new URL("..", import.meta.url));
  return readdirSync(dir)
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => readFileSync(join(dir, name), "utf8"));
}

/**
 * DEC77, owner condition 2: every read function is in the read-permission matrix with a
 * third-party and a guest test that exist, and the matrix lists no function that is gone.
 * Pure, so sec02-baseline.test.ts can feed it a planted matrix.
 */
export function readFunctionViolations(
  functions: readonly ReadFunction[],
  matrix: Readonly<Record<string, ReadFunctionTests>>,
  testSources: readonly string[],
): Violation[] {
  const out: Violation[] = [];
  const found = (title: string): boolean =>
    title.trim() !== "" &&
    testSources.some((source) => source.includes(`"${title}"`) || source.includes(`'${title}'`));
  for (const f of functions) {
    if (f.returnsRowOf !== null) {
      out.push({
        rule: "read_function_whole_row",
        object: f.fn,
        detail: `returns the whole row of ${f.returnsRowOf}; return named columns`,
      });
    }
    const pattern = WHOLE_ROW_PATTERNS.find((p) => p.test(f.source));
    if (pattern !== undefined) {
      out.push({
        rule: "read_function_whole_row",
        object: f.fn,
        detail: `body matches ${pattern.source}; name each column`,
      });
    }
    const entry = matrix[f.fn];
    if (entry === undefined) {
      out.push({
        rule: "read_function_unregistered",
        object: f.fn,
        detail: "read function missing from tests/integration/_harness/read-matrix.ts",
      });
      continue;
    }
    for (const kind of ["thirdParty", "guest"] as const) {
      if (!found(entry[kind])) {
        out.push({
          rule: "read_function_untested",
          object: f.fn,
          detail: `${kind} test not found: ${entry[kind] === "" ? "(empty)" : entry[kind]}`,
        });
      }
    }
  }
  const live = new Set(functions.map((f) => f.fn));
  for (const fn of Object.keys(matrix)) {
    if (!live.has(fn)) {
      out.push({ rule: "read_matrix_stale", object: fn, detail: "no such read function" });
    }
  }
  return out;
}

/** DEC77: STABLE or IMMUTABLE functions in app that a server role may execute. */
async function readFunctionRules(client: pg.ClientBase, out: Violation[]): Promise<void> {
  const functions = await rows<ReadFunction>(
    client,
    `select (n.nspname || '.' || p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')') as fn,
            p.prosrc as source,
            (select rn.nspname || '.' || rc.relname
               from pg_catalog.pg_type t
               join pg_catalog.pg_class rc on rc.oid = t.typrelid
               join pg_catalog.pg_namespace rn on rn.oid = rc.relnamespace
              where t.oid = p.prorettype and rc.relkind in ('r', 'v', 'm', 'p', 'f')) as "returnsRowOf"
       from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
        and p.provolatile in ('s', 'i')
        and exists (select 1 from pg_catalog.pg_roles r
                     where r.rolname = any($1)
                       and pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE'))
      order by 1`,
    [[...SERVER_ROLES]],
  );
  out.push(...readFunctionViolations(functions, READ_MATRIX, integrationTestSources()));
}

/** Every SEC02 / DEC36 violation in the current database, in a stable order. */
export async function securityViolations(client: pg.ClientBase): Promise<Violation[]> {
  const out: Violation[] = [];
  // Only roles that exist: a missing server role is reported by serverRoleRules.
  const callers = (
    await rows<{ name: string }>(
      client,
      "select rolname as name from pg_catalog.pg_roles where rolname = any($1) order by 1",
      [[...CALLER_ROLES]],
    )
  ).map((r) => r.name);
  await relationRules(client, callers, out);
  await functionRules(client, callers, out);
  await schemaRules(client, callers, out);
  await serverRoleRules(client, out);
  await ownerRules(client, out);
  await defaultPrivilegeRules(client, callers, out);
  await readFunctionRules(client, out);
  return out;
}
