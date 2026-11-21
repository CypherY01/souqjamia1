-- Reauthentication, email and password change (task 3.6, plan/task-3.6.md): FR59, BR23, UC20,
-- API009, API015, API020, API021, API022, DEC37, DEC38, DEC79, SEC03, SEC11, TC27, TC74.
-- Supabase Auth changes the email and the password itself; the database records what our server
-- confirmed and enforces BR23.
--  1. app.email_change_confirmation: which of the two links of a pending email change were
--     confirmed through our server (DEC79). Internal, RLS on, no grant.
--  2. app.guard_email_change() on auth.users: an email change completes only after both links
--     were confirmed (DEC79). It fires only when the email column changes (owner condition 1).
--  3. app.confirm_email_change_link(): API021, records one link.
--  4. app.record_credential_change(): the audit of API020 and API022.
--  5. app.me(): recreated with pending_email (API015).
--
-- Why the trigger: email confirmation is off (DEC63), so Supabase Auth runs with autoconfirm,
-- and in that mode it completes an email change with either link alone, also when the link is
-- sent to its own /verify endpoint without our server (checked on GoTrue v2.197.0). The trigger
-- relies on columns of a table Supabase manages (auth.users.email_change, email_change_sent_at,
-- email_change_token_current, email_change_token_new): it is checked again on every Supabase
-- upgrade (ops/runbooks/supabase-upgrade.md, owner condition 2).

-- Item 1. One row per member with a pending change: requested_at is auth.users.email_change_sent_at
-- of that request, so a new request (new links) starts again from no confirmation. The row is
-- removed when the change completes.
create table app.email_change_confirmation (
  user_id uuid primary key references public.profile (id),
  requested_at timestamptz not null,
  current_confirmed_at timestamptz,
  new_confirmed_at timestamptz,
  updated_at timestamptz not null default app.app_now()
);
alter table app.email_change_confirmation enable row level security;
comment on table app.email_change_confirmation is
  'Task 3.6, DEC79: the links of a pending email change confirmed through API021 (current = the old address).';

-- Item 2, DEC79. Any change of auth.users.email must be the completion of a pending email change
-- (the new address is the pending one) whose two links were both confirmed for this request;
-- anything else is refused, and Supabase Auth rolls the whole update back, so the pending
-- address and both links stay as they were. When it completes, the row is removed and
-- account.email_changed is audited in the same transaction as the change itself.
-- Owner condition 1: the trigger fires only when the email column changes (WHEN below), so
-- sign-in, signup, password change and session refresh never reach it.
-- Runs as Supabase Auth's role, hence SECURITY DEFINER; no grant to anyone.
-- A later administrative email change (not in Phase 1) needs its own owner decision and path.
create function app.guard_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(old.email_change, '') = ''
     or new.email is distinct from old.email_change
     or not exists (
       select 1
         from app.email_change_confirmation c
        where c.user_id = old.id
          and c.requested_at = old.email_change_sent_at
          and c.current_confirmed_at is not null
          and c.new_confirmed_at is not null
     ) then
    perform app.raise_api_error('LINK_INVALID_OR_EXPIRED');
  end if;
  delete from app.email_change_confirmation c where c.user_id = old.id;
  perform app.audit('account.email_changed', 'profile', old.id);
  return new;
end;
$$;
comment on function app.guard_email_change() is
  'Task 3.6, DEC79: an email change completes only after both of its links were confirmed.';

create trigger guard_email_change
  before update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function app.guard_email_change();

