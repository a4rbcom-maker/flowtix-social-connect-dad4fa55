## التشخيص النهائي

الكوكيز عندك سليمة (Cookie-Editor JSON، فيها c_user/xs/datr/fr، الحساب نظيف). المشكلة مش فيها.

**السبب الحقيقي:** السيرفر بتاع التطبيق (Cloudflare Workers) بيبعت طلب `fetch("https://m.facebook.com/me")` من IP تابع لـ Cloudflare Datacenter. فيسبوك عنده طبقة حماية صارمة بترفض كل الطلبات الجاية من IPs الـ Datacenters (AWS, GCP, Cloudflare, إلخ) حتى لو الكوكيز صحيحة 100%، وبيرجّع صفحة تسجيل الدخول/redirect على `/login` كرد افتراضي.

**الدليل من الكود** (`src/lib/fb-bot.functions.ts` سطر 307):
```ts
const res = await fetch("https://m.facebook.com/me", { ... cookies + UA ... })
// res.body بيرجع صفحة login → lastError = "صفحة /me أعادت محتوى تسجيل دخول"
```
ده اللي ظاهر في الـ Toast اللي بعتّه. نفس الكوكيز لو جرّبتها من متصفحك أو من VPS بـ IP منزلي → هترجع `profile_id={c_user}` عادي.

**ليه بيشتغل من المعاينة لكن مش من Live؟** الاتنين بيشتغلوا على نفس Workers، الفرق إن فيسبوك ساعات بيسمح بطلبات نادرة من preview ثم يبدأ يحظر بعد تكرار. عملياً الاختبار من Workers مش موثوق نهائياً.

---

## الحل (ملخّص)

عندنا أصلاً في الـ architecture **VPS Worker** المفروض هو اللي يعمل كل التفاعلات الحقيقية مع فيسبوك (لأنه هيشتغل ببراوزر حقيقي على IP منزلي/خاص). الحل إن **اختبار الحساب** يتم نفس الطريق:

### الخطوات

1. **تعديل `testBotAccount` في `src/lib/fb-bot.functions.ts`**:
   - بدل ما السيرفر يعمل `fetch` مباشرة لفيسبوك، يعمل validation محلي بس على بنية الكوكيز:
     - وجود `c_user` + `xs` + `datr` + `fr`
     - `c_user` رقمي صالح
     - `xs` مش فاضي
   - لو الـ validation نجح → ينشئ **job جديد نوعه `account_test`** في جدول `fb_jobs` ويرجع للواجهة `status: "pending_test"` مع رسالة "تم إرسال طلب الاختبار لعامل VPS — النتيجة هتظهر خلال ثوانٍ".

2. **إضافة handler للنوع ده في الـ VPS Worker** (لما نوصل لمرحلة بناءه — Phase 4):
   - الـ worker بيسحب الـ job، يفتح بروسر مع الكوكيز، يدخل m.facebook.com/me، يتأكد من ظهور `profile_id`، ويرجّع النتيجة بكتابة `last_test_status` + `last_test_error` + `last_tested_at` على الحساب.

3. **في واجهة `dashboard.facebook.bot.tsx`**:
   - بعد ما المستخدم يدوس "اختبر الآن" → polling كل 3 ثواني على `getBotAccounts` لمدة 60 ثانية لحد ما `last_tested_at` يتحدّث.
   - عرض رسالة واضحة: "⏳ في الانتظار — العامل بيختبر الحساب الآن"، ثم النتيجة النهائية.

4. **حل مؤقت لحد ما VPS Worker يبقى جاهز**:
   - نضيف رسالة واضحة في الواجهة (Banner أصفر فوق قائمة الحسابات):
     > "الاختبار الفوري من السيرفر معطّل مؤقتاً — فيسبوك بيرفض طلبات Cloudflare. الحسابات هتتختبر تلقائياً أول ما VPS Worker يربط (Phase 4). دلوقتي بنتحقق فقط من بنية الكوكيز."
   - والـ button يعمل بس structural validation ويعرض ✓ "الكوكيز كاملة وسليمة شكلياً" أو ✗ "ناقص كذا".

---

## التفاصيل التقنية

**ملفات هتتعدّل:**
- `src/lib/fb-bot.functions.ts` — تبسيط `testBotAccount` (إزالة fetch لفيسبوك، إبقاء structural check فقط، إضافة job creation اختياري)
- `src/routes/dashboard.facebook.bot.tsx` — تحديث رسائل النتيجة + banner تنبيهي

**ملفات مش هتتعدّل:**
- `crypto.server.ts`, `client.ts`, جداول الـ DB — مفيش تغيير schema.

**ليه مش هنحاول workaround تاني؟**
- Proxy services مدفوعة → تعقيد + تكلفة.
- تغيير User-Agent مش بيحل المشكلة (فيسبوك بيشوف الـ IP الأول).
- استخدام Graph API الرسمي → بيحتاج App Review من Meta وعملية الموافقة طويلة، ومش بيغطي كل المزايا اللي بتحتاجها (نشر في Groups بحساب شخصي مثلاً ممنوع رسمياً عبر API).

VPS Worker بكوكيز هو الطريق العملي الوحيد لـ Facebook automation، وده اللي خطّطنا له من الأول.

---

## التحقق بعد التنفيذ

1. تفتح صفحة `/dashboard/facebook/bot` على Live → مفيش error.
2. تدوس "اختبر الآن" → ترجع رسالة "الكوكيز سليمة شكلياً، استنى VPS Worker" بدل صفحة login.
3. الـ Banner التنبيهي ظاهر فوق القائمة.
