# التشغيل المحلي والمراجعة

مرحلة التكلفة 0 (DEC62): كل التطوير والمراجعة على الجهاز، بلا حسابات مستضافة.

## المتطلبات

- Node 26.13.1 (`.nvmrc`)، وpnpm 12.17.0.
- Docker Desktop يعمل. صور Supabase المحلية حوالي 7 GB، وتُنزَّل مرة واحدة في أول تشغيل.

## خطوات التشغيل

نفّذها من مجلد المستودع، بالترتيب:

1. `pnpm install`
2. `pnpm db:start`
   - يشغّل Supabase المحلي. أول مرة يأخذ دقائق لتنزيل الصور.
3. `pnpm env:local`
   - يكتب `apps/web/.env.local` و`apps/worker/.env.local` من Supabase المحلي.
   - يضع كلمة مرور عشوائية جديدة لدور العامل `souq_worker` على القاعدة المحلية، ورابطها في `apps/worker/.env.local` (المهمة 2.5).
   - **أعد تشغيله بعد كل `pnpm db:reset`،** لأن إعادة القاعدة تمسح كلمة مرور الدور. بدونه يرفض العامل البدء بالسطر `worker.db_unavailable`.
   - لا يكتب فوق ملف لم يولّده هو.
4. `pnpm dev`
   - الموقع على `http://localhost:3000`.
5. اختياري: `pnpm dev:worker` في نافذة ثانية، للعامل الخلفي.

## ما تفتحه للمراجعة

| العنوان | ما فيه |
| --- | --- |
| `http://localhost:3000` | الموقع |
| `http://localhost:3000/healthz` | فحص الحياة (API105) |
| `http://127.0.0.1:54323` | Supabase Studio: الجداول والمستخدمون |
| `http://127.0.0.1:54324` | Mailpit: كل البريد الذي يرسله Supabase محلياً، ولا يخرج شيء للإنترنت |

## مراجعة الواجهة: صفحة المكوّنات `/dev/ui`

الصفحة تعرض كل مكوّن موحّد بحالاته (المهمة 1.5). لا تحتاج Supabase، فيكفي `pnpm dev`.

1. افتح `http://localhost:3000/dev/ui`.
2. **راجع الأقسام بالترتيب:**
   - الألوان والخطوط.
   - الأزرار، ومنها زر معطّل يعرض سببه.
   - الحقول: حقل السعر فيه «٣٥٠٫٥٠٥» عمداً ليظهر خطأ المنزلتين العشريتين.
   - التنبيهات والشارات والبطاقة.
   - حالات الصفحة: التحميل والفراغ والخطأ.
   - الأرقام والمبالغ والتواريخ.
   - نصوص الأعضاء: يجب أن يظهر `<script>` نصاً، وأن يكون رابط https فقط قابلاً للضغط.
   - النافذة المنبثقة: تُغلق بـ Escape ويعود التركيز لزرها.
   - الشريط العلوي بشكل العضو.
3. **عرض الجوال:** في Chrome اضغط F12، ثم Ctrl+Shift+M، واختر عرض 360. تأكد أن الصفحة لا تتمرر أفقياً، وأن زر «القائمة» يفتح الروابط ويغلقها.
4. **لوحة المفاتيح:** حدّث الصفحة، ثم اضغط Tab. أول ما يظهر رابط «تخطَّ إلى المحتوى». تابع بـ Tab وتأكد أن إطار التركيز ظاهر على كل عنصر.
5. **صفحة «غير متاح»:** افتح أي مسار غير موجود، مثل `http://localhost:3000/abc`.

روابط الشريط والتذييل تذهب لصفحات لم تُبنَ بعد، مثل `/market` و`/login`، فترجع «غير متاح» حتى تُبنى في مهامها.

## مراجعة طبقة HTTP (المهمة 1.6)

المهمة أضافت متغيرات بيئة جديدة، فشغّل أولاً `pnpm env:local` ثم أعد تشغيل `pnpm dev`. بدونها يرفض الخادم التشغيل ويذكر أسماء المتغيرات الناقصة (OPS05).

1. **رمز CSRF:** افتح `http://localhost:3000/api/csrf`، فيظهر JSON فيه `token`.
2. **ترويسات الأمان:** في Chrome اضغط F12، ثم تبويب Network، وحدّث الصفحة الرئيسية، واضغط أول طلب (`localhost`). في Response Headers يجب أن تظهر:
   - `Content-Security-Policy`، وفيها `nonce-` يتغير مع كل تحديث.
   - `X-Trace-Id` و`X-Frame-Options: DENY` و`X-Robots-Tag: noindex, nofollow`.
3. **Console:** يجب ألا يظهر خطأ CSP في الرئيسية ولا في `/dev/ui`.
4. **طلبات مرفوضة:** في PowerShell من مجلد المستودع. استخدم `curl.exe` لا `curl`، لأن `curl` في PowerShell اسم بديل لأمر آخر.
   - طلب بلا رمز، يرجع 403 و`CSRF_FAILED` مع `trace_id`:

     ```powershell
     curl.exe -i -X POST http://localhost:3000/api/csrf -H "Origin: http://localhost:3000"
     ```

   - طلب من موقع آخر، يرجع 403 و`ORIGIN_REJECTED`:

     ```powershell
     curl.exe -i -X POST http://localhost:3000/api/csrf -H "Origin: https://evil.example"
     ```

5. **فحص الجاهزية `/readyz`:**
   - بلا رمز، يرجع 401:

     ```powershell
     curl.exe -i http://localhost:3000/readyz
     ```

   - بالرمز من `.env.local`، يرجع 200 و`ready` ما دام Supabase المحلي يعمل:

     ```powershell
     $t = (Select-String -Path apps/web/.env.local -Pattern '^PROBE_TOKEN=(.*)').Matches.Groups[1].Value
     curl.exe -i -H "X-Probe-Token: $t" http://localhost:3000/readyz
     ```

   - بعد `pnpm db:stop` يرجع نفس الطلب 503 و`not_ready`.
