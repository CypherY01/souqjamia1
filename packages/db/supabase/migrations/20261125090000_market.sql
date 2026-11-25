-- Task 4.3 (plan/task-4.3.md): home, market and listing details. FR06 to FR13, NFR14, RL04,
-- API031, API032, DEC28, DEC67, DEC77, DEC84, UC03, UC04.
--  1. Market indexes (chapter 08 "Indexes and search"): newest, price, newest in a category, and
--     the trigram index of the search copy without spaces (DEC84 "exact").
--  2. Internal helpers: app.public_viewer() (who reads, never raises) and
--     app.public_listing_visible() (what the public may see).
--  3. app.market_listings(): API031, the home page and /market (DEC84 matching and order).
--  4. app.public_listing() and app.public_listing_images(): API032.
-- The limits are the same as packages/domain/src/market.ts (tests/integration/market.test.ts
-- compares them): 100 code points for the normalized query, 50 cards a page (the server asks one
-- more to know whether a next page exists), similarity 0.5 for "close" (DEC84).

-- 1. Partial indexes on what the market shows: active and not hidden by moderation. The price
-- index serves both directions. listing_search_trgm (task 4.2) serves the words and the
-- similarity; the space-less copy needs its own expression index.
create index listing_market_newest on public.listing (created_at desc, id desc)
  where status = 'active' and moderation_hidden_at is null;
create index listing_market_price on public.listing (price_minor, id)
  where status = 'active' and moderation_hidden_at is null;
create index listing_market_category_newest on public.listing (category_id, created_at desc, id desc)
  where status = 'active' and moderation_hidden_at is null;
create index listing_search_compact_trgm on public.listing
  using gin ((pg_catalog.replace(search_text, ' ', '')) extensions.gin_trgm_ops)
  where status = 'active' and moderation_hidden_at is null;

-- 2a. Who reads a public page: a member with a live normal session, or a guest. A guest, a
-- limited session (DEC73) and a session that is no longer live all read as a guest, so a public
-- read never fails on the session. restricted: suspended, banned or awaiting deletion.
-- Internal, no grant.
create function app.public_viewer()
returns table (viewer_id uuid, restricted boolean)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_claims text := nullif(pg_catalog.current_setting('request.jwt.claims', true), '');
  v_id uuid;
  v_restricted boolean;
begin
  if v_claims is null or app.limited_session() then
    return query select null::uuid, false;
    return;
  end if;
  begin
    select s.user_id, s.restricted or s.deletion_requested_at is not null
      into v_id, v_restricted
      from app.session_context() s;
  exception when sqlstate 'SJ001' then
    v_id := null;
    v_restricted := false;
  end;
  return query select v_id, coalesce(v_restricted, false);
end;
$$;
comment on function app.public_viewer() is
  'Task 4.3: the member reading a public page, or null for a guest. Never raises on the session.';

-- 2b. UC04, TC05: what the public may see of a listing. Active or sold (DEC84: a sold listing
-- keeps its page), not hidden by moderation, and its seller neither hidden (suspended, banned,
-- awaiting deletion: profile.hidden_from_public, tasks 2.2 and 3.7) nor deleted. Archived and
-- everything else is the same generic 404. Internal, no grant.
create function app.public_listing_visible(p_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.listing l
      join public.profile p on p.id = l.seller_id
     where l.id = p_id
       and l.status in ('active', 'sold')
       and l.moderation_hidden_at is null
       and not p.hidden_from_public
       and p.deleted_at is null
  )
$$;
comment on function app.public_listing_visible(uuid) is
  'Task 4.3, UC04: whether the public may read a listing (active or sold, not hidden).';

-- 3. API031 (FR06 to FR12, NFR14, RL04, DEC84, TC04, TC29). Public: a guest reads it. RL04 is
-- counted by the server on its own connection before this read (a STABLE read never writes).
-- Shown: active listings only (DEC84: sold ones are not in the market), not hidden by
-- moderation, of a seller who is not hidden or deleted. Filters intersect (FR09).
-- The query (DEC84), after DEC67 normalization:
--  - match_tier 1 "exact": every word is a part of the search copy, or the query without spaces
--    is a part of the search copy without spaces ("لابتوب" and "لاب توب").
--  - match_tier 2 "close": otherwise, word_similarity(query, search copy) >= 0.5 (the <%
--    operator, with the threshold set on this function).
--  - No query: every row is tier 1.
-- Order: tier, then the chosen sort, then the id (FR11): newest is created_at desc, id desc;
-- price_asc is price_minor, id; price_desc is price_minor desc, id desc. The cursor is the
-- last row's (tier, value, id), value being created_at as text or the price as text.
-- The index-friendly form: the longest word, the space-less copy and the similarity are one OR
-- the trigram indexes serve; every word is then checked on those rows. force_custom_plan lets
-- the planner see the parameters, so the branches of an absent filter or another sort fold away.
create function app.market_listings(
  p_query text,
  p_category public.category_key,
  p_condition public.item_condition,
  p_location uuid,
  p_sort text,
  p_after_tier smallint,
  p_after_value text,
  p_after_id uuid,
  p_limit integer
)
returns table (
  listing_id uuid,
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
  created_key text,
  primary_media_id uuid,
  primary_public_ready boolean,
  match_tier smallint
)
language plpgsql
stable
security definer
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
set pg_trgm.word_similarity_threshold = '0.5'
as $$
declare
  v_query text := nullif(app.search_normalize(coalesce(p_query, '')), '');
  v_sort text := coalesce(p_sort, 'newest');
  v_category uuid;
  v_patterns text[];
  v_longest text;
  v_compact text;
  v_after_created timestamptz;
  v_after_price integer;
