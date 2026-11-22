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
