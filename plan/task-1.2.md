# المهمة 1.2 — هيكل المستودع

الحالة: **معتمدة في 18 نوفمبر 2026، وقيد التنفيذ.** اعتمد المالك Node 26 LTS وسياسة الإصدارات كما هي.

التاريخ: 18 نوفمبر 2026. الإصدارات أدناه فُحصت في سجل npm وموقع Node.js بنفس التاريخ.

## الهدف

مستودع واحد بحزم pnpm، يُثبَّت ويُفحص ويُبنى من نسخة نظيفة بأمر واحد لكل خطوة. لا منطق تجاري في هذه المهمة. فقط الهيكل والأدوات التي تبني عليها كل المهام التالية.

## المعرّفات

- **DEC35:** Next.js وعامل خلفي، وكلاهما على Railway.
- **DEC48:** مجلد `ops/`.
- **DEC30:** `lang="ar"` و`dir="rtl"` من أول صفحة. الهيكل الكامل في 1.5.
- **NFR17 وOPS05، جزئياً:** إصدارات مثبتة بالضبط، وملف قفل، وفحص الأنواع. باقيها في 1.3 و8.3.

## سياسة الإصدارات (تحتاج اعتماد)

1. كل اعتمادية تُثبَّت بإصدار محدد، بلا `^` ولا `~`، ويُرفع ملف القفل `pnpm-lock.yaml` مع الكود.
2. يُختار أحدث إصدار مستقر مضى على نشره 14 يوماً على الأقل.
   - الإصدار الأمني يُؤخذ فوراً.
   - إعداد `minimumReleaseAge` في pnpm يفرض هذه المهلة على الاعتماديات غير المباشرة أيضاً.
3. سكربتات التثبيت ممنوعة إلا لحزم في قائمة سماح مكتوبة في `pnpm-workspace.yaml`.
4. أي رفع لإصدار يكون في commit مستقل يذكر السبب.

## الإصدارات المقترحة

| الأداة | الإصدار | ملاحظة |
| --- | --- | --- |
| Node.js | 26.13.1 LTS | إصدار أمني بتاريخ 10 نوفمبر. الجهاز الحالي عليه 24.11.0، وهو أقدم من آخر إصلاح أمني لسلسلة 24 |
| pnpm | 12.17.0 | غير مثبت على الجهاز |
| TypeScript | 6.0.3 | الإصدار 7.0 لا يدعمه typescript-eslint بعد، فهو يقبل أقل من 6.1 |
| Next.js وeslint-config-next | 16.4.5 | |
| React وReact DOM | 19.3.1 | و`@types/react` 19.3.0 |
| `@types/node` | 26.6.6 | يطابق Node 26 |
| ESLint | 10.14.0 | إن لم تدعمه إضافات eslint-config-next يُستخدم آخر 9.x، ويُذكر ذلك |
| typescript-eslint | 8.72.1 | |
| Prettier | 3.9.10 | |
| Vitest | 5.1.0 | |
| tsx | 4.23.15 | لتشغيل العامل أثناء التطوير |
| `@redocly/cli` | 2.73.0 | العقد فُحص بـ 2.72.1، ويُعاد فحصه بهذا الإصدار |

**مؤجلة لمهامها:**
- Playwright 1.64.1 مع 1.5.
- zod 4.6.7 مع 1.6.
- Supabase CLI مع 1.4. الإصدار 3.0.0 رئيسي جديد صدر في 2 نوفمبر، والاختيار بينه وبين 2.122.1 يُعرض في 1.4.
- pg 8.23.1 مع 2.1.
- `@supabase/supabase-js` 2.118.0 و`@supabase/ssr` 0.12.7 مع 3.1.

## الملفات

