# @souq/db

هجرات SQL، والقيود، وسياسات RLS، ودوال Postgres، والبيانات التجريبية.

- إعداد Supabase المحلي في المهمة 1.4: `supabase/config.toml` وقوالب البريد العربية.
- خط الأساس الأمني في المهمة 2.1 (SEC02، DEC36): `supabase/migrations/` وتفاصيله في `plan/task-2.1.md`.
- جداول الهوية والحارس في المهمة 2.2: تفاصيلها في `plan/task-2.2.md`.
- البيانات المرجعية في المهمة 2.3: `plan/task-2.3.md`، وطريقة إضافة فئة في `ops/runbooks/reference-data.md`.
- البنية التحتية في المهمة 2.4: `plan/task-2.4.md`، وDEC70.
- دوال العامل الخلفي في المهمة 2.5: `plan/task-2.5.md`، وDEC71.
- اتصال خادم Next.js والحراس في المهمة 3.1: `plan/task-3.1.md`، وDEC72 وDEC73.
- التسجيل والإقرار بالسياسات في المهمة 3.2: `plan/task-3.2.md`، وDEC74.
- التأكيد المزدوج لتغيير البريد في المهمة 3.6: `plan/task-3.6.md`، وDEC79، وفحص الترقية في `ops/runbooks/supabase-upgrade.md`.

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

## أدوات دوال الكتابة (المهمة 2.4)

الجداول الداخلية (`idempotency_record` و`rate_limit_bucket` و`audit_event` و`job`) في `app`، فلا تنكشف عبر REST أبداً. دالة مدخل للعضو تستعمل الأدوات بهذا الترتيب داخل معاملتها:

```sql
v_member := app.assert_active_member();
v_prior := app.idempotency_claim('POST /api/listings', p_key, p_input);
if v_prior is not null then return v_prior; end if;
perform app.rate_limit_take('RL05:hour', pg_catalog.sha256(pg_catalog.convert_to(v_member::text, 'UTF8')), 5, '1 hour');
-- ... العمل نفسه ...
perform app.notify(v_seller, 'offer.received', 'offer', v_offer_id, 'offer.received:' || v_offer_id);
perform app.audit('listing.publish', 'listing', v_listing_id);
perform app.idempotency_complete('POST /api/listings', p_key, v_result);
```

- **حدود النجاح** بـ `app.rate_limit_take` داخل المعاملة: تُلغى زيادتها إن فشلت العملية.
- **حدود الفشل والمحاولات** (DEC70) بـ `app.rate_limit_hit` من الخادم، على اتصال منفصل وفي معاملة خاصة بها، بعد المحاولة. و`app.rate_limit_check` للفحص قبلها بلا زيادة. كلتاهما لـ `souq_web` فقط.
- **النافذة** يجب أن تقسم اليوم (دقيقة، 10 دقائق، ساعة، يوم...)، فتبدأ النوافذ عند منتصف الليل UTC.
- **التدقيق** لا يُعدَّل ولا يُحذف. الحذف فقط عبر `app.purge_audit_events` لـ `souq_worker`، للصفوف الأقدم من 730 يوماً.
- **المهام والإشعارات** تُنشأ في نفس المعاملة، فإن أُلغيت لم يبقَ منها شيء. ونفس `dedupe_key` يرجع الموجود.
- **الإشعار بلا رابط مخزّن:** الخادم يحسبه من `context_type` و`context_id`.

## دوال العامل الخلفي (المهمة 2.5)

`20261119130000_worker_jobs.sql`. كلها دوال مدخل لـ `souq_worker` وحده، إلا فحص الطابور لـ `souq_web`:

| الدالة | العمل |
| --- | --- |
| `app.claim_jobs(kinds, limit)` | تأخذ المستحق من الأنواع المعطاة بـ `SKIP LOCKED`، بحجز 5 دقائق، وتعدّ المحاولة عند الأخذ |
| `app.complete_job(id, attempt)` | `done`، فقط إذا كانت المحاولة ما زالت صاحبة المهمة |
| `app.fail_job(id, attempt, code, retryable)` | إعادة بعد 1 ثم 5 و15 ثم 60 دقيقة (OPS03)، أو `dead` للخطأ الدائم والمحاولة العاشرة |
| `app.reap_expired_jobs()` | `dead` بالرمز `LEASE_EXPIRED` لمهمة انتهى حجزها في محاولتها الأخيرة |
| `app.schedule_job(kind, every)` | مهمة واحدة لكل فترة UTC ثابتة تقسم اليوم، بمفتاح `schedule:<kind>:<بداية الفترة>` |
| `app.job_queue_health()` | لـ `souq_web`: عمر أقدم مهمة مستحقة، وعدد الميتة في 24 ساعة. أرقام فقط |

