-- Task 4.4 (plan/task-4.4.md): the seller manages their listings. FR23, FR24, BR27, BR28, DEC09,
-- DEC85, RET01, SEC08, API033, API035, API036, TC10, TC34, TC35.
--  1. The lifecycle columns agree with the status (CHECK), after completing the rows that test
--     fixtures of tasks 4.2 and 4.3 wrote without them (item 10).
--  2. app.listing_restorable_until(): BR27's 90 days, for an owner archive of an active listing.
--  3. Reads for souq_web: app.owner_listing() gains restorable_until; app.my_listings() is API033.
--  4. API035: app.update_listing(). API036: app.transition_listing().
--  5. media.publish becomes the sync of the public copies (item 1): app.media_unpublish_files(),
--     app.media_unpublished(), and app.media_published() revives a removed public row.
-- The limits are the same as packages/domain/src/listing-lifecycle.ts (tests/integration/
-- listings-manage.test.ts compares them): 90 days to restore (BR27), 30 edits an hour (DEC85),
-- 24 hours before a detached image is deleted (RET01, UNATTACHED_LIFETIME_HOURS).
-- Owner rule (item 4): every owner action on a listing hidden by moderation is FORBIDDEN until a
-- moderator decides (task 7.5).
-- BR41 (pending offers): task 5.5 adds the cancellations to app.update_listing() (price_changed,
-- made_free_or_fixed) and app.transition_listing() (context_closed for mark_sold and archive).

-- 1a. Fixtures of tasks 4.2 and 4.3 archived or sold listings by writing the status alone. The
-- missing columns are completed before the CHECK: an archive keeps what it came from (DEC09:
-- sold when it has a sale time), with the owner as reason and its last change as time.
update public.listing l
   set sold_at = l.updated_at
 where l.status = 'sold' and l.sold_at is null;
update public.listing l
   set previous_status = case when l.sold_at is null then 'active' else 'sold' end::public.listing_status,
       archive_reason = coalesce(l.archive_reason, 'owner'),
       archived_at = coalesce(l.archived_at, l.updated_at)
 where l.status = 'archived'
   and (l.previous_status is null or l.archive_reason is null or l.archived_at is null);
update public.listing l
   set previous_status = null, archive_reason = null, archived_at = null
 where l.status = 'active'
   and (l.previous_status is not null or l.archive_reason is not null or l.archived_at is not null);

-- 1b. BR27, DEC09: a status has exactly its columns. Active: no sale and no archive. Sold: its
-- sale time. Archived: what it came from (active or sold, with a sale time exactly when sold),
-- why and when. A later task (6.1 deals, 7.5 moderation, 8.1 retention) cannot write half a state.
alter table public.listing add constraint listing_lifecycle_columns check (
  case status
    when 'active' then
      sold_at is null and previous_status is null and archive_reason is null and archived_at is null
    when 'sold' then
      sold_at is not null and previous_status is null and archive_reason is null and archived_at is null
    when 'archived' then
      previous_status in ('active', 'sold')
      and archive_reason is not null
      and archived_at is not null
      and (previous_status = 'sold') = (sold_at is not null)
  end
);

-- API033: a member's listings by tab, newest first by the tab's time.
create index listing_seller_status on public.listing (seller_id, status);

-- 2. BR27: an owner archive of an active listing can be restored until archived_at + 90 days.
-- Anything else (an archived sale, sold_auto, account_deletion, not archived) has no deadline.
-- Internal, no grant.
create function app.listing_restorable_until(
  p_status public.listing_status,
  p_previous public.listing_status,
  p_reason public.archive_reason,
  p_archived_at timestamptz
)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case
           when p_status = 'archived' and p_previous = 'active' and p_reason = 'owner'
             then p_archived_at + interval '90 days'
         end
$$;
comment on function app.listing_restorable_until(public.listing_status, public.listing_status, public.archive_reason, timestamptz) is
  'Task 4.4, BR27: the end of the 90-day restore window, or null.';

-- 3a. API034, API035, API036's answer (OwnerListing), now with restorable_until (BR27). The
-- return type changes, so the function is dropped and created again with its grant.
drop function app.owner_listing(uuid);
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
  restorable_until timestamptz,
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
         l.archive_reason, l.sold_at, l.archived_at,
         app.listing_restorable_until(l.status, l.previous_status, l.archive_reason, l.archived_at),
         l.moderation_hidden_at is not null,
         l.version, l.created_at, l.updated_at
    from public.listing l
    join public.category c on c.id = l.category_id
    left join public.meeting_point m on m.id = l.location_id
   where l.id = p_id
     and l.seller_id = v_member;
