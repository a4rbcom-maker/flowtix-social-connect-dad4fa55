# تقوية Auto-Rollback عند فشل الـ Deploy

## الوضع الحالي

النظام يملك بالفعل rollback متعدد الطبقات:

- **داخل السيرفر** (`scripts/ci/install-restart.sh`): دالة `integrity_rollback` تشتغل تلقائياً عند فشل checksum، أو نقص ملفات، أو عدم ربط البورت، أو فشل health بعد reload. تختار بالترتيب: `LAST_GOOD` → `PREV_SNAPSHOT` → أحدث `good-*`.
- **في الـ workflow** (الخطوة 12): فقط تستعيد `PREV_SNAPSHOT`، وتتجاهل الباقي، ولا تتحقق من صحة الموقع بعد الاستعادة.
- **تسجيل LAST_GOOD**: `publish_good_snapshot` يُنشئ snapshot موثوق بعد كل deploy ناجح.

## الثغرات التي تحتاج إصلاح

1. **خطوة Rollback في الـ workflow ضعيفة**: لو فشل الـ SSH أو الـ rsync نفسه (قبل تشغيل install-restart.sh)، تنفذ خطوة 12 لكنها تستعيد `PREV_SNAPSHOT` فقط. إذا كان فاسداً أو مفقوداً، تستسلم وتترك الموقع مكسوراً.
2. **لا يوجد health check بعد الاستعادة في الـ workflow**: قد تُطبَّق الاستعادة لكن الموقع يظل 500 ولا أحد يعلم — الـ workflow يعرض ✅ على خطوة الـ rollback لأنها مكتوبة بـ `|| true`.
3. **مؤشر SHA الفاشل لا يُمسح بشكل صريح**: يُكتب فقط عند النجاح، لكن إن وُجد marker قديم لنفس الـ SHA من محاولة فاشلة سابقة، قد يُتخطّى الـ deploy التالي عن طريق الخطأ.
4. **لا توجد رسالة واضحة في الـ workflow log** عند نجاح/فشل الـ rollback مع رابط الموقع الحالي.

## الحل المقترح

### 1) ترقية خطوة "Rollback on failure" في `.github/workflows/deploy.yml`

استبدال الخطوة 12 الحالية بمنطق:

- **اختيار snapshot بالترتيب**: `LAST_GOOD` → `PREV_SNAPSHOT` → أحدث `good-*` → أحدث `[0-9]*`.
- **التحقق من صلاحية الـ snapshot** قبل النسخ (وجود `dist/server/`, `ecosystem.config.cjs`, `node_modules`).
- **rsync + pm2 reload + pm2 save** بنفس النمط الحالي.
- **Health check محلي** (`curl http://127.0.0.1:$APP_PORT/`) لمدة 30 ثانية بعد الاستعادة.
- **Public URL health check** (`curl https://flowtixtools.com/api/public/health`) للتأكد أن CDN/Nginx تخدم النسخة المستعادة.
- **مسح `.deploy/last-sha`** للتأكد أن نفس الـ SHA الفاشل لن يُتخطّى لاحقاً.
- **إخراج markdown summary** في `$GITHUB_STEP_SUMMARY` يوضح: السبب، الـ snapshot المُستعاد، نتيجة الـ health check.

### 2) خطوة جديدة "Verify rollback health"

تُضاف بعد خطوة الـ rollback مباشرة، تعمل فقط لو نُفّذ rollback. ترفع failure حقيقية إذا الموقع ظل 500 بعد الاستعادة (بدل الـ silent `|| true`).

### 3) (اختياري — لا يحتاج تعديل) منطق `install-restart.sh` الحالي

يبقى كما هو — هو الطبقة الأولى للحماية ويعمل بشكل ممتاز. التعديل فقط على طبقة الـ workflow التي تغطي حالات لا يصلها السكربت أصلاً (فشل rsync، فشل SSH، فشل بناء، إلخ).

## ملخص الملفات

| ملف | تغيير |
|---|---|
| `.github/workflows/deploy.yml` | استبدال خطوة "Rollback on failure" + إضافة "Verify rollback health" |
| `scripts/ci/install-restart.sh` | بدون تعديل |
| `docs/deployment-runbook.md` | تحديث قسم Rollback ليعكس السلوك الجديد |

## النتيجة المتوقعة

- أي فشل في الـ deploy (في أي خطوة) → استعادة تلقائية لأحدث نسخة موثوقة → health check → الموقع يعمل خلال دقائق دون تدخل يدوي.
- لو فشلت الاستعادة نفسها (سيناريو نادر جداً)، الـ workflow يرفع failure واضح مع تفاصيل في الـ summary بدل الإخفاء الصامت.
- لا حاجة لأي تدخل من المستخدم على السيرفر مرة أخرى للحالات العادية.

هل أبدأ التنفيذ؟
