-- Account page and profile edit (task 3.5, plan/task-3.5.md): FR49, UC20, API015, API016,
-- DEC30, DEC51, DEC58, DEC73, DEC77, DEC78, TC21, TC65.
--  1. app.me(): the private account fields of API015 for the session of this transaction. A read
--     function under DEC77: named columns only, and registered in the read-permission matrix of
--     tests/integration/_harness/read-matrix.ts with its third-party and guest tests.
--  2. app.update_profile(): API016. Name and college today; the avatar waits for task 4.7 (TC75)
--     and the only locale is ar (DEC51). DEC78: 10 successful edits per member per hour.

-- Item 1, API015 and DEC58: any live session, including an unconfirmed or restricted account,
-- so the account page can show its state. app.session_context() does the live-session checks
-- of task 3.1, so they are not repeated here. A limited session (DEC73, a recovery link) reads
-- nothing but may change its password, so it is refused, as app.assert_active_member() does.
-- Fields whose tables come later are not here: the pending email (task 3.6), the avatar (4.7)
-- and the student badge (7.6). The server returns them as null, as the contract allows.
create function app.me()
returns table (
  user_id uuid,
  email text,
  email_confirmed boolean,
  display_name text,
  college_id uuid,
  college_key text,
  college_label_ar text,
  college_label_en text,
  locale public.app_locale,
  joined_at timestamptz,
  account_status public.account_status,
  suspended_until timestamptz,
  deletion_requested_at timestamptz,
  restricted boolean,
  terms_acknowledged boolean,
  roles public.app_role[],
  mfa_enrolled boolean,
  email_offers boolean,
  email_meetups boolean,
  email_deals boolean,
  email_reviews boolean,
  email_reports boolean,
  preferences_version integer,
  version integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid := app.actor_id();
  v_limited boolean;
  v_account_status public.account_status;
  v_suspended_until timestamptz;
  v_deletion_requested_at timestamptz;
  v_restricted boolean;
  v_email_confirmed boolean;
  v_terms_acknowledged boolean;
  v_roles public.app_role[];
begin
  select s.account_status, s.suspended_until, s.deletion_requested_at, s.restricted,
         s.email_confirmed, s.terms_acknowledged, s.roles
    into v_account_status, v_suspended_until, v_deletion_requested_at, v_restricted,
         v_email_confirmed, v_terms_acknowledged, v_roles
    from app.session_context() s;
  v_limited := app.limited_session();
  if v_limited then
    perform app.raise_api_error('RECOVERY_SESSION_ONLY');
  end if;

  return query
  select
    v_id,
    u.email::text,
    v_email_confirmed,
    p.display_name,
    p.college_id,
    c.key,
    c.label_ar,
    c.label_en,
    p.locale,
    p.joined_at,
    v_account_status,
    v_suspended_until,
    v_deletion_requested_at,
    v_restricted,
    v_terms_acknowledged,
    v_roles,
    exists (
      select 1 from auth.mfa_factors f where f.user_id = v_id and f.status = 'verified'
    ),
    n.offers,
    n.meetups,
    n.deals,
    n.reviews,
    n.reports,
    n.version,
    p.version
    from public.profile p
    join auth.users u on u.id = p.auth_user_id
    join public.notification_preference n on n.user_id = p.id
    left join public.college c on c.id = p.college_id
   where p.id = v_id;
  if not found then
    perform app.raise_api_error('UNAUTHENTICATED');
  end if;
end;
$$;
comment on function app.me() is
  'Task 3.5, API015, DEC58, DEC77: the private account fields of this session''s member.';
grant execute on function app.me() to souq_web;

-- Item 2, API016 (FR49, TC21, TC65). p_patch holds only the fields the member sent, so an absent
-- field stays as it is and a null college_id removes the college. The server has already
-- validated the body (ProfilePatch, unknown fields 400); the same rules are checked here again,
-- with the same contract errors, because every entry point rechecks its input.
--  - Lock order: account_control FOR SHARE (app.assert_active_member), then the profile row FOR
--    UPDATE, as in the administrative suspension that updates account_control then the profile.
--  - expected_version is always checked: a stale version is STATE_CONFLICT, even when the
--    request would change nothing.
--  - A college must be active, unless it is the member's current one (deactivated later: it
--    stays until the member changes it, item 5).
--  - avatar_id: null is accepted (there is no avatar yet); any id is VALIDATION_FAILED, because
--    no media exists before task 4.1. Task 4.7 replaces this with the TC75 rules.
--  - A request that changes nothing returns the current version, with no audit and no count.
--  - DEC78: a change takes one of 10 successful edits per member per hour, in this transaction
--    (DEC70 success quota), so a rejected request is not counted.
--  - Audit profile.update with the names of the changed fields only, never their values (item 3).
create function app.update_profile(p_expected_version integer, p_patch jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text;
  v_college uuid;
  v_version integer;
  v_new_name text;
  v_new_college uuid;
  v_text text;
  v_fields text[] := array[]::text[];
begin
  v_id := app.assert_active_member();

  if p_expected_version is null or p_expected_version < 1
    or p_patch is null or pg_catalog.jsonb_typeof(p_patch) <> 'object'
    or exists (
      select 1
        from pg_catalog.jsonb_object_keys(p_patch) k
       where k not in ('display_name', 'college_id', 'avatar_id', 'locale')
    ) then
    perform app.raise_api_error('BAD_REQUEST');
  end if;

  select p.display_name, p.college_id, p.version
    into v_name, v_college, v_version
    from public.profile p
   where p.id = v_id
     for update;
  if not found then
    perform app.raise_api_error('UNAUTHENTICATED');
  end if;
  if v_version <> p_expected_version then
    perform app.raise_api_error('STATE_CONFLICT');
  end if;

  v_new_name := v_name;
  if p_patch ? 'display_name' then
    if pg_catalog.jsonb_typeof(p_patch -> 'display_name') <> 'string' then
      perform app.raise_api_error('BAD_REQUEST');
    end if;
    v_new_name := app.normalize_text(p_patch ->> 'display_name');
    -- The rules of parseDisplayName (@souq/domain), in its order, and of the CHECK
    -- profile_display_name_rules (task 2.2): 2 to 50 code points after NFC and trim, no control
    -- characters or bidi controls (TC31).
    if v_new_name = '' then
      perform app.raise_api_error('VALIDATION_FAILED', 'display_name', 'required');
    elsif v_new_name ~ U&'[!0001-!001F!007F-!009F!202A-!202E!2066-!2069]' uescape '!' then
      perform app.raise_api_error('VALIDATION_FAILED', 'display_name', 'invalid_format');
    elsif pg_catalog.char_length(v_new_name) < 2 then
      perform app.raise_api_error('VALIDATION_FAILED', 'display_name', 'too_small');
    elsif pg_catalog.char_length(v_new_name) > 50 then
      perform app.raise_api_error('VALIDATION_FAILED', 'display_name', 'too_big');
    end if;
  end if;

  v_new_college := v_college;
  if p_patch ? 'college_id' then
    if pg_catalog.jsonb_typeof(p_patch -> 'college_id') = 'null' then
      v_new_college := null;
    elsif pg_catalog.jsonb_typeof(p_patch -> 'college_id') <> 'string' then
      perform app.raise_api_error('BAD_REQUEST');
    else
      v_text := p_patch ->> 'college_id';
      if v_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
        perform app.raise_api_error('VALIDATION_FAILED', 'college_id', 'invalid_format');
      end if;
      v_new_college := v_text::uuid;
      if v_new_college is distinct from v_college and not exists (
        select 1 from public.college c where c.id = v_new_college and c.is_active
      ) then
        perform app.raise_api_error('VALIDATION_FAILED', 'college_id', 'unknown');
      end if;
    end if;
  end if;

  if p_patch ? 'avatar_id' then
    if pg_catalog.jsonb_typeof(p_patch -> 'avatar_id') = 'string' then
      perform app.raise_api_error('VALIDATION_FAILED', 'avatar_id', 'unknown');
    elsif pg_catalog.jsonb_typeof(p_patch -> 'avatar_id') <> 'null' then
      perform app.raise_api_error('BAD_REQUEST');
    end if;
  end if;

  if p_patch ? 'locale' and (p_patch -> 'locale') is distinct from '"ar"'::jsonb then
    perform app.raise_api_error('VALIDATION_FAILED', 'locale', 'invalid_value');
  end if;

  if v_new_name is distinct from v_name then
    v_fields := v_fields || 'display_name'::text;
  end if;
  if v_new_college is distinct from v_college then
    v_fields := v_fields || 'college_id'::text;
  end if;
  if pg_catalog.cardinality(v_fields) = 0 then
    return v_version;
  end if;

  perform app.rate_limit_take(
    'DEC78:hour',
    pg_catalog.sha256(pg_catalog.convert_to(v_id::text, 'UTF8')),
    10,
    '1 hour'
  );

  update public.profile p
     set display_name = v_new_name,
         college_id = v_new_college,
         version = p.version + 1,
         updated_at = app.app_now()
   where p.id = v_id
  returning p.version into v_version;

  perform app.audit(
    'profile.update',
    'profile',
    v_id,
    null,
    pg_catalog.jsonb_build_object('fields', pg_catalog.to_jsonb(v_fields))
  );
  return v_version;
end;
$$;
comment on function app.update_profile(integer, jsonb) is
  'Task 3.5, API016, DEC78: the member''s permitted profile fields, with expected_version.';
grant execute on function app.update_profile(integer, jsonb) to souq_web;