6. **السجلات:** في نافذة `pnpm dev` يظهر سطر JSON لكل طلب API (`api.request`) ولكل طلب مرفوض (`http.rejected`)، بلا رموز ولا كوكيز.

أسرار الخادم وأثر تغييرها في [secrets.md](secrets.md).

## مراجعة خط الأساس الأمني في القاعدة (المهمة 2.1)

أول هجرات في المشروع. لا واجهة جديدة، فالمراجعة على القاعدة والاختبارات. نفّذ الخطوات من مجلد المستودع في PowerShell، وSupabase المحلي يعمل (`pnpm db:start`).

1. **تطبيق الهجرات:** `pnpm db:reset`. يمسح القاعدة المحلية ويطبّق الهجرات الثلاث، ويجب أن تظهر أسماؤها بلا أخطاء:
   - `20261119090000_sec02_dec36_baseline.sql`
   - `20261119090100_enums.sql`
   - `20261119090200_helpers.sql`
2. **الاختبارات:** `pnpm test:integration`. يجب أن تنجح كلها، ومنها:
   - الفحص الشامل بلا مخالفات.
   - اختبار يزرع مخالفة لكل قاعدة داخل معاملة تُلغى، ويتأكد أن الفحص يجدها كلها.
   - الهوية لا تنتقل لمعاملة تالية على نفس الاتصال (شرطك 2).
3. **فحص دوال PL/pgSQL:** `pnpm db:lint`، ويجب أن يطبع `No schema errors found`.
4. **Studio** (`http://127.0.0.1:54323`)، في Database:
   - **Schemas:** تظهر `app`، ومن دوالها `actor_id` و`app_now` و`normalize_text` و`raise_api_error` و`search_normalize`.
   - **Enumerated Types:** 33 نوعاً في `public`.
   - **Roles:** يظهر `souq_web` و`souq_worker`.
5. **`app` غير مكشوفة عبر REST**، يرجع 406 و`PGRST106`:

   ```powershell
   $k = (pnpm --silent db:status -o json | ConvertFrom-Json).PUBLISHABLE_KEY
   curl.exe -i -H "apikey: $k" -H "Accept-Profile: app" http://127.0.0.1:54321/rest/v1/
   ```

6. **تطبيع البحث (DEC67):** في Studio افتح SQL Editor ونفّذ:

   ```sql
   select app.search_normalize('أحمد يبيع مكتبة ومستشفى آيفون ١٣ iPhone');
   ```

   النتيجة: `احمد يبيع مكتبه ومستشفي ايفون 13 iphone`.
7. **الفحوص الأخرى:**
   - `pnpm check:migrations`: الهجرات المدموجة لم تتغير. يقارن بـ `origin/main`، فحدّثه أولاً بـ `git fetch origin main`.
   - `pnpm check:supabase-images`: صور Supabase العاملة تطابق البصمات في `packages/db/supabase/images.lock.json`.

## مراجعة جداول الهوية (المهمة 2.2)

لا واجهة جديدة أيضاً. نفّذ في PowerShell من مجلد المستودع، وSupabase المحلي يعمل.

1. **الهجرات:** `pnpm db:reset`. تظهر الهجرتان الجديدتان بعد هجرات 2.1:
   - `20261119100000_identity.sql`
   - `20261119100100_member_guard.sql`
2. **الاختبارات:** `pnpm test:integration`. تنجح كلها، ومنها `identity.test.ts` و`member-guard.test.ts`.
3. **تسجيل بلا اسم يُرفض،** ويطبع 500 ورسالة عامة بلا تفاصيل القاعدة. الأوامر بـ `Invoke-RestMethod`، لأن Windows PowerShell يحذف علامات التنصيص من JSON الممرر إلى `curl.exe`:

   ```powershell
   $k = (pnpm --silent db:status -o json | ConvertFrom-Json).PUBLISHABLE_KEY
   $noName = @{ email = "review-no-name@example.test"; password = "review-password-1"; gotrue_meta_security = @{ captcha_token = "XXXX.DUMMY.TOKEN.XXXX" } } | ConvertTo-Json
   try { Invoke-RestMethod -Method Post -Uri http://127.0.0.1:54321/auth/v1/signup -Headers @{ apikey = $k } -ContentType "application/json" -Body $noName } catch { $_.Exception.Response.StatusCode.value__; $_.ErrorDetails.Message }
   ```

4. **تسجيل باسم ينشئ الملف.** الاسم بالإنجليزية هنا لأن PowerShell قد يغيّر ترميز العربية في الطلب، والاختبارات تغطي العربية:

   ```powershell
   $withName = @{ email = "review-1@example.test"; password = "review-password-1"; data = @{ display_name = "  Review Member  " }; gotrue_meta_security = @{ captcha_token = "XXXX.DUMMY.TOKEN.XXXX" } } | ConvertTo-Json
   Invoke-RestMethod -Method Post -Uri http://127.0.0.1:54321/auth/v1/signup -Headers @{ apikey = $k } -ContentType "application/json" -Body $withName
   ```

   في Studio افتح SQL Editor ونفّذ:

   ```sql
   select p.id, p.display_name, p.hidden_from_public, c.status
     from public.profile p join public.account_control c on c.user_id = p.id;
   ```

   يظهر `Review Member` بلا المسافات، و`hidden_from_public` بالقيمة `false`.
