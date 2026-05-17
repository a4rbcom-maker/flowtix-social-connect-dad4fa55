## خطة الإصلاح الفوري

سأعدّل فقط `.github/workflows/deploy.yml` لمعالجة الفشل الظاهر في الصورة.

### المشكلة
`PREV_SNAPSHOT` يشير إلى snapshot موجود، لكن `is_valid_ssr_snapshot` يرفضه لأنه يشترط ملفات شكل النشر الجديد (`scripts/tanstack-node-server.mjs` و/أو `node_modules`). هذا يسبب `no_valid_snapshot` بدل استخدام النسخة التي كانت تعمل قبل النشر.

### التعديل المقترح
1. جعل `PREV_SNAPSHOT` fallback واقعيًا في `integrity_rollback`:
   - يبقى `LAST_GOOD` هو الخيار الأول والأكثر ثقة.
   - إذا فشل، يتم قبول `PREV_SNAPSHOT` بمعايير أوسع ومناسبة للحالة الحالية، مثل وجود `dist/server/server.js` وملفات تشغيل كافية، بدل رفضه بسبب اختلاف شكل bundle القديم.

2. إضافة تشخيص واضح قبل رفض أي snapshot:
   - يطبع الملفات المطلوبة الموجودة/المفقودة داخل snapshot.
   - يطبع `source`, `kind`, وسبب الرفض بدقة.

3. منع استخدام snapshots رقمية عشوائية في `integrity_rollback` كما اتفقنا:
   - المصادر الموثوقة فقط: `LAST_GOOD` ثم `PREV_SNAPSHOT` ثم `good-*`.

4. إصلاح رسالة `Auto rollback on failure` لتقول snapshot بدل `LAST_GOOD` فقط، لأن المصدر قد يكون `PREV_SNAPSHOT`.

5. التحقق بعد التعديل:
   - فحص YAML syntax فقط.
   - عدم تشغيل build أو deployment من هنا.

### النتيجة المتوقعة
عند تشغيل Dry Run مرة أخرى، المفروض يظهر بوضوح هل سيختار:

```text
kind=prev_snapshot
source=/www/wwwroot/flowtixtools-backups/20260517182755-fc672ed
DRY-RUN — skipping rsync
```

ولو رفضه، سيعرض بالضبط أي ملف ناقص بدل رسالة عامة `incompatible snapshot`.