- **مرة واحدة على الأقل (DEC71):** المهمة قد تُنفَّذ مرتين، فكل معالج آمن للتكرار. دالة `app` يستدعيها معالج تمنع التكرار بمفتاح `dedupe_key`، أو تفحص الحالة قبل الانتقال.
- **مهمة جديدة من دالة عمل:** `app.enqueue_job('<kind>', ...)` في نفس المعاملة، ومعالجها في `apps/worker/src/registry.ts`. اختبار `worker-registry` يفشل إن وُجد نوع في الهجرات بلا معالج.
- **حدود زمن الدور:** 30 ثانية للاستعلام، و60 للمعاملة الخاملة، تُطبَّق حين يدخل `souq_worker` بنفسه.
- **كلمة مرور الدور** لا تُكتب في هجرة. محلياً يضعها `pnpm env:local`، و`pnpm db:reset` يمسحها.

## خادم Next.js (المهمة 3.1)

`20261119140000_web_session.sql`، وتفاصيله في `plan/task-3.1.md`:

| الدالة | العمل |
| --- | --- |
| `app.session_context()` | لـ `souq_web`: الجلسة الحية وحالة الحساب والاسم والأدوار في استعلام واحد، لحراس القراءة في الخادم. `UNAUTHENTICATED` بنفس شروط `assert_active_member` |
| `app.assert_active_member()` | استُبدلت: بعد فحص الجلسة الحية ترفض الجلسة المحدودة بـ `RECOVERY_SESSION_ONLY` (DEC73) |
| `app.limited_session()` | داخلية: الجلسة ليس في `amr` لها `password` (رابط الاستعادة يعطي `otp` فقط) |

- **الهوية من الخادم:** `withActor` في `apps/web/lib/db/app-client.ts` يضبط `request.jwt.claims` و`app.trace_id` للمعاملة فقط، بعد تحقق `getClaims` من التوقيع. دالة مدخل للعضو لا تقرأ الهوية من غير `app.actor_id()`.
- **DEC72:** الخادم يعيد المعاملة كلها حتى 3 مرات عند `40001` و`40P01`. فدالة المدخل تُكتب لتُعاد من أولها: كل أثرها داخل المعاملة، ومفتاح منع التكرار نفسه في كل محاولة.
- **دالة مُشغّل تقرأ جدولاً تكون `security definer`** بلا منح. المُشغّل المؤجّل (`deferrable`) يعمل عند الالتزام بدور الجلسة، أي `souq_web`، خارج دالة المدخل، و`souq_web` لا يقرأ أي جدول. هكذا ظهر خلل `app.check_idempotency_completed()` من 2.4 وأُصلح هنا.
- **حدود زمن `souq_web`:** 5 ثوانٍ للاستعلام، و3 لانتظار القفل، و15 للمعاملة الخاملة، حين يدخل الدور بنفسه.
- **كلمة مرور `souq_web`** لا تُكتب في هجرة. محلياً يضعها `pnpm env:local`، و`pnpm db:reset` يمسحها.

## التسجيل والإقرار بالسياسات (المهمة 3.2)

`20261120090000_signup.sql`، وتفاصيله في `plan/task-3.2.md`:

| الدالة | العمل |
| --- | --- |
| `app.create_profile_for_auth_user()` | استُبدلت (المُشغّل على `auth.users`): تقرأ من بيانات التسجيل الاسم و`terms_version` و`privacy_version` و`college_id`، وتكتب الملف والإقرارين والكلية وصف تفضيلات البريد في معاملة إنشاء الحساب. نسخة غير الحالية، أو كلية غير نشطة: يُرفض التسجيل كله |
| `app.current_policies()` | لـ `souq_web` (API114): النسخة السارية لكل نوع سياسة، بنفس اختيار `app.current_policy_version()` |
| `app.active_colleges()` | لـ `souq_web`: الكليات النشطة بترتيب العرض، لصفحة التسجيل |
| `app.acknowledge_policies(terms, privacy)` | لـ `souq_web` (API119، DEC69): جلسة حية عادية بأي حالة حساب. نسخة غير الحالية `STATE_CONFLICT`، والتكرار بلا صف جديد |
| `app.assert_live_session()` | داخلية: الجلسة الحية بلا الجلسة المحدودة (DEC73)، لمستوى الوصول `session` |

