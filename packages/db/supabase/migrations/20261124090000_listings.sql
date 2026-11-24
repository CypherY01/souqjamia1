-- Task 4.2 (plan/task-4.2.md): the listing publication wizard. FR16 to FR22, FR60, BR04 to BR08,
-- DEC04 to DEC08, DEC28, DEC67, RL05, SEC08, NFR09, API030, API034.
--  1. pg_trgm in schema extensions, for the search copy of section 6.3 (item 7).
--  2. public.listing and public.listing_image: RLS on, no grant and no policy (item 11). The
--     server reads them through app functions (DEC77).
--  3. Reads for souq_web: app.active_categories() and app.active_meeting_points() (API030),
--     app.owner_listing() and app.owner_listing_images() (API034's answer).
--  4. API034: app.publish_listing() for souq_web.
--  5. media.publish for souq_worker (SEC08, item 6): app.media_publish_files() and
--     app.media_published().
-- The limits are the same as packages/domain/src/listing.ts (tests/integration/listings-publish.test.ts
-- compares them): title 5 to 100 and description 10 to 2000 code points after NFC and trim
-- (DEC04), price 0 to 5,000,000 halalas (DEC05), 1 to 10 images (DEC08), 200 active listings,
-- 5 publications an hour and 20 a day (RL05).

-- 1. pg_trgm (section 6.3, R29). Supabase keeps extensions in their own schema; with
-- search_path = '' its operators and classes are written with it (extensions.gin_trgm_ops).
create extension if not exists pg_trgm with schema extensions;

-- 2a. One listing (chapter 08 Listing, DEC28: the meeting point is optional, null shows
-- «حسب الاتفاق»). The lifecycle columns exist now because OwnerListing returns them; their
-- transition rules come with task 4.4.
--  - title and description are stored normalized (NFC and outer trim, as display_name), with
--    their line breaks and digits as typed (DEC50). The title is one line; the description keeps
--    LF and TAB and nothing else below U+0020 (the server turns CR LF and CR into LF first).
--  - search_text: the search copy of section 6.3 and DEC67, computed by the database so it can
--    never drift from the text. Displayed text is never the search copy.
create table public.listing (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profile (id),
  category_id uuid not null references public.category (id),
  location_id uuid references public.meeting_point (id),
  title text not null,
  description text not null,
  condition public.item_condition not null,
  price_minor integer not null,
  currency char(3) not null default 'SAR',
  is_negotiable boolean not null,
  status public.listing_status not null default 'active',
  previous_status public.listing_status,
  archive_reason public.archive_reason,
  sold_at timestamptz,
  archived_at timestamptz,
  moderation_hidden_at timestamptz,
  search_text text generated always as (app.search_normalize(title || ' ' || description)) stored,
  version integer not null default 1,
  created_at timestamptz not null default app.app_now(),
  updated_at timestamptz not null default app.app_now(),
  constraint listing_title_rules check (
    title = app.normalize_text(title)
    and pg_catalog.char_length(title) between 5 and 100
    and title !~ U&'[!0001-!001F!007F-!009F!202A-!202E!2066-!2069]' uescape '!'
  ),
  constraint listing_description_rules check (
    description = app.normalize_text(description)
    and pg_catalog.char_length(description) between 10 and 2000
    and description !~ U&'[!0001-!0008!000B-!001F!007F-!009F!202A-!202E!2066-!2069]' uescape '!'
  ),
  constraint listing_price_range check (price_minor between 0 and 5000000),
  constraint listing_currency check (currency = 'SAR'),
  -- BR08, DEC06: a free item has no negotiation.
  constraint listing_free_not_negotiable check (price_minor > 0 or not is_negotiable),
  constraint listing_version_positive check (version >= 1)
);
alter table public.listing enable row level security;
comment on table public.listing is
  'Task 4.2, FR16, DEC28: one listing and its lifecycle (RLS on, no grant, DEC77).';
-- Section 6.3: approximate text matching (task 4.3 writes the queries, with their sort indexes).
create index listing_search_trgm on public.listing using gin (search_text extensions.gin_trgm_ops);
-- RL05: the count of a member's active listings.
create index listing_seller_active on public.listing (seller_id) where status = 'active';

-- 2b. The ordered images of a listing (chapter 08 ListingImage). An image belongs to one listing
-- only (media_id unique: a listing image has no context_id, media_asset_context), and position 1
-- is the primary image. Ten at most from the key and the position check.
create table public.listing_image (
  listing_id uuid not null references public.listing (id),
  media_id uuid not null references public.media_asset (id),
  position smallint not null,
  created_at timestamptz not null default app.app_now(),
  constraint listing_image_pkey primary key (listing_id, position),
  constraint listing_image_media_once unique (media_id),
  constraint listing_image_position check (position between 1 and 10)
);
alter table public.listing_image enable row level security;
comment on table public.listing_image is
  'Task 4.2, BR06: the ordered images of a listing, one listing per image (RLS on, no grant).';

-- BR06: a listing has at least one image when the transaction commits, so a later edit (task
-- 4.4) cannot leave one without images. Deferred, because the listing row comes before its images.
-- It reads the tables, so it is security definer with no grant (a deferred trigger runs at commit).
create function app.listing_images_required()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing uuid;
begin
  if tg_table_name = 'listing' then
    v_listing := new.id;
  else
    v_listing := old.listing_id;
  end if;
  if exists (select 1 from public.listing l where l.id = v_listing)
    and not exists (select 1 from public.listing_image i where i.listing_id = v_listing) then
    raise exception using
      errcode = '23514',
      message = 'a listing needs at least one image',
      constraint = 'listing_images_required';
  end if;
  return null;
end;
$$;
comment on function app.listing_images_required() is
  'Task 4.2, BR06: deferred check that every listing keeps at least one image.';
create constraint trigger listing_images_required_on_listing
  after insert on public.listing
  deferrable initially deferred
  for each row execute function app.listing_images_required();
create constraint trigger listing_images_required_on_image
  after update or delete on public.listing_image
  deferrable initially deferred
  for each row execute function app.listing_images_required();

-- 3a. API030 (FR08, FR20, FR55): the pick lists. Active rows only, in display order; the reads of
-- task 2.3 keep inactive ones for old listings (TC80). Public: no session needed.
create function app.active_categories()
returns table (id uuid, key public.category_key, label_ar text, label_en text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.key, c.label_ar, c.label_en
    from public.category c
   where c.is_active
   order by c.display_order, c.label_ar, c.id
$$;
comment on function app.active_categories() is
  'Task 4.2, API030: active categories for pick lists, in display order.';
grant execute on function app.active_categories() to souq_web;

-- DEC28: suggested public places, inside the university and in the city. The list may be empty
-- (G02: the owner adds them from the admin area, task 7.7); «حسب الاتفاق» then stays the only
-- choice and publication still works (owner note 1 on task 4.2).
create function app.active_meeting_points()
returns table (id uuid, key text, kind public.meeting_point_kind, label_ar text, label_en text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.key, m.kind, m.label_ar, m.label_en
    from public.meeting_point m
   where m.is_active
   order by m.kind, m.display_order, m.label_ar, m.id
$$;
comment on function app.active_meeting_points() is
  'Task 4.2, API030, DEC28: active suggested meeting points, by kind and display order.';
grant execute on function app.active_meeting_points() to souq_web;

-- 3b. API034's answer (OwnerListing): the session member's own listing, or no row (another
-- member's listing, an unknown id). The labels of the category and the meeting point come with
-- it, active or not (TC80).
create function app.owner_listing(p_id uuid)
returns table (
  listing_id uuid,
  title text,
  description text,
  category_id uuid,
  category_key public.category_key,
  category_label_ar text,
  category_label_en text,
  location_id uuid,
  location_key text,
  location_kind public.meeting_point_kind,
  location_label_ar text,
  location_label_en text,
  condition public.item_condition,
  price_minor integer,
  is_negotiable boolean,
  status public.listing_status,
  previous_status public.listing_status,
  archive_reason public.archive_reason,
  sold_at timestamptz,
  archived_at timestamptz,
  moderation_hidden boolean,
  version integer,
  created_at timestamptz,
  updated_at timestamptz
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
  select l.id, l.title, l.description,
         c.id, c.key, c.label_ar, c.label_en,
         m.id, m.key, m.kind, m.label_ar, m.label_en,
         l.condition, l.price_minor, l.is_negotiable, l.status, l.previous_status,
         l.archive_reason, l.sold_at, l.archived_at, l.moderation_hidden_at is not null,
         l.version, l.created_at, l.updated_at
    from public.listing l
    join public.category c on c.id = l.category_id
    left join public.meeting_point m on m.id = l.location_id
   where l.id = p_id
     and l.seller_id = v_member;
end;
$$;
comment on function app.owner_listing(uuid) is
  'Task 4.2, API034: the session member''s own listing (OwnerListing), or no row.';
grant execute on function app.owner_listing(uuid) to souq_web;

-- The images of the session member's own listing, in position order. public_ready: the three
-- public variants exist (media.publish has run), so the server may build their public URLs;
-- before that the answer has image null (owner note 2 on task 4.2: "images being prepared").
create function app.owner_listing_images(p_id uuid)
returns table (media_id uuid, image_position smallint, public_ready boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member uuid := app.member_read_actor();
begin
  return query
  select i.media_id, i.position,
         (select pg_catalog.count(*)
            from public.media_derivative d
           where d.media_id = i.media_id
             and d.visibility = 'public'
             and d.deleted_at is null
             and d.variant in ('w150', 'w600', 'w1200')) = 3
    from public.listing_image i
    join public.listing l on l.id = i.listing_id
   where i.listing_id = p_id
     and l.seller_id = v_member
   order by i.position;
end;
$$;
comment on function app.owner_listing_images(uuid) is
  'Task 4.2, API034: the images of the session member''s own listing and whether they are public.';
grant execute on function app.owner_listing_images(uuid) to souq_web;

-- 4. API034 (FR16 to FR22, BR05 to BR08, DEC28, RL05, TC07, TC08, TC09, TC25, TC65). The server
-- has already checked the body with the rules of @souq/domain (all field errors at once); this
-- checks everything again (every entry point rechecks) and raises the first problem.
-- Order (items 8 and 9):
--  1. app.assert_active_member(): session, deletion, restriction, email, current terms (TC25).
--  2. The structure: the contract's ListingInput keys and types, else BAD_REQUEST.
--  3. app.idempotency_claim(): a succeeded attempt with the same key returns its listing (200)
--     and costs nothing; another payload is IDEMPOTENCY_CONFLICT (FR22, TC09). A failed attempt
--     rolls its claim back, so the same key can be sent again after a correction.
--  4. RL05: 5 an hour and 20 a day, counters shared with wanted requests (task 4.6).
--  5. The seller's profile row is locked, then the active listings counted: two publications
--     at once cannot pass 200 (LIMIT_REACHED). A listing hidden by moderation is still active.
--  6. The fields again, with the reference rows: an inactive category or meeting point is
--     VALIDATION_FAILED with the field code unavailable (item 5).
--  7. The images, locked in id order: unknown, another member's, another purpose, attached,
--     rejected, deleted or expired is MEDIA_INVALID; not processed yet is MEDIA_NOT_READY. The
--     field is media_ids.<index>, 0-based as the server's field errors.
--  8. The listing, its images in the given order, expires_at null on each image (the attach
--     rule in packages/db/README.md), and media.publish queued (SEC08: public copies only after
--     the commit). No audit and no notification (item 10).
create function app.publish_listing(p_key uuid, p_input jsonb)
returns table (listing_id uuid, created boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_member uuid := app.assert_active_member();
  v_now timestamptz := app.app_now();
  v_route constant text := 'POST /api/listings';
  v_prior jsonb;
  v_key_hash bytea;
  v_active bigint;
  v_title text;
  v_description text;
  v_category uuid;
  v_location uuid;
  v_condition public.item_condition;
  v_price integer;
  v_negotiable boolean;
  v_media uuid[];
  v_count integer;
  v_row record;
  v_id uuid;
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  -- 2. Structure (ListingInput, additionalProperties false).
  if p_key is null or p_input is null or pg_catalog.jsonb_typeof(p_input) <> 'object'
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_input) k
       where k not in ('title', 'description', 'category_id', 'condition', 'location_id',
                       'price_minor', 'is_negotiable', 'media_ids')
    )
    or pg_catalog.jsonb_typeof(p_input -> 'title') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_input -> 'description') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_input -> 'category_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_input -> 'condition') is distinct from 'string'
    or coalesce(pg_catalog.jsonb_typeof(p_input -> 'location_id'), 'null') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_input -> 'price_minor') is distinct from 'number'
    or pg_catalog.jsonb_typeof(p_input -> 'is_negotiable') is distinct from 'boolean'
    or pg_catalog.jsonb_typeof(p_input -> 'media_ids') is distinct from 'array' then
    perform app.raise_api_error('BAD_REQUEST');
  end if;
  if (p_input ->> 'price_minor')::numeric <> pg_catalog.trunc((p_input ->> 'price_minor')::numeric)
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_input -> 'media_ids') e
       where pg_catalog.jsonb_typeof(e) <> 'string'
    ) then
    perform app.raise_api_error('BAD_REQUEST');
  end if;

  -- 3. FR22: a logical retry returns the same listing.
  v_prior := app.idempotency_claim(v_route, p_key, p_input);
  if v_prior is not null then
    return query select (v_prior ->> 'listing_id')::uuid, false;
    return;
  end if;

  -- 4. RL05 (success quotas, rolled back with a failed attempt).
  v_key_hash := pg_catalog.sha256(pg_catalog.convert_to(v_member::text, 'UTF8'));
  perform app.rate_limit_take('RL05:hour', v_key_hash, 5, '1 hour');
  perform app.rate_limit_take('RL05:day', v_key_hash, 20, '1 day');

  -- 5. RL05: at most 200 active listings, counted under the seller's lock.
  perform 1 from public.profile p where p.id = v_member for no key update;
  select pg_catalog.count(*) into v_active
    from public.listing l
   where l.seller_id = v_member and l.status = 'active';
  if v_active >= 200 then
    perform app.raise_api_error('LIMIT_REACHED');
  end if;

  -- 6. The fields, in the wizard's order, with the rules of @souq/domain (listing.ts).
  v_title := app.normalize_text(p_input ->> 'title');
  if v_title = '' then
    perform app.raise_api_error('VALIDATION_FAILED', 'title', 'required');
  elsif v_title ~ U&'[!0001-!001F!007F-!009F!202A-!202E!2066-!2069]' uescape '!' then
    perform app.raise_api_error('VALIDATION_FAILED', 'title', 'invalid_format');
  elsif pg_catalog.char_length(v_title) < 5 then
    perform app.raise_api_error('VALIDATION_FAILED', 'title', 'too_small');
  elsif pg_catalog.char_length(v_title) > 100 then
    perform app.raise_api_error('VALIDATION_FAILED', 'title', 'too_big');
  end if;

  if (p_input ->> 'category_id') !~ v_uuid then
    perform app.raise_api_error('VALIDATION_FAILED', 'category_id', 'invalid_format');
  end if;
  v_category := (p_input ->> 'category_id')::uuid;
  if not exists (select 1 from public.category c where c.id = v_category and c.is_active) then
    perform app.raise_api_error('VALIDATION_FAILED', 'category_id', 'unavailable');
  end if;

  if (p_input ->> 'condition') not in ('new_boxed', 'like_new', 'good', 'fair', 'used') then
    perform app.raise_api_error('VALIDATION_FAILED', 'condition', 'invalid_value');
  end if;
  v_condition := (p_input ->> 'condition')::public.item_condition;

  v_description := app.normalize_text(
    pg_catalog.replace(pg_catalog.replace(p_input ->> 'description', E'\r\n', E'\n'), E'\r', E'\n')
  );
  if v_description = '' then
    perform app.raise_api_error('VALIDATION_FAILED', 'description', 'required');
  elsif v_description ~ U&'[!0001-!0008!000B-!001F!007F-!009F!202A-!202E!2066-!2069]' uescape '!' then
    perform app.raise_api_error('VALIDATION_FAILED', 'description', 'invalid_format');
  elsif pg_catalog.char_length(v_description) < 10 then
    perform app.raise_api_error('VALIDATION_FAILED', 'description', 'too_small');
  elsif pg_catalog.char_length(v_description) > 2000 then
    perform app.raise_api_error('VALIDATION_FAILED', 'description', 'too_big');
  end if;

  if (p_input ->> 'price_minor')::numeric < 0 then
    perform app.raise_api_error('VALIDATION_FAILED', 'price_minor', 'too_small');
  elsif (p_input ->> 'price_minor')::numeric > 5000000 then
    perform app.raise_api_error('VALIDATION_FAILED', 'price_minor', 'too_big');
  end if;
  v_price := (p_input ->> 'price_minor')::integer;
  v_negotiable := (p_input ->> 'is_negotiable')::boolean;
  if v_price = 0 and v_negotiable then
    perform app.raise_api_error('VALIDATION_FAILED', 'is_negotiable', 'not_allowed');
  end if;

  if pg_catalog.jsonb_typeof(p_input -> 'location_id') = 'string' then
    if (p_input ->> 'location_id') !~ v_uuid then
      perform app.raise_api_error('VALIDATION_FAILED', 'location_id', 'invalid_format');
    end if;
    v_location := (p_input ->> 'location_id')::uuid;
    if not exists (select 1 from public.meeting_point m where m.id = v_location and m.is_active) then
      perform app.raise_api_error('VALIDATION_FAILED', 'location_id', 'unavailable');
    end if;
  end if;

  -- 7. The images (BR06, DEC08, TC07).
  v_count := pg_catalog.jsonb_array_length(p_input -> 'media_ids');
  if v_count < 1 then
    perform app.raise_api_error('VALIDATION_FAILED', 'media_ids', 'too_small');
  elsif v_count > 10 then
    perform app.raise_api_error('VALIDATION_FAILED', 'media_ids', 'too_big');
  end if;
  for v_index in 0 .. v_count - 1 loop
    if (p_input -> 'media_ids' ->> v_index) !~ v_uuid then
      perform app.raise_api_error('VALIDATION_FAILED', 'media_ids.' || v_index, 'invalid_format');
    end if;
  end loop;
  select pg_catalog.array_agg((e.value)::uuid order by e.ordinality)
    into v_media
    from pg_catalog.jsonb_array_elements_text(p_input -> 'media_ids') with ordinality e(value, ordinality);
  if (select pg_catalog.count(distinct x) from pg_catalog.unnest(v_media) x) <> v_count then
    perform app.raise_api_error('VALIDATION_FAILED', 'media_ids', 'duplicate');
  end if;

  perform 1 from public.media_asset a where a.id = any (v_media) order by a.id for update;
  for v_index in 1 .. v_count loop
    select a.owner_id, a.purpose, a.status, a.expires_at,
           exists (select 1 from public.listing_image i where i.media_id = a.id) as attached
      into v_row
      from public.media_asset a
     where a.id = v_media[v_index];
    if not found
      or v_row.owner_id <> v_member
      or v_row.purpose <> 'listing'
      or v_row.attached
      or v_row.expires_at is null
      or v_row.status in ('rejected', 'deleted')
      or v_row.expires_at <= v_now then
      perform app.raise_api_error('MEDIA_INVALID', 'media_ids.' || (v_index - 1), 'invalid');
    elsif v_row.status <> 'ready' then
      perform app.raise_api_error('MEDIA_NOT_READY', 'media_ids.' || (v_index - 1), 'not_ready');
    end if;
  end loop;

  -- 8. The listing, its images, the public copies queued.
  insert into public.listing
    (seller_id, category_id, location_id, title, description, condition, price_minor,
     is_negotiable, created_at, updated_at)
  values
    (v_member, v_category, v_location, v_title, v_description, v_condition, v_price,
     v_negotiable, v_now, v_now)
  returning id into v_id;

  insert into public.listing_image (listing_id, media_id, position, created_at)
  select v_id, m.media_id, m.ordinality::smallint, v_now
    from pg_catalog.unnest(v_media) with ordinality m(media_id, ordinality);

  update public.media_asset a
     set expires_at = null,
         version = a.version + 1,
         updated_at = v_now
   where a.id = any (v_media);

  perform app.enqueue_job(
    'media.publish',
    pg_catalog.jsonb_build_object('listing_id', v_id),
    'media.publish:' || v_id::text
  );

  perform app.idempotency_complete(v_route, p_key, pg_catalog.jsonb_build_object('listing_id', v_id));
  return query select v_id, true;
end;
$$;
comment on function app.publish_listing(uuid, jsonb) is
  'Task 4.2, API034, FR22, RL05: publishes one listing with its ready images, once per key.';
grant execute on function app.publish_listing(uuid, jsonb) to souq_web;

-- 5a. media.publish, step 1 (SEC08, DEC71, item 6): the private files whose public copies the
-- listing needs, only while it is active and not hidden by moderation. No row: nothing to copy,
-- which is a success. The keys are fixed: <media_id>/<variant>.webp, the same in both buckets.
-- A master is never listed (DEC08: the master stays private).
create function app.media_publish_files(p_listing uuid)
returns table (media_id uuid, variant public.media_variant, object_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.media_id, d.variant, d.object_key
    from public.listing l
    join public.listing_image i on i.listing_id = l.id
    join public.media_derivative d on d.media_id = i.media_id
   where l.id = p_listing
     and l.status = 'active'
     and l.moderation_hidden_at is null
     and d.visibility = 'private'
     and d.deleted_at is null
     and d.variant in ('w150', 'w600', 'w1200')
   order by i.position, d.variant
$$;
comment on function app.media_publish_files(uuid) is
  'Task 4.2, SEC08: the private variants media.publish copies to media-public for one listing.';
grant execute on function app.media_publish_files(uuid) to souq_worker;

-- 5b. media.publish, step 2: the copies are in media-public. Under the listing's lock, the
-- listing is checked again:
--  - still active and not hidden: one public row per copied variant, with the private row's
--    size, checksum and dimensions (the bytes are the same). Recording twice changes nothing.
--    No row comes back.
--  - no longer eligible (archived or hidden meanwhile): nothing is recorded, and the keys of the
--    copies that have no live public row come back, for the worker to remove.
create function app.media_published(p_listing uuid)
returns table (object_key text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_eligible boolean;
begin
  select l.status = 'active' and l.moderation_hidden_at is null
    into v_eligible
    from public.listing l
   where l.id = p_listing
     for share;

  if coalesce(v_eligible, false) then
    insert into public.media_derivative
      (media_id, variant, visibility, bucket, object_key, bytes, sha256, width, height, created_at)
    select d.media_id, d.variant, 'public', 'media-public', d.object_key, d.bytes, d.sha256,
           d.width, d.height, app.app_now()
      from public.listing_image i
      join public.media_derivative d on d.media_id = i.media_id
     where i.listing_id = p_listing
       and d.visibility = 'private'
       and d.deleted_at is null
       and d.variant in ('w150', 'w600', 'w1200')
    on conflict (media_id, variant, visibility) do nothing;
    return;
  end if;

  return query
  select d.object_key
    from public.listing_image i
    join public.media_derivative d on d.media_id = i.media_id
   where i.listing_id = p_listing
     and d.visibility = 'private'
     and d.variant in ('w150', 'w600', 'w1200')
     and not exists (
       select 1 from public.media_derivative p
        where p.media_id = d.media_id
          and p.variant = d.variant
          and p.visibility = 'public'
          and p.deleted_at is null
     )
   order by d.object_key;
end;
$$;
comment on function app.media_published(uuid) is
  'Task 4.2, SEC08, DEC71: records the public copies of an eligible listing, or lists the copies to remove.';
grant execute on function app.media_published(uuid) to souq_worker;