end;
$$;
comment on function app.owner_listing(uuid) is
  'Tasks 4.2 and 4.4, API034 to API036: the session member''s own listing (OwnerListing), or no row.';
grant execute on function app.owner_listing(uuid) to souq_web;

-- 3b. API033 (FR23, FR24): one tab of the session member's own listings. The active tab includes
-- the listings hidden by moderation (moderation_hidden, shown with their label, item 4). Order
-- (item 7): the tab's time, newest first (created_at for active, sold_at for sold, archived_at
-- for archived), then the id. The cursor is the last row's (sort_key, id), sort_key being that
-- time as text, to the microsecond. The images come as two arrays in position order (named
-- columns, DEC77), with public_ready for each.
create function app.my_listings(
  p_status public.listing_status,
  p_after_key text,
  p_after_id uuid,
  p_limit integer
)
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
  restorable_until timestamptz,
  moderation_hidden boolean,
  version integer,
  created_at timestamptz,
  updated_at timestamptz,
  sort_key text,
  image_ids uuid[],
  image_public_ready boolean[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member uuid := app.member_read_actor();
  v_after timestamptz;
begin
  if p_status is null then
    perform app.raise_api_error('BAD_REQUEST', 'status', 'required');
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 51 then
    perform app.raise_api_error('BAD_REQUEST', 'limit', 'out_of_range');
  end if;
  if (p_after_key is null) <> (p_after_id is null) then
    perform app.raise_api_error('INVALID_CURSOR');
  end if;
  if p_after_key is not null then
    begin
      v_after := p_after_key::timestamptz;
    exception when others then
      perform app.raise_api_error('INVALID_CURSOR');
    end;
  end if;

  return query
  select l.id, l.title, l.description,
         c.id, c.key, c.label_ar, c.label_en,
         m.id, m.key, m.kind, m.label_ar, m.label_en,
         l.condition, l.price_minor, l.is_negotiable, l.status, l.previous_status,
         l.archive_reason, l.sold_at, l.archived_at,
         app.listing_restorable_until(l.status, l.previous_status, l.archive_reason, l.archived_at),
         l.moderation_hidden_at is not null,
         l.version, l.created_at, l.updated_at,
         t.at::text,
         img.ids, img.ready
    from public.listing l
    join public.category c on c.id = l.category_id
    left join public.meeting_point m on m.id = l.location_id
    cross join lateral (
      select case l.status
               when 'active' then l.created_at
               when 'sold' then l.sold_at
               else l.archived_at
             end as at
    ) t
    cross join lateral (
      select pg_catalog.array_agg(i.media_id order by i.position) as ids,
             pg_catalog.array_agg(
               (select pg_catalog.count(*)
                  from public.media_derivative d
                 where d.media_id = i.media_id
                   and d.visibility = 'public'
                   and d.deleted_at is null
                   and d.variant in ('w150', 'w600', 'w1200')) = 3
               order by i.position) as ready
        from public.listing_image i
       where i.listing_id = l.id
    ) img
   where l.seller_id = v_member
     and l.status = p_status
     and (p_after_id is null or (t.at, l.id) < (v_after, p_after_id))
   order by t.at desc, l.id desc
   limit p_limit;
end;
$$;
comment on function app.my_listings(public.listing_status, text, uuid, integer) is
  'Task 4.4, API033: one status tab of the session member''s own listings, newest first.';
grant execute on function app.my_listings(public.listing_status, text, uuid, integer) to souq_web;

-- 4a. API035 (FR23, BR05 to BR08, DEC85, RET01, TC10, TC35). The server has already checked the
-- body with the rules of @souq/domain (all field errors at once); this checks everything again
-- and raises the first problem. Order:
--  1. app.assert_active_member() (it locks the account row first: the lock order of chapter 07).
--  2. The structure: the contract's ListingPatch keys and types, else BAD_REQUEST.
--  3. The listing, locked: another member's or unknown is NOT_FOUND (TC10, no hint that it
--     exists); hidden by moderation is FORBIDDEN (TC35, item 4); not active or another version
--     is STATE_CONFLICT.
--  4. The fields after the merge, with the publication's codes. A category or meeting point that
--     was deactivated stays while it is not changed; choosing one now is unavailable.
--  5. media_ids is the whole new list in display order. Kept images are the listing's own; new
--     ones follow the publication's rules (media_ids.<n>, MEDIA_INVALID or MEDIA_NOT_READY).
--     Every image involved is locked in id order.
--  6. Nothing changed: the current version, no count, no job (as API016).
--  7. DEC85: one of 30 successful edits per member per hour, in this transaction (DEC70).
--  8. The listing and its images. A detached image gets expires_at in 24 hours (RET01), so
--     media.cleanup deletes it unless an edit attaches it again before. The sync of the public
--     copies is queued when the images changed (SEC08).
-- No audit (item 9) and no notification.
create function app.update_listing(p_id uuid, p_expected_version integer, p_patch jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_member uuid := app.assert_active_member();
  v_now timestamptz := app.app_now();
  v_row record;
  v_title text;
  v_description text;
  v_category uuid;
  v_location uuid;
  v_condition public.item_condition;
  v_price integer;
  v_negotiable boolean;
  v_old_media uuid[];
  v_media uuid[];
  v_detached uuid[];
  v_added uuid[];
  v_media_changed boolean := false;
  v_changed boolean;
  v_count integer;
  v_asset record;
  v_version integer;
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  -- 2. Structure (ListingPatch without expected_version, additionalProperties false).
  if p_id is null or p_expected_version is null or p_expected_version < 1
    or p_patch is null or pg_catalog.jsonb_typeof(p_patch) <> 'object'
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_patch) k
       where k not in ('title', 'description', 'category_id', 'condition', 'location_id',
                       'price_minor', 'is_negotiable', 'media_ids')
    )
    or (p_patch ? 'title' and pg_catalog.jsonb_typeof(p_patch -> 'title') <> 'string')
    or (p_patch ? 'description' and pg_catalog.jsonb_typeof(p_patch -> 'description') <> 'string')
    or (p_patch ? 'category_id' and pg_catalog.jsonb_typeof(p_patch -> 'category_id') <> 'string')
    or (p_patch ? 'condition' and pg_catalog.jsonb_typeof(p_patch -> 'condition') <> 'string')
    or (p_patch ? 'location_id'
        and pg_catalog.jsonb_typeof(p_patch -> 'location_id') not in ('string', 'null'))
    or (p_patch ? 'price_minor' and pg_catalog.jsonb_typeof(p_patch -> 'price_minor') <> 'number')
    or (p_patch ? 'is_negotiable' and pg_catalog.jsonb_typeof(p_patch -> 'is_negotiable') <> 'boolean')
    or (p_patch ? 'media_ids' and pg_catalog.jsonb_typeof(p_patch -> 'media_ids') <> 'array') then
    perform app.raise_api_error('BAD_REQUEST');
  end if;
  if (p_patch ? 'price_minor'
      and (p_patch ->> 'price_minor')::numeric <> pg_catalog.trunc((p_patch ->> 'price_minor')::numeric))
    or (p_patch ? 'media_ids' and exists (
      select 1 from pg_catalog.jsonb_array_elements(p_patch -> 'media_ids') e
       where pg_catalog.jsonb_typeof(e) <> 'string'
    )) then
    perform app.raise_api_error('BAD_REQUEST');
  end if;

  -- 3. The listing, under its lock.
  select l.seller_id, l.status, l.moderation_hidden_at, l.version, l.title, l.description,
         l.category_id, l.location_id, l.condition, l.price_minor, l.is_negotiable
    into v_row
    from public.listing l
   where l.id = p_id
     for update;
  if not found or v_row.seller_id <> v_member then
    perform app.raise_api_error('NOT_FOUND');
  end if;
  if v_row.moderation_hidden_at is not null then
    perform app.raise_api_error('FORBIDDEN');
  end if;
  if v_row.status <> 'active' or v_row.version <> p_expected_version then
    perform app.raise_api_error('STATE_CONFLICT');
  end if;

  -- 4. The fields, in the order of the form, with the rules of @souq/domain (listing.ts).
  v_title := v_row.title;
  if p_patch ? 'title' then
    v_title := app.normalize_text(p_patch ->> 'title');
    if v_title = '' then
      perform app.raise_api_error('VALIDATION_FAILED', 'title', 'required');
    elsif v_title ~ U&'[!0001-!001F!007F-!009F!202A-!202E!2066-!2069]' uescape '!' then
      perform app.raise_api_error('VALIDATION_FAILED', 'title', 'invalid_format');
    elsif pg_catalog.char_length(v_title) < 5 then
      perform app.raise_api_error('VALIDATION_FAILED', 'title', 'too_small');
    elsif pg_catalog.char_length(v_title) > 100 then
      perform app.raise_api_error('VALIDATION_FAILED', 'title', 'too_big');
    end if;
  end if;

  v_category := v_row.category_id;
  if p_patch ? 'category_id' then
    if (p_patch ->> 'category_id') !~ v_uuid then
      perform app.raise_api_error('VALIDATION_FAILED', 'category_id', 'invalid_format');
    end if;
    v_category := (p_patch ->> 'category_id')::uuid;
    if v_category is distinct from v_row.category_id
      and not exists (select 1 from public.category c where c.id = v_category and c.is_active) then
      perform app.raise_api_error('VALIDATION_FAILED', 'category_id', 'unavailable');
    end if;
  end if;

  v_condition := v_row.condition;
  if p_patch ? 'condition' then
    if (p_patch ->> 'condition') not in ('new_boxed', 'like_new', 'good', 'fair', 'used') then
      perform app.raise_api_error('VALIDATION_FAILED', 'condition', 'invalid_value');
    end if;
    v_condition := (p_patch ->> 'condition')::public.item_condition;
  end if;

  v_description := v_row.description;
  if p_patch ? 'description' then
    v_description := app.normalize_text(
      pg_catalog.replace(pg_catalog.replace(p_patch ->> 'description', E'\r\n', E'\n'), E'\r', E'\n')
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
  end if;

  v_price := v_row.price_minor;
  if p_patch ? 'price_minor' then
    if (p_patch ->> 'price_minor')::numeric < 0 then
      perform app.raise_api_error('VALIDATION_FAILED', 'price_minor', 'too_small');
    elsif (p_patch ->> 'price_minor')::numeric > 5000000 then
      perform app.raise_api_error('VALIDATION_FAILED', 'price_minor', 'too_big');
    end if;
    v_price := (p_patch ->> 'price_minor')::integer;
  end if;
  v_negotiable := v_row.is_negotiable;
  if p_patch ? 'is_negotiable' then
    v_negotiable := (p_patch ->> 'is_negotiable')::boolean;
  end if;
  if v_price = 0 and v_negotiable then
    perform app.raise_api_error('VALIDATION_FAILED', 'is_negotiable', 'not_allowed');
  end if;

  v_location := v_row.location_id;
  if p_patch ? 'location_id' then
    if pg_catalog.jsonb_typeof(p_patch -> 'location_id') = 'null' then
      v_location := null;
    else
      if (p_patch ->> 'location_id') !~ v_uuid then
        perform app.raise_api_error('VALIDATION_FAILED', 'location_id', 'invalid_format');
      end if;
      v_location := (p_patch ->> 'location_id')::uuid;
      if v_location is distinct from v_row.location_id
        and not exists (select 1 from public.meeting_point m where m.id = v_location and m.is_active) then
        perform app.raise_api_error('VALIDATION_FAILED', 'location_id', 'unavailable');
      end if;
    end if;
  end if;

  -- 5. The images (BR06, DEC08, TC07).
  select coalesce(pg_catalog.array_agg(i.media_id order by i.position), '{}'::uuid[])
    into v_old_media
    from public.listing_image i
   where i.listing_id = p_id;
  v_media := v_old_media;
  if p_patch ? 'media_ids' then
    v_count := pg_catalog.jsonb_array_length(p_patch -> 'media_ids');
    if v_count < 1 then
      perform app.raise_api_error('VALIDATION_FAILED', 'media_ids', 'too_small');
    elsif v_count > 10 then
      perform app.raise_api_error('VALIDATION_FAILED', 'media_ids', 'too_big');
    end if;
    for v_index in 0 .. v_count - 1 loop
      if (p_patch -> 'media_ids' ->> v_index) !~ v_uuid then
        perform app.raise_api_error('VALIDATION_FAILED', 'media_ids.' || v_index, 'invalid_format');
      end if;
    end loop;
    select pg_catalog.array_agg((e.value)::uuid order by e.ordinality)
      into v_media
      from pg_catalog.jsonb_array_elements_text(p_patch -> 'media_ids') with ordinality e(value, ordinality);
    if (select pg_catalog.count(distinct x) from pg_catalog.unnest(v_media) x) <> v_count then
      perform app.raise_api_error('VALIDATION_FAILED', 'media_ids', 'duplicate');
    end if;

    perform 1 from public.media_asset a
     where a.id = any (v_media || v_old_media)
     order by a.id
       for update;
    for v_index in 1 .. v_count loop
      if v_media[v_index] = any (v_old_media) then
        continue;
      end if;
      select a.owner_id, a.purpose, a.status, a.expires_at,
             exists (select 1 from public.listing_image i where i.media_id = a.id) as attached
        into v_asset
        from public.media_asset a
       where a.id = v_media[v_index];
      if not found
        or v_asset.owner_id <> v_member
        or v_asset.purpose <> 'listing'
        or v_asset.attached
        or v_asset.expires_at is null
        or v_asset.status in ('rejected', 'deleted')
        or v_asset.expires_at <= v_now then
        perform app.raise_api_error('MEDIA_INVALID', 'media_ids.' || (v_index - 1), 'invalid');
      elsif v_asset.status <> 'ready' then
        perform app.raise_api_error('MEDIA_NOT_READY', 'media_ids.' || (v_index - 1), 'not_ready');
      end if;
    end loop;
    v_media_changed := v_media is distinct from v_old_media;
  end if;

  -- 6. Nothing changed.
  v_changed := v_media_changed
    or v_title is distinct from v_row.title
    or v_description is distinct from v_row.description
    or v_category is distinct from v_row.category_id
    or v_location is distinct from v_row.location_id
    or v_condition is distinct from v_row.condition
    or v_price is distinct from v_row.price_minor
    or v_negotiable is distinct from v_row.is_negotiable;
  if not v_changed then
    return v_row.version;
  end if;

  -- 7. DEC85 (a success quota, rolled back with a failed attempt).
  perform app.rate_limit_take(
    'DEC85:hour',
    pg_catalog.sha256(pg_catalog.convert_to(v_member::text, 'UTF8')),
    30,
    '1 hour'
  );

  -- 8. The listing (BR41: task 5.5 cancels the pending offers here when the price or
  -- negotiability changes), then its images.
  update public.listing l
     set title = v_title,
         description = v_description,
         category_id = v_category,
         location_id = v_location,
         condition = v_condition,
         price_minor = v_price,
         is_negotiable = v_negotiable,
         version = l.version + 1,
         updated_at = v_now
   where l.id = p_id
  returning l.version into v_version;

  if v_media_changed then
    select coalesce(pg_catalog.array_agg(x), '{}'::uuid[]) into v_detached
      from pg_catalog.unnest(v_old_media) x
     where x <> all (v_media);
    select coalesce(pg_catalog.array_agg(x), '{}'::uuid[]) into v_added
      from pg_catalog.unnest(v_media) x
     where x <> all (v_old_media);

    delete from public.listing_image i where i.listing_id = p_id;
    insert into public.listing_image (listing_id, media_id, position, created_at)
    select p_id, m.media_id, m.ordinality::smallint, v_now
      from pg_catalog.unnest(v_media) with ordinality m(media_id, ordinality);

    update public.media_asset a
       set expires_at = null, version = a.version + 1, updated_at = v_now
     where a.id = any (v_added);
    update public.media_asset a
       set expires_at = v_now + interval '24 hours', version = a.version + 1, updated_at = v_now
     where a.id = any (v_detached);

    perform app.enqueue_job(
      'media.publish',
      pg_catalog.jsonb_build_object('listing_id', p_id, 'detached_media_ids', pg_catalog.to_jsonb(v_detached)),
      'media.publish:' || p_id::text || ':' || v_version::text
    );
  end if;

  return v_version;
end;
$$;
comment on function app.update_listing(uuid, integer, jsonb) is
  'Task 4.4, API035, DEC85: edits an active, visible listing of the session member, with expected_version.';
grant execute on function app.update_listing(uuid, integer, jsonb) to souq_web;

-- 4b. API036 (FR24, BR27, BR28, DEC09, TC34, TC35). Order:
--  1. app.assert_active_member(), then the structure (the three actions), else BAD_REQUEST.
--  2. restore only: the seller's profile row is locked before the listing, as publication does,
--     so two restores at once cannot pass 200 active listings (LIMIT_REACHED).
--  3. The listing, locked: NOT_FOUND, FORBIDDEN when hidden (item 4), STATE_CONFLICT for another
--     version.
--  4. The table of packages/domain/src/listing-lifecycle.ts:
--     - mark_sold: active to sold (final: nothing makes a sold listing active again, BR27).
--     - archive: active or sold to archived, keeping where it came from (DEC09).
--     - restore: an owner archive of an active listing, before archived_at + 90 days
--       (DEADLINE_PASSED after), to active. Restoring never purges or deletes (TC34).
--     Any other start state is STATE_CONFLICT.
--  5. archive and restore queue the sync of the public copies (SEC08). A sold listing keeps its
--     copies (DEC84: its page stays).
-- BR41: task 5.5 cancels the pending offers with context_closed on mark_sold and archive.
-- No limit (DEC85: the state bounds them), no audit (item 9), no notification.
create function app.transition_listing(p_id uuid, p_action text, p_expected_version integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_member uuid := app.assert_active_member();
  v_now timestamptz := app.app_now();
  v_row record;
  v_active bigint;
  v_version integer;
begin
  if p_id is null or p_expected_version is null or p_expected_version < 1
    or p_action is null or p_action not in ('mark_sold', 'archive', 'restore') then
    perform app.raise_api_error('BAD_REQUEST');
  end if;

  if p_action = 'restore' then
    perform 1 from public.profile p where p.id = v_member for no key update;
  end if;

  select l.seller_id, l.status, l.previous_status, l.archive_reason, l.archived_at,
         l.moderation_hidden_at, l.version
    into v_row
    from public.listing l
   where l.id = p_id
     for update;
  if not found or v_row.seller_id <> v_member then
    perform app.raise_api_error('NOT_FOUND');
  end if;
  if v_row.moderation_hidden_at is not null then
    perform app.raise_api_error('FORBIDDEN');
  end if;
  if v_row.version <> p_expected_version then
    perform app.raise_api_error('STATE_CONFLICT');
  end if;

  if p_action = 'mark_sold' then
    if v_row.status <> 'active' then
      perform app.raise_api_error('STATE_CONFLICT');
    end if;
    update public.listing l
       set status = 'sold', sold_at = v_now, version = l.version + 1, updated_at = v_now
     where l.id = p_id
    returning l.version into v_version;

  elsif p_action = 'archive' then
    if v_row.status not in ('active', 'sold') then
      perform app.raise_api_error('STATE_CONFLICT');
    end if;
    update public.listing l
       set status = 'archived',
           previous_status = v_row.status,
           archive_reason = 'owner',
           archived_at = v_now,
           version = l.version + 1,
           updated_at = v_now
     where l.id = p_id
    returning l.version into v_version;

  else
    if v_row.status <> 'archived' or v_row.previous_status <> 'active'
      or v_row.archive_reason <> 'owner' then
      perform app.raise_api_error('STATE_CONFLICT');
    end if;
    if v_now >= app.listing_restorable_until(v_row.status, v_row.previous_status,
                                              v_row.archive_reason, v_row.archived_at) then
      perform app.raise_api_error('DEADLINE_PASSED');
    end if;
    select pg_catalog.count(*) into v_active
      from public.listing l
     where l.seller_id = v_member and l.status = 'active';
    if v_active >= 200 then
      perform app.raise_api_error('LIMIT_REACHED');
    end if;
    update public.listing l
       set status = 'active',
           previous_status = null,
           archive_reason = null,
           archived_at = null,
           version = l.version + 1,
           updated_at = v_now
     where l.id = p_id
    returning l.version into v_version;
  end if;

  if p_action in ('archive', 'restore') then
    perform app.enqueue_job(
      'media.publish',
      pg_catalog.jsonb_build_object('listing_id', p_id),
      'media.publish:' || p_id::text || ':' || v_version::text
    );
  end if;
  return v_version;
end;
$$;
comment on function app.transition_listing(uuid, text, integer) is
  'Task 4.4, API036, BR27, DEC09: mark_sold, archive or restore one listing of the session member.';
grant execute on function app.transition_listing(uuid, text, integer) to souq_web;

-- 5. media.publish, the sync of the public copies (SEC08, DEC71, item 1). An image's public copies
-- may exist while it belongs to a listing that is active or sold and not hidden by moderation
-- (DEC84: a sold listing keeps its page). The job's scope is the listing's images and the images
-- an edit detached from it. Order in the worker (apps/worker/src/jobs/media.publish.ts):
--  1. app.media_unpublish_files(): the fixed keys of the images in scope that are not eligible.
--  2. The worker removes them (a missing file is a success).
--  3. app.media_unpublished() with the images step 2 removed: under their locks, the public rows
--     of those still not eligible are marked deleted, and the keys of those that became eligible
--     meanwhile come back, for the worker to copy again (another listing attached a detached image).
--  4. app.media_publish_files() and app.media_published() as in task 4.2: copy, then record
--     under the listing's lock, or list the copies to remove again if the listing changed.
-- Each step decides from the state at that moment, so jobs in any order end with the copies the
-- current state allows.

-- Internal: whether an image may have public copies now. No grant.
create function app.media_public_eligible(p_media uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.listing_image i
      join public.listing l on l.id = i.listing_id
     where i.media_id = p_media
       and l.status in ('active', 'sold')
       and l.moderation_hidden_at is null
  )
$$;
comment on function app.media_public_eligible(uuid) is
  'Task 4.4, SEC08: an image of an active or sold listing not hidden by moderation.';

-- 5a. Step 1: the public keys to remove (the same fixed keys as the private variants).
create function app.media_unpublish_files(p_listing uuid, p_detached uuid[])
returns table (media_id uuid, object_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.media_id, d.object_key
    from public.media_derivative d
    join public.media_asset a on a.id = d.media_id
   where a.purpose = 'listing'
     and d.visibility = 'private'
     and d.variant in ('w150', 'w600', 'w1200')
     and (d.media_id in (select i.media_id from public.listing_image i where i.listing_id = p_listing)
          or d.media_id = any (coalesce(p_detached, '{}'::uuid[])))
     and not app.media_public_eligible(d.media_id)
   order by d.object_key
$$;
comment on function app.media_unpublish_files(uuid, uuid[]) is
  'Task 4.4, SEC08: the public copies media.publish removes for a listing and its detached images.';
grant execute on function app.media_unpublish_files(uuid, uuid[]) to souq_worker;

-- 5b. Step 3, with the images whose keys step 2 removed: under their locks (id order, the lock an
-- edit or a publication takes to attach an image), the public rows of the images still not
-- eligible are marked deleted (twice changes nothing). The keys of those that became eligible
-- meanwhile and already have live public rows come back, for the worker to copy again (another
-- listing attached a detached image and its own sync ran in between).
create function app.media_unpublished(p_removed uuid[])
returns table (object_key text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_scope uuid[] := coalesce(p_removed, '{}'::uuid[]);
begin
  perform 1 from public.media_asset a where a.id = any (v_scope) order by a.id for share;

  update public.media_derivative d
     set deleted_at = app.app_now()
   where d.media_id = any (v_scope)
     and d.visibility = 'public'
     and d.deleted_at is null
     and not app.media_public_eligible(d.media_id);

  return query
  select d.object_key
    from public.media_derivative d
   where d.media_id = any (v_scope)
     and d.visibility = 'private'
     and d.deleted_at is null
     and d.variant in ('w150', 'w600', 'w1200')
     and app.media_public_eligible(d.media_id)
     and exists (
       select 1 from public.media_derivative p
        where p.media_id = d.media_id
          and p.variant = d.variant
          and p.visibility = 'public'
          and p.deleted_at is null
     )
   order by d.object_key;
end;
$$;
comment on function app.media_unpublished(uuid[]) is
  'Task 4.4, SEC08, DEC71: marks removed public copies, and lists eligible ones to copy again.';
grant execute on function app.media_unpublished(uuid[]) to souq_worker;

-- 5c. Step 4 (task 4.2's function): a public row removed by an archive is revived on restore,
-- since (media_id, variant, visibility) is unique. Otherwise unchanged.
create or replace function app.media_published(p_listing uuid)
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
    on conflict (media_id, variant, visibility) do update
      set deleted_at = null,
          bytes = excluded.bytes,
          sha256 = excluded.sha256,
          width = excluded.width,
          height = excluded.height,
          created_at = excluded.created_at
      where public.media_derivative.deleted_at is not null;
    return;
  end if;

  return query
  select d.object_key
    from public.listing_image i
    join public.media_derivative d on d.media_id = i.media_id
   where i.listing_id = p_listing
     and d.visibility = 'private'
     and d.variant in ('w150', 'w600', 'w1200')
     and not app.media_public_eligible(d.media_id)
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
  'Tasks 4.2 and 4.4, SEC08, DEC71: records the public copies of an eligible listing, or lists the copies to remove.';
