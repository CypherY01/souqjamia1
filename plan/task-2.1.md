# المهمة 2.1 — خط الأساس الأمني في قاعدة البيانات

الحالة: **معتمدة بشروط (19 نوفمبر 2026)، والتنفيذ جارٍ على الفرع.** قرارات المالك في القسم التالي، وهي تتقدم على ما بعدها في هذا الملف.

## قرارات المالك عند الاعتماد

البنود العشرة في «يحتاج قرارك» معتمدة كما هي، مع هذه الشروط:
1. **البند 2، الهوية:**
   - المطالبات تُستخرج فقط بعد أن يتحقق الخادم من توقيع JWT (`getClaims` أو ما يعادله)، لا بقراءة الكوكي كما هو. يُنفَّذ في 3.1، ومسجّل هناك في `plan/phase-1.md`.
   - تُضبط بـ `set_config(..., true)` للمعاملة فقط.
   - اختبار يثبت أن الهوية لا تنتقل إلى معاملة تالية على نفس الاتصال.
2. **البند 3، دوال `SECURITY DEFINER`:**
   - كل دالة منها فيها `SET search_path = ''`، وكل أسماء الجداول والدوال فيها مؤهلة بالـ schema.
   - الفحص الشامل يفشل إن وُجدت دالة `SECURITY DEFINER` بلا `search_path` ثابت، أو يستطيع `PUBLIC` أو `anon` أو `authenticated` تنفيذها.
3. **البند 4، العامل:**
   - دور منفصل `souq_worker`، بصلاحية EXECUTE على دوال المهام الخلفية فقط، لا على دوال الأعضاء.
   - `souq_web` لا يستطيع تنفيذ دوال العامل.
   - لذلك يُنشأ الدوران في هذه المهمة، والفحص يرفض أي دالة يستطيع الدوران كلاهما تنفيذها. وتبقى لـ 2.5 دوال المهام نفسها.
4. **البند 6، التطبيع:** على نسخة البحث فقط، والنص المعروض يبقى كما كتبه العضو. مسجّل قراراً DEC67 في `docs/addendum-v3.1.md`.
5. **الصلاحيات الافتراضية:**
   - تُسحب TRUNCATE وREFERENCES وTRIGGER مع صلاحيات الكتابة.
   - تُضبط `ALTER DEFAULT PRIVILEGES` للدورين `postgres` و`supabase_admin`، فتشمل الكائنات المستقبلية، ويتحقق الفحص الشامل من ذلك.
   - **تعذّر الجزء الخاص بـ `supabase_admin` حرفياً:** الهجرات تعمل بدور `postgres` محلياً وفي Supabase المستضاف، و`postgres` ليس عضواً في `supabase_admin`. فحصته: الأمر يُرفض بالرسالة «permission denied to change default privileges». وفي Supabase المستضاف لا يعمل أحد بدور `supabase_admin` غير Supabase نفسها.
   - **المطبّق بدلاً منه:** الفحص الشامل يرفض أي كائن في `public` أو `app` لا يملكه `postgres`. فأي كائن ينشئه `supabase_admin` هناك يُفشل الفحص، مهما كانت صلاحياته الافتراضية. السؤال 30 في `plan/phase-1.md` يطلب اعتمادك لهذا البديل.

التاريخ: 19 نوفمبر 2026. الإصدارات أدناه فُحصت في npm بنفس التاريخ. وسلوك القاعدة فُحص على Supabase المحلي (CLI 3.0.0، Postgres 17.11) باستعلامات قراءة، ومعاملة تجريبية أُلغيت (rollback) فلم تغيّر شيئاً.

الفرع: `phase1/task-2.1-security-baseline`، من `main` بعد إغلاق المجموعة 1.

## الهدف

أول هجرات في المشروع. تضع القواعد التي تُبنى عليها كل جداول المرحلة الأولى، وتختبرها آلياً:
- **لا كتابة مباشرة على الجداول** من `anon` أو `authenticated` أو `service_role` (SEC02، DEC36).
- **schema `app` غير مكشوفة** لدوال الكتابة، لا ينفّذها إلا خادم Next.js بدوره المخصص.
- **هوية المستخدم تمر داخل المعاملة فقط،** ولا تنتقل لطلب آخر على نفس الاتصال.
- **أدوات مشتركة للدوال القادمة:** الوقت مع ساعة اختبار، وتطبيع النص، ورفع أخطاء العقد.
- **القوائم الثابتة** كأنواع enum في القاعدة، مطابقة للعقد.
- **أداة اختبارات التكامل،** ودخول هذه الاختبارات إلى CI لأول مرة.

## المعرّفات

