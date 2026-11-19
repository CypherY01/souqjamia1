-- Supabase Auth on the server (task 3.1, plan/task-3.1.md): FR04, BR01, FR78, DEC36, DEC38,
-- DEC73. The Next.js server (souq_web) verifies the member's JWT, then sets the verified claims
-- for one transaction with set_config('request.jwt.claims', ..., true).
--  0. The deferred idempotency check of task 2.4 runs as its owner (found here, see below).
--  1. Time limits for souq_web's own sessions (item 10).
--  2. app.limited_session(): DEC73, a session without the password method in amr (a recovery
--     link gives amr = otp only) may only change the password, never write to the market.
--  3. app.assert_active_member() rejects limited sessions with RECOVERY_SESSION_ONLY (item 7).
--  4. app.session_context(): the live session and account state for the server guards (item 6).

-- Item 10: NFR04 asks for p95 under one second, so a statement over 5 seconds is a defect that
-- must fail clearly; a short lock wait stops requests piling up behind an administrative
-- suspension. They apply when souq_web logs in itself (DATABASE_URL of the web app).
alter role souq_web set statement_timeout = '5s';
alter role souq_web set lock_timeout = '3s';
alter role souq_web set idle_in_transaction_session_timeout = '15s';

-- Found with the first real souq_web transaction: the deferred check of task 2.4 runs at commit,
-- outside the SECURITY DEFINER entry point, so it ran as souq_web, which may not read
-- app.idempotency_record (42501), and every idempotent write from the server failed at commit.
-- Like the other trigger functions (task 2.2), it runs as its owner, with no grant to anyone.
alter function app.check_idempotency_completed() security definer;

-- DEC73: true when the verified claims of this transaction are not an ordinary password session.
-- Signup and login always record password in amr, and so do MFA sessions (password, totp).
-- Review this rule before adding any sign-in method without a password (OAuth, magic link).
-- Internal helper, no grant.
create function app.limited_session()
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_claims jsonb := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb;
begin
  return not coalesce(
    pg_catalog.jsonb_typeof(v_claims -> 'amr') = 'array'
      and exists (
        select 1
          from pg_catalog.jsonb_array_elements(v_claims -> 'amr') as e(entry)
         where pg_catalog.jsonb_typeof(e.entry) = 'object'
           and e.entry ->> 'method' = 'password'
      ),
    false
  );
end;
$$;
comment on function app.limited_session() is
  'DEC73: the session of this transaction has no password method in amr (recovery link and similar).';

-- FR04, BR01, DEC36, DEC73: the same checks and order as task 2.2, with the limited session
-- rejected right after the live-session check:
--   UNAUTHENTICATED        claims, linked profile, and the token's session still in auth.sessions
--   RECOVERY_SESSION_ONLY  no password method in amr (DEC73)
--   DELETION_PENDING       a deletion request is open
--   ACCOUNT_RESTRICTED     banned, or suspended until a time still ahead
--   EMAIL_NOT_CONFIRMED    no email_confirmed_at (DEC63: set at signup while confirmation is off)
--   TERMS_NOT_ACKNOWLEDGED the current terms or privacy version is not acknowledged (DEC36)
-- It locks the member's account_control row FOR SHARE, the first lock of the chapter 07 order,
-- so a concurrent suspension waits for this write and the next write sees it.
create or replace function app.assert_active_member()
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_id uuid := app.actor_id();
  v_session text := pg_catalog.current_setting('request.jwt.claims', true)::jsonb ->> 'session_id';
  v_now timestamptz := app.app_now();
  v_status public.account_status;
  v_suspended_until timestamptz;
  v_deletion_requested_at timestamptz;
