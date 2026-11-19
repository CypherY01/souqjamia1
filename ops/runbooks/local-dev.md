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

## الاختبارات

- `pnpm test`: اختبارات الوحدة، بلا أي خدمة.
- `pnpm test:integration`: يحتاج `pnpm db:start` والهجرات مطبّقة (`pnpm db:reset`). يختبر إعدادات Auth، وخط الأساس الأمني في القاعدة. لا يعمل إلا على قاعدة على نفس الجهاز.
- `pnpm build` ثم `pnpm test:e2e`: اختبارات المتصفح بالعروض الثلاثة، مع فحص الوصول axe.
  - تحتاج تنزيل متصفح الاختبار مرة واحدة: `pnpm --filter @souq/tests exec playwright install --only-shell chromium`.
  - تشغّل الموقع بنفسها على المنفذ 3100، فلا تتعارض مع `pnpm dev`.

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

- **Turnstile:** محلياً يُستخدم مفتاح الاختبار العام من Cloudflare، وهو ينجح دائماً.
- **القيم في `.env.local`:** مفاتيح التطوير المحلية الافتراضية من Supabase CLI، لا أسرار.
- **تحذير hydration mismatch في وحدة تحكم المتصفح:** سببه غالباً إضافة متصفح تضيف خصائص للصفحة قبل أن يحمّلها React، مثل `bis_skin_checked` و`bis_register`. ليس خطأ في الكود ولا يحتاج تعديلاً. للتأكد افتح الموقع في نافذة تصفح متخفٍ، فالإضافات معطّلة فيها افتراضياً، ويجب أن يختفي التحذير. إن بقي هناك فهو خطأ حقيقي يُبلَّغ عنه.
- **قياس الاستخدام:** Supabase CLI يرسل بيانات استخدام مجهولة افتراضياً. لإيقافه على جهازك:
  `pnpm --filter @souq/db exec supabase telemetry disable`
