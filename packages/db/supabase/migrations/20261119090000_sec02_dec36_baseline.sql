-- SEC02, DEC36: security baseline (task 2.1, plan/task-2.1.md).
-- Deny by default. anon, authenticated and service_role never write to our tables directly.
-- Business writes go through functions in the non-exposed `app` schema, executed only by the
-- dedicated server roles souq_web (Next.js) and souq_worker (background worker).
-- tests/integration/sec02-baseline.test.ts checks every rule here against the live catalog.

-- 1. Default privileges for objects that postgres (the migration role) creates from now on.
--    Supabase's defaults still give anon, authenticated and service_role TRUNCATE, REFERENCES,
--    TRIGGER and MAINTAIN on new tables, UPDATE on new sequences, and EXECUTE on new functions
--    through PUBLIC, even with auto_expose_new_tables = false (found in task 2.1).
--    Every grant from here on is explicit, in the migration of the slice that needs it.
--    Owner condition on task 2.1: supabase_admin's defaults too. postgres may not change them
--    ("permission denied to change default privileges"), so the comprehensive check instead
--    rejects any object in public or app that postgres does not own (question 30, plan/phase-1.md).
alter default privileges for role postgres revoke execute on functions from public;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, service_role;

-- Objects that already exist in public: none at this point, revoked for completeness.
revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;
revoke all on all functions in schema public from public, anon, authenticated, service_role;

-- 2. The `app` schema (DEC36). Not listed in [api] schemas of config.toml, so PostgREST never
--    exposes it. No USAGE for PUBLIC, anon, authenticated or service_role.
create schema app;
revoke all on schema app from public;
comment on schema app is
  'DEC36: business write functions. Entry points are SECURITY DEFINER with search_path '''', '
  'each granted to exactly one of souq_web or souq_worker. Never exposed through the Data API.';

alter default privileges for role postgres in schema app
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema app
  revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema app
  revoke all on functions from anon, authenticated, service_role;

-- 3. Dedicated roles (SEC02): no BYPASSRLS, own nothing, member of no role.
--    LOGIN without a password: nobody can sign in as them until a password is set outside the
--    repository (task 3.1 locally; the owner in hosted environments, cost stage 1).
--    Created only when missing, then their attributes are set, so this also holds if the
--    cluster keeps roles across `supabase db reset`.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'souq_web') then
    create role souq_web login noinherit;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'souq_worker') then
    create role souq_worker login noinherit;
  end if;
end
$$;

alter role souq_web with login noinherit nocreatedb nocreaterole noreplication nobypassrls;
alter role souq_worker with login noinherit nocreatedb nocreaterole noreplication nobypassrls;
comment on role souq_web is
  'SEC02, DEC36: Next.js server. Executes only the app entry points granted to it.';
comment on role souq_worker is
  'SEC02, owner condition on task 2.1: background worker. Executes only job entry points.';

grant usage on schema app to souq_web, souq_worker;

-- postgres may SET ROLE to them (integration tests act as the server this way). This makes
-- postgres a member of them, never the other way round, and grants them nothing.
grant souq_web, souq_worker to postgres with inherit false, set true;
