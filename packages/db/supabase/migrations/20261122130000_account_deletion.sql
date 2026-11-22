-- Account deletion request and recovery (task 3.7, plan/task-3.7.md): FR72, BR40, UC23, RET06,
-- DEC39, DEC41, DEC73, DEC81, SEC01, TC59. Nothing new is stored: the request is
-- account_control.deletion_requested_at (task 2.2), and its trigger keeps
-- profile.hidden_from_public in step, so public reads leave the member out (DEC41).
--  1. app.deletion_deadline(): the end of the 30-day recovery period (FR72), one definition.
--  2. app.cancel_pending_for_account(): DEC39, the cancellations a deletion request (and from
--     task 7.4 a suspension or ban) makes in the same transaction. Empty until its tables exist.
--  3. app.request_account_deletion(): API026.
--  4. app.deletion_recovery_pending(email): API027, whether a recovery link may be sent.
--  5. app.recover_account_deletion(): API028, on the session of the recovery link.

-- 1. FR72, BR40: recovery is possible while app.app_now() is before this time, measured as
-- elapsed UTC time (chapter 11 of v3). Internal helper, no grant.
create function app.deletion_deadline(p_requested_at timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select p_requested_at + interval '30 days'
$$;
comment on function app.deletion_deadline(timestamptz) is
  'FR72: the end of the 30-day recovery period of a deletion request.';

-- 2. DEC39: a deletion request, a suspension and a permanent ban cancel, in the same
-- transaction, what is pending for the account as seller or buyer, with the reason
-- account_restricted: pending deals (task 6.1), pending offers (task 5.5), and proposed or
-- accepted meetups not yet due (task 5.6). Those tasks replace this function, each starting
-- from its latest version (packages/db/README.md), and lock their rows after the caller's
-- account_control lock, in the order of chapter 07. Nothing to cancel yet: it returns how many
-- records it cancelled. Internal helper, no grant.
create function app.cancel_pending_for_account(p_user_id uuid, p_reason text)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
begin
  if p_user_id is null or p_reason is distinct from 'account_restricted' then
    perform app.raise_api_error('BAD_REQUEST');
  end if;
  return 0;
end;
$$;
comment on function app.cancel_pending_for_account(uuid, text) is
  'DEC39: cancels the pending deals, offers and meetups of an account (tasks 5.5, 5.6, 6.1).';

-- 3. API026 (account_reauth, DEC81): the checks of app.assert_active_member() in the same order,
-- without the current-terms condition, and the account_control row locked FOR UPDATE (first in
-- the chapter 07 order) so a concurrent request or suspension waits:
--   UNAUTHENTICATED        claims, linked profile, live session (app.session_context)
--   RECOVERY_SESSION_ONLY  a limited session (DEC73)
--   DELETION_PENDING       already requested: the second of two requests gets this
--   ACCOUNT_RESTRICTED     banned, or suspended until a time still ahead (DEC81: no self-deletion)
--   EMAIL_NOT_CONFIRMED    no email_confirmed_at
-- The reauthentication window (DEC38) is checked by the server from amr. Sessions are revoked
-- by the server through Supabase Auth after the commit; until then, and if that fails, every
-- session of the member already gets DELETION_PENDING from this row. Returns the request time.
create function app.request_account_deletion()
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid := app.actor_id();
  v_now timestamptz := app.app_now();
  v_limited boolean;
  v_status public.account_status;
  v_suspended_until timestamptz;
  v_deletion_requested_at timestamptz;
begin
  perform 1 from app.session_context();
  v_limited := app.limited_session();
  if v_limited then
    perform app.raise_api_error('RECOVERY_SESSION_ONLY');
  end if;

  select c.status, c.suspended_until, c.deletion_requested_at
    into v_status, v_suspended_until, v_deletion_requested_at
    from public.account_control c
   where c.user_id = v_id
     for update;
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

  update public.account_control c
     set deletion_requested_at = v_now,
         version = c.version + 1,
         updated_at = v_now
   where c.user_id = v_id;
  perform app.cancel_pending_for_account(v_id, 'account_restricted');
  perform app.audit('account.deletion_requested', 'profile', v_id);
  -- SEC11: the in-app notice now; its required email is built in task 3.8 (owner condition).
  perform app.notify(
    v_id,
    'account.deletion_requested',
    'account',
    v_id,
    'account.deletion_requested:' || pg_catalog.floor(pg_catalog.date_part('epoch', v_now))::bigint
  );
  return v_now;
end;
$$;
comment on function app.request_account_deletion() is
  'Task 3.7, API026: starts the 30-day recovery period of the session''s member (FR72, DEC41).';
grant execute on function app.request_account_deletion() to souq_web;

-- 4. API027: true when this login email belongs to an account awaiting deletion whose recovery
-- period is still running, so the server asks Supabase Auth for a link only then. The answer
-- never leaves the server: API027 is the same 202 either way (no account disclosure). No
-- identity is used. GoTrue stores addresses in lower case; both sides are lowered anyway.
create function app.deletion_recovery_pending(p_email text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.app_now();
begin
  if p_email is null or p_email = '' then
    return false;
  end if;
  return exists (
    select 1
      from auth.users u
      join public.profile p on p.id = u.id and p.auth_user_id = u.id
      join public.account_control c on c.user_id = p.id
     where pg_catalog.lower(u.email::text) = pg_catalog.lower(p_email)
       and u.deleted_at is null
       and u.email_confirmed_at is not null
       and c.deletion_requested_at is not null
       and v_now < app.deletion_deadline(c.deletion_requested_at)
  );
end;
$$;
comment on function app.deletion_recovery_pending(text) is
  'Task 3.7, API027: whether a deletion recovery link may be sent to this address.';
grant execute on function app.deletion_recovery_pending(text) to souq_web;

-- 5. API028: on the limited session the server has just opened with the recovery link (DEC73),
-- which never reaches the browser. An ordinary password session cannot recover without the link
-- (DEC41): FORBIDDEN. A suspension or ban stays (FR72, TC59), and what DEC39 cancelled is not
-- restored. The trigger recomputes hidden_from_public, so a restricted account stays hidden.
--   LINK_INVALID_OR_EXPIRED  the account is not awaiting deletion (already recovered, or a link
--                            sent straight from Supabase Auth for an active account)
--   DEADLINE_PASSED          30 days or more since the request (TC59)
create function app.recover_account_deletion()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid := app.actor_id();
  v_now timestamptz := app.app_now();
  v_limited boolean;
  v_deletion_requested_at timestamptz;
begin
  perform 1 from app.session_context();
  v_limited := app.limited_session();
  if not v_limited then
    perform app.raise_api_error('FORBIDDEN');
  end if;

  select c.deletion_requested_at
    into v_deletion_requested_at
    from public.account_control c
   where c.user_id = v_id
     for update;
  if not found then
    perform app.raise_api_error('UNAUTHENTICATED');
  end if;
  if v_deletion_requested_at is null then
    perform app.raise_api_error('LINK_INVALID_OR_EXPIRED');
  end if;
  if v_now >= app.deletion_deadline(v_deletion_requested_at) then
    perform app.raise_api_error('DEADLINE_PASSED');
  end if;

  update public.account_control c
     set deletion_requested_at = null,
         version = c.version + 1,
         updated_at = v_now
   where c.user_id = v_id;
  perform app.audit('account.deletion_recovered', 'profile', v_id);
  perform app.notify(
    v_id,
    'account.deletion_recovered',
    'account',
    v_id,
    'account.deletion_recovered:'
      || pg_catalog.floor(pg_catalog.date_part('epoch', v_deletion_requested_at))::bigint
  );
end;
$$;
comment on function app.recover_account_deletion() is
  'Task 3.7, API028: ends the deletion request of the recovery link''s member (FR72, TC59).';
grant execute on function app.recover_account_deletion() to souq_web;
