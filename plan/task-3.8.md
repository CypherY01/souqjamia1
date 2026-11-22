# المهمة 3.8 — نواة الإشعارات

الحالة: **معتمدة بعد مراجعة المالك المحلية، ومدموجة في main (22 نوفمبر 2026). CI أخضر على commit 54fd767 (التشغيل [45050006704](https://github.com/CypherY01/souqjamia1/actions/runs/45050006704): الفحوص والبناء 78 ثانية، والتكامل 161، وE2E 232، وgitleaks 16).** الفرع `phase1/task-3.8-notifications` من `main` (418237c). قرارات المالك في القسم التالي، وهي تتقدم على ما بعدها في هذا الملف.

## قرارات المالك عند الاعتماد

البنود الاثنا عشر في «يحتاج قرارك» معتمدة كما اقتُرحت (22 نوفمبر 2026)، مع ثلاث إضافات:
1. **البند 5 (عنوان مؤكد):** التحقق من البريد ملغى (DEC63). يُتأكد أن حساباً جديداً من `/signup` له `email_confirmed_at` محلياً وفي CI، واختبار يثبت أن بريد «طُلب حذف حسابك» يصل لحساب سُجّل بالطريقة العادية بلا أي تأكيد. وإن لم يكن `email_confirmed_at` مضبوطاً تلقائياً، يتوقف التنفيذ ويُسأل المالك قبل أي حل.
2. **`CONTACT_EMAIL`:** لا بريد شخصي للمالك في أي ملف. محلياً وفي CI عنوان تجريبي على `souqjamia1.test`. ويُسجَّل في `plan/cost-plan.md` (مرحلة التكلفة 1) أن عنوان التواصل الحقيقي على `souqjamia1.com` يُنشأ مع توثيق النطاق (G01).
3. **بريد الاسترجاع:** تُحذف جملة «الإيقاف أو الحظر، إن وُجد، يبقى كما هو». وباقي نصي البريدين معتمد.

## الهدف

- كل إشعار يُنشأ داخل الموقع (FR48) يحدد الخادم قناة بريده من جدول أحداث واحد: إلزامي، أو مجموعة اختيارية، أو بلا بريد (SEC11، BR38).
- العامل يرسل البريد بعد التزام العملية، ويقرأ العنوان والحالة والتفضيلات وقت الإرسال. فشل البريد لا يمس الإشعار ولا يكرر العملية (UC19).
- العضو يقرأ إشعاراته ويعلّمها مقروءة (API078، API079)، ويرى عدد غير المقروء في الشريط العلوي (API115)، ويفعّل مجموعات البريد الاختيارية من `/account/notifications` (API029). كل المجموعات مطفأة افتراضياً (DEC49، DEC65).
- **الشرطان الإلزاميان من المالك** (أدناه في «شرطا المالك») مبنيان ومختبران قبل طلب الاعتماد.

## المعرّفات

- **FR48** (إشعارات خاصة، والوجهة يحددها الخادم ويُعاد التحقق منها عند الفتح)، و**FR68** (قنوات البريد والتفضيلات)، و**UC19**.
- **BR38** (بريد اختياري حسب التفضيلات، وبريد الأمان لا يُعطَّل، ولا نص محادثة في البريد)، و**SEC11** (جدول الأحداث والقنوات)، و**RET07** (عرض 90 يوماً فقط، والتنظيف في 8.1).
- **API029** `PATCH /api/me/preferences`، و**API078** `GET /api/notifications`، و**API079** `PATCH /api/notifications`، و**API115** `GET /api/notifications/unread-count`.
- **DEC49** و**DEC65** (المجموعات الخمس مطفأة، وسطر «إذا لم تسجّل...» في كل رسالة)، و**DEC71** (مفتاح منع تكرار ثابت للطلب الخارجي)، و**DEC77** (دوال القراءة ومصفوفتها)، و**DEC72** (إعادة جسم المعاملة)، و**DEC62** (بلا خدمة مدفوعة: Mailpit محلياً).
- **الاختبار:** **TC20** و**TC55**، و«عضو جديد لا يصله بريد اختياري حتى يفعّل مجموعته»، و«كل رسالة فيها سطر DEC65»، واختبارا الشرطين.
- **لا تبعيات جديدة** (البند 2 في «يحتاج قرارك»)، فلا إصدارات تُفحص.

## شرطا المالك (إلزاميان، ولا تُعتمد 3.8 بدونهما)

1. **بريد «طُلب حذف حسابك»** (شرطه عند اعتماد 3.7، وفي شروط التجربة في `plan/cost-plan.md`): يصل عند كل طلب حذف، فيه موعد الطلب وموعد نهاية المهلة (30 يوماً، `app.deletion_deadline()`) بتوقيت الرياض، وطريقة الاسترجاع. مصدره الإشعار `account.deletion_requested` من `app.request_account_deletion()`، ومعه بريد `account.deletion_recovered` من `app.recover_account_deletion()`. الحساب بانتظار الحذف، والبريد إلزامي، فلا تمنعه حالة الحساب ولا تفضيلاته. النص المقترح في القسم 5 من «التصميم».
2. **قواعد بريد الإشعارات:**
   - بريد الأمان والإدارة إلزامي ولا يُعطَّل (BR38، SEC11): لا حقل له في API029، وأي حقل غير المجموعات الخمس 400.
   - المجموعات الخمس `offers` و`meetups` و`deals` و`reports` و`reviews` مطفأة افتراضياً (DEC49، DEC65، مبنية في 2.4)، فعضو جديد لا يصله بريد اختياري حتى يفعّل مجموعته.
   - كل رسالة فيها سطر «إذا لم تسجّل في سوق الجامعة، تجاهل هذه الرسالة» (DEC65)، آخر سطر في نسختي HTML والنص.
   - لا نص محادثة ولا أي نص كتبه عضو في أي بريد (BR38): دوال العرض لا تقبل نصاً حراً أصلاً.
   - الطلب لـ Resend، من مرحلة التكلفة 1، يحمل مفتاح منع تكرار ثابتاً لكل محاولات المهمة (DEC71، البند 4).

## ما فُحص قبل الخطة (22 نوفمبر 2026)

البنود الخمسة في «يُفحص قبل كتابة الخطة» في ملاحظات `plan/phase-1.md`:

1. **منفذ SMTP لـ Mailpit:** غير مكشوف فعلاً. الحاوية `supabase_inbucket_souqjamia1` (صورة `mailpit:v1.31.3`) تكشف 1025 (SMTP) و1110 و8025 داخلياً، وتربط 8025 فقط بالمنفذ 54324. وSupabase Auth يصلها داخل شبكة Docker على 1025. **لكن Mailpit فيه واجهة إرسال HTTP:** `POST /api/v1/send` على المنفذ 54324 المكشوف أصلاً. جرّبته بجسم فارغ فرد 400 «from not set»، أي الواجهة موجودة ولم يُنشأ أي بريد. وCI يشغّل Mailpit في مهمتي التكامل وE2E (لا يستثنيه `-x`). فلا حاجة لتغيير `config.toml` (البند 1).
2. **محوّل الإرسال:** Resend له واجهة HTTP: `POST https://api.resend.com/emails` بترويسة `Authorization: Bearer` وجسم JSON (`from` و`to` و`subject` و`html` و`text`). ومنع التكرار بالترويسة `Idempotency-Key` (من 1 إلى 256 محرفاً، تُحفظ 24 ساعة): نفس المفتاح ونفس الجسم يرجع الرد نفسه بلا إرسال ثانٍ، ونفس المفتاح بجسم مختلف 409 `invalid_idempotent_request`، وطلب متزامن بنفس المفتاح 409 `concurrent_idempotent_requests` (يُعاد لاحقاً). المصدر صفحتا Resend: [send-email](https://resend.com/docs/api-reference/emails/send-email) و[idempotency-keys](https://resend.com/docs/dashboard/emails/idempotency-keys). فالمحوّلان `fetch` مع Node 26، بلا مكتبة (البند 2). حد الطلبات وجدول الأخطاء الكامل لم يظهرا في الصفحتين، فيُقرأان عند ربط Resend في مرحلة التكلفة 1، والمحوّل يعامل 429 و5xx كفشل مؤقت.
3. **عنوان المستلم:** لا يُخزّن في الإشعار ولا في المهمة ولا في السجل. يُقرأ وقت الإرسال من `auth.users.email` بدالة قراءة للعامل، مع حالة الحساب والتفضيلات في نفس اللحظة (SEC11، AccountControl: «Check the current record on requests and delivery»). البند 5.
4. **قراءات الإشعارات:** API078 وAPI115 دالتا قراءة في `app` لـ `souq_web` تُسجَّلان في `read-matrix.ts` (DEC77)، ودالة البريد للعامل كذلك. وAPI079 وAPI029 دالتا كتابة، وAPI029 بـ `expected_version`.
5. **الإشعارات قبل 3.8:** في القاعدة المحلية 79 صفاً `account.deletion_*` (62 طلباً و17 استرجاعاً، كلها من الاختبارات في 22 نوفمبر)، و24 صفاً تجريبياً (`test.effect` و`offer.received`) من اختبارات 2.4. ولا مهام في `app.job`. ولا بيئة مستضافة بعد (DEC62)، فلا عضو حقيقي فاته بريد. البند 6.
6. **أشياء جاهزة:** `public.notification` و`app.notify()` (2.4، ولم تُستبدل في أي هجرة بعدها)، و`public.notification_preference` بالأعمدة الخمسة `false` و`version`، و`app.me()` يرجعها (آخر نسخة في هجرة 3.6). والعامل يعطي `context.idempotencyKey` بصيغة `job:<id>` (`loop.ts`). والشريط العلوي فيه رابط الإشعارات و`unreadNotifications` ثابتاً على 0 في `app/layout.tsx`، ومساره `routes.notifications` موجود.

## التصميم

### 1. جدول الأحداث: مصدر القناة

- **في القاعدة:** جدول داخلي `app.notification_event (event_type text primary key, email text not null)`، و`email` واحد من `required` و`offers` و`meetups` و`deals` و`reports` و`reviews` و`none` (CHECK). RLS مفعّل وبلا منح. هجرة 3.8 تضيف الحدثين `account.deletion_requested` و`account.deletion_recovered` بقناة `required`. وكل مهمة لاحقة تضيف أحداثها في هجرتها (5.2 الرسالة الجديدة `none`، و5.5 العروض `offers`...).
- **قيد:** `public.notification.event_type` مفتاح أجنبي إلى الجدول، بـ `not valid` حتى لا تفشل الهجرة على الصفوف التجريبية القديمة محلياً (البند 12). الصفوف الجديدة تُفحص كلها.
- **في الكود:** `packages/domain/src/notifications.ts` فيه `NOTIFICATION_EVENTS`: لكل حدث قناة البريد ونوع السياق ومفاتيح النص. واختبار تكامل يقرأ الجدول ويطابقه بالقائمة، كما تُطابق قيم الأنواع الثلاثة اليوم.

### 2. `app.notify()` (تستبدل نسخة 2.4)

- الإدراج كما هو: صف واحد لكل `(recipient, dedupe_key)`.
- إن كان الصف جديداً وقناة حدثه ليست `none`: `app.enqueue_job('email.send', {notification_id}, 'email.send:' || id)` في نفس المعاملة. فعملية تُلغى لا ترسل شيئاً، وحدث مكرر بنفس المفتاح لا يُنشئ صفاً ولا مهمة (TC55).
- **بلا مهمة `notify.dispatch`:** القرار في القاعدة، فلا مهمة لحدث بلا بريد (الرسائل في 5.2 كثيرة). هذا يختلف عن قائمة الملفات في القسم 3.8 من `plan/phase-1.md` (البند 3).

### 3. مهمة `email.send` في العامل

- **الحمولة:** `{ notification_id: uuid }` فقط، بلا عنوان ولا نص.
- **دالة القراءة** `app.notification_email(p_notification_id uuid)` (STABLE، `security definer`، لـ `souq_worker` وحده). ترجع صفاً واحداً فيه الحدث وقناته والعنوان وموعد الإشعار، وموعد نهاية المهلة لحدث طلب الحذف (`app.deletion_deadline(created_at)`)، **فقط إن كان الإرسال الآن مسموحاً:**
  - الإشعار موجود، ومستخدم Auth موجود بلا `deleted_at`، وبريده مؤكد؛
  - **القناة `required`:** يُرسل أياً كانت حالة الحساب: بانتظار الحذف، أو موقوف، أو محظور (الشرط 1)؛
  - **مجموعة اختيارية:** الحساب نشط، بلا طلب حذف، ولا إيقاف أو حظر، والمجموعة مفعّلة الآن.
  - غير ذلك: لا صفوف، والمعالج يرجع `{ skipped: 1 }` نجاحاً (DEC71: «لا شيء لفعله» نجاح).
- **ثم:** العرض (القسم 5)، ثم المحوّل بمفتاح منع التكرار (البند 4)، ثم السطر `email.sent` بمعرّف الإشعار ونوع الحدث ومعرّف رسالة المزوّد. لا عنوان ولا نص في أي سجل.
- **الأخطاء:** 429 و5xx وانقطاع الشبكة والمهلة (10 ثوانٍ لكل طلب) فشل مؤقت، فتُعاد المهمة بعد 1 و5 و15 ثم 60 دقيقة (2.5). و400 و422 و409 `invalid_idempotent_request` و`PermanentJobError` فوراً (`job.dead`). و401 و403 (مفتاح خاطئ) فشل مؤقت يظهر في السجل، لأن إصلاح المفتاح يكفي ليمر البريد.
- **مدة المحاولات:** المحاولات العشر تنتهي خلال حوالي 7 ساعات ونصف، داخل نافذة Resend (24 ساعة)، فكل إعادة يعرفها Resend.

### 4. محوّلا الإرسال (`apps/worker/src/email/`)

- **`mailpit.ts`** محلياً وفي CI: `POST ${MAILPIT_URL}/api/v1/send` بجسم JSON (المرسل والمستلم والموضوع وHTML والنص). Mailpit لا يمنع التكرار، فإعادة بعد إرسال ناجح وتوقف قبل إكمال المهمة قد تُظهر رسالة ثانية محلياً فقط. مقبول ومذكور في التعليق.
- **`resend.ts`** من مرحلة التكلفة 1: الطلب في البند 2 أعلاه، بترويسة `Idempotency-Key`. يُختبر على خادم HTTP محلي مزيف في اختبار وحدة (الترويسات، والمفتاح ثابت بين محاولتين، وتصنيف الأخطاء). لا طلب حقيقي لـ Resend في هذه المهمة.
- **متغيرات العامل** (`apps/worker/src/env.ts`، و`.env.example`، و`pnpm env:local`):
  - `EMAIL_TRANSPORT`: `mailpit` أو `resend`. و`mailpit` مرفوض مع `APP_ENV=production`.
  - `EMAIL_FROM`: محلياً `سوق الجامعة <no-reply@souqjamia1.test>`، وفي الإنتاج عنوان على `souqjamia1.com` بعد توثيق النطاق عند Resend (G01، مرحلة التكلفة 1).
  - `MAILPIT_URL` (مع `mailpit` فقط)، و`RESEND_API_KEY` (سر، مع `resend` فقط، يُضاف إلى `ops/runbooks/secrets.md`).
  - `APP_ORIGIN` لروابط البريد، و`CONTACT_EMAIL` لبريد الحذف. نفس قيمتي الموقع.

### 5. محتوى البريد

- **حزمة صغيرة `packages/email`** (البند 9): الإطار والهروب وسطر DEC65 تنتقل إليها من `packages/db/scripts/build-email-templates.ts`، فيستعملها السكربت والعامل. قوالب Supabase لا تتغير حرفاً، و`pnpm emails:check` يثبت ذلك.
- **كل رسالة:** موضوع وعنوان ونص من `packages/i18n/src/ar/email.json` (`email.notification.<الحدث>`)، وزر إلى مسار ثابت على `APP_ORIGIN`، ونسخة نصية، ثم سطر DEC65 آخر الرسالة.
  - **الاختيارية:** سطر «تستطيع إيقاف هذا البريد من تفضيلات البريد» ورابط `/account/notifications`، والزر إلى `/notifications` لا إلى الوجهة نفسها (البند 7).
  - **الإلزامية:** سطر «هذا بريد أمان يصلك دائماً، ولا يمكن إيقافه من التفضيلات».
- **BR38:** دوال العرض تأخذ نوع الحدث والتواريخ والأصل وبريد التواصل فقط، فلا مدخل لنص حر. والأنواع واختبار وحدة يثبتان ذلك.
- **النص المقترح لبريد طلب الحذف** (الشرط 1، البند 8):
  - الموضوع: «طُلب حذف حسابك في سوق الجامعة».
  - النص: «وصلنا طلب حذف حسابك في سوق الجامعة في {موعد الطلب}. حسابك مخفي الآن عن الآخرين، ويُحذف نهائياً في {موعد نهاية المهلة} إن لم تسترجعه.»
  - «لاسترجاع حسابك قبل هذا الموعد: ادخل إلى الموقع ببريدك وكلمة مرورك، ثم اضغط «أرسل رابط الاسترجاع» في الصفحة التي تظهر لك، ثم افتح الرابط الذي يصلك (صالح ساعة واحدة).»
  - «إذا لم تطلب الحذف أنت، فاسترجع حسابك فوراً بهذه الخطوات، ثم غيّر كلمة مرورك. وإن لم تستطع الدخول، فراسلنا على {بريد التواصل}.»
  - الزر: «الدخول إلى سوق الجامعة» إلى `/login`. ثم سطر بريد الأمان، ثم سطر DEC65.
  - التاريخان بتوقيت الرياض، بالأشهر الميلادية بأسمائها العربية والساعة بنظام 12 ساعة (`formatDateTime` من `@souq/i18n`).
- **بريد الاسترجاع:** الموضوع «استُرجع حسابك في سوق الجامعة». النص: «أُلغي طلب حذف حسابك، وعاد حسابك ظاهراً كما كان.» (حُذفت جملة الإيقاف والحظر، الإضافة 3 من المالك) و«إذا لم تسترجعه أنت، فغيّر كلمة مرورك فوراً من صفحة الحساب.» والزر «الدخول إلى سوق الجامعة».

### 6. الإشعارات داخل الموقع (API078 وAPI079 وAPI115)

- **API078** (`member`): دالة القراءة `app.my_notifications(p_before_created timestamptz, p_before_id uuid, p_limit integer)` بأعمدة مسماة (`id` و`event_type` و`context_type` و`context_id` و`read_at` و`created_at`)، لمستلم الجلسة فقط، خلال 90 يوماً (RET07)، بترتيب `created_at desc, id desc`. المؤشر بـ `encodeCursor`، و20 افتراضياً و50 حداً أعلى (NFR14).
- **الوجهة (`destination`):** يبنيها الخادم من نوع السياق ومعرّفه في `NOTIFICATION_EVENTS`، ولا تأتي من المتصفح أبداً. اليوم السياق `account` فقط، ووجهته `/account`. والسياقات اللاحقة تضيف وجهاتها، وصفحة الوجهة تعيد فحص الصلاحية بحارسها (FR48). وجهة لا تُبنى تظهر «غير متاح» (`plan/screens.md`).
- **API079** (`member`): `app.mark_notifications_read(p_ids uuid[])` تعلّم ما للعضو من المعرّفات وغير مقروء بعد، وتتجاهل الباقي بلا كشف (TC20). الرد 204. آمن للتكرار بطبيعته.
- **API115** (`member`): `app.unread_notification_count()` عدد غير المقروء خلال 90 يوماً. و`app/layout.tsx` يستعمله بدل الصفر، لجلسة لها وصول `member` فقط (البند 10)، وفشله لا يكسر الصفحة: يختفي العدد.
- **بلا حد طلبات ولا تدقيق** لـ API079 وAPI029: لا حد لهما في المواصفات ولا الملحق (البند 11).

### 7. التفضيلات (API029)

- الجسم: `strictObject({ email_groups: strictObject({ offers?, meetups?, deals?, reports?, reviews? }), expected_version })`. أي حقل آخر، مثل `security` أو `locale`، 400 (العقد يستثني `locale`، القسم 6.3).
- `app.update_notification_preferences(p_expected_version integer, p_groups jsonb)` لـ `souq_web`: تبدأ بـ `app.assert_active_member()`، والإصدار القديم `STATE_CONFLICT` (409)، وتغيّر الحقول المرسلة فقط، وترفع `version` إن تغيّر شيء، كما في API016. الرد `Preferences` من نفس المعاملة.

### 8. الصفحات

- **`/notifications`:** القائمة بنص عربي لكل حدث ووقت نسبي، و«غير مقروء» نصاً لا لوناً فقط. فتح الإشعار يعلّمه مقروءاً (API079) ثم ينتقل إلى وجهته. وزر «تعليم الكل كمقروءة» لما في الصفحة، و«المزيد» للصفحة التالية. وحالات التحميل والفراغ والخطأ وإعادة المحاولة. الجلسة غير المؤهلة تذهب حيث تذهب في صفحات الحساب (`requireMemberPage`).
- **`/account/notifications`:** المجموعات الخمس مربعات اختيار بعنوان ووصف، وقسم ثابت «بريد الأمان والإدارة: يصلك دائماً» بشارة «إلزامي» بلا مربع يوحي بإمكان التعطيل. الحفظ بـ `expected_version`، و409 برسالة وإعادة تحميل، و«حُفظت التفضيلات». ورابط إليها من `/account`.
- **الشريط العلوي:** الرابط والعدد موجودان، ويُضاف نص للقارئ الآلي «الإشعارات، 3 غير مقروءة».
- **`/dev/ui`:** عنصر الإشعار ونموذج التفضيلات بكل حالاتهما.

### 9. العقد

لا تغيير متوقع: المسارات الأربعة وأنواعها في العقد منذ 1.1. إن احتاج التنفيذ تغييراً، يرتفع الإصدار ويُذكر في «اختلافات عن الخطة».

## الملفات

- **الهجرة:** `packages/db/supabase/migrations/20261123090000_notifications.sql`: `app.notification_event` وصفّاه، والمفتاح الأجنبي `not valid`، و`app.notify()` الجديدة، و`app.notification_email()` و`app.my_notifications()` و`app.unread_notification_count()` و`app.mark_notifications_read()` و`app.update_notification_preferences()`، ومنحها.
- **القاعدة:** `packages/db/README.md` (قاعدة الحدث الجديد وقناته)، و`packages/db/scripts/build-email-templates.ts` (يستورد من `packages/email`).
- **الحزم:** `packages/email/` (جديدة: `package.json` و`src/layout.ts` و`src/notifications.ts`)، و`packages/domain/src/notifications.ts`، و`packages/i18n/src/ar/email.json` و`layout.json` و`account.json` (وملف `notifications.json` إن لزم).
- **العامل:** `apps/worker/src/jobs/email.send.ts`، و`apps/worker/src/email/{mailpit,resend,transport}.ts`، و`apps/worker/src/env.ts`، و`apps/worker/src/registry.ts`، و`apps/worker/package.json`.
- **الموقع:** `apps/web/lib/notifications/{list,read,count,preferences}.ts` (بلا إطار، مثل 3.5)، و`app/api/notifications/route.ts` و`unread-count/route.ts`، و`app/api/me/preferences/route.ts`، و`app/notifications/` و`app/account/notifications/`، و`components/notifications/`، و`app/layout.tsx`، و`app/account/page.tsx`، و`lib/routes.ts`، ومعرض `/dev/ui`.
- **الإعداد:** `.env.example`، و`scripts/write-local-env.ts` (`pnpm env:local`)، و`ops/runbooks/secrets.md`، و`ops/runbooks/local-dev.md` (خطوات المراجعة مع `pnpm dev:worker`)، و`plan/cost-plan.md` (فحص Resend الحقيقي في مرحلة التكلفة 1).
- **الاختبارات:** `tests/integration/notifications.test.ts` (موجود من 2.4، يُوسَّع) و`notification-email.test.ts` (جديد)، و`tests/integration/_harness/read-matrix.ts`، و`tests/unit/email-render.test.ts` و`resend-transport.test.ts` و`notification-events.test.ts`، و`tests/e2e/notifications.spec.ts`. ويُعدَّل `notifications.test.ts` و`idempotency.test.ts` من 2.4، وهما يستعملان `test.effect` و`offer.received` (البند 12).

## خارج هذه المهمة

- أحداث المهام اللاحقة ونصوصها ووجهاتها: كل مهمة تضيف صفوفها في `app.notification_event`. وبريد الإجراءات الإدارية (7.4) إلزامي بنفس الآلية.
- حذف الإشعارات بعد 90 يوماً (RET07) في 8.1. هنا تُخفى من القراءة فقط.
- تحديث العدد فوراً بلا إعادة تحميل (Realtime) في 5.4. وWeb Push في المرحلة 2.
- مفتاح Resend الحقيقي وتوثيق النطاق (SPF وDKIM) في مرحلة التكلفة 1.
- بريد تغيير كلمة المرور والبريد يرسله Supabase نفسه (3.4، 3.6)، فلا يُكرَّر هنا.

## مخاطر معروفة

- **محوّل Resend لا يُجرَّب على الخدمة الحقيقية** قبل مرحلة التكلفة 1. يُضاف إلى `plan/cost-plan.md` بند: إرسال بريد حقيقي واحد، وإعادته بنفس المفتاح، قبل التجربة مع الطلاب.
- **واجهة Mailpit HTTP ليست SMTP:** الطريق المحلي يختلف عن الإنتاجي في النقل فقط. العرض والقرار ومفتاح التكرار مشتركة ومختبرة.
- **عدّ غير المقروء في كل صفحة** استعلام واحد على الفهرس الجزئي `notification_recipient_unread`. يُقاس في اختبار الحمل (8.4).
- **`app.notify()` تُستبدل:** كل من يستدعيها يأخذ السلوك الجديد. اليوم دالتا 3.7 فقط.

## الاختبار (تعريف الانتهاء)

- **TC55:** `TC55 a disabled optional group sends no email and keeps the in-app notification`، و`TC55 a failed delivery retries without a second notification`، و`TC55 a duplicate event keeps one notification and one email job`، و`TC55 security email is sent with every optional group off`.
- **DEC65:** `DEC65 a new member gets no optional email until the group is enabled`، و`DEC65 every notification email ends with the not-registered line` (HTML والنص لكل حدث في القائمة).
- **BR38:** `BR38 notification emails carry no member text`.
- **TC20:** `TC20 a member never lists another member's notifications`، و`TC20 marking another member's notification changes nothing and reveals nothing`، و`TC20 the destination is derived on the server`. وجزء «الوجهة غير المتاحة» يُكمَل مع سياقات 5.x.
- **الشرط 1 (SEC11):** `SEC11 a deletion request emails the deadline and the recovery steps` (رسالة حقيقية في Mailpit بموعد نهاية المهلة بساعة الاختبار)، و`SEC11 the deletion email reaches an account awaiting deletion`، و`SEC11 a recovery emails the account owner`.
- **DEC71:** `DEC71 email.send run twice on one job sends one idempotency key` (خادم Resend المزيف يرى المفتاح نفسه)، و`DEC71 an email for a notification that is gone is a success`.
- **API029:** إصدار قديم 409، وتعديل جزئي، وحقل غير معروف 400، والزائر 401، وعضو لا يغيّر تفضيلات غيره.
- **DEC77:** عنوانا اختبار الطرف الثالث والزائر لكل دالة قراءة جديدة في `read-matrix.ts`.
- **العامل:** `worker-registry` يجد معالجاً لـ `email.send`. واختبار تطابق الأحداث بين القاعدة و`@souq/domain`.
- **E2E:** صفحتا `/notifications` و`/account/notifications` بالعروض الثلاثة مع axe، والعدد في الشريط، وحفظ التفضيلات.
- **الأوامر كلها** في «Commands» من `CLAUDE.md`، ثم CI أخضر، ثم مراجعة المالك المحلية بخطوات في `ops/runbooks/local-dev.md`.

## يحتاج قرارك

البند واقتراحي في سطر لكل منها:

1. **إرسال البريد محلياً:** واجهة Mailpit HTTP (`/api/v1/send` على 54324 المكشوف)، بلا تغيير `config.toml` ولا مكتبة. البديل كشف منفذ SMTP 54325 ومكتبة SMTP جديدة.
2. **مكتبة الإرسال:** `fetch` لـ Resend ولـ Mailpit، بلا SDK ولا تبعية جديدة.
3. **بلا `notify.dispatch`:** قناة كل حدث في `app.notification_event`، و`app.notify()` تضع مهمة `email.send` فقط لحدث له بريد. مهمة واحدة بدل اثنتين.
4. **مفتاح Resend:** `email/<notification_id>` (UUID ثابت لكل محاولات المهمة، DEC71) بدل `job:<id>`. أرقام المهام تبدأ من جديد بعد `db:reset` أو استرجاع نسخة، فقد يتكرر رقم خلال 24 ساعة، فيُرفض بريد جديد بـ 409 أو لا يُرسل.
5. **القرار وقت الإرسال:** العنوان من `auth.users` فقط. البريد الإلزامي يصل أياً كانت حالة الحساب. والاختياري لحساب نشط ومجموعته مفعّلة لحظة الإرسال. وكل بريد يحتاج عنواناً مؤكداً.
6. **إشعارات ما قبل 3.8:** لا إرسال لها. البريد لما يُنشأ بعد الهجرة فقط، فالصفوف الـ 79 تجريبية، ولا بيئة مستضافة.
7. **زر البريد الاختياري** إلى `/notifications` لا إلى الوجهة، وزر بريدي الحذف والاسترجاع إلى `/login`.
8. **نص بريد طلب الحذف والاسترجاع:** النص المقترح في القسم 5 من «التصميم»، ومعه بريد التواصل لمن لم يستطع الدخول.
9. **حزمة `packages/email`** للإطار المشترك بين قوالب Supabase وبريد العامل.
10. **عدد الشريط** لجلسة لها وصول `member` فقط. من لم يقر بالشروط الجديدة لا يرى عدداً حتى يقر، كما في العقد.
11. **بلا حد طلبات ولا تدقيق** لـ API029 وAPI079: لا حد لهما في المواصفات ولا الملحق.
12. **المفتاح الأجنبي `not valid`** للصفوف التجريبية القديمة. وتُعدَّل اختبارات 2.4 لتستعمل حدثاً في الجدول.

## التنفيذ

### ما بُني

- **الهجرة** `20261122170000_notifications.sql`: `app.notification_event` بالحدثين `required`، والمفتاح الأجنبي `not valid`، و`app.notify()` الجديدة (مهمة `email.send` واحدة لكل إشعار له بريد)، و`app.notification_email()` للعامل، و`app.my_notifications()` و`app.unread_notification_count()` و`app.mark_notifications_read()` و`app.update_notification_preferences()`، والداخلية `app.member_read_actor()`.
- **`@souq/domain`:** `NOTIFICATION_EVENTS` و`EMAIL_GROUPS` و`EMAIL_CHANNELS`.
- **`packages/email` (جديدة):** الإطار المشترك (انتقل من `build-email-templates.ts`، وقوالب Supabase لم تتغير حرفاً) و`renderNotificationEmail`: بريد خاص لكل حدث إلزامي، وبريد عام لكل مجموعة اختيارية.
- **العامل:** `jobs/email.send.ts`، ومحوّلا `email/mailpit.ts` و`email/resend.ts` بـ `fetch`، و`email/config.ts`، ومتغيرات `EMAIL_TRANSPORT` و`EMAIL_FROM` و`MAILPIT_URL` و`RESEND_API_KEY` و`APP_ORIGIN` و`CONTACT_EMAIL`، يفحصها `main.ts` عند البدء.
- **الموقع:** `lib/notifications/{events,list,read,preferences}.ts`، والمسارات `GET`/`PATCH /api/notifications` و`GET /api/notifications/unread-count` و`PATCH /api/me/preferences`، وصفحتا `/notifications` و`/account/notifications`، والعدد في الشريط العلوي، ورابط «تفضيلات البريد» في `/account`، وقسم في `/dev/ui`.
- **الإعداد:** `.env.example`، و`pnpm env:local` (بريد العامل إلى Mailpit، وعنوان التواصل `contact@souqjamia1.test`)، و`ops/runbooks/secrets.md` (`RESEND_API_KEY`)، و`plan/cost-plan.md` (إضافة المالك 2 وفحص Resend الحقيقي)، و`packages/db/README.md`، و`CLAUDE.md`.

### إضافات المالك الثلاث

1. **`email_confirmed_at` (DEC63):** فحصتُه قبل أي كود بتسجيل حقيقي عبر API001 محلياً: مضبوط تلقائياً. والاختباران `DEC63 an account from API001 has email_confirmed_at` و`SEC11 a deletion request emails the deadline and the recovery steps` يسجّلان حساباً عبر API001 بلا أي تأكيد، ويطلبان الحذف، ويقرآن الرسالة الحقيقية من Mailpit. يعملان في CI أيضاً.
2. **`CONTACT_EMAIL`:** `contact@souqjamia1.test` في `pnpm env:local` وإعداد E2E ومعرض `/dev/ui` والاختبارات وخطوات المراجعة، بدل `contact@example.test`. ولا بريد شخصي في أي ملف (فُحص بـ `git grep`). والعنوان الحقيقي على `souqjamia1.com` مسجّل في مرحلة التكلفة 1 في `plan/cost-plan.md`.
3. **بريد الاسترجاع:** بلا جملة الإيقاف والحظر، واختبار وحدة واختبار تكامل يتأكدان من غيابها.

### اختلافات عن الخطة

1. **«في» صارت «يوم» قبل التاريخين** في بريد طلب الحذف: التاريخ المنسّق يبدأ باسم اليوم («يوم الأحد، 22 نوفمبر 2026 في 1:00 م»)، و«في الأحد» لا تستقيم. باقي النص كما اعتُمد.
2. **نصوص البريد الاختياري الخمسة جديدة** (`email.notification.groups.*`): لكل مجموعة موضوع وعنوان وسطر عام مثل «حدث تغيير في أحد عروض الأسعار الخاصة بك. افتح الإشعارات لترى التفاصيل.». لا تفاصيل ولا أسماء ولا مبالغ (BR38، البند 7). فلا تحتاج المهام اللاحقة نص بريد لكل حدث اختياري. تحتاج مراجعتك.
3. **`app.member_read_actor()`** دالة داخلية لم تُذكر في الخطة: وصول `member` لدوال القراءة بترتيب `app.assert_active_member()` بلا قفل، لتبقى دالة القراءة STABLE. تنفع قراءات الأعضاء في المهام اللاحقة.
4. **صفحات `/notifications` التالية رابط بالمؤشر** (`?cursor=`) يُعرض من الخادم، لا زر يجلب بـ JavaScript: يعمل بلا JavaScript، والتواريخ تُنسَّق في الخادم وحده.
5. **`destination` لإشعار لا يعرفه هذا الإصدار** هي `/notifications` في API078، لأن العقد يطلب مساراً دائماً. والصفحة تعرضه «غير متاح».
6. **مفتاح منع التكرار في Mailpit** يُحفظ في الترويسة `X-Souq-Idempotency-Key`، ليقرأه الاختبار وأنت في المراجعة.
7. **مثال `packages/db/README.md`** الذي كان يضع `email.send` يدوياً صار `app.notify(...)`: مهام البريد تأتي منها وحدها الآن.
8. **شغّلتُ `pnpm env:local`** أثناء التنفيذ لأن العامل يحتاج متغيراته، فتغيرت كلمتا مرور الدورين. خادمك `pnpm dev` على 3000 يحتاج إعادة تشغيل (الخطوة 3 من المراجعة).

### نتائج الفحص (22 نوفمبر 2026)

- `pnpm format:check` و`pnpm lint` و`pnpm typecheck` و`pnpm check:css` و`pnpm contract:lint` و`pnpm check:contract-ids` و`pnpm emails:check` و`pnpm check:migrations` و`pnpm db:lint`: نظيفة.
- `pnpm test`: 35 ملفاً، 1068 اختباراً ناجحاً.
- `pnpm test:integration`: 29 ملفاً، 405 اختبارات ناجحة، ومنها الفحص الشامل ومصفوفة القراءة بالدوال الثلاث الجديدة.
- `pnpm build` و`pnpm check:bundle`: نظيفان.
- `pnpm test:e2e`: 191 ناجحاً في التشغيل الكامل الثاني. في الأول فشلت 6 من اختباراتي (فحص التركيز على نص التنبيه بدل غلافه، واختفاء تنبيه «علّم الكل» بعد تحديث الصفحة، وأُصلحا)، و4 اختبارات دخول عند 360 من ملفي `recovery` و`restricted` انتظرت الدخول أكثر من 5 ثوانٍ. نجحت الأربعة في التشغيل الثاني، وسُجّلت في «اختبارات متقطعة» في `plan/phase-1.md`.
- **العامل الحقيقي:** شغّلته 40 ثانية على Supabase المحلي: أرسل 34 رسالة تركتها الاختبارات في الطابور إلى Mailpit، بلا خطأ، ولا عنوان في أي سطر سجل.
- **الصفحتان والبريد في المتصفح** (البناء الإنتاجي على 3101): `/notifications` و`/account/notifications` ورسالة «طُلب حذف حسابك» في Mailpit، كما في خطوات المراجعة.

### المراجعة المحلية

الخطوات في `ops/runbooks/local-dev.md`، قسم «مراجعة نواة الإشعارات (المهمة 3.8)». ما جرّبته بنفسي قبل كتابتها: تشغيل العامل (الخطوة 4)، وعرض صفحتي التفضيلات والإشعارات على حساب مراجعة 3.7 في متصفح البناء الإنتاجي (الخطوتان 5 و9، بلا حفظ ولا تعليم كمقروء)، ورسالة «طُلب حذف حسابك» في Mailpit (الخطوة 7، من رسائل الاختبارات)، وأوامر SQL في الخطوة 10 داخل معاملة أُلغيت. والتدفق الكامل بالنقر (الحفظ، وتعليم الكل، وفتح إشعار) مغطى في E2E، والحذف والاسترجاع ببريدهما في التكامل.

### الاعتماد

اعتمد المالك المهمة اعتماداً صريحاً بتاريخ 22 نوفمبر 2026، بعد مراجعته المحلية:
- **ما جرّبه:** التفضيلات تُظهر المجموعات الخمس مطفأة، وبريد الأمان إلزامياً بلا خيار إيقاف. ووصل بريد «طُلب حذف حسابك» بالعربية في Mailpit بموعد الحذف وخطوات الاسترجاع وسطر «إذا لم تسجّل...»، ووصل بريد «استُرجع حسابك». وظهر الإشعاران في القائمة مع العدد في الشريط، وزر «علّم الكل كمقروء» يعمل.
- **الاختلافان عن الخطة معتمدان،** وهما 1 و2 في «اختلافات عن الخطة» أعلاه: «يوم» بدل «في» قبل التاريخين، والنص العام لكل مجموعة اختيارية.
- **بهذا تكتمل المجموعة 3.** وطلب المالك قبل أول مهمة في المجموعة 4: معالجة الاختبارات المتقطعة في جدول «اختبارات متقطعة» في `plan/phase-1.md` بسببها الحقيقي، لا برفع المهلة. البند الأول في «ملاحظات للجلسة القادمة».
