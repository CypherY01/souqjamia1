-- Database infrastructure (task 2.4, plan/task-2.4.md): BR32, NFR09, FR74, FR75, SEC07, DEC70,
-- RET07, RET08, RET12, section 6.3. Internal tables live in the non-exposed app schema, so no
-- grant can ever expose them through the Data API (item 2). Notifications and preferences are in
-- public, readable by their owner only.

-- Background job states (item 6). Not in the contract; mirrored in packages/domain.
create type public.job_status as enum ('queued', 'running', 'done', 'dead');

-- ---------------------------------------------------------------------------------------------
-- Idempotency (BR32, NFR09, item 1). Claim and completion happen in the business transaction:
-- a concurrent request with the same key waits at the primary key until the first transaction
-- ends, then gets its stored result (or runs as new if the first one rolled back). So no
-- 'processing' row is ever committed in Phase 1, and the contract's 202 is not used.
create table app.idempotency_record (
  actor_key text not null,
  route text not null,
  request_key uuid not null,
  payload_hash bytea not null,
  state public.idempotency_state not null default 'processing',
  -- Minimal result (ids only). The server reads the resource again with the member's token.
  result jsonb,
  created_at timestamptz not null default app.app_now(),
  expires_at timestamptz not null default (app.app_now() + interval '24 hours'),
  primary key (actor_key, route, request_key),
  constraint idempotency_route check (char_length(route) between 1 and 200),
  constraint idempotency_hash check (octet_length(payload_hash) = 32),
  constraint idempotency_result_size check (result is null or octet_length(result::text) <= 4096),
  constraint idempotency_succeeded_has_result check ((state = 'succeeded') = (result is not null))
);
alter table app.idempotency_record enable row level security;

-- A claim must be completed before its transaction commits.
create function app.check_idempotency_completed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from app.idempotency_record r
     where r.actor_key = new.actor_key and r.route = new.route
       and r.request_key = new.request_key and r.state = 'processing'
  ) then
    raise exception using errcode = '23514', message = 'idempotency claim not completed';
  end if;
  return null;
end;
$$;
create constraint trigger idempotency_completed_at_commit
  after insert on app.idempotency_record
  deferrable initially deferred
  for each row execute function app.check_idempotency_completed();