- **أي إنشاء لحساب دخول يرسل النسختين الحاليتين** في بيانات المستخدم (`data` في التسجيل، و`generate_link` و`admin.createUser`)، وإلا رفضه المُشغّل. أداة الاختبارات `signupData()` في `tests/integration/_harness/users.ts`، وسكربت تهيئة المالك في 7.1 يحتاجها أيضاً.
- **دالة تستبدل دالة سابقة تبدأ من آخر نسخة لها،** لا من أول هجرة: المُشغّل عُرّف في 2.2، ثم استُبدل في 2.4 بصف التفضيلات، ثم هنا. اختبار «every profile has its preference row» كشف ذلك أثناء التنفيذ.

## القراءة من الخادم والحساب (المهمة 3.5، DEC77 وDEC78)

`20261121090000_account_profile.sql`، وتفاصيله في `plan/task-3.5.md`:

| الدالة | العمل |
| --- | --- |
| `app.me()` | لـ `souq_web` (API015، DEC58): حقول الحساب الخاصة لعضو الجلسة، ومنها البريد وMFA من `auth`. أي جلسة حية عادية بأي حالة حساب، والجلسة المحدودة `RECOVERY_SESSION_ONLY`. تبني على `app.session_context()` فلا يتكرر فحص الجلسة |
| `app.update_profile(expected_version, patch)` | لـ `souq_web` (API016): الاسم والكلية، و`avatar_id` بمعرّف `unknown` حتى 4.7، و`locale` = `ar` فقط. أي مفتاح آخر `BAD_REQUEST`، والنسخة القديمة `STATE_CONFLICT` دائماً. الكلية الحالية تبقى ولو عُطّلت. طلب بلا تغيير يرجع النسخة نفسها بلا عدّ ولا تدقيق. حد DEC78 بـ `app.rate_limit_take('DEC78:hour', ...)`، وتدقيق `profile.update` بأسماء الحقول فقط |

**قاعدة القراءة من الخادم (DEC77):** خادم Next.js لا يقرأ عبر PostgREST، بل بدوال قراءة في `app`:
- **دالة القراءة** = دالة في `app` بصفة `stable` أو `immutable` ينفّذها دور خادم. `security definer` لدور واحد، كباقي دوال المدخل.
- **أعمدة مسماة فقط:** `returns table (...)` أو قيمة مفردة، لا صف جدول كاملاً. لا `select *` ولا `alias.*` ولا `row_to_json` ولا `to_jsonb`/`json_agg` على اسم مجرد، ولو في تعليق. والخادم يسمّي الأعمدة عند قراءتها أيضاً.
- **الظهور** بنفس دوال schema `rls` التي تستعملها السياسات. `auth.uid()` يعمل لأن `withActor` يضبط `request.jwt.claims`.
- **مصفوفة صلاحيات القراءة:** كل دالة قراءة مسجّلة في `tests/integration/_harness/read-matrix.ts` بعنوان اختبار طرف ثالث وعنوان اختبار زائر، والعنوانان موجودان حرفياً في ملف تكامل. الفحص الشامل يفشل بالقواعد `read_function_unregistered` و`read_function_untested` و`read_matrix_stale` و`read_function_whole_row`.
- **RLS تبقى مفعّلة** على كل جدول، لقراءات المتصفح وRealtime.

## إعادة التحقق وتغيير البريد وكلمة المرور (المهمة 3.6، DEC79 وDEC80)

`20261122090000_credentials.sql`، وتفاصيله في `plan/task-3.6.md`:

| الكائن | العمل |
| --- | --- |
| `app.email_change_confirmation` | داخلي، RLS مفعّلة وبلا منح: أي رابطي تغيير البريد المعلّق أُكّد عبر خادمنا، لوقت الطلب نفسه (`email_change_sent_at`). طلب جديد يصفّره |
| `app.guard_email_change()` | مُشغّل `BEFORE UPDATE OF email` على `auth.users` بشرط `when (old.email is distinct from new.email)` (شرط المالك الأول). أي تغيير لعمود البريد يُرفض `LINK_INVALID_OR_EXPIRED` ما لم يكن إكمال الطلب المعلّق بعد تأكيد الرابطين. عند الإكمال يحذف الصف ويكتب `account.email_changed` في نفس المعاملة |
| `app.confirm_email_change_link(token_hash)` | لـ `souq_web` (API021، بلا هوية): يسجّل رابطاً واحداً خلال ساعة (DEC37) بقفل الصف. المستعمل والآخر لم يُؤكَّد `LINK_INVALID_OR_EXPIRED`. يرجع `recorded` أو `complete` ورمز الرابط الآخر |
| `app.record_credential_change(action)` | لـ `souq_web`: تدقيق `account.password_changed` (API022) أو `account.email_change_requested` (API020) من جلسة عادية حية |
| `app.me()` | أُعيد إنشاؤها بعمود `pending_email`: العنوان المعلّق ما دام رابطاه صالحين، وإلا `null` |

- **المُشغّل يعتمد على أعمدة يديرها Supabase:** يُعاد فحصه مع الكود والاختبارات عند كل ترقية، بالخطوات في `ops/runbooks/supabase-upgrade.md` (شرط المالك الثاني).
- **DEC80: لا تغيير للبريد إلا بالرابطين، حتى من الإدارة.** تغيير البريد إدارياً خارج المرحلة الأولى، وإن احتيج يُبنى إجراء خاص بسبب مسجّل وتدقيق وقرار جديد من المالك.

## حذف الحساب واسترجاعه (المهمة 3.7، DEC39 وDEC41 وDEC81)

`20261122130000_account_deletion.sql`، وتفاصيله في `plan/task-3.7.md`. لا جدول جديد: الطلب هو `account_control.deletion_requested_at`، ومُشغّله يضبط `profile.hidden_from_public`.

| الدالة | العمل |
| --- | --- |
| `app.deletion_deadline(requested_at)` | داخلية: نهاية مهلة الثلاثين يوماً (FR72)، تعريف واحد لكل الدوال |
| `app.cancel_pending_for_account(user_id, reason)` | داخلية (DEC39): تلغي المعلّق للحساب بالسبب `account_restricted`، وترجع العدد. فارغة الآن |
| `app.request_account_deletion()` | لـ `souq_web` (API026، مستوى `account_reauth`): فحوص `app.assert_active_member()` بترتيبها بلا شرط الشروط (DEC81)، بقفل `FOR UPDATE`. ثم الطلب والإلغاء والتدقيق `account.deletion_requested` والإشعار. ترجع وقت الطلب |
| `app.deletion_recovery_pending(email)` | لـ `souq_web` (API027): هل يُرسل رابط استرجاع لهذا البريد. الجواب لا يغادر الخادم |
| `app.recover_account_deletion()` | لـ `souq_web` (API028): بالجلسة المحدودة من رابط الاسترجاع فقط (DEC73)، والجلسة العادية `FORBIDDEN`. حساب ليس بانتظار الحذف `LINK_INVALID_OR_EXPIRED`، وبعد المهلة `DEADLINE_PASSED`. التدقيق `account.deletion_recovered` والإشعار |

- **قاعدة DEC39 للمهام القادمة:** 5.5 (العروض) و5.6 (اللقاءات) و6.1 (الصفقات) تستبدل `app.cancel_pending_for_account` بـ `create or replace`، بدءاً من آخر نسخة لها، وتضيف إلغاء جدولها بالسبب `account_restricted`. تقفل صفوفها بعد قفل `account_control` الذي أخذه المستدعي، بترتيب الفصل 07. و7.4 تستدعيها للإيقاف والحظر النهائي.
- **رابط الاسترجاع** رابط دخول من Supabase (`magic_link`)، وهو ورابط استعادة كلمة المرور في خانة واحدة (`recovery_token`). يُعاد فحص ذلك عند كل ترقية لـ Supabase (`ops/runbooks/supabase-upgrade.md`).

## الإشعارات وبريدها (المهمة 3.8)