begin
  if v_query is not null and pg_catalog.char_length(v_query) > 100 then
    perform app.raise_api_error('BAD_REQUEST', 'q', 'too_big');
  end if;
  if v_sort not in ('newest', 'price_asc', 'price_desc') then
    perform app.raise_api_error('BAD_REQUEST', 'sort', 'invalid_value');
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 51 then
    perform app.raise_api_error('BAD_REQUEST', 'limit', 'out_of_range');
  end if;
  -- FR10, DEC28: only an active suggested meeting point is a filter.
  if p_location is not null
    and not exists (select 1 from public.meeting_point m where m.id = p_location and m.is_active) then
    perform app.raise_api_error('BAD_REQUEST', 'location', 'unavailable');
  end if;
  if p_category is not null then
    select c.id into v_category from public.category c where c.key = p_category;
  end if;
  if (p_after_id is null) <> (p_after_tier is null) or (p_after_id is null) <> (p_after_value is null) then
    perform app.raise_api_error('INVALID_CURSOR');
  end if;
  if p_after_id is not null then
    begin
      if v_sort = 'newest' then
        v_after_created := p_after_value::timestamptz;
      else
        v_after_price := p_after_value::integer;
      end if;
    exception when others then
      perform app.raise_api_error('INVALID_CURSOR');
    end;
  end if;

  if v_query is not null then
    -- LIKE patterns: the words with \ % _ escaped (the default LIKE escape is a backslash).
    select pg_catalog.array_agg(
             '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(w.word, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'
             order by w.ord),
           (pg_catalog.array_agg(
             '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(w.word, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'
             order by pg_catalog.char_length(w.word) desc, w.ord))[1]
      into v_patterns, v_longest
      from pg_catalog.unnest(pg_catalog.string_to_array(v_query, ' ')) with ordinality as w(word, ord);
    v_compact := '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
                   pg_catalog.replace(v_query, ' ', ''), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
  end if;

  return query
  select l.id, l.title, l.price_minor, l.is_negotiable, l.condition,
         c.id, c.key, c.label_ar, c.label_en,
         m.id, m.key, m.kind, m.label_ar, m.label_en,
         l.status,
         false,
         l.created_at, l.created_at::text,
         pi.media_id,
         coalesce((select pg_catalog.count(*)
                     from public.media_derivative d
                    where d.media_id = pi.media_id
                      and d.visibility = 'public'
                      and d.deleted_at is null
                      and d.variant in ('w150', 'w600', 'w1200')) = 3, false),
         t.tier
    from public.listing l
    join public.profile p on p.id = l.seller_id
    join public.category c on c.id = l.category_id
    left join public.meeting_point m on m.id = l.location_id
    left join public.listing_image pi on pi.listing_id = l.id and pi.position = 1
    cross join lateral (
      select (case
                when v_query is null then 1
                when l.search_text like all (v_patterns)
                  or pg_catalog.replace(l.search_text, ' ', '') like v_compact then 1
                else 2
              end)::smallint as tier
    ) t
   where l.status = 'active'
     and l.moderation_hidden_at is null
     and not p.hidden_from_public
     and p.deleted_at is null
     and (v_category is null or l.category_id = v_category)
     and (p_condition is null or l.condition = p_condition)
     and (p_location is null or l.location_id = p_location)
     and (v_query is null or (
           (l.search_text like v_longest
             or pg_catalog.replace(l.search_text, ' ', '') like v_compact
             or v_query operator(extensions.<%) l.search_text)
           and (l.search_text like all (v_patterns)
             or pg_catalog.replace(l.search_text, ' ', '') like v_compact
             or v_query operator(extensions.<%) l.search_text)))
     and (p_after_id is null
       or t.tier > p_after_tier
       or (t.tier = p_after_tier and (
             (v_sort = 'newest' and (l.created_at, l.id) < (v_after_created, p_after_id))
          or (v_sort = 'price_asc' and (l.price_minor, l.id) > (v_after_price, p_after_id))
          or (v_sort = 'price_desc' and (l.price_minor, l.id) < (v_after_price, p_after_id)))))
   order by t.tier,
            case when v_sort = 'newest' then l.created_at end desc,
            case when v_sort = 'price_asc' then l.price_minor end,
            case when v_sort = 'price_desc' then l.price_minor end desc,
            case when v_sort = 'price_asc' then l.id end,
            case when v_sort <> 'price_asc' then l.id end desc
   limit p_limit;
