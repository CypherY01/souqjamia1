# المهمة 1.3 — CI وفحص تسرّب الأسرار

الحالة: **منفذة في 18 نوفمبر 2026، بانتظار نتيجة CI على GitHub واعتماد المالك للدمج.** اعتمد المالك الخطة، ونقل القائمة إلى `x-phase1-excluded`، وفعّل Push protection. النتائج في قسم «التنفيذ» آخر الملف.

التاريخ: 18 نوفمبر 2026. الإصدارات أدناه فُحصت في GitHub وDocker Hub بنفس التاريخ، وكلها مضى على نشرها 14 يوماً على الأقل.

الفرع: `phase1/task-1.3-ci-secrets`، من `main` بعد دمج 1.1 و1.2.

## الهدف

كل push إلى GitHub يشغّل نفس الفحوص المحلية، ومعها فحصان للأسرار:
- في الكود وكل تاريخ git.
- في ما يصل للمتصفح من ناتج البناء.

## المعرّفات

- **SEC06:** «افحص الكود والبناء والمتصفح والسجلات بحثاً عن تسرّب الأسرار». هذه المهمة تغطي الكود والبناء. المتصفح في TC56 (المهمة 3.3)، والسجلات في 1.6.
- **OPS05، جزئياً:** فحص الأنواع والاختبارات في كل تغيير. اختبارات التكامل والتفويض تُضاف إلى CI مع 2.1، وهجرات بيئة التجربة مع 1.4.
- **NFR17، جزئياً:** تثبيت مجمّد من ملف القفل، وإصدارات مثبتة.
- **قاعدة في CLAUDE.md:** مفتاح `service_role` لا يصل لكود المتصفح أبداً.
- **contracts/README.md:** فحص تغطية المعرّفات في CI، بحيث تظهر كل عملية من الـ98 مرة واحدة.

## مسار CI

ملف واحد: `.github/workflows/ci.yml`.

- **متى يعمل:** عند push لأي فرع، وعند pull request نحو `main`.
- **الصلاحيات:** `contents: read` فقط.
- **التكرار:** التشغيل الأحدث لنفس الفرع يلغي الأقدم.
- **الخصوصية:** `NEXT_TELEMETRY_DISABLED=1`.
- **التثبيت:** كل Action مثبتة بـ commit SHA، لأن الوسم (tag) يمكن نقله. كل صورة Docker مثبتة بالـ digest.

**مهمة `checks`:**
1. checkout.
2. pnpm من حقل `packageManager`.
3. Node من `.nvmrc`، مع ذاكرة مؤقتة لـ pnpm.
4. `pnpm install --frozen-lockfile`.
5. actionlint على ملف CI نفسه.
6. `lint`، ثم `typecheck`، ثم `test`، ثم `format:check`.
7. `contract:lint`، ثم `check:contract-ids`.
8. `build`، ثم `check:bundle`.

**مهمة `secrets`:**
1. checkout بكل التاريخ.
2. gitleaks على كل الـ commits. يفشل عند أي تسريب، ويخفي القيمة في السجل (`--redact`).

## فحص البناء: `check:bundle`

السكربت `scripts/check-client-bundle.ts` يقرأ كل ما يصل للمتصفح بعد `next build`:
- ملفات `apps/web/.next/static/**`، أي JS وCSS.
- الصفحات المولّدة مسبقاً في `apps/web/.next/server/app/`: ملفات `.html` و`.rsc` ومجلدات `.segments`.

ويفشل إذا وجد واحداً من هذه:
1. النص `service_role`.
2. بادئة المفتاح السري الجديد في Supabase: `sb_secret_`.
3. رمز JWT دوره `service_role` بعد فك جزئه الأوسط. هذا شكل مفتاح الخدمة القديم في Supabase.
4. رابط اتصال Postgres، يبدأ بـ `postgres://` أو `postgresql://`.
5. اسم أي متغير في `.env.example` لا يبدأ بـ `NEXT_PUBLIC_`. القائمة فارغة الآن، وتمتلئ من المهمة 1.4.

السكربت يطبع الملف ونوع المشكلة فقط، ولا يطبع القيمة نفسها.

## فحص تغطية العقد: `check:contract-ids`

السكربت `scripts/check-contract-ids.ts`:
- يجمّع العقد إلى JSON مؤقت عبر `redocly bundle`، فلا يحتاج اعتمادية جديدة لقراءة YAML.
- يتحقق من أربعة شروط:
  1. كل `operationId` يبدأ بـ `apiNNN`.
  2. أول قيمة في `x-spec-ids` هي نفس الرقم.
  3. لا رقم مكرر.
  4. المجموعة تساوي API001 إلى API118، ناقص العمليات العشرين المستبعدة.
- **قائمة المستبعدة** تنتقل إلى امتداد `x-phase1-excluded` في `contracts/openapi.yaml`، لكل عملية رقمها وسببها. السكربت يقرأ القائمة من هناك، والجدول في README يشير إليها. هذا يحتاج اعتمادك.

## الفحص المحلي للأسرار: `secrets:scan`

السكربت `scripts/secrets-scan.ts` يشغّل نفس صورة gitleaks عبر Docker على المستودع المحلي. كتبته بـ TypeScript لا كأمر shell، حتى يعمل مسار المجلد على Windows وLinux معاً.

**الحالة الآن:** شغّلته مرة على كل التاريخ (14 commit): لا تسريب.

## الإصدارات

| الأداة | الإصدار | التثبيت |
| --- | --- | --- |
| `actions/checkout` | v7.0.1 (20 يوليو) | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | v7.1.0 (8 أكتوبر) | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| `pnpm/action-setup` | v6.1.1 (3 نوفمبر، قبل 15 يوماً) | `73e46992e05b19abd31f2f3c20e0e7370d762115` |
| gitleaks | v8.30.1 (21 مارس) | `zricethezav/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f` |
| actionlint | 1.7.12 (30 مارس) | `rhysd/actionlint@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667` |

