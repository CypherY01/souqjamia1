-- Task 4.1 (plan/task-4.1.md): the image pipeline. FR17, FR61, FR80, BR06, BR26, DEC08, DEC45,
-- DEC54, DEC83, SEC08, RL09, RET01, NFR10, API037 to API040.
--  1. Three Storage buckets (item 3). No policy on storage.objects: anon and authenticated reach
--     no bucket directly, only through the signed links the server issues (SEC08).
--  2. public.media_asset and public.media_derivative: RLS on and no grant, the server reads
--     through app functions (DEC77).
--  3. app.rate_limit_take_amount(): an amount quota, for RL09's 200 MiB a day.
--  4. Entry points for souq_web: API037 app.authorize_upload(), API038 app.complete_upload(),
--     API039 app.upload_status(), API040 app.delete_upload().
--  5. Entry points for souq_worker: app.media_begin_processing(), app.media_processed(),
--     app.media_rejected() (image.process), app.media_cleanup_claim() and
--     app.media_cleanup_done() (media.cleanup, RET01).
-- The limits are the same as packages/domain/src/media.ts (tests/integration/media-upload.test.ts
-- compares them): 5 MiB = 5,242,880 bytes, 24 megapixels = 24,000,000 pixels (DEC83), JPEG, PNG
-- and WebP only, 60 authorizations an hour and 200 MiB a day per member (RL09).

