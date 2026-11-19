# @souq/db

هجرات SQL، والقيود، وسياسات RLS، ودوال Postgres، والبيانات التجريبية.

- إعداد Supabase المحلي في المهمة 1.4: `supabase/config.toml` وقوالب البريد العربية.
- خط الأساس الأمني في المهمة 2.1 (SEC02، DEC36): `supabase/migrations/` وتفاصيله في `plan/task-2.1.md`.
- جداول الهوية والحارس في المهمة 2.2: تفاصيلها في `plan/task-2.2.md`.
- البيانات المرجعية في المهمة 2.3: `plan/task-2.3.md`، وطريقة إضافة فئة في `ops/runbooks/reference-data.md`.

## قواعد كتابة الهجرات

- **للأمام فقط، ولا تُعدَّل بعد الدمج.** `pnpm check:migrations` في CI يرفض تعديل هجرة مدموجة أو حذفها، ويطلب أن يأتي رقم الهجرة الجديدة الزمني بعد آخر هجرة مدموجة.
- **الاسم:** `<YYYYMMDDHHMMSS>_<snake_case>.sql`، ومعرّفات المواصفات في الاسم أو أول تعليق.
- **كل تغيير في القاعدة عبر هجرة،** لا من Studio. الفحص الشامل يرفض أي كائن في `public` أو `app` لا يملكه `postgres`.
- **المحارف الخاصة** (العربية الخاصة والمسافات غير العادية والمحارف غير المرئية) تُكتب بتسلسلات هروب `U&'\0640'`، لا بنفسها.
- **الصلاحيات صريحة دائماً.** الصلاحيات الافتراضية لا تعطي `anon` ولا `authenticated` ولا `service_role` شيئاً على الكائنات الجديدة.

## الجداول

- **RLS مفعّلة على كل جدول** في `public` و`app`.
- **لا كتابة مباشرة:** لا INSERT ولا UPDATE ولا DELETE ولا TRUNCATE ولا REFERENCES ولا TRIGGER ولا MAINTAIN لـ `anon` أو `authenticated` أو `service_role` أو `souq_web` أو `souq_worker`.
- **القراءة:** `anon` و`authenticated` فقط، حين تمنح الشريحة SELECT صراحة، وتحكمها RLS.
- **view:** بـ `security_invoker = true` دائماً. لا materialized view ولا foreign table في `public`.
- **الوقت:** القيم الافتراضية لأعمدة الوقت `app.app_now()`، لا `now()`.

## دوال `app`

- **دالة مدخل** يستدعيها خادم Next.js أو العامل:
  - `security definer` ومالكها `postgres`، و`set search_path = ''`، وكل اسم مؤهل بالـ schema (`public.listing`، `pg_catalog.now()`).
  - بلا SQL ديناميكي.
  - تبدأ بـ `app.actor_id()` إن كانت لعضو، ثم تعيد فحص الجلسة والملكية والحظر وحالة الحساب.
  - EXECUTE يُمنح صراحة لدور واحد فقط: `souq_web` لدوال الأعضاء، أو `souq_worker` لدوال المهام الخلفية.
- **دالة داخلية:** `set search_path = ''`، وبلا أي منح، فلا يستدعيها إلا دالة مدخل.
- **الأخطاء:** `perform app.raise_api_error('STATE_CONFLICT')`، أو مع الحقل وقاعدته: `perform app.raise_api_error('VALIDATION_FAILED', 'title', 'too_small')`. الرمز من `ErrorCode` في العقد، والخطأ بـ SQLSTATE `SJ001`.
- **الوقت:** `app.app_now()` فقط. الاختبارات تستبدلها محلياً بساعة اختبار.
- **النص:** `app.normalize_text()` لحدود الطول (NFC والقص، مثل `normalizeText` في `packages/domain`). و`app.search_normalize()` لنسخة البحث فقط (DEC67).

## الهوية (المهمة 2.2)

- **`profile.id` = معرّف حساب الدخول عند الإنشاء.** سياسات RLS تكتب `owner_id = (select auth.uid())` مباشرة.
- **لا CASCADE من `auth.users`:** المفتاح الوحيد إليه `profile.auth_user_id` بـ `ON DELETE SET NULL`، فيبقى الملف معرّفاً مستعاراً (RET06).
- **`hidden_from_public` لا تكتبه أي دالة:** يُشتق بمُشغّل على `account_control` في نفس المعاملة، وفحص مؤجّل عند الالتزام يرفض أي اختلاف. دوال الإيقاف والحظر والحذف تغيّر `account_control` فقط.
- **محتوى عام لحساب مقيّد:** سياسات الجداول القادمة تقرأ `profile` العام (الصف المخفي لا يظهر لغير صاحبه)، فلا تحتاج قراءة `account_control`.
- **صلاحيات الأعمدة:** كل SELECT بقائمة أعمدة صريحة. عمود جديد لا يقرؤه أحد حتى يُمنح، واختبار `identity.test.ts` يحدد القائمة المسموحة لكل جدول.
- **دالة كتابة للعضو تبدأ بـ `app.assert_active_member()`،** لا بـ `app.actor_id()` وحدها. ترجع معرّف العضو بعد فحص الجلسة والحذف والتقييد والبريد والإقرار، وتقفل صف `account_control` بـ FOR SHARE.

## البيانات المرجعية (المهمة 2.3)

- **الفئات السبع في الهجرة،** والكليات ونقاط اللقاء ونسخ السياسات التجريبية في `supabase/seed.sql` فقط. لا يصل `seed.sql` لأي قاعدة مستضافة.
- **قيمة مستخدمة لا تُحذف:** كل جدول يشير إلى قائمة مرجعية يضع مفتاحاً أجنبياً عادياً (بلا CASCADE)، والتعطيل بـ `is_active`.
- **التسميات فريدة بعد `app.search_normalize`** (DEC67)، بفهرس فريد على التعبير نفسه.
- **الصفوف المعطّلة تُقرأ،** وقوائم الاختيار تصفّي `is_active`.

## schema `rls`

- دوال تستدعيها سياسات RLS: `security invoker` وSTABLE أو IMMUTABLE، و`set search_path = ''`. EXECUTE لـ `anon` أو `authenticated` صراحة لكل دالة.
- تقرأ ما تسمح به RLS للمتصل فقط (شرط المالك 3 على 2.1). مثال: `rls.has_role('moderator')`.

## القوائم الثابتة (enum)

- الأنواع في `public`، والقيم نفسها في `packages/domain/src/enums.ts` والعقد. اختبارا `enums` يفشلان عند أي اختلاف.
- إضافة قيمة: هجرة `alter type ... add value`، مع تحديث `packages/domain` والعقد معاً (DEC48).

## الفحوص

| الأمر | ما يفحصه |
| --- | --- |
| `pnpm test:integration` | الفحص الشامل (`tests/integration/_harness/security.ts`) وكل اختبارات القاعدة |
| `pnpm db:lint` | أجسام دوال PL/pgSQL بإضافة plpgsql_check |
| `pnpm check:migrations` | الهجرات المدموجة لم تتغير |
| `pnpm check:supabase-images` | صور Supabase العاملة تطابق `supabase/images.lock.json` |