5. **الإخفاء يتبع حالة الحساب في نفس المعاملة.** في SQL Editor:

   ```sql
   update public.account_control
      set status = 'suspended', suspended_until = now() + interval '7 days'
    where user_id = (select id from public.profile where display_name = 'Review Member');
   select hidden_from_public from public.profile where display_name = 'Review Member';
   ```

   النتيجة `true`. وأعده بعدها:

   ```sql
   update public.account_control set status = 'active', suspended_until = null
    where user_id = (select id from public.profile where display_name = 'Review Member');
   ```

6. **الأعمدة الخاصة لا يقرؤها الزائر:** الأول يرجع الأسماء، والثاني يطبع 401 والرمز `42501`:

   ```powershell
   Invoke-RestMethod -Uri "http://127.0.0.1:54321/rest/v1/profile?select=display_name" -Headers @{ apikey = $k }
   try { Invoke-RestMethod -Uri "http://127.0.0.1:54321/rest/v1/profile?select=auth_user_id" -Headers @{ apikey = $k } } catch { $_.Exception.Response.StatusCode.value__; $_.ErrorDetails.Message }
   ```

## مراجعة البيانات المرجعية (المهمة 2.3)

لا واجهة جديدة. Supabase المحلي يعمل.

1. **الهجرة والبيانات التجريبية:** `pnpm db:reset`. يظهر `20261119110000_reference_data.sql`، ثم «Seeding data from supabase/seed.sql».
2. **الاختبارات:** `pnpm test:integration`. تنجح كلها، ومنها `reference-data.test.ts`.
3. **في Studio،** افتح SQL Editor ونفّذ:

   ```sql
   select key, label_ar, label_en from public.category order by display_order;
   select key, kind, label_ar from public.meeting_point order by display_order;
   select key, label_ar from public.college order by display_order;
   ```

   - سبع فئات بتسميات المواصفات، من «الكتب والدراسة» إلى «أخرى».
   - أربع نقاط لقاء تجريبية: اثنتان `campus` واثنتان `city`.
   - ثلاث كليات تجريبية.
4. **كشف التكرار:** يُرفض هذا الإدخال بخطأ `duplicate key`، لأنه يختلف عن «كلية تجريبية 1» بالتاء المربوطة فقط:

   ```sql
   insert into public.college (key, label_ar) values ('dup_review', 'كليه تجريبيه 1');
   ```

5. **الزائر يقرأ القوائم:** يطبع الفئات السبع بالعربية:

   ```powershell
   $k = (pnpm --silent db:status -o json | ConvertFrom-Json).PUBLISHABLE_KEY
   Invoke-RestMethod -Uri "http://127.0.0.1:54321/rest/v1/category?select=key,label_ar&order=display_order" -Headers @{ apikey = $k }
   ```

6. **إضافة فئة مستقبلاً:** الخطوات في [reference-data.md](reference-data.md).

## مراجعة البنية التحتية في القاعدة (المهمة 2.4)

لا واجهة جديدة. Supabase المحلي يعمل.

1. **الهجرة:** `pnpm db:reset`. يظهر `20261119120000_infrastructure.sql`.
2. **الاختبارات:** `pnpm test:integration`. تنجح كلها، ومنها `idempotency` و`rate-limit` و`audit-jobs` و`notifications`.
3. **في Studio، SQL Editor:** الجداول الداخلية في `app`، لا في `public`:

   ```sql
   select table_name from information_schema.tables where table_schema = 'app' order by 1;
   ```

   تظهر `audit_event` و`idempotency_record` و`job` و`rate_limit_bucket`.
4. **عدّاد المحاولات (DEC70):** نفّذ السطر ثلاث مرات. الأولى والثانية ترجعان `0`، والثالثة عدد الثواني الباقية حتى نهاية الدقيقة:

   ```sql
   select app.rate_limit_hit('review:demo', sha256('demo'::bytea), 2, '1 minute');
   ```

5. **التدقيق لا يُعدَّل:** يُرفض التعديل بالرسالة «app.audit_event is append-only (RET08)». الصف التجريبي يبقى في القاعدة المحلية حتى `pnpm db:reset`:

   ```sql
   select app.audit('review.check');
   update app.audit_event set action = 'review.changed' where action = 'review.check';
   ```

6. **التفضيلات:** بعد تسجيل عضو كما في مراجعة 2.2، تظهر له المجموعات الخمس مطفأة:

   ```sql
   select * from public.notification_preference;
   ```

## مراجعة العامل الخلفي (المهمة 2.5)

لا واجهة جديدة. Supabase المحلي يعمل. كل سطر من العامل كائن JSON واحد.

1. **الهجرة:** `pnpm db:reset`. يظهر `20261119130000_worker_jobs.sql`.
2. **كلمة مرور الدور:** `pnpm env:local`، لأن `db:reset` مسحها.
3. **الاختبارات:** `pnpm test:integration`. تنجح كلها، ومنها `worker-queue` و`worker-loop`.
4. **تشغيل العامل:** `pnpm dev:worker` في نافذة ثانية. يظهر سطران:
   - `worker.started`، وفيه `"kinds":["audit.purge"]`.
   - `job.done` لـ `audit.purge` مع `"result":{"deleted":0}`. هذه مهمة اليوم الدورية (البند 7)، وتعمل مرة واحدة في اليوم مهما أعدت التشغيل.
5. **في Studio، SQL Editor،** أنشئ ثلاث مهام:

   ```sql
   select app.enqueue_job('audit.purge', '{}', 'review:1') as purge,
          app.enqueue_job('review.unknown') as unknown_kind,
          app.enqueue_job('audit.purge', '{"x": 1}', 'review:2') as bad_payload;
   ```

   خلال 5 ثوانٍ يظهر في نافذة العامل:
   - `job.done` للمهمة الأولى.
   - `job.dead` بمستوى `error` والرمز `INVALID_PAYLOAD` للثالثة، لأن حمولتها لا تطابق مخطط النوع (البند 3).
   - لا شيء للثانية، لأن العامل لا يعرف نوعها (البند 4).
