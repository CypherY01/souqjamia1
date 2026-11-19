-- Member guard and RLS helpers (task 2.2, moved from task 2.1): FR04, BR01, DEC36, DEC63.

-- Schema for functions that RLS policies call. Not exposed through the Data API (only public is
-- listed in config.toml). Owner condition on task 2.1: never SECURITY DEFINER for anon or
-- authenticated, so these are SECURITY INVOKER and read only what RLS lets the caller read.
create schema rls;
revoke all on schema rls from public;
grant usage on schema rls to anon, authenticated;
comment on schema rls is
  'Task 2.2: SECURITY INVOKER, read-only helpers for RLS policies. Never exposed.';

-- DEC29: does the current member hold this role? Reads the member's own active grants through
-- RLS. Called from app functions (as postgres) it still checks revoked_at itself.
-- MFA (aal2) for staff access is checked separately by the policies of task 7.1.
create function rls.has_role(p_role public.app_role)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from public.role_grant g
     where g.user_id = (select auth.uid())
       and g.role = p_role
       and g.revoked_at is null
  )
$$;
grant execute on function rls.has_role(public.app_role) to authenticated;

-- DEC36: the version in force for a policy type, or null when none is published yet.
create function app.current_policy_version(p_type public.policy_type)
returns text
language sql
stable
set search_path = ''
as $$
  select v.version
    from public.policy_version v
   where v.policy_type = p_type
     and v.effective_at <= app.app_now()
   order by v.effective_at desc, v.created_at desc
   limit 1
$$;

-- FR04, BR01: every member write function starts here (internal helper, no grant). Returns the
-- member id, or raises the contract error, in the order approved for item 6 of task 2.2:
--   UNAUTHENTICATED       claims, linked profile, and the token's session still in auth.sessions
--   DELETION_PENDING      a deletion request is open
--   ACCOUNT_RESTRICTED    banned, or suspended until a time still ahead
--   EMAIL_NOT_CONFIRMED   no email_confirmed_at (DEC63: set at signup while confirmation is off)
--   TERMS_NOT_ACKNOWLEDGED the current terms or privacy version is not acknowledged (DEC36)
-- It locks the member's account_control row FOR SHARE, the first lock of the chapter 07 order,
-- so a concurrent suspension waits for this write and the next write sees it.
create function app.assert_active_member()
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
  'FR04, BR01, DEC36: the active member of this transaction, or the contract error.';