gitleaks عبر Docker لا عبر `gitleaks-action`، لأن الأخيرة تطلب ترخيصاً لمستودعات المنظمات.

## الملفات

```
.github/workflows/ci.yml
.gitleaks.toml                     يمدّد القواعد الافتراضية، بلا استثناءات الآن
scripts/package.json               @souq/scripts، حزمة جديدة في المستودع
scripts/tsconfig.json
scripts/check-client-bundle.ts
scripts/check-contract-ids.ts
scripts/secrets-scan.ts
tests/unit/check-client-bundle.test.ts
tests/unit/check-contract-ids.test.ts
```

**تعديلات على ملفات موجودة:**
- `pnpm-workspace.yaml`: إضافة `scripts` إلى الحزم.
- `package.json`: الأوامر `check:bundle` و`check:contract-ids` و`secrets:scan`.
- `contracts/openapi.yaml`: الامتداد `x-phase1-excluded`.
- `contracts/README.md`: الإشارة إلى الامتداد.
- `CLAUDE.md`: الأوامر الجديدة.

**اختبارات الوحدة تبني النصوص التجريبية وقت التشغيل،** مثل `"sb_" + "secret_" + ...`. لا يُكتب في المستودع أي نص يشبه سراً، حتى لا يجده gitleaks.

## خارج هذه المهمة

- **1.4:** هجرات بيئة التجربة، والتحقق من متغيرات البيئة.
- **1.5:** Playwright في CI.
- **1.6:** حجب الأسرار في السجلات.
- **2.1:** اختبارات التكامل مع Supabase في CI.
- **3.3:** فحص المتصفح (TC56).
- **8.3:** البناء في حاوية، وترقية نفس النسخة من التجربة للإنتاج (NFR17، OPS05).

## الاختبار (تعريف الانتهاء)

1. كل الأوامر تنجح محلياً، ومنها الثلاثة الجديدة.
2. اختبارات الوحدة للسكربتين تنجح، وتشمل حالة فشل لكل نوع من الأنواع الخمسة، ولكل شرط في فحص العقد.
3. **اختبار سلبي يدوي:** إضافة `service_role` مؤقتاً لمكوّن يُرسل للمتصفح، ثم البناء. `check:bundle` يجب أن يفشل. ثم يُحذف المكوّن.
4. actionlint على ملف CI بلا أخطاء.
5. gitleaks على كل التاريخ بلا تسريب.
6. **CI على GitHub:** لا أستطيع تشغيله لأني لا أرفع. بعد أن ترفع الفرع من GitHub Desktop، يظهر التشغيل في تبويب Actions، ويجب أن يكون أخضر قبل الاعتماد والدمج.

## يحتاج قرارك

1. **`x-phase1-excluded`:** نقل قائمة العمليات المستبعدة إلى امتداد في العقد، بدل الجدول اليدوي في README وحده.
2. **ترتيب الاعتماد مع CI:** ترفع فرع المهمة أولاً، فيعمل CI. تعتمد بعد أن يصير أخضر، ثم أدمج في `main`، ثم ترفع `main`.
3. **اختياري، من إعدادات GitHub وبيدك:** تفعيل «Push protection» لفحص الأسرار، إن كانت متاحة لنوع المستودع. هذه تمنع الرفع قبل وصول السر إلى GitHub، أما فحص CI فيكتشفه بعد الرفع.

## التنفيذ (18 نوفمبر 2026)

### قرارات المالك عند الاعتماد

1. نُقلت قائمة العمليات المستبعدة إلى `x-phase1-excluded` في `contracts/openapi.yaml`، وفحص التغطية يقرأها منه. جدول README صار إشارة إليها.
2. **طريقة العمل الجديدة:** أرفع فرع كل مهمة بنفسي فيعمل CI. يعتمد المالك بعد أن يصير CI أخضر، وبعد اعتماده الصريح أدمج في `main` وأرفعه.
3. فعّل المالك Push protection في GitHub.

### اختلافات عن الخطة

- **مهمة `secrets` في CI** تشغّل `node scripts/secrets-scan.ts` نفسه، فصورة gitleaks مثبتة في مكان واحد للفحص المحلي وCI معاً.

### نتائج الفحص المحلي

1. الأوامر كلها نجحت: `lint` و`typecheck` و`test` (20 اختباراً في 3 ملفات) و`format:check` و`contract:lint` و`check:contract-ids` و`build` و`check:bundle` و`secrets:scan`.
2. actionlint 1.7.12 على `ci.yml`: بلا أخطاء.
3. `check:contract-ids`: 98 عملية و20 مستبعدة تغطي API001 إلى API118، كل رقم مرة واحدة.
4. `check:bundle`: 26 ملفاً يصل للمتصفح، بلا أسرار.
5. `secrets:scan`: 15 commit، بلا تسريب.

### اختبارات سلبية (تأكدت أن كل فحص يفشل فعلاً)

1. **البناء:** مكوّن عميل مؤقت فيه `service_role`. `check:bundle` فشل بالرمز 1، ووجده في `static/chunks` وفي `server/app/index.html`. حُذف المكوّن، فعاد البناء نظيفاً.
2. **العقد:** حذف API104 مؤقتاً من القائمة. `check:contract-ids` فشل بالرمز 1 وسمّى الرقم الناقص. ثم أُعيد الملف.
3. **gitleaks:** مفتاح AWS مزيف في مجلد مؤقت خارج المستودع، فوجده gitleaks («leaks found: 1»). ثم حُذف المجلد.

### بانتظار

- نتيجة CI على GitHub بعد رفع الفرع.
