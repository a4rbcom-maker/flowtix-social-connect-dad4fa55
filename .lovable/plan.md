## السبب الجذري

من فحص طلبات الشبكة الحقيقية لصفحة `/dashboard/facebook`، استجابة `inspectFacebookConnection` تحتوي على:

```
validationError: "(#4) Application request limit reached"
granted: []   declined: []   missingScopes: [كل الصلاحيات]
```

هذا خطأ من Meta نفسه (Error Code 4): **تطبيق فيسبوك الذي يولّد التوكن وصل سقف الاستدعاءات اليومي**. التوكن صحيح وغير منتهي، لكن أي نداء على `/me` أو `/me/permissions` يُرفض من Graph API.

النتيجة في الواجهة: `testFacebookToken` و`connectFacebook` يرجعان استجابة فيها `profile: null` ورسالة خطأ Meta الخام، فيتعامل معها كود الواجهة على أنها "رد غير مكتمل" بدلاً من رسالة واضحة.

## الخطة

### 1. رسائل خطأ صادقة وواضحة بدل "رد الخادم غير مكتمل"
- في `src/lib/facebook.functions.ts`: توسعة `classifyFbError` لتشمل صراحة:
  - `code === 4` → نوع جديد `app_rate_limited` مع رسالة: "تطبيقك على فيسبوك تجاوز حد الاستدعاءات اليومي (#4). انتظر ساعة، أو ارفع الحد من Meta App Dashboard → App Rate Limits."
  - `code === 17` → "تجاوزت حد الاستدعاءات على مستوى المستخدم (#17). انتظر قليلاً."
  - `code === 32 / 613` → حد الصفحة/المجموعة.
- في `src/routes/dashboard.facebook.tsx`: 
  - `friendlyError` يتعرّف على `(#4)` و `application request limit` و `rate limit` ويعرض الرسالة العربية المفصّلة أعلاه + رابط لـ Meta App Dashboard.
  - `normalizeAuthResponse` عند `!id` يضيف `fbType` ورسالة الخطأ الأصلية بدلاً من جملة "رد غير مكتمل" المضلِّلة.

### 2. تجنّب استنزاف الحد (المعالجة الجذرية)
- **زر "اختبار التوكن" يعيد استخدام نتيجة `inspectFacebookConnection` المخزّنة** إذا كان نفس التوكن مخزّن بالفعل، بدل استدعاء `/me` و`/me/permissions` مرتين على كل ضغطة.
- **`getFacebookConnection` المُستدعى عند فتح الصفحة لا يستدعي `inspectFacebookConnection` تلقائياً** عند كل تحميل — فقط مرة واحدة بعد اتصال جديد أو عند ضغط زر "تحديث".
- إضافة `localStorage` cache قصير (30 ثانية) لنتيجة `testFacebookToken` لنفس التوكن، فلا يضرب FB أكثر من مرة في الدقيقة.

### 3. مؤشّر حالة التطبيق
- لافتة أعلى الصفحة (بنفس نمط لافتة انتهاء الصلاحية الحالية) تظهر فقط إذا اكتُشف `app_rate_limited`، توضح:
  - رسالة الخطأ
  - الخطوات: انتظار ساعة، أو زيادة الحد من Meta App Dashboard
  - زر يفتح `developers.facebook.com/apps` مباشرة

### 4. تحقّق الإصلاح
- لا يمكن إعادة الاختبار يدوياً (يحتاج توكن حقيقي للمستخدم)، لكن سنتأكد:
  - من خلال قراءة شبكة بعد التغيير أن عدد طلبات `_serverFn` انخفض (لا inspect تلقائي + cache).
  - أن استجابة test/connect المخزّنة في `network_requests` لم تعد تحتوي على نص خطأ خام أو `profile: null` بدون رسالة مفهومة.
  - فحص TypeScript/ESLint للملفّين.

## ملفّات ستتغيّر
- `src/lib/facebook.functions.ts` — تصنيف خطأ #4 و#17، طبقة cache بسيطة على الخادم اختيارية.
- `src/routes/dashboard.facebook.tsx` — رسائل خطأ + لافتة rate-limit + إزالة الـ inspect التلقائي عند كل تحميل + cache نتيجة الاختبار.
- `src/features/facebook/api.ts` — إضافة `app_rate_limited` لـ `FbErrorKind` و `describeFbError`.

## ملاحظة مهمة للمستخدم
الإصلاحات أعلاه ستجعل الرسائل واضحة وستوقف إهدار الحد، لكن **لن تُعيد عمل الـ API فوراً** — يجب الانتظار حتى يُعاد ضبط الحد من فيسبوك (عادة ساعة)، أو طلب رفع الحد من Meta App Dashboard → App Rate Limits.