`20261122170000_notifications.sql`، وتفاصيله في `plan/task-3.8.md`:

| الكائن | العمل |
| --- | --- |
| `app.notification_event` | داخلي، RLS مفعّلة وبلا منح: قناة بريد كل حدث، `required` أو إحدى المجموعات الخمس أو `none`. ومفتاح أجنبي من `public.notification.event_type` إليه (`not valid` للصفوف التجريبية القديمة) |
| `app.notify(...)` | استُبدلت: الصف الجديد لحدث له بريد يضع مهمة `email.send` واحدة بمفتاح `email.send:<معرّف الإشعار>` في نفس المعاملة. الحدث المكرر لا صف ولا مهمة |
| `app.notification_email(id)` | لـ `souq_worker`: صف واحد إن جاز الإرسال الآن، وإلا لا شيء. العنوان من `auth.users` وقت الإرسال. `required` يُرسل أياً كانت حالة الحساب، والاختياري لحساب نشط ومجموعته مفعّلة |
| `app.member_read_actor()` | داخلية: وصول `member` لدالة قراءة، بترتيب `app.assert_active_member()` وبلا قفل |
| `app.my_notifications(before_created, before_id, limit)` | لـ `souq_web` (API078): إشعارات العضو خلال 90 يوماً، الأحدث أولاً، حتى 51 صفاً |
| `app.unread_notification_count()` | لـ `souq_web` (API115): عدد غير المقروء خلال 90 يوماً |
| `app.mark_notifications_read(ids)` | لـ `souq_web` (API079): يعلّم ما للعضو فقط، ويتجاهل الباقي بلا كشف |
| `app.update_notification_preferences(expected_version, groups)` | لـ `souq_web` (API029): المجموعات الخمس فقط، وأي مفتاح آخر `BAD_REQUEST`. النسخة القديمة `STATE_CONFLICT`، وطلب بلا تغيير يُبقي النسخة |

- **حدث جديد في مهمة قادمة:** صف في `app.notification_event` في هجرتها، والصف نفسه في `packages/domain/src/notifications.ts` (اختبار التكامل يطابقهما)، ونصه داخل الموقع في `packages/i18n/src/ar/notifications.json`، ووجهته في `apps/web/lib/notifications/events.ts`. حدث `required` يحتاج بريده في `packages/email/src/notifications.ts`، والاختياري يستعمل بريد مجموعته.
- **لا نص حر في البريد (BR38):** دوال العرض لا تأخذ نص عضو أصلاً. البريد الاختياري يقول إن شيئاً تغيّر، ويفتح `/notifications`.
- **اختبار يرسل إشعاراً بحدث تجريبي** يضيف صفاً `test.<...>` للجدول ثم يحذفه مع إشعاراته ومهامه (`tests/integration/_harness/notifications.ts`).

## الصور (المهمة 4.1، DEC83)

`20261123090000_media.sql`، وتفاصيله في `plan/task-4.1.md`:

| الكائن | العمل |
| --- | --- |
| الدلاء الثلاثة | `quarantine` (خاص، 5 MiB، والأنواع الثلاثة بالترويسة)، و`media-private` (الأصل المعالج والمقاسات لكل الأغراض)، و`media-public` (عام، فارغ حتى 4.2 و4.7). لا سياسة على `storage.objects`، فالوصول بالروابط الموقّعة من الخادم فقط |
| `public.media_asset` و`public.media_derivative` | RLS مفعّلة وبلا منح. القيم المعلنة على الصورة، والحقيقية على المقاسات. مفاتيح الملفات الخاصة ثابتة: `<media_id>/<variant>.webp` |
| `app.authorize_upload(...)` | لـ `souq_web` (API037): يعيد فحص القيم، ثم حصتا RL09 (60 في الساعة و200 MiB في اليوم من الحجم المعلن)، ثم صف `pending` بمسار عشوائي ومهلة خمس دقائق. الغرض `chat` مرفوض حتى 5.3 |
| `app.complete_upload(id, checksum, expected_size)` | لـ `souq_web` (API038): الملف في الحجر بالحجم المعلن وأُنشئ قبل المهلة، ثم `uploaded` ومهمة `image.process`. بعد المهلة `DEADLINE_PASSED` (DEC83) |
| `app.upload_status(id)` | لـ `souq_web` (API039): صورة العضو نفسه فقط، ومفتاح معاينة `w600` بعد الجاهزية، ولا معاينة لصورة البطاقة (DEC83) |
| `app.delete_upload(id)` | لـ `souq_web` (API040): غير المرتبطة فقط. المرتبطة (`expires_at` فارغ) `STATE_CONFLICT` |
| `app.media_begin_processing` و`app.media_processed` و`app.media_rejected` | لـ `souq_worker` (`image.process`): كلها تفحص الحالة قبل الانتقال، فالتكرار لا يغيّر شيئاً (DEC71). مجموعة المقاسات تُفحص: الأصل وحده للبطاقة (DEC45)، والأربعة لغيرها |
| `app.media_cleanup_claim(limit)` و`app.media_cleanup_done(raw, purged)` | لـ `souq_worker` (`media.cleanup`، كل ساعة، RET01): حذف المعلّق المنتهي وغير المرتبط بعد 24 ساعة، ثم الملفات الخام بعد ساعتين من الإذن (مدة رمز الرفع، DEC83)، وملفات الصور المحذوفة |
| `app.rate_limit_take_amount(...)` | داخلية: حصة بكمية، مثل `app.rate_limit_take` لعملية واحدة |