```
package.json              سكربتات الجذر، و packageManager، و engines
pnpm-workspace.yaml       الحزم، و minimumReleaseAge، وقائمة سماح سكربتات التثبيت
.nvmrc                    26.13.1
tsconfig.base.json        strict و noUncheckedIndexedAccess و verbatimModuleSyntax
eslint.config.mjs         typescript-eslint مع فحص الأنواع، وقواعد Next لـ apps/web
.prettierrc.json .prettierignore .editorconfig
.gitattributes            نهايات أسطر LF، لأن التطوير على Windows
.gitignore                node_modules و .next و coverage و .env* ما عدا .env.example
.env.example              أسماء المتغيرات المعروفة الآن بلا قيم، ويكتمل في 1.4
apps/web/                 Next.js App Router
  package.json  next.config.ts  tsconfig.json
  app/layout.tsx          <html lang="ar" dir="rtl"> فقط، والهيكل الكامل في 1.5
  app/page.tsx            اسم الموقع من مفتاح ترجمة، بلا نص ثابت
apps/worker/
  package.json  tsconfig.json  src/main.ts   يبدأ ويسجل سطر بدء منظماً، والحلقة في 2.5
packages/domain/          package.json  tsconfig.json  src/index.ts
packages/db/              package.json  README.md   الهجرات تبدأ في 1.4 و2.1
packages/i18n/            package.json  src/index.ts  src/ar/common.json
tests/
  package.json  vitest.config.ts   مشروعا unit و integration
  unit/workspace.test.ts  يتأكد أن حزم المستودع تُستورد من بعضها
  integration/  e2e/      فارغان حتى 2.1 و1.5
ops/README.md             ما يوضع هنا من أدلة وسكربتات (DEC48)
```

أسماء الحزم: `@souq/web` و`@souq/worker` و`@souq/domain` و`@souq/db` و`@souq/i18n` و`@souq/tests`.

**تعديلات على ملفات موجودة:**
- `CLAUDE.md`: يُعبّأ قسم Commands.
- `contracts/README.md`: أمر الفحص يصير `pnpm contract:lint`.

## الأوامر

| الأمر | ما يفعله |
| --- | --- |
| `pnpm install` | تثبيت كل الحزم من ملف القفل |
| `pnpm dev` | تشغيل الموقع محلياً |
| `pnpm dev:worker` | تشغيل العامل محلياً |
| `pnpm lint` | ESLint على كل المستودع |
| `pnpm typecheck` | `tsc --noEmit` لكل حزمة |
| `pnpm test` | اختبارات الوحدة بـ Vitest |
| `pnpm build` | بناء الموقع والعامل |
| `pnpm format` و`pnpm format:check` | Prettier |
| `pnpm contract:lint` | فحص عقد OpenAPI |

أوامر القاعدة (migrate وreset وseed) تُضاف في 1.4.

## خارج هذه المهمة

- **1.3:** CI وفحص تسرّب الأسرار.
- **1.4:** Supabase المحلي، والتحقق من متغيرات البيئة، وبيئة التجربة على Railway.
- **1.5:** نظام الترجمة الكامل، والتصميم، وهيكل RTL، وPlaywright.
- **1.6:** طبقة HTTP وzod.

## الاختبار (تعريف الانتهاء)

1. من نسخة نظيفة: `pnpm install --frozen-lockfile`، ثم `lint` و`typecheck` و`test` و`build` و`contract:lint`. كلها تنجح بلا أخطاء ولا تحذيرات.
2. `pnpm dev` يعرض صفحة فيها `<html lang="ar" dir="rtl">` واسم الموقع من مفتاح الترجمة.
3. العامل يُبنى ويبدأ ويسجل سطر البدء، ويتوقف بنظافة عند إيقافه.
4. كل الإصدارات في كل `package.json` محددة بالضبط، وملف القفل مرفوع.
5. لا قيمة سرية في المستودع، و`.env.example` بلا قيم.

## يحتاج قرار المالك أو عمله قبل البدء

1. **إصدار Node:** 26 LTS (المقترح، ودعمه أطول) أو 24 LTS.
2. **سياسة الإصدارات** أعلاه.
3. **تجهيز الجهاز:** تحديث Node إلى الإصدار المعتمد، وتثبيت pnpm 12.17.0. يمكنني تثبيت pnpm بأمر `npm install -g pnpm@12.17.0` بعد موافقتك، أما Node فيُثبَّت من موقعه الرسمي.
4. **لاحقاً، قبل 1.4:** Docker Desktop غير مثبت، وSupabase المحلي يحتاجه.