- **SEC02:** المنع افتراضياً. دور مخصص للخادم لا يملك جداول ولا BYPASSRLS، والهوية تُمرَّر داخل كل معاملة، ولا كتابة مباشرة لـ `anon` و`authenticated`.
- **DEC36:** schema `app` غير مكشوفة، وEXECUTE مسحوب من `PUBLIC` و`anon` و`authenticated`، واتصال مباشر بدور بلا BYPASSRLS، والهوية بـ `set_config` داخل المعاملة.
- **DEC35:** الاعتماد على Supabase، وRLS بـ `auth.uid()`.
- **BR01 وFR04:** الأساس فقط: لا عملية خاصة بلا هوية تحقق منها الخادم. فحص حالة الحساب والشروط يأتي مع جداولها في 2.2، ومصفوفة الصلاحيات في 3.1.
- **القوائم الثابتة:** «Canonical enumerations» وحقول enum في الفصل 08، والقسم 6.2 من الملحق، وتعديلات DEC39 وDEC45 وDEC51 وDEC61.
- **«Indexes and search» في الفصل 08، وR29، والقسم 6.3:** نسخة بحث مطبّعة، بلا تغيير النص المعروض.
- **«Shared input schemas» في الفصل 09:** NFC والقص وعدّ المحارف.
- **NFR17 وOPS05:** CI يشغّل اختبارات التكامل.

## ما وجدته في القاعدة المحلية

أنشأت جدولاً ودالة في `public` بدور `postgres`، داخل معاملة أُلغيت، وفحصت صلاحياتهما. رغم `auto_expose_new_tables = false` في `config.toml`، تبقى صلاحيات افتراضية لـ `anon` و`authenticated` و`service_role`:

| النوع | ما يبقى | الخطر |
| --- | --- | --- |
| الجداول | TRUNCATE وTRIGGER وREFERENCES وMAINTAIN | TRUNCATE يمسح الجدول كله ولا تمنعه RLS. وMAINTAIN يسمح بقفل الجدول |
| التسلسلات (sequences) | UPDATE | تغيير قيمة التسلسل بـ `setval` |
| الدوال | EXECUTE عبر `PUBLIC` | كل دالة جديدة في `public` تصير قابلة للاستدعاء عبر REST |

الإعداد يمنع SELECT وINSERT وUPDATE وDELETE فقط. الهجرة الأولى تسحب الباقي، والفحص الشامل يمنع رجوعه.

وجدت أيضاً:
- **`postgres` ليس superuser،** لكنه يملك BYPASSRLS وCREATEROLE.
- **صلاحيته على `auth.users`:** يستطيع منح SELECT لغيره، ولا يستطيع منح REFERENCES. هذا يهم البند 3.
- **الاتصال من خارج الحاوية يطلب كلمة مرور** (scram-sha-256 في `pg_hba.conf`).

## التصميم

### الأدوار

| الدور | ما يستطيعه | ما لا يستطيعه |
| --- | --- | --- |
| `anon` و`authenticated` | القراءة التي تسمح بها RLS، حين تمنح شريحةٌ SELECT صراحة | أي كتابة، وأي دالة في `app` |
| `service_role` | التخزين وإدارة Auth من الخادم والعامل. مفتاحه لا يصل للمتصفح | أي صلاحية على جداولنا |
| `souq_web` (جديد) | تنفيذ دوال `app` الممنوحة له صراحة | أي صلاحية مباشرة على الجداول، وBYPASSRLS، وإنشاء أي شيء |
| `postgres` | يملك الجداول والدوال، وتعمل به الهجرات | — |

- **`souq_web`:**
  - LOGIN بلا كلمة مرور في الهجرة. كلمة المرور تُضبط خارج المستودع: محلياً في 3.1، وفي البيئات المستضافة يضبطها المالك.
  - NOBYPASSRLS وNOCREATEDB وNOCREATEROLE وNOREPLICATION. لا يملك شيئاً، وليس عضواً في أي دور.
  - الهجرة تنشئه إن لم يوجد، ثم تضبط صفاته. فتعمل سواء بقيت الأدوار بعد `db reset` أو لم تبق، وأتحقق من ذلك وقت التنفيذ.
- **دور العامل `souq_worker`** في 2.5 مع أول مهامه، بنفس القواعد. SEC02 يطلب للعامل دوراً منفصلاً.
- يحتاج قرارك (البند 4).

### الـ schemas والصلاحيات الافتراضية

- **`app`:**
  - ينشئها `postgres`. USAGE لـ `souq_web` فقط، ولا شيء لـ `PUBLIC` و`anon` و`authenticated` و`service_role`.
  - غير موجودة في `[api] schemas` ولا في `extra_search_path`.
