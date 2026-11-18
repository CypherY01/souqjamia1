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

## الاختبارات

- `pnpm test`: اختبارات الوحدة، بلا أي خدمة.
- `pnpm test:integration`: يحتاج `pnpm db:start`. يختبر إعدادات Auth على Supabase المحلي.

## الإيقاف

1. `Ctrl+C` في نافذة `pnpm dev`.
2. `pnpm db:stop`. البيانات المحلية تبقى للتشغيل القادم.
3. `pnpm db:reset` يمسح القاعدة المحلية ويعيدها من الهجرات. الهجرات تبدأ في المهمة 2.1.

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
