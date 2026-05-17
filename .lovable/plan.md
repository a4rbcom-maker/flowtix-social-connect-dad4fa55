## الهدف
إصلاح فشل GitHub Actions الظاهر في الصورة: `Process completed with exit code 141` داخل خطوة `Install dependencies and restart SSR app`، بحيث لا يقطع خطأ SIGPIPE الطباعة التشخيصية قبل تنفيذ منطق rollback.

## التشخيص المختصر
- `141 = SIGPIPE` غالبًا من pipeline تحت `set -euo pipefail`.
- الملف الحالي أصلح أغلب `head` داخل مقارنة الملفات، لكن ما زال هناك خطر مهم: أمر الـ SSH نفسه موصول إلى `tee`:
  ```bash
  ssh ... 2>&1 <<'EOSSH' | tee /tmp/install-restart.log
  ```
  إذا خرج سكربت السيرفر بسرعة أو أغلق طرف الكتابة أثناء وجود مخرجات كثيرة، قد يرجع كود pipeline كـ `141` بدل كود الخطأ الحقيقي، خصوصًا مع `pipefail`.
- النتيجة: GitHub يظهر `exit code 141` بدل سبب drift/rollback الحقيقي.

## خطة التعديل
1. تعديل خطوة `Install dependencies and restart SSR app` فقط في `.github/workflows/deploy.yml`.
2. إزالة الاعتماد على pipe مباشر بين `ssh` و `tee` في هذه الخطوة.
3. استبداله بنمط آمن:
   - تشغيل `ssh` مع redirect للمخرجات إلى `/tmp/install-restart.log`.
   - حفظ كود خروج `ssh` مباشرة في `SSH_EXIT`.
   - طباعة اللوج بعد انتهاء الأمر باستخدام `cat /tmp/install-restart.log`.
4. حماية `cat`/قراءة اللوج بـ `|| true` حتى لا تصبح هي سبب فشل جديد.
5. الحفاظ على نفس منطق rollback الحالي كما هو:
   - لو ظهر `INTEGRITY_ROLLBACK_RESULT=restored` يسجل `FAILURE_REASON=integrity-restored-last-good`.
   - لو لا يوجد LAST_GOOD يسجل `integrity-no-snapshot`.
   - لا يتم restart لـ PM2 قبل نجاح integrity checks.

## النتيجة المتوقعة
- لن يظهر `exit code 141` بسبب pipe/tee.
- عند وجود اختلاف ملفات فعلي، سيظهر السبب الحقيقي مثل `file-list-drift`.
- سيتم استدعاء rollback إلى `LAST_GOOD` قبل أي PM2 restart كما هو مطلوب.
- ستظل خطوة Auto rollback تتصرف بنفس المنطق الحالي بدون توسيع نطاق التعديل.