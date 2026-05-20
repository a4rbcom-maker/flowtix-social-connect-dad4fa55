## المشكلة

كل صفحات الحملات (`/dashboard/facebook/campaigns`, `/new`, `/$id`) بتعرض شاشة "Something went wrong" العامة فور الفتح.

لما فحصت الصفحات بالمتصفح كمستخدم khaled.tqnee نفسه:
- صفحة القائمة بتفتح طبيعي (حالة فاضية)
- مفيش أي أخطاء في الـ console أو network
- كل الـ exports موجودة في `fb-campaigns.functions.ts`
- جدول `fb_campaigns` موجود في قاعدة البيانات

يعني الخطأ بيحصل عندك بس مش عندي — على الأرجح:
1. كاش متصفح قديم بعد آخر تعديل
2. أو خطأ في الـ runtime مش ظاهر لأن الـ routes الـ 3 **ماعندهاش `errorComponent`** خاص بيها، فأي خطأ بيتم التقاطه في `defaultErrorComponent` العام (اللي في الصورة) من غير ما نعرف رسالة الخطأ.

## الحل

### 1. إضافة `errorComponent` لكل route من الحملات (الأولوية)
حالياً كل routes الحملات معتمدة على `defaultErrorComponent` العام اللي بيخفي رسالة الخطأ في الـ production. هضيف لكل route من الـ 3:
- `errorComponent`: يعرض رسالة الخطأ الفعلية + زر "إعادة المحاولة" يستدعي `router.invalidate()` + `reset()`
- `notFoundComponent`: للـ `$id` لما الحملة مش موجودة

### 2. تحسين `defaultErrorComponent` في `src/router.tsx`
- يعرض `error.message` دايماً (مش بس في DEV) لكن بشكل مرتب وقابل للإخفاء، عشان نعرف سبب أي خطأ مستقبلي
- زر "Try again" يعمل `router.invalidate()` + reload للبيانات

### 3. تحسين `callFn` helper
في الـ 3 ملفات في علاقة `callFn` بترمي helper بيبعث `headers` يدوي. ده مش لازم (لأن `attachSupabaseAuth` موجود في `src/start.ts`). هبسطها:
- لو الـ session موجودة، استدعي السيرفر فانكشن مباشرة: `await listCampaigns()` أو `await saveCampaign({ data: payload })`
- ده يقلل احتمال الأخطاء الـ type-cast بـ `as never`

### 4. اختبار بعد التعديل
- فتح كل صفحة من الـ 3 في المتصفح والتأكد إنها بتشغل
- لو لسة فيه خطأ، رسالته هتكون ظاهرة في الـ errorComponent الجديد عشان نعالجها

## الملفات المعدّلة
- `src/router.tsx` — عرض رسالة الخطأ
- `src/routes/dashboard.facebook.campaigns.tsx` — errorComponent + تبسيط callFn
- `src/routes/dashboard.facebook.campaigns.new.tsx` — errorComponent + تبسيط callFn
- `src/routes/dashboard.facebook.campaigns.$id.tsx` — errorComponent + notFoundComponent + تبسيط callFn

## ملاحظة
لو ممكن قبل ما أبدأ التنفيذ، حدّث الصفحة مرة بـ Ctrl+Shift+R (hard refresh). لو لسه بتدي نفس الخطأ، التنفيذ هيكشف رسالة الخطأ الحقيقية ويصلحها.