-- Local seed data (task 2.3, item 5 of plan/task-2.3.md). Clearly fake fixtures only, never real
-- people or campus names (CLAUDE.md). `pnpm db:reset` and `supabase start` apply it locally and
-- in CI; no hosted database runs it. Real colleges and meeting points come from the owner's G02
-- file (task 7.7), real policy texts with task 7.8 (G06). No members and no passwords (SEC02).
-- tests/integration/reference-data.test.ts checks that every row here is a marked fixture.

insert into public.college (key, label_ar, label_en, display_order, source_ref) values
  ('test_college_1', 'كلية تجريبية 1', 'Test college 1', 1, 'fixture'),
  ('test_college_2', 'كلية تجريبية 2', 'Test college 2', 2, 'fixture'),
  ('test_college_3', 'كلية تجريبية 3', 'Test college 3', 3, 'fixture');

-- DEC28: two suggested places on campus and two in the city.
insert into public.meeting_point (key, kind, label_ar, label_en, display_order, source_ref) values
  ('test_point_1', 'campus', 'نقطة لقاء تجريبية 1', 'Test meeting point 1', 1, 'fixture'),
  ('test_point_2', 'campus', 'نقطة لقاء تجريبية 2', 'Test meeting point 2', 2, 'fixture'),
  ('test_point_3', 'city', 'نقطة لقاء تجريبية 3', 'Test meeting point 3', 3, 'fixture'),
  ('test_point_4', 'city', 'نقطة لقاء تجريبية 4', 'Test meeting point 4', 4, 'fixture');

-- DEC36: draft policy versions, so a local member can acknowledge them and write.
insert into public.policy_version (policy_type, version, effective_at, path) values
  ('terms', 'draft-1', '2026-01-01T00:00:00Z', '/policies/terms'),
  ('privacy', 'draft-1', '2026-01-01T00:00:00Z', '/policies/privacy');