end;
$$;
comment on function app.market_listings(text, public.category_key, public.item_condition, uuid, text, smallint, text, uuid, integer) is
  'Task 4.3, API031, DEC84: public market cards with match tier, filters and keyset order.';
grant execute on function app.market_listings(text, public.category_key, public.item_condition, uuid, text, smallint, text, uuid, integer) to souq_web;

-- 4a. API032 (FR13, UC04, TC05): one public listing with its seller and what the reader may do,
-- or no row (the generic 404). The seller fields of later tasks are fixed values: the student
-- badge is false until task 7.6 and the rating count 0 («بائع جديد») until task 6.2.
-- Capabilities (ListingCapabilities), the first reason that applies: sign_in_required (a guest),
-- own_content (the seller), account_restricted (suspended, banned or awaiting deletion),
-- context_closed (sold); then, for an offer only, free_item and not_negotiable. Blocks (5.7) and
-- a pending offer (5.5) are added by those tasks.
create function app.public_listing(p_id uuid)
returns table (
  listing_id uuid,
  title text,
  description text,
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
  sold_at timestamptz,
  created_at timestamptz,
  seller_id uuid,
  seller_display_name text,
  seller_college_id uuid,
  seller_college_key text,
  seller_college_label_ar text,
  seller_college_label_en text,
  seller_joined_at timestamptz,
  seller_student_badge boolean,
  seller_rating_count integer,
  can_contact boolean,
  can_offer boolean,
  disabled_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer uuid;
  v_restricted boolean;
begin
  if not app.public_listing_visible(p_id) then
    return;
  end if;
  select v.viewer_id, v.restricted into v_viewer, v_restricted from app.public_viewer() v;

  return query
  select l.id, l.title, l.description, l.price_minor, l.is_negotiable, l.condition,
         c.id, c.key, c.label_ar, c.label_en,
         m.id, m.key, m.kind, m.label_ar, m.label_en,
         l.status, l.sold_at, l.created_at,
         p.id, p.display_name,
         g.id, g.key, g.label_ar, g.label_en,
         p.joined_at, false, 0,
         a.contact,
         a.contact and l.price_minor > 0 and l.is_negotiable,
         case
           when v_viewer is null then 'sign_in_required'
           when v_viewer = l.seller_id then 'own_content'
           when v_restricted then 'account_restricted'
           when l.status = 'sold' then 'context_closed'
           when l.price_minor = 0 then 'free_item'
           when not l.is_negotiable then 'not_negotiable'
         end
    from public.listing l
    join public.profile p on p.id = l.seller_id
    join public.category c on c.id = l.category_id
    left join public.meeting_point m on m.id = l.location_id
    left join public.college g on g.id = p.college_id
    cross join lateral (
      select v_viewer is not null
             and v_viewer <> l.seller_id
             and not v_restricted
             and l.status = 'active' as contact
    ) a
   where l.id = p_id;
end;
$$;
comment on function app.public_listing(uuid) is
  'Task 4.3, API032: a public listing, its seller and the reader''s capabilities, or no row.';
grant execute on function app.public_listing(uuid) to souq_web;

-- 4b. The images of a public listing in position order. public_ready: the three public variants
-- exist (media.publish has run), so the server may build their URLs; before that the page shows
-- «الصور قيد التجهيز» (owner note on task 4.2). No row for a listing the public may not see.
create function app.public_listing_images(p_id uuid)
returns table (media_id uuid, image_position smallint, public_ready boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.public_listing_visible(p_id) then
    return;
  end if;
  return query
  select i.media_id, i.position,
         (select pg_catalog.count(*)
            from public.media_derivative d
           where d.media_id = i.media_id
             and d.visibility = 'public'
             and d.deleted_at is null
             and d.variant in ('w150', 'w600', 'w1200')) = 3
    from public.listing_image i
   where i.listing_id = p_id
   order by i.position;
end;
$$;
comment on function app.public_listing_images(uuid) is
  'Task 4.3, API032: the images of a public listing and whether their public copies exist.';
grant execute on function app.public_listing_images(uuid) to souq_web;