-- Returns the stored result for a repeated request, or null when this request is new.
-- Same key with another payload: IDEMPOTENCY_CONFLICT. An expired key counts as new.
create function app.idempotency_claim(p_route text, p_key uuid, p_input jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_actor text := app.actor_id()::text;
  v_hash bytea := pg_catalog.sha256(pg_catalog.convert_to(p_input::text, 'UTF8'));
  v_stored_hash bytea;
  v_state public.idempotency_state;
  v_result jsonb;
begin
  delete from app.idempotency_record r
   where r.actor_key = v_actor and r.route = p_route and r.request_key = p_key
     and r.expires_at <= app.app_now();
  insert into app.idempotency_record (actor_key, route, request_key, payload_hash)
  values (v_actor, p_route, p_key, v_hash)
  on conflict (actor_key, route, request_key) do nothing;
  if found then
    return null;
  end if;
  select r.payload_hash, r.state, r.result into v_stored_hash, v_state, v_result
    from app.idempotency_record r
   where r.actor_key = v_actor and r.route = p_route and r.request_key = p_key;
  if v_stored_hash <> v_hash then
    perform app.raise_api_error('IDEMPOTENCY_CONFLICT');
  end if;
  if v_state <> 'succeeded' then
    raise exception using errcode = 'XX000', message = 'idempotency record without result';
  end if;
  return v_result;
end;
$$;

create function app.idempotency_complete(p_route text, p_key uuid, p_result jsonb)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_actor text := app.actor_id()::text;
begin
  update app.idempotency_record r
     set state = 'succeeded', result = p_result
   where r.actor_key = v_actor and r.route = p_route and r.request_key = p_key
     and r.state = 'processing';
  if not found then
    raise exception using errcode = 'XX000', message = 'no idempotency claim to complete';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Rate limits (FR74, SEC07, DEC70, item 3). Fixed UTC-aligned windows, atomic upsert per
-- (scope, key, window). Keys are 32-byte digests: HMAC from the server for addresses, emails and
-- guests; sha256 of the member id inside app functions. Windows end plus 24 hours (RET12).
create table app.rate_limit_bucket (
  scope text not null,
  key_hash bytea not null,
  window_start timestamptz not null,
  count bigint not null default 0,
  expires_at timestamptz not null,
  primary key (scope, key_hash, window_start),
  constraint rate_limit_scope check (scope ~ '^[A-Za-z0-9:_.-]{1,64}$'),
  constraint rate_limit_key check (octet_length(key_hash) = 32),
  constraint rate_limit_count check (count >= 0)
);
alter table app.rate_limit_bucket enable row level security;

create function app.raise_rate_limited(p_retry_after integer)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'SJ001',
    message = 'RATE_LIMITED',
    detail = pg_catalog.json_build_object('retry_after', p_retry_after)::text;
end;
$$;

-- Start of the current window. The window must divide a day, so windows align to UTC midnight.
create function app.rate_limit_window_start(p_window interval)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_seconds numeric := pg_catalog.date_part('epoch', p_window);
begin
  if v_seconds < 1 or v_seconds > 86400 or 86400 % v_seconds <> 0 then
    raise exception using errcode = 'XX000', message = 'rate limit window must divide a day';
  end if;
  return pg_catalog.date_bin(p_window, app.app_now(), '2000-01-01 00:00:00+00'::timestamptz);
end;
$$;

-- Seconds until the window ends, at least 1 (Retry-After).
create function app.rate_limit_retry_after(p_window_start timestamptz, p_window interval)
returns integer
language sql
stable
set search_path = ''
as $$
  select greatest(1, pg_catalog.ceil(pg_catalog.date_part('epoch', p_window_start + p_window - app.app_now())))::integer
$$;

-- One increment, returning the new count.
create function app.rate_limit_increment(p_scope text, p_key_hash bytea, p_window interval)
returns bigint
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_start timestamptz := app.rate_limit_window_start(p_window);
  v_count bigint;
begin
  insert into app.rate_limit_bucket as b (scope, key_hash, window_start, count, expires_at)
  values (p_scope, p_key_hash, v_start, 1, v_start + p_window + interval '24 hours')
  on conflict (scope, key_hash, window_start) do update set count = b.count + 1
  returning b.count into v_count;
  return v_count;
end;
$$;

-- Success limits, inside the business transaction (internal): over the limit raises
-- RATE_LIMITED, which also rolls the increment back, so only successful operations count.
create function app.rate_limit_take(p_scope text, p_key_hash bytea, p_limit integer, p_window interval)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  if app.rate_limit_increment(p_scope, p_key_hash, p_window) > p_limit then
    perform app.raise_rate_limited(app.rate_limit_retry_after(app.rate_limit_window_start(p_window), p_window));
  end if;
end;
$$;

-- DEC70: failures and attempts (RL01, RL14, RL04...). The server calls this entry point in its
-- own transaction, on its own connection, after the attempt, so the count survives a failed and
-- rolled-back operation. It never raises: it returns 0 within the limit, or the seconds until
-- the window ends once the limit is exceeded.
create function app.rate_limit_hit(p_scope text, p_key_hash bytea, p_limit integer, p_window interval)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if app.rate_limit_increment(p_scope, p_key_hash, p_window) > p_limit then
    return app.rate_limit_retry_after(app.rate_limit_window_start(p_window), p_window);
  end if;
  return 0;
end;
$$;
grant execute on function app.rate_limit_hit(text, bytea, integer, interval) to souq_web;

-- DEC70: read-only check before an attempt (for example a login after 5 failures): 0 when the
-- count is below the limit, otherwise the seconds until the window ends.
create function app.rate_limit_check(p_scope text, p_key_hash bytea, p_limit integer, p_window interval)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := app.rate_limit_window_start(p_window);
  v_count bigint;
begin
  select b.count into v_count from app.rate_limit_bucket b
   where b.scope = p_scope and b.key_hash = p_key_hash and b.window_start = v_start;
  if coalesce(v_count, 0) >= p_limit then
    return app.rate_limit_retry_after(v_start, p_window);
  end if;
  return 0;
end;
$$;
grant execute on function app.rate_limit_check(text, bytea, integer, interval) to souq_web;

-- ---------------------------------------------------------------------------------------------
-- Audit (FR75, chapter 08, items 5 and owner condition). Append-only; deleted only by the
-- RET08 cleanup of the worker after 730 days.
create table app.audit_event (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profile (id),
  action text not null,
  target_type text,
  target_id uuid,
  reason_ref uuid,
  trace_id text,
  occurred_at timestamptz not null default app.app_now(),
  metadata_minimal jsonb not null default '{}'::jsonb,
  constraint audit_action check (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  constraint audit_target_type check (target_type is null or target_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint audit_trace check (trace_id is null or trace_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  constraint audit_metadata_size check (octet_length(metadata_minimal::text) <= 4096)
);
alter table app.audit_event enable row level security;
create index audit_event_occurred on app.audit_event (occurred_at);
create index audit_event_target on app.audit_event (target_type, target_id) where target_id is not null;

-- No update ever, no truncate, and delete only through app.purge_audit_events below, for rows
-- older than 730 days. This holds for postgres too, short of dropping the trigger.
create function app.guard_audit_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and pg_catalog.current_setting('app.audit_purge', true) = 'on'
     and old.occurred_at <= app.app_now() - interval '730 days' then
    return old;
  end if;
  raise exception using errcode = '55000', message = 'app.audit_event is append-only (RET08)';
end;
$$;
create trigger audit_event_append_only
  before update or delete on app.audit_event
  for each row execute function app.guard_audit_event();
create trigger audit_event_no_truncate
  before truncate on app.audit_event
  for each statement execute function app.guard_audit_event();

-- Writes one audit row in the current transaction (internal). The actor comes from the claims
-- when there are any, the trace id from app.trace_id (set by the server with the identity).
create function app.audit(
  p_action text,
  p_target_type text default null,
  p_target_id uuid default null,
  p_reason_ref uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_claims text := pg_catalog.current_setting('request.jwt.claims', true);
  v_actor uuid;
  v_trace text := nullif(pg_catalog.current_setting('app.trace_id', true), '');
  v_id uuid;
begin
  if v_claims is not null and v_claims <> '' then
    v_actor := app.actor_id();
  end if;
  insert into app.audit_event (actor_id, action, target_type, target_id, reason_ref, trace_id, metadata_minimal)
  values (v_actor, p_action, p_target_type, p_target_id, p_reason_ref, v_trace, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

-- RET08 cleanup (owner condition on item 5): the only path that deletes audit rows, for the
-- worker role only. Deletes at most p_limit rows older than 730 days and returns how many.
create function app.purge_audit_events(p_limit integer default 1000)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  perform pg_catalog.set_config('app.audit_purge', 'on', true);
  delete from app.audit_event e
   where e.id in (
     select a.id from app.audit_event a
      where a.occurred_at <= app.app_now() - interval '730 days'
      order by a.occurred_at
      limit greatest(p_limit, 0)
   );
  get diagnostics v_deleted = row_count;
  perform pg_catalog.set_config('app.audit_purge', 'off', true);
  return v_deleted;
end;
$$;
grant execute on function app.purge_audit_events(integer) to souq_worker;

-- ---------------------------------------------------------------------------------------------
-- Background jobs (FR75, section 5 of the addendum, item 6). Created in the business transaction
-- that causes them; claimed, retried and completed by the worker in task 2.5.
create table app.job (
  id bigint generated always as identity primary key,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  status public.job_status not null default 'queued',
  run_at timestamptz not null default app.app_now(),
  attempts integer not null default 0,
  max_attempts integer not null default 10,
  locked_until timestamptz,
  last_error_code text,
  created_at timestamptz not null default app.app_now(),
  updated_at timestamptz not null default app.app_now(),
  completed_at timestamptz,
  constraint job_kind check (kind ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  constraint job_payload_size check (octet_length(payload::text) <= 8192),
  constraint job_dedupe_key check (dedupe_key is null or char_length(dedupe_key) between 1 and 200),
  constraint job_attempts check (attempts >= 0 and max_attempts between 1 and 50),
  constraint job_error_code check (last_error_code is null or last_error_code ~ '^[A-Za-z0-9_.:-]{1,64}$')
);
alter table app.job enable row level security;
create unique index job_dedupe on app.job (dedupe_key) where dedupe_key is not null;
create index job_due on app.job (run_at) where status = 'queued';

-- Queues a job in the current transaction (internal) and returns its id. The same dedupe_key
-- returns the job already kept instead of a second one.
create function app.enqueue_job(
  p_kind text,
  p_payload jsonb default '{}'::jsonb,
  p_dedupe_key text default null,
  p_run_at timestamptz default null
)
returns bigint
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into app.job (kind, payload, dedupe_key, run_at)
  values (p_kind, coalesce(p_payload, '{}'::jsonb), p_dedupe_key, coalesce(p_run_at, app.app_now()))
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  if v_id is null then
    select j.id into v_id from app.job j where j.dedupe_key = p_dedupe_key;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Notifications (FR48, chapter 08, RET07, item 7). No stored destination: the server derives it
-- from the context when reading and checks access again on open.
create table public.notification (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profile (id),
  event_type text not null,
  context_type public.notification_context_type not null,
  context_id uuid not null,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default app.app_now(),
  constraint notification_once unique (recipient_id, dedupe_key),
  constraint notification_event_type check (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  constraint notification_dedupe_key check (char_length(dedupe_key) between 1 and 200)
);
create index notification_recipient_recent on public.notification (recipient_id, created_at desc);
create index notification_recipient_unread on public.notification (recipient_id) where read_at is null;
alter table public.notification enable row level security;
grant select (id, event_type, context_type, context_id, read_at, created_at)
  on public.notification to authenticated;
create policy notification_read_own on public.notification for select to authenticated
  using (recipient_id = (select auth.uid()));

-- Creates the notification once per (recipient, dedupe_key) in the current transaction (internal)
-- and returns its id. Email follows the member's preferences in task 3.8.
create function app.notify(
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
begin
  insert into public.notification (recipient_id, event_type, context_type, context_id, dedupe_key)
  values (p_recipient, p_event_type, p_context_type, p_context_id, p_dedupe_key)
  on conflict (recipient_id, dedupe_key) do nothing
  returning id into v_id;
  if v_id is null then
    select n.id into v_id from public.notification n
     where n.recipient_id = p_recipient and n.dedupe_key = p_dedupe_key;
  end if;
  return v_id;
end;
$$;

-- Email preferences (SEC11, DEC49, DEC65, section 6.3: no locale). All five groups off.
create table public.notification_preference (
  user_id uuid primary key references public.profile (id),
  offers boolean not null default false,
  meetups boolean not null default false,
  deals boolean not null default false,
  reports boolean not null default false,
  reviews boolean not null default false,
  version integer not null default 1,
  updated_at timestamptz not null default app.app_now(),
  constraint notification_preference_version check (version >= 1)
);
alter table public.notification_preference enable row level security;
grant select (user_id, offers, meetups, deals, reports, reviews, version)
  on public.notification_preference to authenticated;
create policy notification_preference_read_own on public.notification_preference for select
  to authenticated using (user_id = (select auth.uid()));

-- Profiles that already exist get their row; new ones get it with the profile (replacing the
-- function of 20261119100000_identity.sql, which itself stays unchanged).
insert into public.notification_preference (user_id)
select p.id from public.profile p
on conflict (user_id) do nothing;

create or replace function app.create_profile_for_auth_user()
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
  insert into public.notification_preference (user_id) values (new.id);
  return new;
end;
$$;
