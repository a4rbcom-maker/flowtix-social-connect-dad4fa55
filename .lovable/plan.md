## الهدف
إيقاف سلسلة مشاكل المزامنة والنشر، وتحويلها من محاولات عشوائية إلى مسار نشر واحد واضح: إما نشر Static مضمون، أو نشر SSR/PM2 صحيح، مع تحقق نهائي أن الموقع العام يعرض نفس نسخة GitHub.

## التشخيص الحالي
من آخر صورة، النشر لم يعد يفشل بسبب المسار فقط. الخطأ الآن واضح:

```text
No server entry found under .output or dist/server
ERROR: index.html missing in /www/wwwroot/flowtixtools.com
```

هذا يعني أن الـ workflow يرفع `dist/client`، لكن لا يوجد `index.html` في جذر الموقع، وفي نفس الوقت لا يوجد server entry لتشغيله عبر PM2. إذن المشكلة الأساسية أن workflow الحالي يمزج بين 3 طرق نشر مختلفة:

1. Static files من `dist/client`
2. Server runtime من `.output` أو `dist/server`
3. تعديل Nginx وتشغيل PM2

وهذا سبب عدم الاستقرار خلال الأيام الماضية.

## الخطة المقترحة

### 1. تثبيت وضع النشر بدل الخلط
سأحوّل النشر إلى وضع واحد واضح بناءً على مخرجات البناء الفعلية:

- إذا خرج `dist/client/index.html`: ننشر Static.
- إذا خرج `dist/client/_shell/index.html`: ننسخه كـ `index.html` ثم ننشر Static.
- إذا خرج `.output/server/index.mjs` أو `dist/server/index.mjs`: نشغل PM2 ونضبط Nginx proxy.
- إذا لم يخرج أي من ذلك: يفشل الـ Action برسالة تشخيص واضحة قبل لمس السيرفر.

### 2. وقف تعديل Nginx العنيف في كل Deploy
بدل ما الـ workflow يعدل ملف Nginx كل مرة، سيتم جعله يتصرف بحذر:

- يقرأ مسار `root` الحالي للدومين.
- يطبع المسار في اللوج.
- لا يغير Nginx إلا إذا كان محتاج فعلاً.
- يحتفظ بنسخة backup قبل أي تعديل.
- لا يلمس أي دومين أو مشروع آخر.

### 3. إصلاح حالة Static الحالية
بما أن آخر build ظاهر أنه يحتوي `dist/client/sitemap.xml` و `robots.txt` و assets لكن لا يحتوي `index.html` في الجذر، سأضيف fallback واضح:

```text
if dist/client/index.html exists -> deploy it
else if dist/client/_shell/index.html exists -> copy it to index.html
else fail before rsync
```

وبكده لن يصل السيرفر لحالة “ملفات assets موجودة لكن الصفحة الرئيسية مفقودة”.

### 4. إضافة ملف تحقق عام بعد النشر
سأضيف ملف نسخة مثل:

```text
/deploy-version.json
```

يحتوي:

```json
{
  "sha": "GitHub commit",
  "run_id": "GitHub Actions run",
  "deployed_at": "timestamp",
  "deploy_path": "actual nginx root"
}
```

ثم الـ Action يعمل `curl` عليه من الموقع العام للتأكد أن التحديث وصل فعلاً إلى نفس الدومين، وليس إلى مسار آخر.

### 5. تحقق نهائي من الموقع العام
بعد النشر، الـ workflow سيتحقق من:

- `https://www.flowtixtools.com/` يرجع 200.
- الصفحة تحتوي HTML حقيقي وليس error page.
- `/assets/...` متاح.
- `/deploy-version.json` يعرض نفس commit الحالي.

لو أي نقطة فشلت، اللوج سيقول السبب بوضوح.

## النتيجة المتوقعة
بعد تنفيذ الخطة، سيكون عندك إجابة مؤكدة من الـ Action:

- أين تم النشر بالضبط.
- هل Nginx يخدم نفس المسار أم لا.
- هل `index.html` موجود أم لا.
- هل الموقع العام يعرض آخر commit أم نسخة قديمة.

## ملاحظة مهمة
لو التطبيق يحتاج server functions أو SSR بشكل كامل، الحل الأفضل بعد استعادة الموقع هو تحويل النشر إلى SSR/PM2 مضبوط. لكن كخطوة إنقاذ الآن، سنجعل Static deploy يعمل أولاً حتى يرجع الموقع، ثم نثبت SSR لو احتجناه.