begin
  if not exists (select 1 from public.profile p where p.id = v_id and p.auth_user_id = v_id) then
    perform app.raise_api_error('UNAUTHENTICATED');
  end if;
  if v_session is null
    or v_session !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or not exists (
      select 1
        from auth.sessions s
       where s.id = v_session::uuid
         and s.user_id = v_id
         and (s.not_after is null or s.not_after > v_now)
    ) then
    perform app.raise_api_error('UNAUTHENTICATED');
  end if;
  if app.limited_session() then
    perform app.raise_api_error('RECOVERY_SESSION_ONLY');
  end if;

  select c.status, c.suspended_until, c.deletion_requested_at
    into v_status, v_suspended_until, v_deletion_requested_at
    from public.account_control c
   where c.user_id = v_id
     for share;
  if not found then
    perform app.raise_api_error('UNAUTHENTICATED');
  end if;
  if v_deletion_requested_at is not null then
    perform app.raise_api_error('DELETION_PENDING');
  end if;
  if v_status = 'banned' or (v_status = 'suspended' and v_suspended_until > v_now) then
    perform app.raise_api_error('ACCOUNT_RESTRICTED');
  end if;

  if not exists (
    select 1 from auth.users u where u.id = v_id and u.email_confirmed_at is not null
  ) then
    perform app.raise_api_error('EMAIL_NOT_CONFIRMED');
  end if;

  if exists (
    select 1
      from pg_catalog.unnest(pg_catalog.enum_range(null::public.policy_type)) as t(policy_type)
     where not exists (
       select 1
         from public.policy_acknowledgment a
        where a.user_id = v_id
          and a.policy_type = t.policy_type
          and a.policy_version = app.current_policy_version(t.policy_type)
     )
  ) then
    perform app.raise_api_error('TERMS_NOT_ACKNOWLEDGED');
  end if;

  return v_id;
end;
$$;
comment on function app.assert_active_member() is
  'FR04, BR01, DEC36, DEC73: the active member of this transaction, or the contract error.';

-- Item 6, FR04: the live session and the account state in one query, for the server guards of
-- private reads (session and member access, task 3.1), the member's name in the site header
-- (task 1.5 left wiring it to the session to 3.1) and the account page (task 3.5).
-- UNAUTHENTICATED under the same conditions as app.assert_active_member(). A limited session is
-- not rejected here: the server classifies it from amr, and the recovery access of task 3.4
-- needs its live-session check too. Times are compared with app.app_now() (test clock).
-- No lock: it is a read, and every write rechecks in app.assert_active_member().
create function app.session_context()
returns table (
  user_id uuid,
  display_name text,
  account_status public.account_status,
  suspended_until timestamptz,
  deletion_requested_at timestamptz,
  restricted boolean,
  email_confirmed boolean,
  terms_acknowledged boolean,
  roles public.app_role[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid := app.actor_id();
  v_session text := pg_catalog.current_setting('request.jwt.claims', true)::jsonb ->> 'session_id';
  v_now timestamptz := app.app_now();
begin
  if not exists (select 1 from public.profile p where p.id = v_id and p.auth_user_id = v_id) then
    perform app.raise_api_error('UNAUTHENTICATED');
  end if;
  if v_session is null
    or v_session !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or not exists (
      select 1
        from auth.sessions s
       where s.id = v_session::uuid
         and s.user_id = v_id
         and (s.not_after is null or s.not_after > v_now)
    ) then
    perform app.raise_api_error('UNAUTHENTICATED');
  end if;

  return query
  select
    v_id,
    p.display_name,
    c.status,
    c.suspended_until,
    c.deletion_requested_at,
    c.status = 'banned' or (c.status = 'suspended' and c.suspended_until > v_now),
    exists (select 1 from auth.users u where u.id = v_id and u.email_confirmed_at is not null),
    not exists (
      select 1
        from pg_catalog.unnest(pg_catalog.enum_range(null::public.policy_type)) as t(policy_type)
       where not exists (
         select 1
           from public.policy_acknowledgment a
          where a.user_id = v_id
            and a.policy_type = t.policy_type
            and a.policy_version = app.current_policy_version(t.policy_type)
       )
    ),
    coalesce(
      (select pg_catalog.array_agg(g.role order by g.role)
         from public.role_grant g
        where g.user_id = v_id and g.revoked_at is null),
      '{}'::public.app_role[]
    )
    from public.account_control c
    join public.profile p on p.id = c.user_id
   where c.user_id = v_id;
  if not found then
    perform app.raise_api_error('UNAUTHENTICATED');
  end if;
end;
$$;
comment on function app.session_context() is
  'FR04, task 3.1: live session and account state of this transaction for the server guards.';
grant execute on function app.session_context() to souq_web;