6. **حالة المهام:**

   ```sql
   select id, kind, status, attempts, last_error_code from app.job order by id;
   ```

   المهمة `review.unknown` حالتها `queued` و`attempts` صفر، والثالثة `dead`.
7. **فحص الطابور كما يراه الخادم:** يظهر `oldest_due_seconds` أكبر من صفر بسبب `review.unknown`، و`dead_last_24h` يساوي 1:

   ```sql
   set role souq_web;
   select * from app.job_queue_health();
   reset role;
   ```

8. **الإيقاف:** أوقف `pnpm dev:worker` بـ `Ctrl+C`، ثم شغّل العامل مباشرة بلا pnpm:

   ```bash
   node --env-file=apps/worker/.env.local apps/worker/src/main.ts
   ```

   اضغط `Ctrl+C` فيظهر `worker.stopping` ثم `worker.stopped`. على Windows، `pnpm dev:worker` (pnpm مع `--watch`) ينهي العملية بعد `worker.stopping`، ويسأل «Terminate batch job (Y/N)?». أجب Y. الإيقاف الكامل بإشارة SIGTERM جُرّب أيضاً في حاوية Linux، كما يفعل Railway.
9. **رفض الدور الخطأ:** في نافذة PowerShell جديدة، شغّل العامل برابط دور `postgres` المحلي، وهو `DB_URL` في ناتج `pnpm db:status`. ضعه مكان `<DB_URL>`:

   ```powershell
   $env:APP_ENV = 'development'; $env:DATABASE_URL = '<DB_URL>'; node apps/worker/src/main.ts
   ```

   يرفض البدء بالسطر `worker.config_invalid` ورسالة «DATABASE_URL must use the souq_worker role.». ثم أغلق النافذة، لأن المتغير فيها يتقدم على `apps/worker/.env.local`.
10. **التنظيف:** المهام التجريبية تبقى حتى `pnpm db:reset`، ثم `pnpm env:local`.

## مراجعة ربط Supabase Auth بالخادم (المهمة 3.1)

لا صفحة دخول قبل 3.3، فحالات العضو الحقيقية تُراجع بالاختبارات، وبصفحة المكوّنات للشكل. الأوامر في PowerShell من جذر المستودع، وSupabase المحلي يعمل.

1. **الهجرة:** `pnpm db:reset`. يظهر `20261119140000_web_session.sql`.
2. **كلمتا مرور الدورين:** `pnpm env:local`. صار `apps/web/.env.local` فيه `DATABASE_URL` بدور `souq_web`، و`CONTACT_EMAIL=contact@example.test`.
   - أوقف أي `pnpm dev` قديم وشغّله من جديد، لأن الأسرار وكلمة المرور تغيّرت.
3. **الاختبارات:** `pnpm test:integration`. تنجح كلها، ومنها:
   - `auth-guards`: الحالات الست، والجلسة الحية بعد الخروج، والإيقاف أثناء الجلسة، والجلسة المحدودة (DEC73)، وتجديد الرمز وخصائص الكوكيز.
   - `web-db`: الاتصال بدور `souq_web`، وتحويل الأخطاء، وحدود الفشل (DEC70)، والـ deadlock المفتعل مع الإعادة (DEC72)، وفحوص الجاهزية.
4. **`pnpm dev`،** ثم فحص الجاهزية برمز الفحص من `.env.local`:

   ```powershell
   $token = (Get-Content apps/web/.env.local | Where-Object { $_ -like 'PROBE_TOKEN=*' }) -replace '^PROBE_TOKEN=', ''
   Invoke-RestMethod http://localhost:3000/readyz -Headers @{ 'X-Probe-Token' = $token } | ConvertTo-Json
   ```

   يظهر `"status": "ready"` و`supabase_auth` و`database` و`job_queue` كلها `true`.
   - إن ظهر `job_queue` بقيمة `false` والحالة `ready`: مهمة ماتت في آخر 24 ساعة، غالباً من اختبارات العامل. هذا متوقع (البند 13)، و`pnpm db:reset` ثم `pnpm env:local` يمسحانها.
5. **بلا رمز الفحص:** نفس الأمر بلا `-Headers` يرجع خطأ 401.
6. **صفحة المكوّنات:** <http://localhost:3000/dev/ui>، قسم «الحساب المقيّد» في آخرها. ثلاث حالات:
   - موقوف: تاريخ ووقت انتهاء الإيقاف بتوقيت الرياض (12:00 م للمثال)، وقسم «الاعتراض على القرار».
   - محظور: مع قسم الاعتراض.
   - بانتظار الحذف: تاريخ نهاية مهلة الاسترجاع، وقسم «تحتاج مساعدة؟». زر الاسترجاع يأتي في 3.7.
   - في الحالات كلها البريد `contact@example.test` رابط `mailto`.
7. **`/restricted` كزائر:** <http://localhost:3000/restricted> ينقلك إلى صفحة الدخول (من 3.3).
8. **توقف القاعدة:** `pnpm db:stop`، ثم أمر الخطوة 4: خطأ 503، لأن الموقع لا يصل إلى القاعدة ولا إلى Supabase Auth. ثم `pnpm db:start`، وأمر الخطوة 4 من جديد: `ready`، بلا إعادة تشغيل `pnpm dev`، لأن مجمّع الاتصالات يتصل من جديد.
9. **الشريط العلوي** يبقى بشكل الزائر لأنك لم تدخل. شكل العضو يظهر بعد الدخول في 3.3، وجُرّب في 3.1 بجلسة حقيقية في المتصفح (النتيجة في `plan/task-3.1.md`).