- **ربط الصورة في المهام القادمة** (4.2 و4.7 و5.3 و7.6): دالة الربط تتحقق من المالك والغرض والسياق وأن الحالة `ready`، ثم تجعل `expires_at` فارغاً. والفك يضع `detached_at` و`expires_at` بعد 24 ساعة. والنسخ إلى `media-public` بعد التزام النشر فقط، بصف `visibility = 'public'`، وإزالته عند الإخفاء والأرشفة.
- **الحدود في مكانين:** الهجرة و`packages/domain/src/media.ts`، واختبار التكامل يطابقهما.

## الإعلانات (المهمة 4.2)

`20261124090000_listings.sql`، وتفاصيله في `plan/task-4.2.md`:

| الكائن | العمل |
| --- | --- |
| `pg_trgm` | في schema `extensions`. مع `search_path = ''` تُكتب دواله ومشغّلاته بمخططها (`extensions.gin_trgm_ops`، و`operator(extensions.%)`)، و`ILIKE` يستعمل الفهرس بلا ذلك |
| `public.listing` | RLS مفعّلة وبلا منح ولا سياسات. النص محفوظ بعد NFC والقص (قيد مثل `display_name`)، والعنوان سطر واحد، والوصف يحفظ LF وTAB. `search_text` عمود محسوب من `app.search_normalize(title \|\| ' ' \|\| description)` (DEC67) بفهرس GIN. `location_id` الفارغ «حسب الاتفاق» (DEC28). قيد `listing_free_not_negotiable` (BR08) |
| `public.listing_image` | الموضع من 1 إلى 10 (الأول الرئيسية)، والصورة في إعلان واحد (`listing_image_media_once`). وصورة واحدة على الأقل لكل إعلان عند الالتزام: المُشغّل المؤجل `listing_images_required` |
| `app.active_categories()` و`app.active_meeting_points()` | لـ `souq_web` (API030): الصفوف النشطة بترتيب العرض. قائمة النقاط قد تكون فارغة (G02) |
| `app.publish_listing(key, input)` | لـ `souq_web` (API034). بالترتيب: `assert_active_member`، والبنية (`BAD_REQUEST`)، و`idempotency_claim`، وRL05 (`RL05:hour` و`RL05:day`، مشتركان مع طلبات الشراء في 4.6)، وقفل صف `profile` للبائع ثم حد 200 (`LIMIT_REACHED`)، والحقول، والصور مقفلة بترتيب المعرّف (`MEDIA_INVALID` و`MEDIA_NOT_READY` بالحقل `media_ids.<n>`)، ثم الإدراج و`expires_at` فارغ للصور ومهمة `media.publish`. ترجع `(listing_id, created)` |
| `app.owner_listing(id)` و`app.owner_listing_images(id)` | لـ `souq_web`: إعلان العضو نفسه وصوره، و`public_ready` حين توجد المقاسات العامة الثلاثة |
| `app.media_publish_files(listing)` و`app.media_published(listing)` | لـ `souq_worker` (`media.publish`، SEC08): المقاسات الخاصة لإعلان نشط غير مخفي، ثم تسجيل صفوف `public` بعد النسخ تحت قفل الإعلان، أو مفاتيح النسخ التي تُحذف إن لم يعد مؤهلاً. الأصل لا يُنسخ أبداً |

