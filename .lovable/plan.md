## هدف الخطة

لو فشل نشر commit جديد (لم يصل للدومين أو ملفات ناقصة)، يرجّع الـ workflow آخر إصدار شغّال تلقائيًا، بدون أي تدخل يدوي.

## آلية العمل

1. **نسخ احتياطي قبل rsync**
   - قبل ما الـ workflow يكتب فوق ملفات الموقع، يعمل snapshot للمسار الحالي:
     ```
     /www/backups/flowtixtools/<timestamp>-<short_sha_السابق>/
     ```
   - يحتفظ بآخر 5 نسخ فقط ويحذف الأقدم تلقائيًا.

2. **تسجيل آخر إصدار ناجح**
   - بعد نجاح التحقق العام (`deploy-version.json` يظهر على الدومين)، يحدّث ملف:
     ```
     /www/backups/flowtixtools/LAST_GOOD
     ```
     يحتوي اسم آخر مجلد snapshot ناجح.

3. **خطوة Rollback تلقائية عند الفشل**
   - تستخدم `if: failure()` في GitHub Actions.
   - تقرأ `LAST_GOOD` عبر SSH، تعمل rsync من مجلد الـ snapshot إلى مسار الموقع.
   - تتحقق بعدها أن `deploy-version.json` على الدومين يحمل short_sha النسخة الراجعة.
   - تطبع في لوج الـ Action: "Rolled back to commit X".

4. **حماية النسخة الأولى**
   - لو لا يوجد `LAST_GOOD` (أول مرة)، الـ rollback يطبع رسالة واضحة ولا يفشل الـ Action مرة ثانية، فقط يخرج بـ warning.

5. **حماية المسار**
   - نفس فحص `case ... /www/wwwroot/*flowtix*` يُطبّق على مسار الـ rollback لمنع أي كتابة خارج الموقع.

## الملفات المتأثرة

- `.github/workflows/deploy.yml` فقط — إضافة:
  - خطوة "Snapshot current site" قبل rsync.
  - خطوة "Record LAST_GOOD" بعد التحقق العام.
  - خطوة "Auto rollback on failure" بـ `if: failure()` في نهاية الـ job.

## النتيجة المتوقعة

- أي نشر فاشل يرجع الموقع تلقائيًا لآخر نسخة شغالة خلال ثوانٍ.
- الموقع لن يبقى مكسور أبدًا بعد deploy فاشل.
- سجل واضح في GitHub Actions يوضح أي commit تم استعادته.