-- Signup and policy acknowledgments (task 3.2, plan/task-3.2.md): FR01, UC01, DEC26, DEC36,
-- DEC63, DEC69, API001, API114, API119.
--  1. The profile trigger of task 2.2 also records the acknowledgments of the current terms and
--     privacy versions and the optional college, in the transaction that creates the login
--     identity (item 2). A signup without the current versions, or with an inactive college,
--     fails as a whole, so no account is left half created or without its acknowledgments
--     (UC01), even when someone calls Supabase Auth directly.
--  2. app.current_policies() for API114 and the signup page, and app.active_colleges() for the
--     signup page (API030 itself joins with task 4.2), both for souq_web (item 4).
--  3. app.acknowledge_policies() for API119 (DEC69): any live, ordinary session.

-- Item 2. Replaces the function as 20261119120000_infrastructure.sql left it (with the email
-- preferences row of task 2.4), adding the acknowledgments and the college.
-- Supabase Auth returns database errors to its caller, so every rejection here is a plain
-- contract error (SJ001) with the field and its rule, never the row values. Our server checks
-- the same rules first and answers with clear field errors; this is the last line of defense.
-- Runs as Supabase Auth's role, hence SECURITY DEFINER; no grant to anyone.
create or replace function app.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_data jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_terms text := v_data ->> 'terms_version';
  v_privacy text := v_data ->> 'privacy_version';
  v_college_text text := nullif(v_data ->> 'college_id', '');
  v_college uuid;
begin
  -- DEC36: the acknowledged versions must be the ones in force at this moment.
  if v_terms is null or v_terms is distinct from app.current_policy_version('terms') then
    perform app.raise_api_error('VALIDATION_FAILED', 'terms_version', 'not_current');
  end if;
  if v_privacy is null or v_privacy is distinct from app.current_policy_version('privacy') then
    perform app.raise_api_error('VALIDATION_FAILED', 'privacy_version', 'not_current');
  end if;

  -- FR01, section 4.4: the college is optional; when given it must be an active one.
  if v_college_text is not null then
    if v_college_text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select c.id into v_college
        from public.college c
       where c.id = v_college_text::uuid
         and c.is_active;
    end if;
    if v_college is null then
      perform app.raise_api_error('VALIDATION_FAILED', 'college_id', 'unknown');
    end if;
  end if;

  begin
    insert into public.profile (id, auth_user_id, display_name, college_id)
    values (
      new.id,
      new.id,
      app.normalize_text(coalesce(v_data ->> 'display_name', '')),
      v_college
    );
  exception when check_violation then
    perform app.raise_api_error('VALIDATION_FAILED', 'name', 'invalid_format');
  end;
  insert into public.account_control (user_id) values (new.id);
  insert into public.notification_preference (user_id) values (new.id);
  insert into public.policy_acknowledgment (user_id, policy_type, policy_version)
  values (new.id, 'terms', v_terms), (new.id, 'privacy', v_privacy);
  return new;
end;
$$;

-- Item 4, API114: the version in force of each policy type, the same choice as
-- app.current_policy_version(). No row for a type that has no published version yet; the
-- server then answers 503. Public data, read by souq_web for guests and members alike.
create function app.current_policies()
returns table (
  policy_type public.policy_type,
  version text,
  effective_at timestamptz,
  path text
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (v.policy_type) v.policy_type, v.version, v.effective_at, v.path
    from public.policy_version v
   where v.effective_at <= app.app_now()
   order by v.policy_type, v.effective_at desc, v.created_at desc
$$;
comment on function app.current_policies() is
  'API114, DEC36: the policy versions in force, one row per published policy type.';
grant execute on function app.current_policies() to souq_web;

-- Item 4: the pick list of the signup page. Active colleges only, in display order
-- (the reads of task 2.3 keep inactive ones for old profiles).
create function app.active_colleges()
returns table (id uuid, key text, label_ar text, label_en text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.key, c.label_ar, c.label_en
    from public.college c
   where c.is_active
   order by c.display_order, c.label_ar, c.id
$$;
comment on function app.active_colleges() is
  'Task 3.2: active colleges for the signup page, in display order.';
grant execute on function app.active_colleges() to souq_web;

-- The live-session part of app.session_context() (task 3.1), for entry points of the session
-- access level (any account state), with the limited session of DEC73 refused. Internal helper,
-- no grant.
create function app.assert_live_session()
returns uuid
language plpgsql
stable
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
  if app.limited_session() then
    perform app.raise_api_error('RECOVERY_SESSION_ONLY');
  end if;
  return v_id;
end;
$$;
comment on function app.assert_live_session() is
  'Task 3.2: the member of a live ordinary session (session access level), or the contract error.';

-- Item 4, API119, DEC69: acknowledges the versions in force. Any account state (session access
-- level, like API015), because acknowledging is a condition for writing, not a write to the
-- market. Versions that are not the current ones: STATE_CONFLICT, and the page fetches API114
-- again. Acknowledging the same versions again changes nothing.
create function app.acknowledge_policies(p_terms_version text, p_privacy_version text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid := app.assert_live_session();
begin
  if p_terms_version is null
    or p_privacy_version is null
    or p_terms_version is distinct from app.current_policy_version('terms')
    or p_privacy_version is distinct from app.current_policy_version('privacy') then
    perform app.raise_api_error('STATE_CONFLICT');
  end if;
  insert into public.policy_acknowledgment (user_id, policy_type, policy_version)
  values (v_id, 'terms', p_terms_version), (v_id, 'privacy', p_privacy_version)
  on conflict on constraint policy_acknowledgment_once do nothing;
end;
$$;
comment on function app.acknowledge_policies(text, text) is
  'API119, DEC69: acknowledges the current terms and privacy versions for this session.';
grant execute on function app.acknowledge_policies(text, text) to souq_web;