## مراجعة التسجيل والتأكيد (المهمة 3.2)

التأكيد معطّل الآن (DEC63)، فالتسجيل يدخلك فوراً. وضع التفعيل يُجرَّب في الخطوة 9، وهو اختياري. الأوامر من جذر المستودع، وSupabase المحلي يعمل.

1. **الهجرة:** `pnpm db:reset`. يظهر `20261120090000_signup.sql`. هذا يمسح الحسابات التجريبية المحلية.
2. **`pnpm env:local`.** صار في `apps/web/.env.local` السطر `NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA`، وهو مفتاح الاختبار العام من Cloudflare.
   - **أوقف أي `pnpm dev` قديم وشغّله من جديد،** لأن المتغير جديد والأسرار وكلمات المرور تغيّرت.
3. **الاختبارات:** `pnpm test:integration`. تنجح كلها، ومنها `signup` و`confirm` و`policies`.
4. **`pnpm dev`:** لا يظهر في النافذة تحذير «A Node.js API is used (process.exit...) which is not supported in the Edge Runtime» ولا «Ecmascript file had an error» (شرط المالك 2). ولا تحذيرات في `pnpm build` أيضاً.
5. **أخطاء الحقول:** افتح <http://localhost:3000/signup> واضغط «إنشاء الحساب» والنموذج فارغ.
   - تظهر الأخطاء تحت كل حقل معاً، والتركيز على حقل الاسم.
   - تحت كلمة المرور «8 أحرف على الأقل» فقط، بلا عدّاد (DEC75).
   - اكتب 57 حرفاً لاتينياً: يظهر العدّاد «57 من 64». وبـ 56 لا يظهر.
   - اكتب 37 حرفاً عربياً (مثل «ككككك...»): العدّاد «37 من 64»، وتنبيه أن الحروف تأخذ مساحة أكبر من المسموح، لأنها تتجاوز 72 بايت.
   - تحت حقل البريد: «تأكد من بريدك، فهو الطريقة الوحيدة لاستعادة حسابك» (DEC63).