- **دوال `app` نوعان:**
  - **دالة مدخل** يستدعيها الخادم: `SECURITY DEFINER` ومالكها `postgres`، و`SET search_path = ''` بأسماء مؤهلة كاملة، وبلا SQL ديناميكي. EXECUTE يُمنح لـ `souq_web` صراحة لكل دالة.
  - **دالة داخلية** تستدعيها دوال المدخل فقط، بلا أي منح. فلا يستطيع الخادم تجاوز فحوص دالة المدخل باستدعاء الداخلية مباشرة.
- **`public`:** للجداول وأنواع enum. كل دالة فيها تصير نقطة REST، فلا دوال فيها في هذه المهمة، والفحص يرفض أي دالة `SECURITY DEFINER` فيها.
- **الصلاحيات الافتراضية لـ `postgres`:**
  - على مستوى القاعدة: سحب EXECUTE على الدوال الجديدة من `PUBLIC`.
  - في `public` و`app`: سحب كل الصلاحيات على الجداول والتسلسلات والدوال الجديدة من `anon` و`authenticated` و`service_role`.
  - كل منح بعدها صريح في هجرة الشريحة، ويمر بالفحص الشامل.
- **ما ينشئه دور آخر،** مثل `supabase_admin` من Studio محلياً، لا تغطيه صلاحيات `postgres` الافتراضية، والفحص الشامل يكشفه. القاعدة: كل تغيير في القاعدة عبر هجرة.

### هوية المستخدم داخل المعاملة

- **الخادم (3.1)** يتحقق من الجلسة، ثم يفتح معاملة ويضع المطالبات التي تحقق منها:
  - `set_config('request.jwt.claims', <json>, true)`.
  - القيمة `true` تجعلها للمعاملة فقط، فتختفي عند COMMIT أو ROLLBACK. هذا ما يطلبه SEC02: «do not leak context through pooled connections».
  - وتعمل مع مجمّع الاتصالات بوضع transaction لاحقاً.
- **نفس المفتاح الذي تضعه PostgREST وRealtime،** فـ `auth.uid()` و`auth.jwt()` لهما نفس المعنى في سياسات RLS وقنوات Realtime ودوال `app`.
- **المطالبات:** `sub` و`role` و`session_id` و`aal`، من الرمز المتحقق منه فقط، لا من جسم الطلب (TC65).
- **`app.actor_id()`:** ترجع `sub`، وترفع `UNAUTHENTICATED` إن غاب أو كان تالفاً. كل دالة مدخل للعضو تبدأ بها، فتفشل مغلقة.
- **`session_id` و`aal` لما بعد:**
  - فحص أن الجلسة ما زالت موجودة في `auth.sessions`، فلا يكتب رمز جلسة خرج صاحبها (FR04). في 2.2 أو 3.1.
  - aal2 لدوال الإدارة في 7.1.
- يحتاج قرارك (البند 2).

### الوقت: `app.app_now()` وساعة الاختبار

- **كل دالة، وكل قيمة افتراضية لعمود وقت، تستخدم `app.app_now()`،** لا `now()` مباشرة. والفحص الشامل يرفض `now()` و`current_timestamp` وأخواتها في غيرها.
- **في الهجرة:** `app.app_now()` ترجع `now()` فقط. لا ساعة اختبار في أي قاعدة مستضافة، ولا إعداد يغيّر الوقت.
- **في الاختبارات فقط:**
  - الأداة تستبدل الدالة محلياً بنسخة تقرأ وقتاً من إعداد الاتصال `app_test.now`، وتعيد نسخة الهجرة بعد الاختبارات.
  - الإعداد خاص بكل اتصال، فلا يتأثر `pnpm dev` ولا الاختبارات المتوازية.
  - الأداة ترفض العمل على أي قاعدة غير محلية.
- **لماذا لا تكون الساعة في الهجرة بإعداد يفعّلها:** أي دور ينفذ SQL يستطيع ضبط إعداد اتصال. فالخادم المخترق يستطيع تغيير الوقت وتجاوز المهل، مثل مهلة الاسترجاع 30 يوماً.
- يحتاج قرارك (البند 5).

### تطبيع النص

- **`app.normalize_text(text)`:** NFC ثم قص المسافات من الطرفين.
  - تطابق `normalizeText` في `packages/domain/src/text.ts` حرفاً بحرف، بنفس المسافات التي يقصها `trim()` في JavaScript. أما `btrim` في Postgres فيقص المسافة العادية وحدها إن لم تُحدَّد له المحارف.
  - اختبار يقارن الاثنين على مجموعة نصوص.
- **قيود الطول في الجداول القادمة** بـ `char_length`، وهو يعدّ code points. ومعها شرط أن النص مطبّع ومقصوص، فلا يُخزَّن نص مخالف حتى لو أخطأ الخادم.
- **`app.search_normalize(text)`:** لنسخة البحث (`search_text` في 4.2 و4.6، القسم 6.3).
  - IMMUTABLE، فتصلح لعمود مولّد (generated column) ولفهرس pg_trgm.
  - تُطبَّق على عبارة البحث نفسها داخل القاعدة، فلا نسخة ثانية في JavaScript تختلف عنها.
  - القواعد في البند 6.
