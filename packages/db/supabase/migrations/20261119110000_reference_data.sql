-- Reference data (task 2.3, plan/task-2.3.md): BR03, FR55, UC24, DEC28, BR10, section 4.4 of the
-- addendum (label_en optional). Values are never deleted once used: the referencing tables block
-- it with their foreign keys, and task 7.7 deactivates instead (is_active). No role writes here
-- directly (task 2.1). Adding an eighth category: ops/runbooks/reference-data.md.

-- Labels: 1-120 code points after NFC and outer trim (CatalogEntryInput in the contract).
-- Duplicates are detected after the DEC67 search normalization (item 2), so labels that differ
-- only by diacritics, teh marbuta or hamza on alef count as the same.

create table public.category (
  id uuid primary key default gen_random_uuid(),
  key public.category_key not null unique,
  label_ar text not null,
  label_en text,
  display_order integer not null default 0,
  is_active boolean not null default true,
  source_ref text,
  version integer not null default 1,
  created_at timestamptz not null default app.app_now(),
  updated_at timestamptz not null default app.app_now(),
  constraint category_label_ar check (
    label_ar = app.normalize_text(label_ar) and char_length(label_ar) between 1 and 120
  ),
  constraint category_label_en check (
    label_en is null
    or (label_en = app.normalize_text(label_en) and char_length(label_en) between 1 and 120)
  ),
  constraint category_version_positive check (version >= 1)
);
create unique index category_label_ar_unique on public.category (app.search_normalize(label_ar));
create unique index category_label_en_unique on public.category (app.search_normalize(label_en))
  where label_en is not null;

create table public.college (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label_ar text not null,
  label_en text,
  display_order integer not null default 0,
  is_active boolean not null default true,
  source_ref text,
  version integer not null default 1,
  created_at timestamptz not null default app.app_now(),
  updated_at timestamptz not null default app.app_now(),
  constraint college_key_format check (key ~ '^[a-z0-9_]{2,64}$'),
  constraint college_label_ar check (
    label_ar = app.normalize_text(label_ar) and char_length(label_ar) between 1 and 120
  ),
  constraint college_label_en check (
    label_en is null
    or (label_en = app.normalize_text(label_en) and char_length(label_en) between 1 and 120)
  ),
  constraint college_version_positive check (version >= 1)
);
create unique index college_label_ar_unique on public.college (app.search_normalize(label_ar));
create unique index college_label_en_unique on public.college (app.search_normalize(label_en))
  where label_en is not null;

-- DEC28: suggested public places on campus or in the city. No address or GPS (BR10).
create table public.meeting_point (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  kind public.meeting_point_kind not null,
  label_ar text not null,
  label_en text,
  display_order integer not null default 0,
  is_active boolean not null default true,
  source_ref text,
  version integer not null default 1,
  created_at timestamptz not null default app.app_now(),
  updated_at timestamptz not null default app.app_now(),
  constraint meeting_point_key_format check (key ~ '^[a-z0-9_]{2,64}$'),
  constraint meeting_point_label_ar check (
    label_ar = app.normalize_text(label_ar) and char_length(label_ar) between 1 and 120
  ),
  constraint meeting_point_label_en check (
    label_en is null
    or (label_en = app.normalize_text(label_en) and char_length(label_en) between 1 and 120)
  ),
  constraint meeting_point_version_positive check (version >= 1)
);
create unique index meeting_point_label_ar_unique
  on public.meeting_point (app.search_normalize(label_ar));
create unique index meeting_point_label_en_unique
  on public.meeting_point (app.search_normalize(label_en)) where label_en is not null;

-- BR03: the seven stable categories, in every environment (item 1), with the labels of the
-- "Market categories and item conditions" table in docs/spec-v3-en.md.
insert into public.category (key, label_ar, label_en, display_order, source_ref) values
  ('books_study', 'الكتب والدراسة', 'Books and study', 1, 'spec-v3-en: market categories'),
  ('electronics', 'الإلكترونيات', 'Electronics', 2, 'spec-v3-en: market categories'),
  ('room_furniture', 'الأثاث والسكن', 'Furniture and housing', 3, 'spec-v3-en: market categories'),
  ('university_supplies', 'المستلزمات الجامعية', 'University supplies', 4, 'spec-v3-en: market categories'),
  ('clothing_personal', 'الملابس والعناية', 'Clothing and personal care', 5, 'spec-v3-en: market categories'),
  ('vehicles', 'وسائل التنقل والمركبات', 'Transport and vehicles', 6, 'spec-v3-en: market categories'),
  ('other', 'أخرى', 'Other', 7, 'spec-v3-en: market categories');

-- Reads (item 3): every row, active or not, so old listings and profiles keep their labels
-- (TC80). Pick lists show active rows only (API030). Internal columns are not granted.
alter table public.category enable row level security;
alter table public.college enable row level security;
alter table public.meeting_point enable row level security;

grant select (id, key, label_ar, label_en, display_order, is_active)
  on public.category to anon, authenticated;
grant select (id, key, label_ar, label_en, display_order, is_active)
  on public.college to anon, authenticated;
grant select (id, key, kind, label_ar, label_en, display_order, is_active)
  on public.meeting_point to anon, authenticated;

create policy category_read on public.category for select to anon, authenticated using (true);
create policy college_read on public.college for select to anon, authenticated using (true);
create policy meeting_point_read on public.meeting_point for select to anon, authenticated
  using (true);

-- FR01, FR14: optional college in the profile, public like the profile name (item 4).
alter table public.profile add column college_id uuid references public.college (id);
create index profile_college on public.profile (college_id) where college_id is not null;
grant select (college_id) on public.profile to anon, authenticated;
