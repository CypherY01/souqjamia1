-- Identity tables (task 2.2, plan/task-2.2.md): FR01, FR04, FR49, FR72, FR77, DEC29, DEC30,
-- DEC36, DEC51, RET06. No role writes to these tables directly (task 2.1): the trigger below and
-- app entry points of later tasks do. Reads go through RLS with column grants (item 3).

-- Profile (item 1). id equals the auth user id at creation and has no foreign key to
-- auth.users, so deleting the login identity never deletes the profile: it stays as a
-- pseudonymous id (RET06, owner condition on item 1). auth_user_id is set null instead.
-- The name is stored after NFC and outer trim (item 4), 2-50 code points (FR01), without
-- control characters or bidi embeddings, overrides and isolates (chapter 09, TC31).
create table public.profile (
  id uuid primary key,
  auth_user_id uuid unique references auth.users (id) on delete set null,
  display_name text not null,
  locale public.app_locale not null default 'ar',
  joined_at timestamptz not null default app.app_now(),
  -- Derived from account_control by trigger only (owner condition on item 2).
  hidden_from_public boolean not null default false,
  deleted_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default app.app_now(),
  updated_at timestamptz not null default app.app_now(),
  constraint profile_auth_user_is_self check (auth_user_id is null or auth_user_id = id),
  constraint profile_version_positive check (version >= 1),
  constraint profile_display_name_rules check (
    display_name = app.normalize_text(display_name)
    and char_length(display_name) between 2 and 50
    and display_name !~ '[\u0001-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]'
  )
);
comment on table public.profile is
  'Task 2.2: member profile. Public columns: id, display_name, joined_at, locale, version.';

-- Account restrictions (FR72, FR78, DEC57). A suspension always carries its end, nothing else
-- does. token_version from v3 is not created: Supabase Auth revokes sessions (DEC35).
create table public.account_control (
  user_id uuid primary key references public.profile (id),
  status public.account_status not null default 'active',
  suspended_until timestamptz,
  deletion_requested_at timestamptz,
  version integer not null default 1,
  updated_at timestamptz not null default app.app_now(),
  constraint account_control_suspension_end check ((status = 'suspended') = (suspended_until is not null)),
  constraint account_control_version_positive check (version >= 1)
);

-- Privileged roles (DEC29, FR77, SEC02). One active grant per member and role. granted_by is
-- null only for the one-time owner bootstrap (task 7.1), which also protects the last owner.
create table public.role_grant (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profile (id),
  role public.app_role not null,
  granted_by uuid references public.profile (id),
  granted_at timestamptz not null default app.app_now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profile (id),
  reason text not null,
  constraint role_grant_revocation check ((revoked_at is null) = (revoked_by is null)),
  constraint role_grant_reason check (
    reason = app.normalize_text(reason) and char_length(reason) between 1 and 2000
  )
);
create unique index role_grant_one_active on public.role_grant (user_id, role) where revoked_at is null;

