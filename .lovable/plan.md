سأعدّل `.github/workflows/deploy.yml` لمعالجة فشل أول نشر بعد إضافة LAST_GOOD بدون تغيير منطق النشر العام.

الخطة:
1. توحيد فحص صلاحية snapshot داخل خطوة `Install dependencies and restart SSR app` عبر helper مثل `is_valid_ssr_snapshot` يتأكد من الملفات المطلوبة، بما فيها `node_modules`.
2. تحديث `integrity_rollback()` ليختار snapshot بالترتيب:
   - `LAST_GOOD`
   - `PREV_SNAPSHOT` عند غياب/عدم صلاحية `LAST_GOOD`
   - أحدث snapshots متوافقة من `good-*` أو snapshots التاريخية كاحتياط أخير
3. تحسين logs عند استخدام `PREV_SNAPSHOT` لتوضيح أن هذا متوقع في أول نشر بعد safety net، بدل رسالة `no_last_good` المضللة.
4. إخراج metadata واضحة من `integrity_rollback`:
   - `INTEGRITY_ROLLBACK_RESULT=restored`
   - `INTEGRITY_ROLLBACK_KIND=last_good|prev_snapshot|latest_good|latest_snapshot`
   - `INTEGRITY_ROLLBACK_SRC=...`
5. تحديث معالجة نتيجة SSH في workflow بحيث رسالة GitHub تقول إن snapshot تم استرجاعه، وليس بالضرورة `LAST_GOOD` فقط، مع إبقاء `FAILURE_REASON=integrity-restored-last-good` حتى يستمر تخطي Auto rollback وعدم تشغيل PM2.
6. التحقق من صحة YAML بعد التعديل فقط، بدون تشغيل build أو تغيير ملفات أخرى.

النتيجة المتوقعة:
- عند `file-list-drift` أو checksum/manifest failure، سيتم استرجاع `LAST_GOOD` إن وجد.
- في أول نشر لا يوجد فيه `LAST_GOOD`، سيتم استرجاع `PREV_SNAPSHOT` تلقائياً.
- PM2 سيبقى محجوباً ولن يبدأ إلا بعد نجاح integrity checks؛ وعند rollback الداخلي سيبقى process القديم حيّاً كما هو.