## التشخيص

الفشل في الصورة يحدث داخل خطوة `Install dependencies and restart SSR app` عند أمر npm، وليس عند تشغيل التطبيق نفسه.

السبب المرجّح: يوجد `package-lock.json` قديم وغير متزامن مع `package.json` بعد تحديث إصدارات TanStack إلى `1.168.x`، لذلك السيرفر الذي لا يجد Bun يستخدم `npm ci --omit=dev`، و`npm ci` يفشل لأن `package-lock.json` ما زال يحتوي مثلًا:

- `@tanstack/react-start`: في `package.json` = `^1.168.0`، وفي `package-lock.json` = `^1.167.14`
- `@tanstack/router-plugin`: في `package.json` = `^1.168.0`، وفي `package-lock.json` = `^1.167.10`

## الخطة

1. **توحيد مدير الحزم في النشر**
   - جعل workflow يعتمد على Bun بوضوح لأن المشروع لديه `bun.lockb` ومرحلة GitHub نفسها تستخدم Bun.
   - في السيرفر: إذا Bun غير موجود، تثبيته أو الفشل برسالة واضحة تطلب تثبيت Bun، بدل السقوط تلقائيًا إلى `npm ci` مع lockfile غير متزامن.

2. **إزالة مسار npm غير المستقر من deploy bundle**
   - عدم نسخ `package-lock.json` إلى deploy bundle، لأن وجوده يفعّل مسار `npm ci` على السيرفرات التي لا تحتوي Bun.
   - إبقاء `bun.lockb`/`bun.lock` فقط كمرجع تثبيت الإنتاج.

3. **تحديث rollback بنفس نفس المنطق**
   - نفس تعديل التثبيت في مسار rollback حتى لا يرجع الفشل عند الاسترجاع.

4. **تحديث الخطة/التوثيق الداخلي**
   - توثيق أن النشر production يستخدم Bun فقط، وأن خطأ npm ci كان بسبب `package-lock.json` قديم.

5. **التحقق بعد التنفيذ**
   - فحص workflow للتأكد أنه لم يعد يستدعي `npm ci` في مسار النشر الطبيعي أو rollback.
   - التأكد أن `package.json` وملفات lock المعتمدة لا تعيد نفس التعارض.

## النتيجة المتوقعة

بعد تطبيق الخطة وتشغيل workflow مرة أخرى، خطوة `Install dependencies and restart SSR app` لن تفشل بسبب `npm ci`، وسنصل بعدها إما لتشغيل PM2 بنجاح أو لرسالة تشخيص حقيقية عن السيرفر/البورت إن بقيت مشكلة أخرى.