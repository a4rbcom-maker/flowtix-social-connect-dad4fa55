المشكلة ليست في “ملف الاتصال” نفسه. المشكلة الأساسية مركبة من نقطتين:

1. إصدارات TanStack غير متطابقة
- `@tanstack/react-start` عند `1.168.6`
- `@tanstack/router-plugin` عند `1.168.6`
- `@tanstack/react-router` عند `1.170.4`
- ويوجد override لـ `@tanstack/router-core` إلى `1.171.2`

هذا الخلط يكسر TypeScript module augmentation التي تضيف خاصية `server` إلى `createFileRoute`. لذلك TypeScript يرى route عادي من `@tanstack/react-router` ولا يرى دعم server routes، فيظهر الخطأ:
`'server' does not exist in type ... FilebaseRouteOptionsInterface`

2. خط النشر نفسه صار حساس جداً لأي فشل
الصورة توضّح أن الفشل يحدث في خطوة:
`Install dependencies and restart SSR app`
ثم يحاول rollback، لكنه لا يجد snapshot متوافق لأن المعمارية اتغيّرت إلى SSR/Node، فيقول:
`Skipping incompatible rollback snapshot`
وهذا طبيعي بعد تغييرات كبيرة في طريقة النشر.

خطة الحل الجذري:

1. تثبيت TanStack كحزمة واحدة متوافقة
- توحيد `@tanstack/react-start`, `@tanstack/react-router`, `@tanstack/router-plugin` على نفس عائلة إصدار مستقرة.
- إزالة overrides/resolutions التي تجبر `router-core` على إصدار مختلف عن باقي الحزم، لأنها سبب محتمل لكسر augmentation.
- إعادة توليد lockfile بـ Bun فقط.

2. تصحيح server routes حسب النسخة المستقرة
- الإبقاء على `server: { handlers: ... }` لو النسخة المتوافقة تدعمه بشكل صحيح.
- أو تحويل ملفات API إلى الصيغة الرسمية البديلة إن لزم الأمر، مثل `createServerFileRoute` من `@tanstack/react-start/server` إذا كانت النسخة المختارة تتطلب ذلك.
- الملفات المستهدفة تحديداً:
  - `src/routes/api/public/bot/job-update.ts`
  - `src/routes/api/public/bot/next-job.ts`
  - `src/routes/api/public/hooks/process-bulk-jobs.ts`
  - `src/routes/deploy-version[.]json.ts`

3. تنظيف النشر من مصادر عدم التوافق
- التأكد أن `deploy` يشحن `bun.lockb` و`package.json` فقط.
- تثبيت dependencies في GitHub Actions وعلى السيرفر بنفس مدير الحزم ونفس lockfile.
- جعل خطوة التثبيت تفشل برسالة واضحة لو lockfile غير متوافق بدلاً من استخدام fallback يخفي المشكلة.

4. جعل rollback لا يحول الفشل إلى “كارثة”
- تعديل خطوة rollback بحيث لو لا يوجد snapshot SSR متوافق، لا تفشل الـ workflow بخطأ إضافي.
- الرسالة الحالية معناها: “لا يوجد نسخة SSR قديمة نرجع لها”، وليس أن الكود نفسه يحتاج ملف اتصال جديد.

5. التحقق النهائي
- تشغيل فحص TypeScript محلياً للتأكد أن `server` لم يعد يسبب TS2353.
- التأكد أن build ينتج `dist/server/server.js`.
- التأكد أن `/deploy-version.json` موجود كـ server route ويعمل بعد النشر.

النتيجة المتوقعة:
- وقف حلقة أخطاء TanStack نهائياً بتوحيد الإصدارات بدل ترقيع كل خطأ لوحده.
- عدم الحاجة لإعادة بناء “ملف الاتصال”.
- النشر إما ينجح، أو يفشل بسبب واضح ومحدد بدون rollback مضلل.