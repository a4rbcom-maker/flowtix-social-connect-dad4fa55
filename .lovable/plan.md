## التشخيص المختصر
- شاشة المحادثة نفسها تعمل وتستدعي `listConversations` بنجاح، لكنها ترجع قائمة فارغة.
- قاعدة البيانات فيها جلسة واتساب متصلة للمستخدم الحالي، لكن `wa_messages = 0` و `wa_conversations = 0`، إذن المشكلة قبل الواجهة: الرسائل لا تُحفظ أصلًا.
- مسار الـ webhook الموجود حاليًا هو `/api/public/wa-webhook` فقط.
- كود إنشاء جلسة واتساب لا يربط الـ Bridge تلقائيًا بالـ webhook URL، لذلك حتى لو الجلسة متصلة قد لا يعرف خادم الربط أين يرسل الرسائل الواردة.
- معالج الـ webhook الحالي يقبل أشكالًا محدودة من payload وقد يتجاهل بعض صيغ WhatsApp/Baileys مثل `messages.upsert` داخل مصفوفة `messages` أو داخل `data.messages`.

## الخطة
1. **ربط الـ Bridge بالـ webhook تلقائيًا عند إنشاء/تحديث الجلسة**
   - إضافة دالة في `wa-bridge.server.ts` لضبط webhook الجلسة على خادم الربط.
   - عند `connectWaSession` وبعد إنشاء الجلسة، يتم إرسال webhook URL الحالي إلى الـ Bridge بدل الاعتماد على إعداد يدوي.
   - تمرير الأحداث المهمة مثل الرسائل الواردة، تحديث الاتصال، QR، والرسائل الصادرة إن كان الـ Bridge يدعمها.

2. **توسيع نقاط استقبال الـ webhook بدون كسر المسار الحالي**
   - إبقاء `/api/public/wa-webhook` كما هو.
   - إضافة alias آمن `/api/public/wa/webhook` لأن بعض الإعدادات أو النسخ قد تستخدم هذا الشكل.
   - إضافة `OPTIONS` و `GET` health response للمسارين لتسهيل الاختبار والتأكد من أن endpoint متاح.

3. **جعل معالج الرسائل أكثر تحمّلًا لاختلاف صيغ BotXtra/Baileys**
   - استخراج `sessionId` من أكثر من مكان: body، headers، `instance`, `instanceId`, `data.instanceId`, `data.sessionId`.
   - دعم payload يحتوي رسالة واحدة أو مصفوفة رسائل.
   - دعم صيغ مثل:
     - `data.messages[]`
     - `messages[]`
     - `data.key.remoteJid`
     - `message.conversation`
     - `message.extendedTextMessage.text`
     - `message.imageMessage.caption` وغيرها.
   - تجاهل رسائل المجموعات أو الرسائل النظامية فقط إذا كانت بلا نص/وسائط حقيقية.

4. **منع الفقد الصامت للرسائل**
   - تسجيل أخطاء الإدخال في السيرفر بدل `return ok` بصمت عند payload غير مفهوم.
   - في حال عدم العثور على الجلسة، سيتم تسجيل sessionId المستلم في اللوج لنعرف هل المشكلة في عدم تطابق sessionId أم في التوقيع/المسار.
   - عند فشل إدخال `wa_messages` أو تحديث `wa_conversations` سيتم رمي/تسجيل خطأ واضح بدل تجاهله.

5. **تحسين عرض المحادثات بعد وصول الرسائل**
   - بعد وصول realtime على `wa_messages` يتم تحديث قائمة المحادثات أيضًا، وليس الرسائل النشطة فقط.
   - الحفاظ على polling الحالي كنسخة احتياطية.

6. **اختبار نهائي قابل للإثبات**
   - اختبار endpoint برسالة webhook موقعة باستخدام الجلسة المتصلة الحالية.
   - التأكد أن صفًا يظهر في `wa_messages` وصفًا يظهر/يتحدث في `wa_conversations`.
   - فتح `/dashboard/whatsapp/inbox` والتأكد أن المحادثة تظهر في القائمة وأن الرسائل تُعرض.
   - تنظيف أي رسالة اختبارية إذا لزم الأمر بعد التحقق.

## الملفات المتوقع تعديلها
- `src/lib/wa-bridge.server.ts`
- `src/lib/wa.functions.ts`
- `src/lib/wa-webhook.server.ts`
- `src/routes/api/public/wa-webhook.ts`
- إضافة route جديد: `src/routes/api/public/wa/webhook.ts`
- `src/routes/dashboard.whatsapp.inbox.tsx` لتحديث realtime بشكل أقوى

## النتيجة المتوقعة
بعد التنفيذ، لن يعتمد وصول الرسائل على ضبط يدوي غير مضمون، وسيقبل النظام صيغ webhook المختلفة، وسيتم حفظ الرسائل في قاعدة البيانات ثم تظهر تلقائيًا في صفحة المحادثة.