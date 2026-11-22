-- Task 3.8 (plan/task-3.8.md): the notifications core. FR48, FR68, BR38, SEC11, RET07, API029,
-- API078, API079, API115, DEC49, DEC65, DEC71, DEC77.
--  1. app.notification_event: the email channel of every event type, the one source the
--     database decides from (item 3). packages/domain/src/notifications.ts holds the same list,
--     and an integration test keeps the two equal.
--  2. app.notify() replaced (its only version is in 20261119120000_infrastructure.sql): a new row
--     whose event has an email channel queues one email.send job in the same transaction. No
--     notify.dispatch job (item 3).
--  3. app.notification_email(): what the worker may send now, read at send time (item 5).
--  4. app.member_read_actor(): internal, the member access of a read.
--  5. API078 app.my_notifications(), 6. API115 app.unread_notification_count(),
--  7. API079 app.mark_notifications_read(), 8. API029 app.update_notification_preferences().

-- 1. Channels: 'required' (security and essential administrative email, never disabled: BR38,
-- SEC11), one of the five optional groups of public.notification_preference (DEC49, DEC65), or
-- 'none' (in-app only, such as a new message in task 5.2). Each later task adds its events here
-- in its own migration, with the same rows in packages/domain/src/notifications.ts.
create table app.notification_event (
  event_type text primary key,
  email text not null,
  constraint notification_event_type_format
    check (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  constraint notification_event_email
    check (email in ('required', 'offers', 'meetups', 'deals', 'reports', 'reviews', 'none'))
);
alter table app.notification_event enable row level security;
comment on table app.notification_event is
  'Task 3.8, SEC11: the email channel of each notification event type (internal, no grant).';

-- Task 3.7's two events: account deletion email is required (SEC11, owner condition 1).
insert into app.notification_event (event_type, email) values
  ('account.deletion_requested', 'required'),
  ('account.deletion_recovered', 'required');

-- Every new notification names a known event. NOT VALID: rows written by the tests of task 2.4
-- before this migration keep their test event names locally (item 12); new rows are checked.
alter table public.notification
  add constraint notification_event_known foreign key (event_type)
  references app.notification_event (event_type) not valid;

-- 2. Creates the notification once per (recipient, dedupe_key) in the current transaction
-- (internal) and returns its id. A new row whose event has an email channel queues email.send
-- with one job per notification, so a repeated event (same dedupe_key) queues nothing more
-- (TC55) and a rolled back operation sends nothing. The job carries the notification id only:
-- the address, the account state and the preferences are read when it runs (item 5).
create or replace function app.notify(
  p_recipient uuid,
  p_event_type text,
  p_context_type public.notification_context_type,
  p_context_id uuid,
  p_dedupe_key text
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_id uuid;
  v_email text;
begin
  insert into public.notification (recipient_id, event_type, context_type, context_id, dedupe_key)
  values (p_recipient, p_event_type, p_context_type, p_context_id, p_dedupe_key)
  on conflict (recipient_id, dedupe_key) do nothing
  returning id into v_id;
  if v_id is null then
    select n.id into v_id from public.notification n
     where n.recipient_id = p_recipient and n.dedupe_key = p_dedupe_key;
    return v_id;
  end if;

  select e.email into v_email from app.notification_event e where e.event_type = p_event_type;
  if v_email is distinct from 'none' then
    perform app.enqueue_job(
      'email.send',
      pg_catalog.jsonb_build_object('notification_id', v_id),
      'email.send:' || v_id::text
    );
  end if;
  return v_id;
end;
$$;

-- 3. Item 5: one row when the email of this notification may be sent now, otherwise none (the
-- job then succeeds with nothing to do, DEC71). The address comes from auth.users here and is
-- never stored with the job (SEC11: "check the current record on requests and delivery").
--  - Every email needs the login identity, not deleted, with a confirmed address (DEC63: a signup
--    is confirmed at once while confirmation is off).
--  - 'required': sent whatever the account state, awaiting deletion, suspended or banned
--    included (BR38, owner condition 1).
--  - An optional group: an active account with no deletion request, and the group on now.
-- For account.deletion_requested, deletion_deadline is the end of the recovery period (FR72):
-- the notification is created in the request's transaction, so created_at is the request time.
create function app.notification_email(p_notification_id uuid)
returns table (
  notification_id uuid,
  event_type text,
  email_channel text,
  recipient_email text,
  created_at timestamptz,
  deletion_deadline timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    n.id,
    n.event_type,
    e.email,
    u.email::text,
    n.created_at,
    case when n.event_type = 'account.deletion_requested'
      then app.deletion_deadline(n.created_at)
    end
    from public.notification n
    join app.notification_event e on e.event_type = n.event_type
    join public.profile p on p.id = n.recipient_id
    join auth.users u on u.id = p.auth_user_id
    join public.account_control c on c.user_id = p.id
    join public.notification_preference f on f.user_id = p.id
   where n.id = p_notification_id
     and u.deleted_at is null
     and coalesce(u.email, '') <> ''
     and u.email_confirmed_at is not null
     and (
       e.email = 'required'
       or (
         c.deletion_requested_at is null
         and c.status <> 'banned'
         and not (c.status = 'suspended' and c.suspended_until > app.app_now())
         and case e.email
           when 'offers' then f.offers
           when 'meetups' then f.meetups
           when 'deals' then f.deals
           when 'reports' then f.reports
           when 'reviews' then f.reviews
           else false
         end
       )
     )
$$;
comment on function app.notification_email(uuid) is
  'Task 3.8, SEC11, BR38: the email the worker may send now for one notification, or no row.';
grant execute on function app.notification_email(uuid) to souq_worker;

-- 4. The member access of a read (x-access member): the live session of app.session_context(),
-- then the order of app.assert_active_member() without its lock, so a read stays STABLE. The
-- server guard rejects the same cases first (lib/auth/guards.ts). Internal, no grant.
create function app.member_read_actor()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_id uuid := app.actor_id();
  v_limited boolean;
  v_deletion_requested_at timestamptz;
  v_restricted boolean;
  v_email_confirmed boolean;
  v_terms_acknowledged boolean;
begin
  select s.deletion_requested_at, s.restricted, s.email_confirmed, s.terms_acknowledged
    into v_deletion_requested_at, v_restricted, v_email_confirmed, v_terms_acknowledged
    from app.session_context() s;
  v_limited := app.limited_session();
  if v_limited then
    perform app.raise_api_error('RECOVERY_SESSION_ONLY');
  end if;
  if v_deletion_requested_at is not null then
    perform app.raise_api_error('DELETION_PENDING');
  end if;
  if v_restricted then
    perform app.raise_api_error('ACCOUNT_RESTRICTED');
  end if;
  if not v_email_confirmed then
    perform app.raise_api_error('EMAIL_NOT_CONFIRMED');
  end if;
  if not v_terms_acknowledged then
    perform app.raise_api_error('TERMS_NOT_ACKNOWLEDGED');
  end if;
  return v_id;
end;
$$;

-- 5. API078 (FR48, TC20, RET07): the session member's own notifications of the last 90 days,
-- newest first, before the cursor (created_at, id) when given. The server asks for one row more
-- than the page to know whether another page follows, so at most 51 rows.
create function app.my_notifications(
  p_before_created timestamptz,
  p_before_id uuid,
  p_limit integer
)
returns table (
  id uuid,
  event_type text,
  context_type public.notification_context_type,
  context_id uuid,
  read_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid := app.member_read_actor();
  v_since timestamptz := app.app_now() - interval '90 days';
  v_limit integer := pg_catalog.int4larger(pg_catalog.int4smaller(coalesce(p_limit, 21), 51), 1);
begin
  if (p_before_created is null) <> (p_before_id is null) then
    perform app.raise_api_error('INVALID_CURSOR');
  end if;
  return query
  select n.id, n.event_type, n.context_type, n.context_id, n.read_at, n.created_at
    from public.notification n
   where n.recipient_id = v_id
     and n.created_at > v_since
     and (
       p_before_created is null
       or n.created_at < p_before_created
       or (n.created_at = p_before_created and n.id < p_before_id)
     )
   order by n.created_at desc, n.id desc
   limit v_limit;
end;
$$;
comment on function app.my_notifications(timestamptz, uuid, integer) is
  'Task 3.8, API078, FR48, RET07: the session member''s notifications of the last 90 days.';
grant execute on function app.my_notifications(timestamptz, uuid, integer) to souq_web;

-- 6. API115: how many of the session member's notifications of the last 90 days are unread.
create function app.unread_notification_count()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid := app.member_read_actor();
  v_since timestamptz := app.app_now() - interval '90 days';
  v_count integer;
begin
  select pg_catalog.count(*)::integer into v_count
    from public.notification n
   where n.recipient_id = v_id
     and n.read_at is null
     and n.created_at > v_since;
  return v_count;
end;
$$;
comment on function app.unread_notification_count() is
  'Task 3.8, API115: the number of the session member''s unread notifications (90 days).';
grant execute on function app.unread_notification_count() to souq_web;

-- 7. API079 (FR48, TC20): marks read the given notifications of the session member that are
-- still unread. Another recipient's ids, unknown ids and read ones change nothing and are not
-- reported (no disclosure). Returns how many changed; the route answers 204 either way.
create function app.mark_notifications_read(p_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid := app.assert_active_member();
  v_now timestamptz := app.app_now();
  v_count integer;
begin
  if p_ids is null or pg_catalog.cardinality(p_ids) not between 1 and 100 then
    perform app.raise_api_error('BAD_REQUEST');
  end if;
  update public.notification n
     set read_at = v_now
   where n.recipient_id = v_id
     and n.id = any (p_ids)
     and n.read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
comment on function app.mark_notifications_read(uuid[]) is
  'Task 3.8, API079, FR48, TC20: marks read the session member''s own notifications only.';
grant execute on function app.mark_notifications_read(uuid[]) to souq_web;

-- 8. API029 (FR68, BR38, DEC49, DEC65): the five optional email groups. Only the keys sent
-- change; any other key, such as a security group, is BAD_REQUEST, so required email cannot be
-- turned off. A stale version is STATE_CONFLICT (409), and a request that changes nothing keeps
-- the version, as in API016. No quota and no audit (item 11).
create function app.update_notification_preferences(p_expected_version integer, p_groups jsonb)
returns table (
  email_offers boolean,
  email_meetups boolean,
  email_deals boolean,
  email_reports boolean,
  email_reviews boolean,
  preferences_version integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid := app.assert_active_member();
  v_now timestamptz := app.app_now();
  v_key text;
  v_version integer;
  v_offers boolean;
  v_meetups boolean;
  v_deals boolean;
  v_reports boolean;
  v_reviews boolean;
  v_new_offers boolean;
  v_new_meetups boolean;
  v_new_deals boolean;
  v_new_reports boolean;
  v_new_reviews boolean;
begin
  if p_groups is null or pg_catalog.jsonb_typeof(p_groups) <> 'object' then
    perform app.raise_api_error('BAD_REQUEST');
  end if;
  for v_key in select k from pg_catalog.jsonb_object_keys(p_groups) as t(k) loop
    if v_key not in ('offers', 'meetups', 'deals', 'reports', 'reviews')
      or pg_catalog.jsonb_typeof(p_groups -> v_key) <> 'boolean' then
      perform app.raise_api_error('BAD_REQUEST');
    end if;
  end loop;

  select f.version, f.offers, f.meetups, f.deals, f.reports, f.reviews
    into v_version, v_offers, v_meetups, v_deals, v_reports, v_reviews
    from public.notification_preference f
   where f.user_id = v_id
     for update;
  if not found then
    perform app.raise_api_error('UNAUTHENTICATED');
  end if;
  if p_expected_version is null or v_version <> p_expected_version then
    perform app.raise_api_error('STATE_CONFLICT');
  end if;

  v_new_offers := coalesce((p_groups ->> 'offers')::boolean, v_offers);
  v_new_meetups := coalesce((p_groups ->> 'meetups')::boolean, v_meetups);
  v_new_deals := coalesce((p_groups ->> 'deals')::boolean, v_deals);
  v_new_reports := coalesce((p_groups ->> 'reports')::boolean, v_reports);
  v_new_reviews := coalesce((p_groups ->> 'reviews')::boolean, v_reviews);

  if (v_new_offers, v_new_meetups, v_new_deals, v_new_reports, v_new_reviews)
     is distinct from (v_offers, v_meetups, v_deals, v_reports, v_reviews) then
    v_version := v_version + 1;
    update public.notification_preference f
       set offers = v_new_offers,
           meetups = v_new_meetups,
           deals = v_new_deals,
           reports = v_new_reports,
           reviews = v_new_reviews,
           version = v_version,
           updated_at = v_now
     where f.user_id = v_id;
  end if;

  return query
  select v_new_offers, v_new_meetups, v_new_deals, v_new_reports, v_new_reviews, v_version;
end;
$$;
comment on function app.update_notification_preferences(integer, jsonb) is
  'Task 3.8, API029, FR68, BR38: the session member''s optional email groups.';
grant execute on function app.update_notification_preferences(integer, jsonb) to souq_web;