- **النص المعروض لا يتغير أبداً** (DEC50).

### رفع الأخطاء من الدوال

- **`app.raise_api_error(code, field?, rule?)`:** ترفع خطأ بـ SQLSTATE خاص `SJ001`. الرسالة رمز من `ErrorCode` في العقد، مثل `STATE_CONFLICT`، ومعها الحقل وقاعدته لـ `field_errors` إن وُجدا.
- **الخادم (3.1)** يحوّل `SJ001` إلى `ApiError` بنفس الرمز. أي خطأ آخر من القاعدة يصير 500 `INTERNAL_ERROR`، إلا تعارض القيود الفريدة، فيُحوَّل حسب اسم القيد.
- **فحص يقرأ أجسام الدوال من القاعدة،** ويرفض أي رمز غير موجود في العقد.
- يحتاج قرارك (البند 8).

### القوائم الثابتة (enum)

في القاعدة القوائم التي ستُخزَّن في أعمدة، بقيم المرحلة الأولى. الأنواع في `public`، والأسماء تتجنب الكلمات العامة (`item_condition` لا `condition`):

| النوع | القيم | المصدر |
| --- | --- | --- |
| `category_key` | books_study، electronics، room_furniture، university_supplies، clothing_personal، vehicles، other | الفصل 08، BR03 |
| `item_condition` | new_boxed، like_new، good، fair، used | الفصل 08، BR04 |
| `listing_status` | active، sold، archived | الفصل 08 |
| `archive_reason` | owner، sold_auto، account_deletion | 6.2 |
| `wanted_status` | active، found، closed | الفصل 08 |
| `wanted_closed_reason` | owner، expired، account_deletion | الفصل 08، DEC61 |
| `offer_status` | pending، accepted، rejected، withdrawn، expired، cancelled | الفصل 08 |
| `offer_cancel_reason` | context_closed، price_changed، made_free_or_fixed، blocked، account_restricted | 6.2، DEC39 |
| `offer_reference_kind` | listing_price، wanted_budget | PriceOffer |
| `meetup_status` | proposed، accepted، rejected، cancelled، expired | الفصل 08 |
| `meetup_cancel_reason` | by_proposer، by_recipient، blocked، account_restricted | DEC39 |
| `deal_status` | pending، completed، cancelled | 6.2، DEC33 |
| `deal_cancel_reason` | by_seller، by_buyer، timeout، account_restricted | 6.2، DEC39 |
| `report_target_type` | listing، wanted، conversation، message، review، user | 6.2 |
| `report_reason` | inappropriate_content، fraud، illegal_goods، harassment، spam، misleading_price، other | الفصل 08 |
| `report_status` | received، in_review، actioned، dismissed | الفصل 08 |
| `report_decision` | dismiss، warn، hide_content، suspend_7d، suspend_30d، ban | 6.2 |
| `moderation_action` | warning، hide_content، unhide_content، suspend، unsuspend، ban، unban، revoke_badge، reset_display_name، remove_avatar | 6.2 |
| `app_role` | owner، moderator | 6.2، DEC29 |
| `account_status` | active، suspended، banned | AccountControl |
| `media_purpose` | listing، chat، avatar، student_card | 6.2 |
| `media_status` | pending، uploaded، processing، ready، rejected، deleted | MediaAsset |
| `media_variant` | master، w150، w600، w1200 | 6.2 |
| `media_visibility` | private، public | MediaDerivative |
| `media_rejection_reason` | unsupported_type، too_large، too_many_pixels، animated، corrupt، processing_failed | العقد |
| `meeting_point_kind` | campus، city | 6.2، DEC28 |
| `message_type` | text، image، offer، meetup، system | Message |
| `student_verification_status` | pending، approved، rejected، expired، revoked | 4.1، DEC45 |
| `student_verification_reason` | unclear_image، expired_card، not_student_card، name_mismatch، other | 4.1 |
| `app_locale` | ar | DEC30، DEC51 |
| `policy_type` | terms، privacy | PolicyAcknowledgment |
| `idempotency_state` | processing، succeeded، failed | IdempotencyRecord |
| `notification_context_type` | conversation، offer، meetup، deal، review، report، listing، wanted، account، student_verification | العقد |

- **لا تُنشأ:**
  - `session_scope`، لأن AppSession أُلغي (DEC35).
  - `appeal_status`، و`Report.kind` بقيمة `deal_dispute`، وحالتا الصفقة `disputed` و`voided`، وقوائم الدفع: كلها للمرحلة الثانية.
  - قوائم العقد التي لا تُخزَّن، مثل `ListingSort` و`DisabledReason` و`ReporterStatus`.
