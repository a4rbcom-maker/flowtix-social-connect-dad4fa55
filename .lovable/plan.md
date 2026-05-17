المشكلة الأساسية ليست في GitHub فقط؛ المشروع الحالي ليس موقع Vite ثابت عادي. هو TanStack Start SSR، يعني يحتاج تشغيل Node/PM2 خلف Nginx. لذلك أي Workflow يتعامل معه كـ static files أو يتحقق من index.html/deploy-version.json كملف ثابت سيظل يفشل.

ما ظهر من الفحص:
- `vite.config.ts` مضبوط على `target: "node-server"`، وهذا صحيح للـ VPS لكنه ينتج `dist/server/server.js` وليس `index.html` عادي.
- الـ Workflow الحالي يفشل عند التحقق من `http://127.0.0.1:3000/deploy-version.json` لأن هذا المسار غير مضمون أن يخدمه SSR كملف ثابت، لذلك يظهر 404 ويتم اعتبار النشر فاشل.
- عندك server functions مستخدمة داخل التطبيق، لذلك الرجوع لنشر static فقط ليس حلًا جذريًا لأنه سيكسر وظائف الداشبورد/الفيسبوك/البوت.
- يوجد أيضًا ملفات `*.functions.ts` داخل `src/server` ومستوردة من الواجهة؛ هذا نمط هش في TanStack Start ويجب نقله لمكان آمن لتجنب مشاكل build/runtime مستقبلية.

الخطة النهائية:

1. تثبيت شكل النشر كـ SSR فقط
- إلغاء منطق auto-detect بين static/SSR لأنه يضيف تعقيد غير ضروري.
- اعتبار المشروع Node SSR app دائمًا.
- البناء في GitHub، ثم رفع bundle واضح للسيرفر:
  - `dist/`
  - `package.json`
  - lockfile
  - ملفات التشغيل المطلوبة فقط.

2. إضافة health/version endpoint حقيقي داخل التطبيق
- إنشاء route رسمي `/deploy-version.json` داخل TanStack Start بدل الاعتماد على ملف ثابت بعد البناء.
- هذا route يرجع commit الحالي من environment variables مثل:
  - `DEPLOY_SHA`
  - `DEPLOY_RUN_ID`
  - `DEPLOYED_AT`
- بعد ذلك فحص `127.0.0.1:3000/deploy-version.json` سيكون فحص حقيقي للتطبيق وليس ملف static قد لا يتم خدمته.

3. تعديل PM2 ليعمل بطريقة مستقرة
- تشغيل `dist/server/server.js` عبر `node` وليس تبديل عشوائي بين `bun` و `node`.
- استخدام `cwd` صحيح داخل deploy path.
- تمرير env واضح:
  - `PORT=3000`
  - `NODE_ENV=production`
  - `DEPLOY_SHA=<commit>`
- إعادة تشغيل PM2 بنفس الاسم `flowtixtools-web` بشكل deterministic.

4. تحسين التحقق بعد النشر
- فحص داخلي أولًا:
  - `http://127.0.0.1:3000/`
  - `http://127.0.0.1:3000/deploy-version.json`
- ثم فحص الدومين العام:
  - `https://www.flowtixtools.com/deploy-version.json`
  - مع رسالة خطأ واضحة لو المشكلة من Nginx/domain وليس من التطبيق.
- لن يتم اعتبار النشر فاشل بسبب endpoint static غير موجود؛ الفشل سيكون فقط لو التطبيق فعلًا لا يعمل أو الدومين لا يوجه له.

5. Rollback حقيقي وآمن
- قبل كل نشر يتم حفظ snapshot من آخر نسخة شغالة.
- بعد نجاح التحقق العام فقط يتم تسجيلها كـ `LAST_GOOD`.
- لو فشل أي شيء بعد رفع النسخة:
  - يرجع تلقائيًا لآخر نسخة `LAST_GOOD` أو snapshot السابقة.
  - يعيد تشغيل PM2 على النسخة القديمة.
  - يتحقق أن الدومين عاد للنسخة القديمة.

6. تنظيف بنية server functions
- نقل الملفات المستوردة من الواجهة من:
  - `src/server/facebook.functions.ts`
  - `src/server/fb-bot.functions.ts`
- إلى مسار آمن مثل:
  - `src/lib/facebook.functions.ts`
  - `src/lib/fb-bot.functions.ts`
- تحديث كل imports المرتبطة بها.
- الإبقاء على الملفات server-only فقط بامتداد `.server.ts` داخل `src/server` أو نقلها حسب الحاجة.

7. توضيح شرط السيرفر مرة واحدة فقط
بعد التنفيذ، سيكون المطلوب من السيرفر بسيط وثابت:

```text
Nginx/domain -> proxy_pass http://127.0.0.1:3000
PM2 app       -> flowtixtools-web
App port      -> 3000
Deploy path   -> /www/wwwroot/flowtixtools.com أو secret DEPLOY_PATH
```

لو Nginx لا يوجه الدومين إلى port 3000، الـ Workflow سيخبرك صراحة أن المشكلة في إعداد الدومين/السيرفر، وليس في كود المشروع.

النتيجة المتوقعة:
- نشر طبيعي مع كل commit على `main`.
- لا بحث عن `index.html` غير موجود.
- لا فشل بسبب 404 وهمي على ملف version.
- PM2 يشغل التطبيق كـ SSR بشكل ثابت.
- rollback تلقائي يرجع آخر نسخة شغالة لو النشر الجديد فشل.
- أخطاء النشر ستكون واضحة ومحددة بدل سلسلة تجارب عشوائية.