-- Item 3, API021 (guest: the link is opened on any device, no session is read).
--  - The link of the pending request of some account, sent within the last hour (DEC37): the
--    old address carries email_change_token_current, the new one email_change_token_new.
--    Anything else: LINK_INVALID_OR_EXPIRED.
--  - The member's row is locked (FOR UPDATE through the upsert), so two links opened at the same
--    moment are recorded one after the other.
--  - A link already recorded while the other is not: LINK_INVALID_OR_EXPIRED (single use).
--  - Otherwise this address is recorded, with account.email_change_confirmed and the address
--    kind only (current or new), never the address.
--  - outcome 'recorded': the other link is still awaited, Supabase Auth is not called.
--    outcome 'complete': both are confirmed; the server calls Supabase Auth with this link. The
--    other link's hash is returned for the case where Supabase Auth runs with confirmation on
--    (DEC63 switched on) and needs both links itself. A retry after a failed call gets
--    'complete' again while the change is pending.
create function app.confirm_email_change_link(p_token_hash text)
returns table (user_id uuid, outcome text, other_token_hash text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.app_now();
  v_user uuid;
  v_kind text;
  v_sent timestamptz;
  v_other text;
  v_current timestamptz;
  v_new timestamptz;
  v_this timestamptz;
  v_that timestamptz;
begin
  if p_token_hash is null or p_token_hash = '' then
    perform app.raise_api_error('LINK_INVALID_OR_EXPIRED');
  end if;

  select u.id,
         case when u.email_change_token_current = p_token_hash then 'current' else 'new' end,
         u.email_change_sent_at,
         case when u.email_change_token_current = p_token_hash
              then u.email_change_token_new else u.email_change_token_current end
    into v_user, v_kind, v_sent, v_other
    from auth.users u
   where coalesce(u.email_change, '') <> ''
     and (u.email_change_token_current = p_token_hash or u.email_change_token_new = p_token_hash)
     and u.email_change_sent_at > v_now - interval '1 hour'
   limit 1;
  if not found then
    perform app.raise_api_error('LINK_INVALID_OR_EXPIRED');
  end if;

  insert into app.email_change_confirmation as c (user_id, requested_at, updated_at)
  values (v_user, v_sent, v_now)
  on conflict on constraint email_change_confirmation_pkey do update
     set requested_at = excluded.requested_at,
         current_confirmed_at = null,
         new_confirmed_at = null,
         updated_at = excluded.updated_at
   where c.requested_at is distinct from excluded.requested_at;

  select c.current_confirmed_at, c.new_confirmed_at
    into v_current, v_new
    from app.email_change_confirmation c
   where c.user_id = v_user
     for update;

  if v_kind = 'current' then
    v_this := v_current;
    v_that := v_new;
  else
    v_this := v_new;
    v_that := v_current;
  end if;

  if v_this is not null then
    if v_that is null then
      perform app.raise_api_error('LINK_INVALID_OR_EXPIRED');
    end if;
    return query select v_user, 'complete'::text, nullif(v_other, '');
    return;
  end if;

  if v_kind = 'current' then
    update app.email_change_confirmation c
       set current_confirmed_at = v_now, updated_at = v_now
     where c.user_id = v_user;
  else
    update app.email_change_confirmation c
       set new_confirmed_at = v_now, updated_at = v_now
     where c.user_id = v_user;
  end if;
  perform app.audit(
    'account.email_change_confirmed',
    'profile',
    v_user,
    null,
    pg_catalog.jsonb_build_object('address', v_kind)
  );

  if v_that is null then
    return query select v_user, 'recorded'::text, null::text;
  else
    return query select v_user, 'complete'::text, nullif(v_other, '');
  end if;
end;
$$;
comment on function app.confirm_email_change_link(text) is
  'Task 3.6, API021, DEC79: records one confirmed link of a pending email change.';
grant execute on function app.confirm_email_change_link(text) to souq_web;

-- Item 4. Supabase Auth makes the change, so the database learns of it from our server, right
-- after Supabase Auth has accepted it, as in app.record_password_reset() (task 3.4):
--   account.password_changed        API022, on the new session the change was made in
--   account.email_change_requested  API020
-- An ordinary live session of the member (app.session_context); a limited session (DEC73) is
-- refused. The account state is not checked again: the change has already been made, and the
-- audit row must not be lost. No metadata: no address or session id (RET08).
create function app.record_credential_change(p_action text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid := app.actor_id();
  v_limited boolean;
begin
  if p_action is null
     or p_action not in ('account.password_changed', 'account.email_change_requested') then
    perform app.raise_api_error('BAD_REQUEST');
  end if;
  perform 1 from app.session_context();
  v_limited := app.limited_session();
  if v_limited then
    perform app.raise_api_error('RECOVERY_SESSION_ONLY');
  end if;
  perform app.audit(p_action, 'profile', v_id);
end;
$$;
comment on function app.record_credential_change(text) is
  'Task 3.6, API020 and API022: audits an email change request or a password change.';
grant execute on function app.record_credential_change(text) to souq_web;

-- Item 5, API015. As in task 3.5, with pending_email: the pending address while its links are
-- valid (one hour, DEC37), otherwise null. The columns of returns table change, so the function
-- is dropped and created again; its key in the read-permission matrix stays app.me() (DEC77).
drop function app.me();
create function app.me()
returns table (
  user_id uuid,
  email text,
  email_confirmed boolean,
  pending_email text,
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
  v_now timestamptz := app.app_now();
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
    case
      when coalesce(u.email_change, '') <> '' and u.email_change_sent_at > v_now - interval '1 hour'
      then u.email_change::text
    end,
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
  'Task 3.5 and 3.6, API015, DEC58, DEC77: the private account fields of this session''s member.';
grant execute on function app.me() to souq_web;