- **`ModerationAction.subject_type`:** لا v3 ولا العقد يحدد قيمه، فيُحسم مع 7.3 أو 7.4.
- **قوائم الجداول الجديدة،** مثل حالة المهمة في جدول Job، تأتي مع جداولها.
- **`packages/domain/src/enums.ts`:** نفس القوائم كثوابت، للتحقق بـ zod في الشرائح القادمة.
- **اختبار تطابق ثلاثي:** القاعدة = `packages/domain` = العقد، حيث يذكر العقد القائمة. أي تغيير في قائمة يفشل حتى تُحدَّث الثلاثة معاً (DEC48).
- **تغيير القوائم لاحقاً:** إضافة قيمة، مثل `disputed` في المرحلة الثانية، هجرة `ALTER TYPE ... ADD VALUE`. حذف قيمة أصعب، ويحتاج قراراً جديداً.
- يحتاج قرارك (البند 7).

### أداة اختبارات التكامل: `tests/integration/_harness/`

| الملف | ما يفعله |
| --- | --- |
| `stack.ts` | يقرأ عناوين Supabase المحلي من `supabase status`، ومعها رابط القاعدة. يرفض أي مضيف غير `127.0.0.1` أو `localhost`، فلا تعمل الاختبارات على قاعدة مستضافة أبداً |
| `db.ts` | اتصالات `pg` بدور `postgres`، ومعاملة لكل اختبار تُلغى في نهايته، إلا إذا احتاج الاختبار التزاماً حقيقياً |
| `roles.ts` | `asRole(role, claims?)`: داخل المعاملة `SET LOCAL ROLE` إلى `anon` أو `authenticated` كما تفعل PostgREST، أو `souq_web` كما سيفعل الخادم، مع المطالبات |
| `parallel.ts` | اتصالان متوازيان لاختبارات السباق. تُستخدم فعلياً من 2.4 |
| `clock.ts` و`test-clock.sql` | تثبيت ساعة الاختبار وضبطها وتقديمها، وإرجاع نسخة الهجرة في النهاية |
| `security.ts` | استعلامات الفحص الشامل، ترجع قائمة مخالفات |
| `global-setup.ts` | يتأكد أن Supabase يعمل وأن كل الهجرات مطبّقة، وإلا يوقف الاختبارات برسالة «شغّل pnpm db:reset» |

المكتبة `pg` كما في الخطة، ويُقترح أن يستخدمها خادم Next.js في 3.1 أيضاً.

### الفحص الشامل (SEC02 وDEC36)

اختبار واحد يجمع المخالفات في قائمة، ويجب أن تكون فارغة:
1. **RLS:**
   - جدول في `public` أو `app` بلا RLS.
   - view بلا `security_invoker`، لأنها تتجاوز RLS.
   - materialized view أو foreign table في `public`.
2. **صلاحيات الكتابة:** أي صلاحية لـ `anon` أو `authenticated` أو `service_role` أو `souq_web` أو `PUBLIC` على جدول أو عمود أو تسلسل، من:
   - INSERT وUPDATE وDELETE وTRUNCATE وREFERENCES وTRIGGER وMAINTAIN.
   - USAGE أو UPDATE على التسلسلات.
   - وأي SELECT لـ `service_role` أو `souq_web`.
3. **الدوال:**
   - دالة في `app` يستطيع `PUBLIC` أو `anon` أو `authenticated` أو `service_role` تنفيذها.
   - دالة ينفّذها `souq_web` وليست `SECURITY DEFINER`.
   - دالة `SECURITY DEFINER` بلا `search_path` ثابت.
   - دالة في `public` غير مذكورة في قائمة مسموحة داخل الاختبار، وهي فارغة الآن. وأي `SECURITY DEFINER` فيها.
4. **`app` مكشوفة:**
   - USAGE عليها لغير `souq_web`.
   - طلب REST حقيقي بالترويسة `Accept-Profile: app` لا يرجع 406 (`PGRST106`). يضاف إلى فحص `config.toml` الموجود.
5. **`souq_web`:** صفة خطرة (SUPERUSER أو BYPASSRLS أو CREATEROLE أو CREATEDB أو REPLICATION)، أو يملك شيئاً، أو عضو في دور، أو له CREATE على schema.
6. **الصلاحيات الافتراضية فعلياً:** جدول وتسلسل ودالة جديدة في `public` و`app`، داخل معاملة تُلغى، ولا صلاحية عليها لأي من الأدوار أعلاه. هذا الفحص كشف ما في «ما وجدته في القاعدة المحلية».
7. **الوقت:** `now()` أو أخواتها في جسم دالة أو قيمة افتراضية لعمود، غير `app.app_now()`.