- **مفاتيح الملفات العامة** هي مفاتيح الخاصة نفسها (`<media_id>/<variant>.webp`) في `media-public`. العنوان يُبنى فقط حين `public_ready` (ملاحظة المالك 2 على 4.2: «الصور قيد التجهيز» في 4.3).
- **إزالة النسخ العامة** عند الأرشفة وحذف الصور في 4.4 (قسم «إدارة الإعلانات»)، وعند الإخفاء في 7.5، بنفس المفاتيح الثابتة.
- **اختبار يطابق الحدود** بين الهجرة و`packages/domain/src/listing.ts` في `listings-publish.test.ts`.

## السوق (المهمة 4.3، DEC84)

`20261125090000_market.sql`، وتفاصيله في `plan/task-4.3.md`:

| الكائن | العمل |
| --- | --- |
| فهارس السوق | جزئية على `status = 'active' and moderation_hidden_at is null`: `listing_market_newest` (`created_at desc, id desc`)، و`listing_market_price` (`price_minor, id`، للاتجاهين)، و`listing_market_category_newest`، و`listing_search_compact_trgm` (GIN على `replace(search_text, ' ', '')`) |
| `app.market_listings(q, category, condition, location, sort, after_tier, after_value, after_id, limit)` | لـ `souq_web` (API031، والرئيسية، و`/market`). النشط فقط (المباع لا يظهر، DEC84)، بلا المخفي، وصاحبه غير مخفي ولا محذوف. `match_tier` 1 «مطابقة» (كل كلمة جزء من `search_text`، أو العبارة بلا مسافات جزء منه بلا مسافات) و2 «قريبة» (`<%` بحد 0.5 مضبوط على الدالة). الترتيب: المجموعة، ثم `sort`، ثم المعرّف. `force_custom_plan` حتى يرى المخطط المعاملات فتسقط فروع الفلتر الغائب. أخطاء الحقول `q` و`sort` و`limit` و`location` (`unavailable` لنقطة غير نشطة)، و`INVALID_CURSOR` |
| `app.public_listing(id)` و`app.public_listing_images(id)` | لـ `souq_web` (API032). النشط أو المباع، بلا المخفي والمؤرشف وإعلان الحساب المقيّد: وإلا لا صف (404 عامة). القدرات من هوية المعاملة بأول سبب: `sign_in_required` ثم `own_content` ثم `account_restricted` ثم `context_closed`، ثم للعرض `free_item` و`not_negotiable`. حقول البائع القادمة ثابتة: الشارة `false` حتى 7.6، والتقييمات صفر حتى 6.2 |
| `app.public_viewer()` و`app.public_listing_visible(id)` | داخليتان بلا منح: قارئ الصفحة العامة (الجلسة المنتهية أو المحدودة زائر، بلا خطأ)، وما يظهر للعامة من إعلان |

- **`listing_search_compact_trgm`** ثلاثياته كثيفة (نص بلا مسافات)، فعلى سوق صغير يفضّل المخطط المسح أو فهرساً آخر. `search-quality.test.ts` يثبت أنه يخدم الشرط، لا أنه المختار دائماً.
- **5.5 و5.7** تضيفان سببي العرض المعلّق والحظر إلى `app.public_listing` بنسخة جديدة منها، من آخر نسخة.
- **RL04** يُعدّ في الخادم على اتصال منفصل قبل القراءة (`lib/listings/limits.ts`)، لأن دالة القراءة STABLE لا تكتب.
- **مجموعة R11** في `tests/integration/search-quality.test.ts`: أي تغيير في قواعد DEC67 أو DEC84 أو الحد يغيّر جدولها، ويحتاج قراراً جديداً.

## إدارة الإعلانات (المهمة 4.4، DEC85)

`20261127090000_owner_listings.sql`، وتفاصيله في `plan/task-4.4.md`:

