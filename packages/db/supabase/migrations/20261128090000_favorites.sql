-- Task 4.5 (plan/task-4.5.md): favorites. FR15, UC05, DEC86, API048, API049, API050, TC06.
--  1. public.favorite: one private relationship per member and listing (the primary key is TC06's
--     constraint, never check-then-insert). RLS on, no policy and no grant: the browser never
--     reads it; the server reads and writes through the app functions below.
--  2. API049: app.save_favorite(). API050: app.remove_favorite().
--  3. Reads for souq_web: app.my_favorites() (API048) and app.favorite_flags() (is_favorite on
--     the public cards and the listing page, item 4: the market reads stay unchanged).
-- The limits are the same as packages/domain/src/favorites.ts (tests/integration/favorites.test.ts
-- compares them): 500 favorites per member and 120 new saves per member per hour (DEC86), 50
-- items a page (the server asks one more to know whether a next page exists), 51 ids per flags
-- read (a market page).
-- No notification to the seller and no public count (item 6), no audit (not a sensitive action).
-- RET03 and RET06: the final purge of a listing or an account (task 8.1) deletes its rows; the
-- profile row stays as a pseudonym, so task 8.1 deletes a purged member's favorites explicitly.

-- 1. FR15, TC06: PRIMARY KEY(user_id, listing_id). created_at is the time it was saved, kept by a
-- repeated save (item 5).
create table public.favorite (
  user_id uuid not null references public.profile (id) on delete cascade,
  listing_id uuid not null references public.listing (id) on delete cascade,
  created_at timestamptz not null default app.app_now(),
  primary key (user_id, listing_id)
);
comment on table public.favorite is
  'Task 4.5, FR15: a member''s private saved listings. Written only by app.save_favorite and app.remove_favorite.';

-- API048's order: the member's newest first, then the listing id.
create index favorite_user_newest on public.favorite (user_id, created_at desc, listing_id desc);
-- The listing's foreign key and task 8.1's purge.
create index favorite_listing on public.favorite (listing_id);

alter table public.favorite enable row level security;