**الفحص يكتشف فعلاً:** اختبار ثانٍ يزرع مخالفة لكل قاعدة داخل معاملة تُلغى، ويتوقع ظهورها كلها. مثلاً جدول بلا RLS، ومنح INSERT لـ `anon`، ودالة في `app` لـ `authenticated`، و`souq_web` بـ BYPASSRLS.

### اختبارات التكامل في CI

- **مهمة رابعة `integration`** بالتوازي مع المهام الثلاث الحالية، فلا يطول زمن CI الكلي إلا بالفرق بينها.
- **Supabase CLI المثبت في `packages/db`** (3.0.0)، بالخدمات اللازمة الآن فقط:
  - تعمل: Postgres وAuth وPostgREST وKong وMailpit.
  - تُستثنى بالخيار `-x`: Studio وpostgres-meta وRealtime وStorage وimgproxy. تدخل Realtime وStorage حين تحتاجها 4.1 و5.4.
  - الحجم أصغر بكثير من 7 GB على جهازك، لأن المستثنى من أكبر الصور. الزمن الفعلي يُسجَّل بعد تشغيلين، كما فعلنا مع E2E.
- **الخطوات:**
  1. تعطيل إرسال بيانات الاستخدام في Supabase CLI.
  2. `supabase start`، وهو يطبّق الهجرات.
  3. `pnpm db:lint`.
  4. `pnpm test:integration`.
  5. عند الفشل فقط: آخر سطور سجلات الحاويات.
- **تثبيت الصور:**
  - قاعدة CI أن صور Docker مثبتة بالبصمة (digest)، لكن Supabase CLI يسحب صوره بالوسم (tag) المكتوب في إصداره.
  - **المقترح:** ملف `packages/db/supabase/images.lock.json` فيه بصمة كل صورة، وخطوة بعد التشغيل تقارن بصمات الصور العاملة به، وتفشل عند أي اختلاف. تحديث CLI يعني تحديث الملف معه.
  - يحتاج قرارك (البند 9).

### فحوص الهجرات

- **`pnpm db:lint`:** `supabase db lint` على `app` و`public`، بإضافة plpgsql_check الموجودة في الصورة المحلية. يكشف أخطاء أجسام دوال PL/pgSQL، وهي لا تظهر عند إنشاء الدالة بل عند تشغيلها.
- **`scripts/check-migrations.ts` في CI:** يقارن مجلد الهجرات بـ `main`.
  - تعديل أو حذف هجرة موجودة في `main` يفشل (CLAUDE.md: الهجرات للأمام فقط، ولا تُعدَّل بعد الدمج).
  - رقم الهجرة الجديدة الزمني يجب أن يأتي بعد آخر هجرة في `main`.
- **فحص النظافة (`source-hygiene.test.ts`) يشمل `.sql`:** الهجرات ستحمل محارف عربية خاصة، فتُكتب بتسلسلات هروب مثل `U&'\0640'`.
- يحتاج قرارك (البند 10).

## الإصدارات

- **`pg` 8.23.1** (30 سبتمبر 2026) و**`@types/pg` 8.23.1** (17 أغسطس 2026):
  - في `catalog`، وتستخدمهما حزمة `tests` فقط الآن. كلاهما أقدم من 14 يوماً.
  - اعتماديات `pg` بلا سكربتات تثبيت حسب npm. أتأكد عند التثبيت، لأن `strictDepBuilds` يوقفه إن وُجدت.
- **Supabase CLI يبقى 3.0.0.** الإصدار 3.2.0 متاح، لكنه لا يصلح قبل 30 نوفمبر، ولا نحتاج منه شيئاً.
- **Postgres 17.11** (الصورة `17.11.0.011`)، وفيها `plpgsql_check` 2.8 لـ `db lint`، و`pg_trgm` 1.6 لـ 4.2.
- **لا مكتبة YAML:** اختبار التطابق يقرأ العقد عبر `redocly bundle`، كما يفعل `check:contract-ids`.

## الملفات

```
packages/db/supabase/migrations/
  <وقت>_sec02_dec36_baseline.sql   الأدوار، schema app، سحب الصلاحيات الافتراضية
  <وقت>_enums.sql                  القوائم الثابتة
  <وقت>_helpers.sql                actor_id و app_now و normalize_text و search_normalize و raise_api_error
packages/db/supabase/images.lock.json  بصمات الصور (البند 9)
packages/db/package.json           db:lint
packages/db/README.md              اصطلاحات كتابة الهجرات والدوال
packages/domain/src/enums.ts       القوائم، وتُصدَّر من index.ts
scripts/local-supabase.ts          رابط القاعدة المحلية، ورفض المضيف غير المحلي
scripts/check-migrations.ts        البند 10
scripts/check-supabase-images.ts   البند 9
tests/integration/_harness/        كما في الجدول أعلاه
tests/integration/sec02-baseline.test.ts
tests/integration/db-helpers.test.ts
tests/integration/enums.test.ts    القاعدة = domain
tests/unit/enums.test.ts           domain = العقد
tests/unit/check-migrations.test.ts
tests/unit/source-hygiene.test.ts  يشمل .sql
tests/vitest.config.ts و tests/package.json
pnpm-workspace.yaml                pg و @types/pg
.github/workflows/ci.yml           مهمة integration وفحص الهجرات
ops/runbooks/local-dev.md          قسم مراجعة 2.1
CLAUDE.md                          قواعد الهجرات والدوال، والأوامر الجديدة
plan/phase-1.md                    حالة المهمة، ونقل الدوال الثلاث إلى 2.2 إن اعتمدت البند 1
```