-- Published policy versions (DEC36, API114). Data differs per environment, so no version is
-- inserted here: fixtures in seed.sql (task 2.3), real texts with task 7.8 (G06).
create table public.policy_version (
  policy_type public.policy_type not null,
  version text not null,
  effective_at timestamptz not null,
  path text not null,
  created_at timestamptz not null default app.app_now(),
  primary key (policy_type, version),
  constraint policy_version_format check (version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
  constraint policy_version_path check (path ~ '^/[a-z0-9/_-]*$')
);
create index policy_version_current on public.policy_version (policy_type, effective_at desc);

-- Acknowledgments of an actually published version (chapter 08, DEC36, DEC69).
create table public.policy_acknowledgment (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profile (id),
  policy_type public.policy_type not null,
  policy_version text not null,
  acknowledged_at timestamptz not null default app.app_now(),
  locale public.app_locale not null default 'ar',
  constraint policy_acknowledgment_once unique (user_id, policy_type, policy_version),
  constraint policy_acknowledgment_published foreign key (policy_type, policy_version)
    references public.policy_version (policy_type, version)
);

-- RLS on every table (task 2.1). Reads only, through column grants (item 3, owner addition:
-- no private column for anon or another member).
alter table public.profile enable row level security;
alter table public.account_control enable row level security;
alter table public.role_grant enable row level security;
alter table public.policy_version enable row level security;
alter table public.policy_acknowledgment enable row level security;

grant select (id, display_name, joined_at, locale, version) on public.profile to anon, authenticated;
create policy profile_read on public.profile for select to anon, authenticated
  using (not hidden_from_public or id = (select auth.uid()));

grant select (user_id, status, suspended_until, deletion_requested_at, version)
  on public.account_control to authenticated;
create policy account_control_read_own on public.account_control for select to authenticated
  using (user_id = (select auth.uid()));

grant select (user_id, role, granted_at, revoked_at) on public.role_grant to authenticated;
create policy role_grant_read_own_active on public.role_grant for select to authenticated
  using (user_id = (select auth.uid()) and revoked_at is null);

grant select (policy_type, version, effective_at, path) on public.policy_version to anon, authenticated;
create policy policy_version_read on public.policy_version for select to anon, authenticated
  using (true);

grant select (user_id, policy_type, policy_version, acknowledged_at)
  on public.policy_acknowledgment to authenticated;
create policy policy_acknowledgment_read_own on public.policy_acknowledgment for select
  to authenticated using (user_id = (select auth.uid()));

-- hidden_from_public follows account_control in the same transaction (owner condition on
-- item 2): hidden while suspended, banned or waiting for deletion. No function sets it itself.
-- SECURITY DEFINER because the triggers also fire for Supabase Auth's own role (signup, user
-- deletion); no grant to anyone.
create function app.sync_profile_visibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profile p
     set hidden_from_public = (new.status <> 'active' or new.deletion_requested_at is not null)
   where p.id = new.user_id
     and p.hidden_from_public
         is distinct from (new.status <> 'active' or new.deletion_requested_at is not null);
  return null;
end;
$$;
create trigger account_control_sync_visibility
  after insert or update of status, deletion_requested_at on public.account_control
  for each row execute function app.sync_profile_visibility();

-- Checked at commit: every profile has its account_control row, and hidden_from_public equals
-- what account_control says, even if someone changed the column directly.
create function app.check_profile_visibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if tg_table_name = 'profile' then
    v_id := new.id;
  else
    v_id := new.user_id;
  end if;
  if not exists (select 1 from public.account_control c where c.user_id = v_id) then
    raise exception using errcode = '23514',
      message = 'profile without account_control', detail = v_id::text;
  end if;
  if exists (
    select 1
      from public.profile p
      join public.account_control c on c.user_id = p.id
     where p.id = v_id
       and p.hidden_from_public
           is distinct from (c.status <> 'active' or c.deletion_requested_at is not null)
  ) then
    raise exception using errcode = '23514',
      message = 'profile.hidden_from_public differs from account_control', detail = v_id::text;
  end if;
  return null;
end;
$$;
create constraint trigger profile_visibility_matches
  after insert or update on public.profile
  deferrable initially deferred
  for each row execute function app.check_profile_visibility();
create constraint trigger account_control_visibility_matches
  after insert or update on public.account_control
  deferrable initially deferred
  for each row execute function app.check_profile_visibility();

-- Profile on signup (FR01, item 5). The name comes from the signup data our server sends
-- (task 3.2, display_name). A missing or invalid name fails the CHECK above, so the whole
-- signup fails and no login identity is left without a profile. Supabase Auth returns database
-- errors to its caller, so the CHECK failure (whose detail repeats the row) becomes a plain
-- contract error for the signup field `name`. Runs as Supabase Auth's role, hence SECURITY
-- DEFINER; no grant to anyone.
create function app.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.profile (id, auth_user_id, display_name)
    values (new.id, new.id, app.normalize_text(coalesce(new.raw_user_meta_data ->> 'display_name', '')));
  exception when check_violation then
    perform app.raise_api_error('VALIDATION_FAILED', 'name', 'invalid_format');
  end;
  insert into public.account_control (user_id) values (new.id);
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.create_profile_for_auth_user();
