# ترقية Supabase: ما يُفحص بعدها

يُتبع عند كل ترقية لـ Supabase CLI (الإصدار في الـ catalog في `pnpm-workspace.yaml`)، وعند كل ترقية للمشروع المستضاف أو لإصدار Auth فيه (من مرحلة التكلفة 1). شرط المالك عند اعتماد DEC79 (المهمة 3.6). وأضافت المهمة 3.7 رابط استرجاع الحساب.

## لماذا

بعض قواعد المشروع تعتمد على جداول وسلوك يديرها Supabase، لا هجراتنا:

| ما نعتمد عليه | أين | ماذا يحدث إن تغيّر |
| --- | --- | --- |
| أعمدة `auth.users`: `email` و`email_change` و`email_change_sent_at` و`email_change_token_current` و`email_change_token_new` | المُشغّل `app.guard_email_change()` والدالة `app.confirm_email_change_link()` (DEC79، `20261122090000_credentials.sql`) | إن تغيّر اسم عمود أو معناه، قد يرفض المُشغّل كل تغيير بريد، أو لا يجد الدالة الرابط، أو، أخطر، يكمل Supabase التغيير برابط واحد |
| رابط العنوان القديم يحمل `email_change_token_current`، ورابط الجديد `email_change_token_new` | نفس الدالة، والعمود `address` في التدقيق | يُسجَّل التأكيد للعنوان الخطأ في التدقيق |
| مع التأكيد المعطّل (DEC63) يكمل Supabase التغيير برابط واحد، ويرجع جلسة | API021 في `apps/web/lib/account/email-change.ts` | إن صار Supabase يطلب التأكيدين بنفسه في هذا الوضع، يرجع أول استدعاء بلا جلسة، والكود يرسل الرابط الآخر بعده |
| اكتمال تغيير البريد لا يلغي الجلسات | API021 يلغيها بنفسه (BR23) | لا ضرر إن صار Supabase يلغيها |
| `amr` في الرمز: `password` مع توقيت الدخول، ولا تحديث له في نفس الجلسة | إعادة التحقق (DEC38، `lib/auth/guards.ts` و`lib/auth/reauth.ts`) والجلسة المحدودة (DEC73) | تتغير نافذة الخمس دقائق أو تصنيف الجلسة |
| `secure_password_change`: جلسة عمرها أقل من 24 ساعة تغيّر كلمة المرور بلا رمز بالبريد | API022 يغيّرها على جلسة جديدة عمرها ثوانٍ | إن قصرت المدة أو صار الرمز إلزامياً، يفشل تغيير كلمة المرور |
| تغيير كلمة المرور يلغي الجلسات الأخرى ويبقي الحالية | API022 (TC27) | تبقى جلسات قديمة حية |
| الدخول بكلمة المرور يحتاج Turnstile، ويُتخطى بمفتاح `service_role` | API009 وAPI022 (`captcha_token`) | — |
| أسماء الإعدادات في `config.toml`: `double_confirm_changes` و`secure_password_change` و`[auth.email.notification.*]` و`[auth.email.template.magic_link]` | `packages/db/supabase/config.toml` و`tests/unit/supabase-config.test.ts` | إعداد يُتجاهل بصمت بعد الترقية |
| رابط الدخول بالبريد (`signInWithOtp` بـ `shouldCreateUser: false`) يُرسل بقالب `magic_link`، ولعنوان بلا حساب يرجع `otp_disabled` بلا إنشاء حساب | API027 في `apps/web/lib/account/deletion.ts` (المهمة 3.7) | تصل رسالة إنجليزية، أو يُنشأ حساب بلا كلمة مرور، أو يتغير الرد العام |
| رابط الدخول ورابط استعادة كلمة المرور في خانة واحدة (`recovery_token`): كل منهما يُقبل بنوع الآخر، والأحدث يبطل الأقدم، والستون ثانية مشتركة | API027 وAPI028 (`plan/task-3.7.md`) | إن فُصلت الخانتان فلا ضرر، والاختبار الذي يثبّتها يفشل فيُحدَّث. وإن صار رابط الدخول يفتح جلسة بكلمة المرور في `amr`، يرفضه API028 (`INTERNAL_ERROR`) |
| جلسة رابط الدخول `amr` فيها `otp` فقط | `app.recover_account_deletion()` لا تقبل إلا الجلسة المحدودة (DEC73) | يفشل الاسترجاع كله |

## الخطوات

1. **الترقية محلياً،** ثم المجموعة كاملة: `pnpm db:stop`، و`pnpm db:start`، و`pnpm check:supabase-images --write`، ثم `pnpm db:reset` و`pnpm env:local`.
2. **الأعمدة:** في Studio أو `psql`:

   ```sql
   select column_name, data_type from information_schema.columns
    where table_schema = 'auth' and table_name = 'users'
      and column_name in ('email', 'email_change', 'email_change_sent_at',
                          'email_change_token_current', 'email_change_token_new')
    order by 1;
   ```

   خمسة صفوف. نقص أي منها: أوقف الترقية، وافتح سؤالاً للمالك.
3. **المُشغّل ما زال مركّباً وبشرطه:**

   ```sql
   select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'auth.users'::regclass and tgname = 'guard_email_change';
   ```

   فيه `BEFORE UPDATE OF email` و`WHEN (... IS DISTINCT FROM ...)`.
4. **الاختبارات:** `pnpm test:integration`، وخاصة:
   - `email-change.test.ts`: الاختبار الدائم «TC74 Confirm only one address...» يرسل رابطاً واحداً إلى `/auth/v1/verify` في Supabase مباشرة، ويتوقع أن يبقى البريد. وتغيير البريد بالرابطين، وإلغاء الجلسات، وإشعار العنوان القديم. واختبارا شرط المالك الأول: المُشغّل لا يمس الدخول والتسجيل وتغيير كلمة المرور وتحديث الجلسة.
   - `reauth.test.ts` و`password-change.test.ts` و`reset.test.ts` و`auth-guards.test.ts`.
   - `deletion.test.ts` (المهمة 3.7): «Supabase: a deletion recovery link and a recovery link share one slot» يثبّت سلوك الخانة المشتركة، والرابط الحقيقي من Mailpit يسترجع الحساب، والرد العام في API027.
   - `supabase-local.test.ts` و`tests/unit/supabase-config.test.ts`.
5. **E2E:** `pnpm db:e2e`، ثم `pnpm build` و`pnpm test:e2e`، ومنها `security.spec.ts` و`deletion.spec.ts`، ثم `pnpm db:restart`.
   - **فحص Turnstile عند التشغيل (DEC82):** يعتمد على رمزي خطأ من Supabase Auth: `captcha_failed` لطلب دخول بلا رمز والتحقق مفعّل، و`invalid_credentials` لحساب غير موجود والتحقق معطل. يثبتهما `supabase-local.test.ts` (التحقق مفعّل) و`tests/e2e/global-setup.ts` (معطل). إن تغيّر أحدهما يرفض الموقع والعامل التشغيل (`check: unknown`)، فيُحدَّث `classifyCaptchaProbe` في `packages/domain/src/auth-captcha.ts` بقرار.
6. **المشروع المستضاف (من مرحلة التكلفة 1):** نفس الخطوتين 2 و3 على قاعدته، ثم المراجعة اليدوية في القسم «مراجعة إعادة التحقق وتغيير البريد وكلمة المرور (المهمة 3.6)» في `local-dev.md` على staging.

إن فشل أي فحص: لا تُدمج الترقية. سجّل ما تغيّر في Supabase في ملف المهمة، واعرضه على المالك قبل أي تعديل في المُشغّل أو الكود.
