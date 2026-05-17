الخلاصة: لا نغيّر ملف الاتصال ولا نعيد بناءه. المشكلة ليست من الاتصال؛ المشكلة من طبقتين: تثبيت اعتمادات غير حتمي في GitHub/VPS، واعتماد بعض الملفات على TypeScript augmentation الخاص بـ TanStack `server` route الذي يتكسر عند اختلاف نسخ TanStack.

## الخطة المقترحة

1. **تثبيت الاعتمادات بشكل حتمي**
   - جعل GitHub Actions يستخدم `bun install --frozen-lockfile` بدل `bun install`.
   - جعل السيرفر يستخدم lockfile فقط بدون fallback يغيّر النسخ بصمت.
   - طباعة `bun --version` ونسخ TanStack في اللوج عشان أي فشل يظهر سببه فورًا.

2. **توحيد TanStack ومنع اختلاف النسخ**
   - مراجعة `package.json` و `bun.lock` بحيث تكون نسخ `@tanstack/react-start`, `@tanstack/react-router`, `@tanstack/router-plugin`, و `router-core` متوافقة ومقفولة.
   - إزالة أي override/resolution غير ضروري لو هو سبب اختلاف typings بين المحلي و GitHub.
   - إعادة توليد `bun.lock` كنصي فقط، بدون `bun.lockb` وبدون `package-lock.json`.

3. **إزالة نقطة الضعف الخاصة بـ `/deploy-version.json`**
   - ملف `src/routes/deploy-version[.]json.ts` زائد عن الحاجة لأن `scripts/tanstack-node-server.mjs` يخدم `/deploy-version.json` مباشرة بالفعل.
   - إزالته تمنع رجوع خطأ `server does not exist` من هذا الملف نهائيًا.

4. **تثبيت endpoint البوت بشكل آمن**
   - إبقاء `/api/public/bot/job-update` كـ TanStack server route إذا ثبتت نسخ TanStack بنجاح.
   - لو ظهر أن GitHub ما زال يكسر type augmentation، ننقل هذا endpoint إلى Node SSR runner كـ raw HTTP handler قبل تمرير الطلب لـ TanStack، وبذلك لا يعتمد deploy نهائيًا على خاصية `server` داخل route files.

5. **تقوية Workflow rollback والتحقق**
   - جعل خطوة الفشل تطبع PM2 logs وسبب `bun install` بوضوح.
   - التأكد أن health check المحلي `/` و `/deploy-version.json` يعملان قبل فحص الدومين العام.
   - عدم قتل أي خدمة مجهولة على البورت؛ فقط يفشل برسالة واضحة لو البورت مشغول.

## ما لن أفعله

- لن أعدل ملف الاتصال أو ملفات Lovable Cloud المولدة تلقائيًا.
- لن أرجع لـ npm أو `package-lock.json`.
- لن أغيّر منطق التطبيق أو الواجهة؛ الإصلاح سيكون محصورًا في الاعتمادات والـ deployment/API routing.

## النتيجة المتوقعة

بعد التنفيذ، GitHub Actions إما ينجح بشكل ثابت، أو يفشل برسالة دقيقة جدًا تحدد هل المشكلة من Bun على الـ VPS، PM2، البورت، أو إعداد proxy للدومين.