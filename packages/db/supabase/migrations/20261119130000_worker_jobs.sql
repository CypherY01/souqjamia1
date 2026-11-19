-- Background worker (task 2.5, plan/task-2.5.md): FR75, OPS03, SEC02, TC69, DEC71, RET08.
-- Entry points for souq_worker claim, complete and fail the jobs of app.job (task 2.4) and queue
-- the jobs of recurring schedules. A job is claimed in a short transaction and run outside it,
-- under a five-minute lease. Delivery is at least once (DEC71): a job whose worker stopped, or
-- whose lease ran out, is claimed again, so every handler must be idempotent.
-- souq_web gets one read-only entry point: the queue health for /readyz (task 2.4, item 8).

-- Running jobs by lease end, to resume work after a worker stopped (TC69).
create index job_lease on app.job (locked_until) where status = 'running';
-- Recently dead jobs, for the queue health check.
create index job_dead_recent on app.job (completed_at) where status = 'dead';

-- Time limits for the worker's own sessions (item 11). They apply when souq_worker logs in, so a
-- stuck statement or a forgotten open transaction cannot hold locks for long.
alter role souq_worker set statement_timeout = '30s';
alter role souq_worker set idle_in_transaction_session_timeout = '60s';

-- OPS03: wait after a failed attempt. One minute, then 5, then 15, then 60 minutes for every
-- later attempt (item 2). The tenth failed attempt is dead, so the longest wait is used six times.
create function app.job_retry_delay(p_attempt integer)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case
    when p_attempt <= 1 then interval '1 minute'
    when p_attempt = 2 then interval '5 minutes'
    when p_attempt = 3 then interval '15 minutes'
    else interval '60 minutes'
  end
$$;