-- 2a. API049 (FR15, UC05, DEC86, TC06). Order:
--  1. app.assert_active_member() (it locks the account row first: the lock order of chapter 07).
--  2. UC05: a listing the public may not see is NOT_FOUND, the same for every reason
--     (app.public_listing_visible: active or sold, not hidden, a visible seller). A sold listing
--     is saved (item 1). The member's own listing is saved too (DEC86, item 2).
--  3. Already saved: nothing changes, nothing is counted (item 5).
--  4. DEC86: at most 500 favorites, counted under the member's profile lock, so two saves at the
--     same time cannot pass it; every row counts, «غير متاح» ones too. LIMIT_REACHED.
--  5. The row; a concurrent save of the same listing waits on the profile lock, then finds it.
--  6. DEC86: one of 120 new saves per member per hour, a success quota in this transaction
--     (DEC70): a repeated save or a refused one is not counted. RATE_LIMITED.
create function app.save_favorite(p_listing uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_member uuid := app.assert_active_member();
  v_count integer;
begin
  if p_listing is null or not app.public_listing_visible(p_listing) then
    perform app.raise_api_error('NOT_FOUND');
  end if;

  perform 1 from public.profile p where p.id = v_member for no key update;
  if exists (
    select 1 from public.favorite f where f.user_id = v_member and f.listing_id = p_listing
  ) then
    return;
  end if;

  select pg_catalog.count(*) into v_count from public.favorite f where f.user_id = v_member;
  if v_count >= 500 then
    perform app.raise_api_error('LIMIT_REACHED');
  end if;

  insert into public.favorite (user_id, listing_id, created_at)
  values (v_member, p_listing, app.app_now())
  on conflict (user_id, listing_id) do nothing;

  perform app.rate_limit_take(
    'DEC86:hour',
    pg_catalog.sha256(pg_catalog.convert_to(v_member::text, 'UTF8')),
    120,
    '1 hour'
  );
end;
$$;
comment on function app.save_favorite(uuid) is
  'Task 4.5, API049, DEC86: saves a visible listing in the session member''s favorites, idempotent.';
grant execute on function app.save_favorite(uuid) to souq_web;

-- 2b. API050 (FR15, TC06): removes the member's row if any. Always succeeds (idempotent), for a
-- listing that is unknown or no longer visible too, so «غير متاح» can be removed. No limit (DEC86).
create function app.remove_favorite(p_listing uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_member uuid := app.assert_active_member();
begin
  delete from public.favorite f where f.user_id = v_member and f.listing_id = p_listing;
end;
$$;
comment on function app.remove_favorite(uuid) is
  'Task 4.5, API050: removes a listing from the session member''s favorites, idempotent.';
grant execute on function app.remove_favorite(uuid) to souq_web;

-- 3a. API048 (FR15, UC05): the session member's favorites, newest saved first, then the listing
-- id. The cursor is the last row's (saved_key, listing_id), saved_key being created_at as text,
-- to the microsecond. available is app.public_listing_visible, the same rule as the listing page
-- (item 1). UC05: when it is false every card column is null, so nothing of a hidden listing is
-- disclosed (no title, price, image, status or date).
create function app.my_favorites(
  p_after_key text,
  p_after_id uuid,
  p_limit integer
)
returns table (
  listing_id uuid,
  saved_at timestamptz,
  saved_key text,
  available boolean,
  title text,
  price_minor integer,
  is_negotiable boolean,
  condition public.item_condition,
  category_id uuid,
  category_key public.category_key,
  category_label_ar text,
  category_label_en text,
  location_id uuid,
  location_key text,
  location_kind public.meeting_point_kind,
  location_label_ar text,
  location_label_en text,
  status public.listing_status,
  seller_student_badge boolean,
  created_at timestamptz,
  primary_media_id uuid,
  primary_public_ready boolean
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
  select f.listing_id, f.created_at, f.created_at::text, v.ok,
         case when v.ok then l.title end,
         case when v.ok then l.price_minor end,
         case when v.ok then l.is_negotiable end,
         case when v.ok then l.condition end,
         case when v.ok then c.id end,
         case when v.ok then c.key end,
         case when v.ok then c.label_ar end,
         case when v.ok then c.label_en end,
         case when v.ok then m.id end,
         case when v.ok then m.key end,
         case when v.ok then m.kind end,
         case when v.ok then m.label_ar end,
         case when v.ok then m.label_en end,
         case when v.ok then l.status end,
         case when v.ok then false end,
         case when v.ok then l.created_at end,
         case when v.ok then pi.media_id end,
         case when v.ok then coalesce((select pg_catalog.count(*)
                     from public.media_derivative d
                    where d.media_id = pi.media_id
                      and d.visibility = 'public'
                      and d.deleted_at is null
                      and d.variant in ('w150', 'w600', 'w1200')) = 3, false) end
    from public.favorite f
    join public.listing l on l.id = f.listing_id
    join public.category c on c.id = l.category_id
    left join public.meeting_point m on m.id = l.location_id
    left join public.listing_image pi on pi.listing_id = l.id and pi.position = 1
    cross join lateral (select app.public_listing_visible(f.listing_id) as ok) v
   where f.user_id = v_member
     and (p_after_id is null or (f.created_at, f.listing_id) < (v_after, p_after_id))
   order by f.created_at desc, f.listing_id desc
   limit p_limit;
end;
$$;
comment on function app.my_favorites(text, uuid, integer) is
  'Task 4.5, API048: the session member''s favorites, newest first; a hidden listing is only its id.';
grant execute on function app.my_favorites(text, uuid, integer) to souq_web;

-- 3b. is_favorite (item 4): which of the given listings the reader has saved. Part of a public
-- read, so it never raises on the session: a guest, a limited session (DEC73) or a session that
-- is no longer live reads no row (app.public_viewer). At most 51 ids, a market page.
create function app.favorite_flags(p_listings uuid[])
returns table (listing_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer uuid;
begin
  if p_listings is null or pg_catalog.cardinality(p_listings) > 51 then
    perform app.raise_api_error('BAD_REQUEST', 'listing_ids', 'out_of_range');
  end if;
  select v.viewer_id into v_viewer from app.public_viewer() v;
  if v_viewer is null then
    return;
  end if;
  return query
  select f.listing_id
    from public.favorite f
   where f.user_id = v_viewer
     and f.listing_id = any (p_listings);
end;
$$;
comment on function app.favorite_flags(uuid[]) is
  'Task 4.5: which of the given listings the reader saved; no row for a guest.';
grant execute on function app.favorite_flags(uuid[]) to souq_web;