-- 1. Buckets (item 3):
--  - quarantine: raw uploads, private. Storage refuses a body over 5 MiB or a Content-Type other
--    than the three; the worker checks the real bytes (SEC08).
--  - media-private: the processed master and the variants of every purpose, private.
--  - media-public: public variants of listings (after publication, task 4.2) and avatars (task
--    4.7, DEC54). Empty in task 4.1; a master is never public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('quarantine', 'quarantine', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('media-private', 'media-private', false, 26214400, array['image/webp']),
  ('media-public', 'media-public', true, 5242880, array['image/webp']);

-- 2. One uploaded image (MediaAsset, section 6.2, DEC27, DEC45).
--  - bytes, mime, width and height are what API037 declared; the real ones are on the
--    derivatives. API038 requires the stored object to have exactly the declared size.
--  - upload_expires_at: the five minutes of SEC08 (DEC83, item 2). API038 refuses after it.
--  - expires_at: when an unattached image is deleted (RET01, 24 hours). Later tasks set it to null
--    when they attach the image, and set detached_at and a new expires_at when they detach it.
--  - raw_removed_at: the raw object left the quarantine bucket (media.cleanup, after the upload
--    token's lifetime, DEC83). purged_at: the private derivatives of a deleted image were removed.
create table public.media_asset (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profile (id),
  purpose public.media_purpose not null,
  context_id uuid,
  quarantine_key text not null,
  status public.media_status not null default 'pending',
  bytes integer not null,
  mime text not null,
  width integer not null,
  height integer not null,
  checksum_sha256 bytea,
  rejection_reason public.media_rejection_reason,
  upload_expires_at timestamptz not null,
  expires_at timestamptz,
  detached_at timestamptz,
  processed_at timestamptz,
  raw_removed_at timestamptz,
  purged_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default app.app_now(),
  updated_at timestamptz not null default app.app_now(),
  constraint media_asset_quarantine_key unique (quarantine_key),
  constraint media_asset_quarantine_key_format check (quarantine_key ~ '^[0-9a-f]{32}$'),
  constraint media_asset_bytes check (bytes between 1 and 5242880),
  constraint media_asset_mime check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  constraint media_asset_dimensions
    check (width >= 1 and height >= 1 and width::bigint * height <= 24000000),
  constraint media_asset_context check ((purpose = 'chat') = (context_id is not null)),
  constraint media_asset_checksum
    check (checksum_sha256 is null or octet_length(checksum_sha256) = 32),
  constraint media_asset_uploaded
    check (status in ('pending', 'deleted') or checksum_sha256 is not null),
  constraint media_asset_rejected check (status <> 'rejected' or rejection_reason is not null),
  constraint media_asset_rejection
    check (rejection_reason is null or status in ('rejected', 'deleted')),
  constraint media_asset_ready check (status <> 'ready' or processed_at is not null),
  constraint media_asset_purged check (purged_at is null or status = 'deleted')
);
alter table public.media_asset enable row level security;
comment on table public.media_asset is
  'Task 4.1, SEC08: one uploaded image and its processing state (RLS on, no grant, DEC77).';
create index media_asset_owner on public.media_asset (owner_id, created_at);
create index media_asset_pending_due on public.media_asset (upload_expires_at)
  where status = 'pending';
create index media_asset_expiry on public.media_asset (expires_at)
  where status <> 'deleted' and expires_at is not null;
create index media_asset_raw_due on public.media_asset (created_at) where raw_removed_at is null;
create index media_asset_purge_due on public.media_asset (created_at)
  where status = 'deleted' and purged_at is null;

-- One processed file (MediaDerivative). The private ones are at <media_id>/<variant>.webp in
-- media-private, a fixed key so a repeated job writes the same files (DEC71). A master is never
-- public, and a variant is at most its longest edge (DEC08, no upscaling).
create table public.media_derivative (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null references public.media_asset (id),
  variant public.media_variant not null,
  visibility public.media_visibility not null,
  bucket text not null,
  object_key text not null,
  bytes integer not null,
  sha256 bytea not null,
  width integer not null,
  height integer not null,
  longest_edge integer generated always as (greatest(width, height)) stored,
  created_at timestamptz not null default app.app_now(),
  deleted_at timestamptz,
  constraint media_derivative_once unique (media_id, variant, visibility),
  constraint media_derivative_object unique (bucket, object_key),
  constraint media_derivative_bucket check (
    (visibility = 'private' and bucket = 'media-private')
    or (visibility = 'public' and bucket = 'media-public')
  ),
  constraint media_derivative_master_private check (variant <> 'master' or visibility = 'private'),
  constraint media_derivative_size check (bytes >= 1 and width >= 1 and height >= 1),
  constraint media_derivative_edge check (
    variant = 'master'
    or greatest(width, height) <= case variant when 'w150' then 150 when 'w600' then 600 else 1200 end
  ),
  constraint media_derivative_sha256 check (octet_length(sha256) = 32)
);
alter table public.media_derivative enable row level security;
comment on table public.media_derivative is
  'Task 4.1, DEC08, SEC08: the processed master and variants of an image (RLS on, no grant).';

-- 3. An amount quota (internal): adds p_amount to the window's counter, and over the limit raises
-- RATE_LIMITED, which rolls the addition back, as app.rate_limit_take does for one operation.
create function app.rate_limit_take_amount(
  p_scope text,
  p_key_hash bytea,
  p_amount bigint,
  p_limit bigint,
  p_window interval
)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_start timestamptz := app.rate_limit_window_start(p_window);
  v_count bigint;
begin
  if p_amount is null or p_amount < 1 then
    raise exception using errcode = 'XX000', message = 'rate limit amount must be positive';
  end if;
  insert into app.rate_limit_bucket as b (scope, key_hash, window_start, count, expires_at)
  values (p_scope, p_key_hash, v_start, p_amount, v_start + p_window + interval '24 hours')
  on conflict (scope, key_hash, window_start) do update set count = b.count + p_amount
  returning b.count into v_count;
  if v_count > p_limit then
    perform app.raise_rate_limited(app.rate_limit_retry_after(v_start, p_window));
  end if;
end;
$$;

-- 4a. API037 (FR17, FR61, SEC08, RL09, TC66): a pending image and its unpredictable quarantine
-- path. The server then asks Storage for a create-only upload link to that path, after the
-- commit (DEC72). The declared values are checked again here (every entry point rechecks).
--  - Purposes (item 9): listing, avatar and student_card take no context_id (the avatar's is
--    the member, DEC27's request does not exist yet). chat needs a conversation the member is
--    part of; there is none before task 5.3, which replaces this function.
--  - RL09 after the checks, so a refused request costs nothing: 60 an hour, and 200 MiB a day of
--    declared bytes (item 15). A failed or deleted upload is not given back.
create function app.authorize_upload(
  p_purpose public.media_purpose,
  p_bytes integer,
  p_mime text,
  p_width integer,
  p_height integer,
  p_context_id uuid
)
returns table (media_id uuid, object_name text, deadline timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_member uuid := app.assert_active_member();
  v_now timestamptz := app.app_now();
  v_key_hash bytea;
  v_id uuid;
  v_object text := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
begin
  if p_purpose is null then
    perform app.raise_api_error('VALIDATION_FAILED', 'purpose', 'required');
  end if;
  if p_purpose = 'chat' then
    perform app.raise_api_error('VALIDATION_FAILED', 'context_id', 'not_found');
  end if;
  if p_context_id is not null then
    perform app.raise_api_error('VALIDATION_FAILED', 'context_id', 'not_allowed');
  end if;
  if p_mime is null or p_mime not in ('image/jpeg', 'image/png', 'image/webp') then
    perform app.raise_api_error('VALIDATION_FAILED', 'mime', 'invalid_value');
  end if;
  if p_bytes is null or p_bytes < 1 then
    perform app.raise_api_error('VALIDATION_FAILED', 'bytes', 'too_small');
  end if;
  if p_bytes > 5242880 then
    perform app.raise_api_error('VALIDATION_FAILED', 'bytes', 'too_big');
  end if;
  if p_width is null or p_width < 1 then
    perform app.raise_api_error('VALIDATION_FAILED', 'width', 'too_small');
  end if;
  if p_height is null or p_height < 1 then
    perform app.raise_api_error('VALIDATION_FAILED', 'height', 'too_small');
  end if;
  if p_width::bigint * p_height > 24000000 then
    perform app.raise_api_error('VALIDATION_FAILED', 'width', 'too_many_pixels');
  end if;

  v_key_hash := pg_catalog.sha256(pg_catalog.convert_to(v_member::text, 'UTF8'));
  perform app.rate_limit_take('RL09:hour', v_key_hash, 60, '1 hour');
  perform app.rate_limit_take_amount('RL09:bytes', v_key_hash, p_bytes, 209715200, '1 day');

  insert into public.media_asset
    (owner_id, purpose, quarantine_key, bytes, mime, width, height, upload_expires_at, expires_at)
  values
    (v_member, p_purpose, v_object, p_bytes, p_mime, p_width, p_height,
     v_now + interval '5 minutes', v_now + interval '24 hours')
  returning id into v_id;

  return query select v_id, v_object, v_now + interval '5 minutes';
end;
$$;
comment on function app.authorize_upload(public.media_purpose, integer, text, integer, integer, uuid) is
  'Task 4.1, API037, SEC08, RL09: a pending upload with its quarantine path and five-minute deadline.';
grant execute on function app.authorize_upload(public.media_purpose, integer, text, integer, integer, uuid)
  to souq_web;

-- 4b. API038 (FR61, SEC08, DEC83, TC32, TC66): the owner says the bytes are uploaded. The client's
-- claim does not make the image ready: this only queues image.process.
--  - Another member's image, an unknown one or a deleted one: NOT_FOUND (no disclosure).
--  - Already announced: the same checksum changes nothing (the route answers with the current
--    state), another checksum is STATE_CONFLICT.
--  - After the five minutes: DEADLINE_PASSED (DEC83).
--  - expected_size must be the declared size, and the object must be in the quarantine bucket
--    with that size, created before the deadline. No object yet: STATE_CONFLICT.
create function app.complete_upload(p_id uuid, p_checksum bytea, p_expected_size integer)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_member uuid := app.assert_active_member();
  v_now timestamptz := app.app_now();
  v_owner uuid;
  v_status public.media_status;
  v_checksum bytea;
  v_bytes integer;
  v_key text;
  v_deadline timestamptz;
  v_object_size bigint;
  v_object_created timestamptz;
begin
  if p_checksum is null or octet_length(p_checksum) <> 32 then
    perform app.raise_api_error('VALIDATION_FAILED', 'checksum_sha256', 'invalid_format');
  end if;
  select a.owner_id, a.status, a.checksum_sha256, a.bytes, a.quarantine_key, a.upload_expires_at
    into v_owner, v_status, v_checksum, v_bytes, v_key, v_deadline
    from public.media_asset a
   where a.id = p_id
     for update;
  if v_owner is null or v_owner <> v_member or v_status = 'deleted' then
    perform app.raise_api_error('NOT_FOUND');
  end if;
  if v_status <> 'pending' then
    if v_checksum = p_checksum then
      return;
    end if;
    perform app.raise_api_error('STATE_CONFLICT');
  end if;
  if v_now > v_deadline then
    perform app.raise_api_error('DEADLINE_PASSED');
  end if;
  if p_expected_size is distinct from v_bytes then
    perform app.raise_api_error('VALIDATION_FAILED', 'expected_size', 'mismatch');
  end if;

  select (o.metadata ->> 'size')::bigint, o.created_at
    into v_object_size, v_object_created
    from storage.objects o
   where o.bucket_id = 'quarantine' and o.name = v_key;
  if v_object_created is null then
    perform app.raise_api_error('STATE_CONFLICT');
  end if;
  if v_object_created > v_deadline then
    perform app.raise_api_error('DEADLINE_PASSED');
  end if;
  if v_object_size is distinct from v_bytes::bigint then
    perform app.raise_api_error('VALIDATION_FAILED', 'expected_size', 'mismatch');
  end if;

  update public.media_asset a
     set status = 'uploaded',
         checksum_sha256 = p_checksum,
         version = a.version + 1,
         updated_at = v_now
   where a.id = p_id;
  perform app.enqueue_job(
    'image.process',
    pg_catalog.jsonb_build_object('media_id', p_id),
    'image.process:' || p_id::text
  );
end;
$$;
comment on function app.complete_upload(uuid, bytea, integer) is
  'Task 4.1, API038, SEC08, DEC83: checks the uploaded object and queues image.process.';
grant execute on function app.complete_upload(uuid, bytea, integer) to souq_web;

-- 4c. API039 (FR80): the session member's own image and its state, deleted ones included so the
-- owner sees that an upload expired. Another member's image or an unknown id: no row (the route
-- answers NOT_FOUND). The context party of a chat image comes with task 5.3.
-- preview_key is the private w600 file once ready, which the server signs for 60 seconds, and
-- null for a student card (DEC83, item 10: only staff reach card images).
create function app.upload_status(p_id uuid)
returns table (
  media_id uuid,
  media_purpose public.media_purpose,
  media_status public.media_status,
  reason public.media_rejection_reason,
  created timestamptz,
  expires timestamptz,
  preview_key text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member uuid := app.member_read_actor();
begin
  return query
  select a.id, a.purpose, a.status, a.rejection_reason, a.created_at, a.expires_at,
         case when a.status = 'ready' and a.purpose <> 'student_card' then
           (select d.object_key
              from public.media_derivative d
             where d.media_id = a.id
               and d.variant = 'w600'
               and d.visibility = 'private'
               and d.deleted_at is null)
         end
    from public.media_asset a
   where a.id = p_id
     and a.owner_id = v_member;
end;
$$;
comment on function app.upload_status(uuid) is
  'Task 4.1, API039, FR80: the session member''s own upload state and its private preview key.';
grant execute on function app.upload_status(uuid) to souq_web;

-- 4d. API040 (FR61, FR73): the owner removes an unattached image. An attached one (expires_at is
-- null, set by the tasks that attach) is STATE_CONFLICT: never a historical attachment. Deleting a
-- deleted image changes nothing. The files are removed by media.cleanup; an image.process job
-- still running finds the image deleted and changes nothing.
create function app.delete_upload(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_member uuid := app.assert_active_member();
  v_now timestamptz := app.app_now();
  v_owner uuid;
  v_status public.media_status;
  v_expires timestamptz;
begin
  select a.owner_id, a.status, a.expires_at
    into v_owner, v_status, v_expires
    from public.media_asset a
   where a.id = p_id
     for update;
  if v_owner is null or v_owner <> v_member then
    perform app.raise_api_error('NOT_FOUND');
  end if;
  if v_status = 'deleted' then
    return;
  end if;
  if v_expires is null then
    perform app.raise_api_error('STATE_CONFLICT');
  end if;
  update public.media_asset a
     set status = 'deleted',
         expires_at = v_now,
         version = a.version + 1,
         updated_at = v_now
   where a.id = p_id;
end;
$$;
comment on function app.delete_upload(uuid) is
  'Task 4.1, API040: deletes the session member''s own unattached upload.';
grant execute on function app.delete_upload(uuid) to souq_web;

-- 5a. image.process, step 1 (DEC71): an uploaded image (or one a previous attempt left in
-- processing) becomes processing, and its declared values come back for the checks. Any other
-- state returns no row: nothing to do, which is a success.
create function app.media_begin_processing(p_id uuid)
returns table (
  media_purpose public.media_purpose,
  declared_mime text,
  declared_bytes integer,
  checksum bytea,
  object_name text
)
language sql
volatile
security definer
set search_path = ''
as $$
  update public.media_asset a
     set status = 'processing',
         version = a.version + case when a.status = 'uploaded' then 1 else 0 end,
         updated_at = app.app_now()
   where a.id = p_id
     and a.status in ('uploaded', 'processing')
  returning a.purpose, a.mime, a.bytes, a.checksum_sha256, a.quarantine_key
$$;
comment on function app.media_begin_processing(uuid) is
  'Task 4.1, SEC08, DEC71: marks an uploaded image processing and returns what the worker checks.';
grant execute on function app.media_begin_processing(uuid) to souq_worker;

-- 5b. image.process, last step: the derivatives are stored, the image is ready. p_derivatives is a
-- JSON array of {variant, bytes, sha256 (hex), width, height}; the keys are fixed here
-- (<media_id>/<variant>.webp in media-private), never taken from the worker. A student card has
-- the master only (DEC45); every other purpose has the master and the three variants (DEC08).
-- An image no longer processing (deleted meanwhile, or done by an earlier attempt) changes
-- nothing and returns false.
create function app.media_processed(p_id uuid, p_derivatives jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.app_now();
  v_status public.media_status;
  v_purpose public.media_purpose;
  v_variants text[];
  v_expected text[];
begin
  select a.status, a.purpose into v_status, v_purpose
    from public.media_asset a
   where a.id = p_id
     for update;
  if v_status is distinct from 'processing' then
    return false;
  end if;

  v_expected := case when v_purpose = 'student_card'
    then array['master']
    else array['master', 'w1200', 'w150', 'w600']
  end;
  select pg_catalog.array_agg(e.value ->> 'variant' order by e.value ->> 'variant')
    into v_variants
    from pg_catalog.jsonb_array_elements(p_derivatives) e;
  if v_variants is distinct from v_expected then
    raise exception using errcode = 'XX000', message = 'media_processed: wrong derivative set';
  end if;

  insert into public.media_derivative
    (media_id, variant, visibility, bucket, object_key, bytes, sha256, width, height)
  select p_id,
         (e.value ->> 'variant')::public.media_variant,
         'private',
         'media-private',
         p_id::text || '/' || (e.value ->> 'variant') || '.webp',
         (e.value ->> 'bytes')::integer,
         pg_catalog.decode(e.value ->> 'sha256', 'hex'),
         (e.value ->> 'width')::integer,
         (e.value ->> 'height')::integer
    from pg_catalog.jsonb_array_elements(p_derivatives) e
  on conflict on constraint media_derivative_once do nothing;

  update public.media_asset a
     set status = 'ready',
         processed_at = v_now,
         version = a.version + 1,
         updated_at = v_now
   where a.id = p_id;
  return true;
end;
$$;
comment on function app.media_processed(uuid, jsonb) is
  'Task 4.1, FR61, DEC08, DEC45: records the private derivatives and makes the image ready.';
grant execute on function app.media_processed(uuid, jsonb) to souq_worker;

-- 5c. image.process: the image itself is refused (type, size, pixels, animation, corrupt bytes),
-- or a third failed attempt ended it as processing_failed (DEC83). Only an image still uploaded or
-- processing changes; returns whether it did.
create function app.media_rejected(p_id uuid, p_reason public.media_rejection_reason)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.app_now();
  v_count integer;
begin
  if p_reason is null then
    raise exception using errcode = 'XX000', message = 'media_rejected: reason required';
  end if;
  update public.media_asset a
     set status = 'rejected',
         rejection_reason = p_reason,
         version = a.version + 1,
         updated_at = v_now
   where a.id = p_id
     and a.status in ('uploaded', 'processing');
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;
comment on function app.media_rejected(uuid, public.media_rejection_reason) is
  'Task 4.1, SEC08, FR80, DEC83: marks an uploaded image rejected with a safe reason.';
grant execute on function app.media_rejected(uuid, public.media_rejection_reason) to souq_worker;

-- 5d. media.cleanup (RET01, DEC83, DEC71), step 1: state changes, then the files to remove.
--  - A pending image past its five minutes is deleted (it can no longer be announced).
--  - An unattached image past expires_at (24 hours) is deleted, whatever its state, so an image
--    stuck in processing does not stay forever.
--  - raw_due: the raw object leaves the quarantine bucket once the upload token can no longer
--    create it again (two hours, plus five minutes of margin, DEC83) and processing is over.
--  - purge_due: a deleted image's private files at <media_id>/<variant>.webp. The keys are
--    fixed, so the worker removes all four, missing files included (a success, DEC71).
-- Each step handles at most p_limit images; the next run continues.
create function app.media_cleanup_claim(p_limit integer)
returns table (media_id uuid, object_name text, raw_due boolean, purge_due boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.app_now();
  v_raw_before timestamptz := app.app_now() - interval '2 hours 5 minutes';
  v_limit integer := pg_catalog.int4larger(pg_catalog.int4smaller(coalesce(p_limit, 100), 500), 1);
begin
  update public.media_asset a
     set status = 'deleted', version = a.version + 1, updated_at = v_now
   where a.id in (
     select p.id from public.media_asset p
      where p.status = 'pending' and p.upload_expires_at < v_now
      order by p.upload_expires_at
      limit v_limit
   );
  update public.media_asset a
     set status = 'deleted', version = a.version + 1, updated_at = v_now
   where a.id in (
     select x.id from public.media_asset x
      where x.status <> 'deleted' and x.expires_at is not null and x.expires_at < v_now
      order by x.expires_at
      limit v_limit
   );

  return query
  select a.id,
         a.quarantine_key,
         (a.raw_removed_at is null
           and a.created_at <= v_raw_before
           and a.status not in ('uploaded', 'processing')),
         (a.status = 'deleted' and a.purged_at is null)
    from public.media_asset a
   where (a.raw_removed_at is null
           and a.created_at <= v_raw_before
           and a.status not in ('uploaded', 'processing'))
      or (a.status = 'deleted' and a.purged_at is null)
   order by a.created_at
   limit v_limit;
end;
$$;
comment on function app.media_cleanup_claim(integer) is
  'Task 4.1, RET01, DEC83: deletes expired images and returns the files media.cleanup removes.';
grant execute on function app.media_cleanup_claim(integer) to souq_worker;

-- 5e. media.cleanup, step 2: the worker removed these files. Recording twice changes nothing.
create function app.media_cleanup_done(p_raw uuid[], p_purged uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.app_now();
  v_raw integer;
  v_purged integer;
begin
  update public.media_asset a
     set raw_removed_at = v_now
   where a.id = any (coalesce(p_raw, '{}'::uuid[]))
     and a.raw_removed_at is null;
  get diagnostics v_raw = row_count;

  update public.media_asset a
     set purged_at = v_now
   where a.id = any (coalesce(p_purged, '{}'::uuid[]))
     and a.status = 'deleted'
     and a.purged_at is null;
  get diagnostics v_purged = row_count;

  update public.media_derivative d
     set deleted_at = v_now
   where d.media_id = any (coalesce(p_purged, '{}'::uuid[]))
     and d.visibility = 'private'
     and d.deleted_at is null
     and exists (
       select 1 from public.media_asset a where a.id = d.media_id and a.status = 'deleted'
     );

  return v_raw + v_purged;
end;
$$;
comment on function app.media_cleanup_done(uuid[], uuid[]) is
  'Task 4.1, RET01, DEC71: records the raw and private files media.cleanup removed.';
grant execute on function app.media_cleanup_done(uuid[], uuid[]) to souq_worker;