-- Claims up to p_limit due jobs of the given kinds (item 4: a worker never claims a kind it does
-- not know, so an older worker leaves a newer kind queued, TC69). Due means queued with run_at
-- reached, or running with an expired lease and attempts left (a resumed job). SKIP LOCKED: two
-- workers never claim the same job and never wait for each other. The attempt is counted here
-- (item 1), so a job that stops its worker every time still ends dead after max_attempts; the
-- returned attempt number fences complete_job and fail_job against a worker whose lease ran out.
create function app.claim_jobs(p_kinds text[], p_limit integer)
returns table (job_id bigint, job_kind text, job_payload jsonb, job_attempt integer, job_max_attempts integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.app_now();
begin
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception using errcode = 'XX000', message = 'claim limit must be between 1 and 20';
  end if;
  return query
  with due as (
    select j.id
      from app.job j
     where j.kind = any (p_kinds)
       and ((j.status = 'queued' and j.run_at <= v_now)
         or (j.status = 'running' and j.locked_until <= v_now and j.attempts < j.max_attempts))
     order by j.run_at, j.id
     limit p_limit
     for update skip locked
  )
  update app.job j
     set status = 'running',
         attempts = j.attempts + 1,
         locked_until = v_now + interval '5 minutes',
         updated_at = v_now
    from due
   where j.id = due.id
  returning j.id, j.kind, j.payload, j.attempts, j.max_attempts;
end;
$$;
grant execute on function app.claim_jobs(text[], integer) to souq_worker;

-- Marks the claimed attempt done. False when the job is no longer this attempt's (its lease ran
-- out and another worker claimed it): the caller logs job.lease_lost.
create function app.complete_job(p_id bigint, p_attempt integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.app_now();
begin
  update app.job j
     set status = 'done', locked_until = null, completed_at = v_now, updated_at = v_now
   where j.id = p_id and j.status = 'running' and j.attempts = p_attempt;
  return found;
end;
$$;
grant execute on function app.complete_job(bigint, integer) to souq_worker;

-- Records a failed attempt (item 3). Retryable with attempts left: queued again after the OPS03
-- delay. Permanent, or the last attempt: dead. Returns the new status and, when queued, the next
-- run time; no row when the job is no longer this attempt's.
create function app.fail_job(p_id bigint, p_attempt integer, p_error_code text, p_retryable boolean)
returns table (job_status public.job_status, retry_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.app_now();
  v_attempts integer;
  v_max integer;
begin
  select j.attempts, j.max_attempts into v_attempts, v_max
    from app.job j
   where j.id = p_id and j.status = 'running' and j.attempts = p_attempt
     for update;
  if not found then
    return;
  end if;
  if p_retryable and v_attempts < v_max then
    retry_at := v_now + app.job_retry_delay(v_attempts);
    update app.job j
       set status = 'queued', run_at = retry_at, locked_until = null,
           last_error_code = p_error_code, updated_at = v_now
     where j.id = p_id;
    job_status := 'queued';
  else
    update app.job j
       set status = 'dead', locked_until = null, last_error_code = p_error_code,
           completed_at = v_now, updated_at = v_now
     where j.id = p_id;
    job_status := 'dead';
    retry_at := null;
  end if;
  return next;
end;
$$;
grant execute on function app.fail_job(bigint, integer, text, boolean) to souq_worker;

-- A job whose lease ran out on its last attempt is dead (LEASE_EXPIRED) instead of being claimed
-- an extra time. Returns those jobs so the worker logs job.dead for each (item 8).
create function app.reap_expired_jobs()
returns table (job_id bigint, job_kind text, job_attempts integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.app_now();
begin
  return query
  with expired as (
    select j.id
      from app.job j
     where j.status = 'running' and j.locked_until <= v_now and j.attempts >= j.max_attempts
     for update skip locked
  )
  update app.job j
     set status = 'dead', last_error_code = 'LEASE_EXPIRED', locked_until = null,
         completed_at = v_now, updated_at = v_now
    from expired
   where j.id = expired.id
  returning j.id, j.kind, j.attempts;
end;
$$;
grant execute on function app.reap_expired_jobs() to souq_worker;

-- Queues the job of the current period of a recurring schedule (item 6). Periods are fixed UTC
-- slots that divide a day, like the rate limit windows, so a daily job starts at 00:00 UTC. The
-- dedupe key names the slot: any number of workers and restarts create one job per slot, and a
-- worker that was down creates the current slot only.
create function app.schedule_job(p_kind text, p_every interval)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_seconds numeric := pg_catalog.date_part('epoch', p_every);
  v_slot timestamptz;
begin
  if v_seconds is null or v_seconds < 60 or v_seconds > 86400 or 86400 % v_seconds <> 0 then
    raise exception using errcode = 'XX000', message = 'schedule period must divide a day and be at least a minute';
  end if;
  v_slot := pg_catalog.date_bin(p_every, app.app_now(), '2000-01-01 00:00:00+00'::timestamptz);
  return app.enqueue_job(
    p_kind,
    '{}'::jsonb,
    'schedule:' || p_kind || ':' || pg_catalog.to_char(v_slot at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'),
    v_slot
  );
end;
$$;
grant execute on function app.schedule_job(text, interval) to souq_worker;

-- Queue health for /readyz (task 2.4, item 8), wired in task 3.1: the age in seconds of the
-- oldest due job (0 when none is due) and the number of jobs that died in the last 24 hours.
-- Counts only, never payloads.
create function app.job_queue_health()
returns table (oldest_due_seconds integer, dead_last_24h integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((
      select pg_catalog.ceil(pg_catalog.date_part('epoch', app.app_now() - pg_catalog.min(d.due_at)))::integer
        from (
          select j.run_at as due_at from app.job j
           where j.status = 'queued' and j.run_at <= app.app_now()
          union all
          select j.locked_until from app.job j
           where j.status = 'running' and j.locked_until <= app.app_now()
        ) d
    ), 0),
    (select pg_catalog.count(*)::integer from app.job j
      where j.status = 'dead' and j.completed_at > app.app_now() - interval '24 hours')
$$;
grant execute on function app.job_queue_health() to souq_web;