| الكائن | العمل |
| --- | --- |
| `listing_lifecycle_columns` | قيد CHECK: النشط بلا أعمدة بيع وأرشفة، والمباع له `sold_at`، والمؤرشف له `previous_status` (نشط أو مباع، و`sold_at` موجود إن كان مباعاً) و`archive_reason` و`archived_at`. كل دالة لاحقة (6.1 و7.5 و8.1) تكتب الحالة كاملة. أكملت الهجرة صفوف الاختبارات القديمة قبله |
| `app.listing_restorable_until(...)` | داخلية: `archived_at + 90 days` لأرشفة المالك من حالة نشطة، وإلا null (BR27) |
| `app.owner_listing(id)` | أُعيد إنشاؤها بعمود `restorable_until` |
| `app.my_listings(status, after_key, after_id, limit)` | لـ `souq_web` (API033): تبويب واحد لإعلانات العضو، فيه المخفي إدارياً في «النشط». الترتيب بوقت التبويب (`created_at` أو `sold_at` أو `archived_at`) ثم المعرّف، والمؤشر `(sort_key, id)`. الصور مصفوفتان بترتيبها |
| `app.update_listing(id, expected_version, patch)` | لـ `souq_web` (API035): `assert_active_member`، والبنية، وقفل الإعلان (`NOT_FOUND` لغير صاحبه، و`FORBIDDEN` للمخفي، و`STATE_CONFLICT` لغير النشط وللنسخة)، والحقول بعد الدمج (الفئة والنقطة المعطّلتان تبقيان ما لم تتغيرا)، والصور (قائمة كاملة، والجديدة بقواعد النشر)، و«لا تغيير» بلا عدّ، ثم حد DEC85 (`DEC85:hour`، 30) والحفظ. الصورة المفصولة `expires_at` بعد 24 ساعة (RET01)، ومهمة `media.publish` حين تتغير الصور |
| `app.transition_listing(id, action, expected_version)` | لـ `souq_web` (API036): `mark_sold` (نشط إلى مباع)، و`archive` (نشط أو مباع، ويحفظ `previous_status`)، و`restore` (أرشفة المالك من نشط، قبل 90 يوماً وإلا `DEADLINE_PASSED`، وسقف 200 تحت قفل صف `profile` وإلا `LIMIT_REACHED`). كل إجراء على المخفي `FORBIDDEN`. الأرشفة والاسترجاع تُنشئان مهمة `media.publish` |
| `app.media_unpublish_files(listing, detached)` و`app.media_unpublished(removed)` | لـ `souq_worker`: مفاتيح النسخ العامة لصور لم تعد مؤهلة (صور إعلان غير نشط وغير مباع أو مخفي، والصور المفصولة غير المرتبطة بإعلان مؤهل)، ثم تحت أقفال الصور تُكتب `deleted_at` لصفوفها العامة، وترجع مفاتيح ما صار مؤهلاً في الأثناء ليُنسخ ثانية |
| `app.media_published(listing)` | تعيد الصف العام المزال نفسه عند الاسترجاع (القيد الفريد `(media_id, variant, visibility)`) |
| `app.media_public_eligible(media)` | داخلية: صورة إعلان نشط أو مباع غير مخفي |

- **مفتاح منع التكرار** لمهمة `media.publish` بعد النشر فيه نسخة الإعلان: `media.publish:<listing_id>:<version>`. فهرس `job_dedupe` دائم، فالمفتاح بلا نسخة لا يُنشئ مهمة ثانية أبداً. والنشر (4.2) يبقى `media.publish:<listing_id>`.
- **المزامنة بأي ترتيب (DEC71):** كل خطوة تقرر من الحالة لحظتها، فمهمة قديمة لا تزيل نسخ إعلان استُرجع، ولا تسجّل نسخ إعلان أُرشف.
- **BR41:** المهمة 5.5 تضيف إلغاء العروض المعلّقة إلى `app.update_listing` (`price_changed` و`made_free_or_fixed`) و`app.transition_listing` (`context_closed` للبيع والأرشفة)، بنسخة جديدة من آخر نسخة.
- **7.5** تضيف مهمة `media.publish` عند الإخفاء ورفعه، و`app.media_public_eligible` يستبعد المخفي من الآن.
- **اختبار يطابق الحدود** بين الهجرة و`packages/domain/src/listing-lifecycle.ts` في `listings-manage.test.ts`.

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