## خارج هذه المهمة

- **2.2:**
  - جداول الهوية، ومعها `current_profile_id()` و`assert_active_member()` و`has_role()` (البند 1).
  - schema لدوال تستدعيها سياسات RLS. `anon` و`authenticated` يحتاجان EXECUTE عليها، فلا تكون في `app`.
  - كيف تعرف القاعدة إعداد DEC63 (`email_confirmation_required`)، وفحص الجلسة في `auth.sessions`.
- **2.3:** البيانات المرجعية و`seed.sql`.
- **2.4:** منع التكرار، وحدود الطلبات، وسجل التدقيق، وجدول المهام.
- **2.5:** دور العامل `souq_worker`.
- **3.1:**
  - كلمة مرور `souq_web` في `pnpm env:local`، ومتغير رابط القاعدة.
  - مجمّع الاتصالات، وحدود الزمن للدور (`statement_timeout` وأخواته).
  - تحويل أخطاء `SJ001` في الخادم.
- **4.2:** إضافة `pg_trgm` وعمود `search_text`.
- **أول دالة تحتاج ترتيب الأقفال** (الفصل 07): مساعدات القفل تأتي معها.
- **مرحلة التكلفة 1:**
  - الاتصال بدور مخصص عبر Supavisor في Supabase المستضاف.
  - تشغيل استعلامات الفحص الشامل على قاعدة التجربة.

## الاختبار (تعريف الانتهاء)

1. **الهجرات:** `pnpm db:reset` يطبّق الهجرات الثلاث على قاعدة جديدة بلا أخطاء، و`pnpm db:lint` بلا تحذيرات.
2. **الفحص الشامل:** صفر مخالفات، والمخالفات المزروعة تُكتشف كلها.
3. **الهوية:**
   - بلا مطالبات، أو بمطالبات تالفة، ترفع `app.actor_id()` الخطأ `UNAUTHENTICATED`.
   - المطالبات تظهر داخل المعاملة، وتختفي في المعاملة التالية على نفس الاتصال.
   - اتصالان متوازيان بهويتين، ولا يرى أحدهما هوية الآخر.
   - دالة مدخل تجريبية داخل معاملة تُلغى: `souq_web` ينفذها وترى الهوية، و`authenticated` لا ينفذها، و`souq_web` لا ينفذ `app.actor_id()` مباشرة.
4. **الوقت:** نسخة الهجرة ترجع `now()`. ساعة الاختبار تثبت الوقت وتقدّمه، ونسخة الهجرة ترجع بعد الاختبارات.
5. **التطبيع:**
   - `app.normalize_text` تطابق `normalizeText` على نصوص فيها حروف مركّبة وكل المسافات التي يقصها `trim()`.
   - `app.search_normalize` حسب قواعد البند 6 المعتمدة، على حالات عربية ولاتينية.
6. **الأخطاء:** `raise_api_error` ترفع `SJ001` بالرمز، ورمز غير موجود في العقد يفشل الفحص.
7. **القوائم:** القاعدة = `packages/domain` = العقد.
8. **CI:** مهمة `integration` خضراء وزمنها مسجّل، والفحوص الحالية كلها خضراء.
9. **مراجعتك المحلية،** بخطوات تُكتب في `ops/runbooks/local-dev.md`:
   - `pnpm db:reset` ثم `pnpm test:integration`.
   - schema `app` والدور `souq_web` في Studio.
   - طلب REST بالترويسة `Accept-Profile: app` يُرفض.

## يحتاج قرارك

1. **نقل ثلاث دوال من 2.1 إلى 2.2:**
   - `current_profile_id()` و`assert_active_member()` و`has_role()` تقرأ جداول 2.2: Profile وAccountControl وRoleGrant وPolicyAcknowledgment. فلا يمكن إنشاؤها ولا اختبارها قبلها.
   - **المقترح:** تُنقل إلى 2.2، وتبقى في 2.1 الأدوات التي تعتمد عليها: الهوية والوقت والأخطاء.
   - **البديل:** ضم جداول الهوية إلى 2.1، فتكبر المهمة.