6. **التسجيل:** املأ الاسم والبريد (مثل `review32-1@example.test`) وكلمة مرور من 8 أحرف، واختر «كلية تجريبية 1»، وضع العلامتين.
   - Turnstile يظهر بعلامة نجاح وعبارة أنه للاختبار فقط.
   - اضغط «إنشاء الحساب»: تنتقل إلى الرئيسية، والشريط العلوي بشكل العضو («حسابي»).
   - في Studio (<http://127.0.0.1:54323>): جدول `policy_acknowledgment` فيه صفان للحساب بالنسخة `draft-1`، و`profile.college_id` هو الكلية التي اخترتها.
7. **البريد المستخدم (DEC64):** افتح نافذة تصفح متخفٍ، ثم `/signup` بنفس البريد (ولو بأحرف كبيرة).
   - تحت حقل البريد: «هذا البريد مسجّل. سجّل الدخول أو استعد كلمة المرور»، ومعها رابطا الدخول والاستعادة (صفحتاهما في 3.3 و3.4).
8. **حد RL02 (DEC74):** في نفس النافذة المتخفية أعد الإرسال بنفس البريد حتى المحاولة السادسة. تظهر «محاولات كثيرة. حاول بعد ... ثانية». كل محاولة وصلت إلى Supabase تُعدّ، حتى الفاشلة. والحد لكل عنوان (300) لا يعمل محلياً، لأن `TRUSTED_PROXY_HOPS=0`.
9. **وضع التفعيل (اختياري):** اتبع «تبديل التحقق من البريد» أدناه، بالقيمة `true`.
   - سجّل ببريد جديد: تظهر «تحقق من بريدك» ونموذج إعادة الإرسال، والشريط العلوي يبقى بشكل الزائر.
   - افتح Mailpit (<http://127.0.0.1:54324>) ورسالة «أكّد بريدك في سوق الجامعة»، ثم زرها.
   - صفحة الرابط فيها زر «تأكيد البريد» فقط، والعنوان صار `/auth/confirm` بلا الرمز.
   - اضغط الزر: تنتقل إلى `/login?confirmed=1`، وفيها «تأكد بريدك» (من 3.3).
   - افتح رابط الرسالة مرة ثانية واضغط الزر: «الرابط انتهى أو استُخدم» مع نموذج إعادة إرسال.
   - **حد البريد في Supabase المحلي** 30 رسالة في الساعة للمشروع كله (`email_sent` في `config.toml`، قرار المالك على 3.4، وكان رسالتين). بعدها يرد الموقع بالرد العام نفسه، ولا تصل رسالة.
   - **أرجع القيمة إلى `false`** بنفس الخطوات.
10. **التأكيد معطّل:** <http://localhost:3000/auth/confirm> تعرض «هذه الصفحة غير متاحة» (DEC66).
11. **صفحة المكوّنات:** <http://localhost:3000/dev/ui>، قسم «حقل كلمة المرور» بحالاته الأربع (بلا عدّاد، وخطأ من الخادم، وأكثر من 56 حرفاً، وتجاوز 72 بايت)، وفي «الحقول» خانة الشروط بخطئها ورابطها.

## مراجعة الدخول والخروج (المهمة 3.3)

لا هجرة جديدة ولا متغير جديد، فلا `pnpm db:reset` ولا `pnpm env:local`. الأوامر من جذر المستودع، وSupabase المحلي يعمل.

1. **الفرع:** `git checkout phase1/task-3.3-login`، ثم أوقف `pnpm dev` وشغّله من جديد.
2. **الاختبارات:** `pnpm test:integration`. تنجح كلها، ومنها `login` و`logout`.
3. **زر الخروج (ما وجدته في مراجعة 3.2):** ادخل بحساب من مراجعة 3.2، أو سجّل حساباً جديداً من `/signup`.
   - افتح «حسابي» ثم «خروج». تنتقل إلى الرئيسية والشريط العلوي بشكل الزائر، بلا صفحة JSON.
   - في أدوات المطوّر، تبويب Network: الطلب `POST /api/auth/logout` رده 204.
   - في تبويب Application، قسم Cookies: لا كوكي يبدأ بـ `sb-`.
4. **صفحة الدخول:** <http://localhost:3000/login>.
   - حقل البريد، وحقل كلمة المرور بلا «8 أحرف على الأقل»، ورابط «نسيت كلمة المرور؟» (صفحته في 3.4)، وTurnstile، وزر «دخول»، ورابط «أنشئ حساباً».
   - اضغط «دخول» والنموذج فارغ: الخطأ تحت كل حقل، والتركيز على البريد.
5. **الدخول:** بالبريد وكلمة المرور الصحيحين، ولو كتبت البريد بأحرف كبيرة. تنتقل إلى الرئيسية والشريط بشكل العضو.
   - افتح <http://localhost:3000/login> وأنت داخل: تنتقل إلى الرئيسية.
6. **البيانات الخاطئة:** اخرج، ثم ادخل بكلمة مرور خاطئة: «البريد أو كلمة المرور غير صحيحة.». وببريد غير مسجّل: نفس الرسالة بالضبط.
7. **حد RL01:** بنفس البريد، كلمة مرور خاطئة 6 مرات.
   - المحاولات الخمس الأولى: الرسالة العامة.
   - السادسة: «محاولات دخول كثيرة. حاول مرة أخرى خلال ... دقيقة».
   - كلمة المرور الصحيحة الآن: نفس رسالة الانتظار. الانتظار 15 دقيقة على الأكثر، ثم يعود الدخول.
   - بريد آخر لا يتأثر.
8. **مسار العودة (TC02):**
   - <http://localhost:3000/login?next=https://evil.example>: بعد الدخول تبقى في الموقع، على الرئيسية.
   - اخرج، ثم <http://localhost:3000/login?next=/dev/ui>: بعد الدخول تصل إلى `/dev/ui`.
9. **الحساب المقيّد:** في Studio (<http://127.0.0.1:54323>)، SQL Editor، ضع بريد حسابك مكان `EMAIL`:

   ```sql
   update public.account_control set status = 'suspended', suspended_until = now() + interval '1 day'
    where user_id = (select id from auth.users where email = lower('EMAIL'));
   ```

   - اخرج ثم ادخل: تنتقل إلى `/restricted` مع تاريخ انتهاء الإيقاف، وتحتها زر «خروج».
   - افتح الرئيسية ثم `/login`: تعود إلى `/restricted`.
   - اضغط «خروج»: الرئيسية بشكل الزائر.
   - أرجع الحساب بنفس الطريقة: `set status = 'active', suspended_until = null`.
10. **الخروج وSupabase متوقف (DEC76، اختياري):** ادخل، ثم أوقف خدمة الدخول وحدها: `docker stop supabase_auth_souqjamia1`.
    - اضغط «خروج»: تنتقل إلى الرئيسية بشكل الزائر، لأن الكوكيز تُحذف دائماً.
    - في نافذة `pnpm dev` سطر `auth.call_failed` فيه `"flow":"logout"`، بلا أي رمز.
    - أعد الخدمة: `docker start supabase_auth_souqjamia1`.
11. **وضع التفعيل (اختياري):** اتبع «تبديل التحقق من البريد» أدناه بالقيمة `true`.
    - بعد زر «تأكيد البريد» في صفحة الرابط تنتقل إلى `/login?confirmed=1`، وفيها «تأكد بريدك».
    - حساب لم يؤكد بريده، بكلمة المرور الصحيحة: «بريدك لم يُؤكَّد بعد» مع نموذج إعادة الإرسال. وبكلمة مرور خاطئة: الرسالة العامة.
    - أرجع القيمة إلى `false`.
12. **صفحة المكوّنات:** <http://localhost:3000/dev/ui>، قسم «زر الخروج» بحالاته الثلاث (قبل الضغط، وأثناء الإرسال، والطلب لم يصل). زر الخروج هنا وفي معاينة الشريط العلوي لا يرسل شيئاً.

## مراجعة الاستعادة وتعيين كلمة المرور (المهمة 3.4)

فيها هجرة جديدة (`20261120150000_password_reset.sql`) وتغييران في `config.toml`: بريد «تغيّرت كلمة مرورك» (SEC11)، وحد البريد المحلي 30 في الساعة. لا متغير بيئة جديد، فلا `pnpm env:local`. الأوامر من جذر المستودع. Mailpit على <http://127.0.0.1:54324>.

1. **الفرع:** `git checkout phase1/task-3.4-recovery`، ثم أوقف `pnpm dev` وشغّله من جديد.
2. **Supabase:** على جهازك طبّقتُ الإعدادين والهجرة في 20 نوفمبر 2026، فتخطَّ هذه الخطوة. على جهاز آخر:
   - `pnpm db:stop` ثم `pnpm db:start`: يطبّق إعدادات `config.toml`.
   - `pnpm --filter @souq/db exec supabase migration up`: يطبّق الهجرة بلا مسح البيانات. أو `pnpm db:reset` ثم `pnpm env:local`، فتُمسح البيانات المحلية.
3. **الاختبارات:** `pnpm test:integration`. تنجح كلها، ومنها `recovery` و`reset`.
4. **جهاز آخر (لفحص إلغاء الجلسات):** ادخل بحسابك في نافذة تصفح متخفٍ، واتركها مفتوحة.
5. **طلب الرابط:** في نافذة عادية، <http://localhost:3000/login> ثم «نسيت كلمة المرور؟».
   - ببريد غير مسجّل: «تحقق من بريدك» مع «إن كان هذا البريد مسجّلاً...»، والزر «إرسال رابط جديد» معطّل مع عدّ تنازلي من 60 ثانية.
   - حدّث الصفحة، ثم ببريد حسابك: نفس الرسالة بالضبط.
   - حدّث الصفحة وأرسل لنفس البريد قبل مرور دقيقة: «طلبات كثيرة لهذا البريد. حاول مرة أخرى خلال ...» (RL03).
6. **الرسالة:** في Mailpit رسالة «استعادة كلمة المرور في سوق الجامعة». اضغط زرها.
7. **صفحة الرابط:** شريط العنوان يعرض `/auth/recover` بلا الرمز، وزر «متابعة لتعيين كلمة المرور». في أدوات المطوّر، تبويب Network: لا طلب `POST` قبل الضغط.
8. **كلمة المرور الجديدة:** اضغط الزر، فتنتقل إلى `/account/reset`. الشريط العلوي بشكل الزائر، وتحت الحقل «8 أحرف على الأقل».
   - كلمة المرور الحالية نفسها: «اختر كلمة مرور غير كلمة المرور الحالية لحسابك.».
   - 7 أحرف: «كلمة المرور قصيرة، 8 أحرف على الأقل.».
   - كلمة مرور جديدة صحيحة ثم «حفظ كلمة المرور»: تنتقل إلى `/login?reset=1` وفيها «عُيّنت كلمة المرور الجديدة».
9. **بعد التعيين:**
   - في Mailpit رسالة ثانية: «تغيّرت كلمة مرورك في سوق الجامعة»، بلا رابط (SEC11).
   - الدخول بكلمة المرور الجديدة ينجح، وبالقديمة الرسالة العامة.
   - حدّث نافذة التصفح المتخفي من الخطوة 4: الشريط بشكل الزائر، لأن كل الجلسات أُلغيت.
10. **الرابط المستعمل:** افتح رابط الرسالة نفسها مرة أخرى واضغط الزر: «الرابط انتهى أو استُخدم»، وتحته «اطلب رابطاً جديداً» بنموذجه.
11. **مهلة الخمس دقائق:** اطلب رابطاً جديداً بعد دقيقة، وافتحه واضغط الزر، ثم انتظر أكثر من 5 دقائق واضغط «حفظ كلمة المرور»: «انتهت مهلة الرابط» مع رابط «طلب رابط استعادة». وتحديث الصفحة بعد المهلة يعرض نفس الحالة.
12. **مسجّل بحساب آخر (قرار المالك على البند 2):** ادخل بحساب أ. اطلب رابطاً لحساب ب من نافذة متخفية، وافتح رابطه من Mailpit في نافذة الحساب أ.
    - الصفحة تقول «أنت مسجّل دخول بحساب آخر»، بلا زر المتابعة.
    - اضغط «اخرج وأكمل الاستعادة»: تنتقل مباشرة إلى `/account/reset` للحساب ب، والشريط بشكل الزائر.
13. **الصفحة بلا رابط:** <http://localhost:3000/account/reset> وأنت زائر: «افتح الرابط من بريدك».
14. **سجل التدقيق:** في Studio (<http://127.0.0.1:54323>)، SQL Editor:

    ```sql
    select action, actor_id, occurred_at from app.audit_event
     where action = 'account.password_reset' order by occurred_at desc limit 5;
    ```

    سطر لكل تعيين ناجح، بلا بريد ولا عنوان.

## مراجعة صفحة الحساب وتعديل الملف (المهمة 3.5)

فيها هجرة جديدة (`20261121090000_account_profile.sql`)، وقاعدة القراءة من الخادم (DEC77)، وحد تعديل الملف (DEC78). لا تغيير في `config.toml`. المتغير الجديد `TURNSTILE_STUB` لاختبارات E2E فقط: لا تضعه في `.env.local`، فتبقى أداة Turnstile الحقيقية في مراجعتك. الأوامر من جذر المستودع.

1. **الفرع:** `git checkout phase1/task-3.5-account`، ثم أوقف `pnpm dev` وشغّله من جديد.
2. **الهجرة:** على جهازك طبّقتُها في 21 نوفمبر 2026، فتخطَّ هذه الخطوة. على جهاز آخر: `pnpm --filter @souq/db exec supabase migration up` (بلا مسح البيانات)، أو `pnpm db:reset` ثم `pnpm env:local`.
3. **الاختبارات:** `pnpm test:integration`. تنجح كلها، ومنها `account` و`read-matrix` و`sec02-baseline` بقواعد DEC77 الأربع.
4. **صفحة «حسابي»:** ادخل بحسابك، ثم من قائمة «حسابي» في الشريط العلوي اختر «صفحة حسابي» (<http://localhost:3000/account>).
   - «بياناتك»: الاسم، والبريد وتحته «بريدك لا يظهر لأي عضو آخر.»، والكلية أو «بدون كلية»، و«عضو منذ» بتاريخ عربي.
   - «أقسام الحساب»: رابط «تعديل الملف» فقط. الأقسام الباقية تضيفها مهامها.
5. **API015:** في نفس النافذة افتح <http://localhost:3000/api/me>: JSON فيه بريدك و`capabilities` بقيمتين، و`pending_email` و`avatar` بقيمة `null`. وفي نافذة متخفية بلا دخول: `UNAUTHENTICATED` بالحالة 401.
6. **تعديل الملف:** من «تعديل الملف»:
   - اضغط «حفظ التغييرات» بلا تغيير: «لم تغيّر شيئاً بعد.».
   - اسم بحرف واحد: «الاسم قصير، حرفان على الأقل.» تحت الحقل، والمؤشر فيه.
   - اسم جديد صحيح وكلية من القائمة، ثم الحفظ: «حُفظت التغييرات.»، والاسم الجديد في قائمة «حسابي» بلا تحديث للصفحة.
7. **التعارض (409):** افتح «تعديل الملف» في تبويبين. احفظ اسماً في الأول، ثم احفظ اسماً آخر في الثاني: «تغيّر ملفك من مكان آخر». اضغط «اعرض البيانات الحالية»: يظهر اسم التبويب الأول.
8. **حد DEC78:** غيّر الاسم واحفظ 10 مرات (كل مرة اسماً مختلفاً). الحفظ الحادي عشر: «عدّلت ملفك مرات كثيرة خلال ساعة. حاول مرة أخرى خلال ... دقيقة.». الحد يبدأ من جديد عند رأس الساعة التالية (UTC).
9. **الإقرار بشروط جديدة (API119):** في Studio (<http://127.0.0.1:54323>)، SQL Editor، احذف إقرارات حسابك كأن نسخة جديدة نُشرت (ضع بريد حسابك المحلي مكان `you@example.test`):

   ```sql
   delete from public.policy_acknowledgment
    where user_id = (select id from auth.users where email = 'you@example.test');
   ```

   حدّث «حسابي»: شريط «نُشرت نسخة جديدة من الشروط» بمربعين. «موافقة» بلا تحديد: رسالة تحت المربع الأول. حدّد المربعين ثم «موافقة»: يختفي الشريط. وقبل الموافقة، «حفظ التغييرات» في «تعديل الملف» معطّل وبجانبه السبب.
10. **سجل التدقيق:** في SQL Editor:

    ```sql
    select action, metadata_minimal, occurred_at from app.audit_event
     where action = 'profile.update' order by occurred_at desc limit 5;
    ```

    سطر لكل حفظ غيّر شيئاً، فيه أسماء الحقول فقط (`display_name` و`college_id`)، بلا الاسم نفسه.
11. **محاكي Turnstile (اختياري):** لا يعمل في مراجعتك. يعمل فقط في `pnpm test:e2e` بالمتغير `TURNSTILE_STUB=true` الذي يضعه `tests/e2e/playwright.config.ts`، ويظهر فيه «تحقق تجريبي لاختبارات الموقع فقط: تم.» بدل الأداة.

## الاختبارات

- `pnpm test`: اختبارات الوحدة، بلا أي خدمة.
- `pnpm test:integration`: يحتاج `pnpm db:start` والهجرات مطبّقة (`pnpm db:reset`). يختبر إعدادات Auth، وخط الأساس الأمني في القاعدة. لا يعمل إلا على قاعدة على نفس الجهاز.
- `pnpm build` ثم `pnpm test:e2e`: اختبارات المتصفح بالعروض الثلاثة، مع فحص الوصول axe.
  - تحتاج تنزيل متصفح الاختبار مرة واحدة: `pnpm --filter @souq/tests exec playwright install --only-shell chromium`.
  - تشغّل الموقع بنفسها على المنفذين 3100 (التأكيد معطّل) و3102 (التأكيد مفعّل)، فلا تتعارض مع `pnpm dev`.
  - **من المهمة 3.2 تحتاج Supabase المحلي:** `pnpm db:start` ثم `pnpm env:local`، فتأخذ رابط القاعدة ومفاتيح Supabase من `apps/web/.env.local`. وتحتاج اتصالاً بالإنترنت لسكربت Turnstile من Cloudflare.

## الإيقاف

1. `Ctrl+C` في نافذة `pnpm dev`.
2. `pnpm db:stop`. البيانات المحلية تبقى للتشغيل القادم.
3. `pnpm db:reset` يمسح القاعدة المحلية ويعيدها من الهجرات في `packages/db/supabase/migrations`.

## تبديل التحقق من البريد (DEC63)

الإعداد الواحد هو `enable_confirmations` في `packages/db/supabase/config.toml`:

1. غيّر القيمة إلى `true`.
2. `pnpm db:stop`، ثم `pnpm db:start`.
3. `pnpm env:local`. ينسخ القيمة إلى `EMAIL_CONFIRMATION_REQUIRED`.
4. حدّث الاختبار المرتبط في `tests/unit/supabase-config.test.ts`. هذا تغيير قرار، فيُسجَّل أولاً (DEC48).

## ملاحظات

- **Turnstile:** محلياً يُستخدم مفتاح الاختبار العام من Cloudflare، وهو ينجح دائماً. سكربته يُحمَّل من `challenges.cloudflare.com` في صفحات التسجيل والدخول وطلب الاستعادة، ونموذجي إعادة الإرسال وطلب رابط جديد فقط، فيحتاج اتصالاً بالإنترنت.
- **القيم في `.env.local`:** مفاتيح التطوير المحلية الافتراضية من Supabase CLI، لا أسرار.
- **تحذير hydration mismatch في وحدة تحكم المتصفح:** سببه غالباً إضافة متصفح تضيف خصائص للصفحة قبل أن يحمّلها React، مثل `bis_skin_checked` و`bis_register`. ليس خطأ في الكود ولا يحتاج تعديلاً. للتأكد افتح الموقع في نافذة تصفح متخفٍ، فالإضافات معطّلة فيها افتراضياً، ويجب أن يختفي التحذير. إن بقي هناك فهو خطأ حقيقي يُبلَّغ عنه.
- **قياس الاستخدام:** Supabase CLI يرسل بيانات استخدام مجهولة افتراضياً. لإيقافه على جهازك:
  `pnpm --filter @souq/db exec supabase telemetry disable`