2. **مفتاح الهوية داخل المعاملة:**
   - **المقترح:** `request.jwt.claims`، نفس ما تضعه PostgREST وRealtime، فيكون `auth.uid()` واحداً في RLS ودوال `app`.
   - **البديل:** مفتاح خاص بنا، مثل `app.actor`. يفصل هوية الخادم عن هوية REST، لكن كل دالة مساعدة مشتركة تأخذ المستخدم كمعامل.
3. **مالك دوال الكتابة:**
   - **المقترح:** `SECURITY DEFINER` ومالكها `postgres`، كما توصي وثائق Supabase للدوال في schema غير مكشوفة، مع `search_path` فارغ وبلا SQL ديناميكي. `postgres` يتجاوز RLS، فالدالة نفسها حارس الكتابة، كما في DEC36: الفحوص داخل الدوال.
   - **البديل:** دور مالك مخصص بصلاحيات أقل. لكن `postgres` لا يستطيع منح REFERENCES على `auth.users` لدور آخر (فحصته محلياً)، فلا يستطيع ذلك الدور إنشاء المفتاح الأجنبي من الملف الشخصي إلى حساب الدخول.
   - **البديل الثاني:** `SECURITY INVOKER` بدور الخادم، مع منحه الكتابة وسياسات RLS للكتابة. عندها يستطيع الخادم المخترق الكتابة في الجداول مباشرة متجاوزاً الحصص، وهذا ما يمنعه SEC02.
4. **صلاحيات الأدوار واسمها:**
   - `souq_web` بلا أي صلاحية على الجداول، ينفذ دوال `app` فقط. قراءات الخادم تمر عبر Supabase برمز العضو، وتحكمها RLS، كما في ملفات 3.1 (`lib/supabase/server.ts`).
   - `service_role` بلا أي صلاحية على جداولنا. مفتاحه للتخزين وإدارة Auth فقط، والعامل يأخذ دوره الخاص في 2.5.
   - الاسمان: `souq_web` للخادم، و`souq_worker` للعامل.
5. **ساعة الاختبار:** نسخة الهجرة بلا ساعة، والاختبارات تستبدلها محلياً فقط. السبب في قسم «الوقت».
6. **قواعد تطبيع البحث العربي:** v3 يذكر حذف التطويل والتشكيل، و«صيغاً مختارة من الألف»، وحالة الأحرف اللاتينية، بلا تفصيل.
   - **من v3:** حذف التطويل (ـ)، وحذف التشكيل (الحركات والتنوين والشدة والسكون والألف الخنجرية)، وتوحيد أ وإ وآ وٱ إلى ا، وتصغير الأحرف اللاتينية.
   - **إضافات مقترحة:**
     - ى إلى ي، وة إلى ه.
     - الأرقام الهندية إلى الغربية، كما في DEC50 للحقول الرقمية.
     - NFKC، لأشكال العرض العربية (presentation forms) التي تأتي من النسخ واللصق.
     - حذف المحارف غير المرئية، وتوحيد المسافات.
   - **لا أقترح:** ؤ إلى و، ولا ئ إلى ي، ولا حذف «ال». تخلط كلمات مختلفة أكثر مما تفيد، وpg_trgm يطابق أجزاء الكلمات أصلاً.
7. **القوائم الثابتة:** ما سيُخزَّن فقط، بقيم المرحلة الأولى، مع ثوابت في `packages/domain` واختبار تطابق ثلاثي. الخطة تقول «كل القوائم»، وهذا يستبعد ما أُلغي أو تأجل أو لا يُخزَّن (التفصيل في قسمها).
8. **رموز الأخطاء من الدوال:** SQLSTATE خاص `SJ001`، ورمز العقد في الرسالة. البديل `P0001`، الافتراضي في PL/pgSQL، لكنه يختلط بأخطاء الإضافات وأخطاء Supabase نفسها.
9. **CI وصور Supabase:** مهمة مستقلة بالخدمات اللازمة فقط، وملف بصمات يُقارَن بعد التشغيل، لأن Supabase CLI لا يدعم تثبيت الصور بالبصمة. البديل: قبول الوسوم التي يحددها إصدار CLI المثبت، مع استثناء مكتوب في `CLAUDE.md`.
10. **فحوص الهجرات الإضافية:** `pnpm db:lint`، وفحص أن الهجرات المدموجة لا تُعدَّل ولا تُحذف، وفحص النظافة على `.sql`. كلها صغيرة، ويمكن تأجيل فحص الهجرات المدموجة إن أردت.

بعد ردك: ما يغيّر قاعدة منتج، مثل قواعد البحث في البند 6، يُسجَّل قراراً جديداً DEC67 في آخر الملحق. والباقي يُسجَّل في هذا الملف، في قسم «قرارات المالك عند الاعتماد».
