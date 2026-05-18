## السبب الجذري (مؤكَّد)

صفحة `dashboard.facebook.bot` تستورد دوال الخادم من `src/lib/fb-bot.functions.ts`، وهذا الملف يحتوي **في الأعلى** على:

```ts
import { encryptJson, decryptJson } from "@/server/crypto.server";
```

قاعدة المنصة: أي ملف داخل `src/server/` ممنوع من الدخول إلى حزمة المتصفح (Import Protection). محوِّل TanStack Start يحذف محتوى `.handler()` من حزمة العميل، لكنه **لا يحذف الاستيرادات الثابتة في أعلى الملف**. النتيجة:

- **في المعاينة (dev/Vite):** يُحلّ الاستيراد بمرونة فيشتغل.
- **في الموقع المنشور (build حقيقي):** الحزمة العميلة تحاول تقييم `@/server/crypto.server` فيُرفض → يُلقى استثناء أثناء تقييم وحدة الصفحة → يظهر `DefaultErrorComponent` من `src/router.tsx` (نفس الصورة التي أرسلتها بالضبط: مثلث أحمر + "Something went wrong").

هذا يفسر لماذا الخطأ **يخص النشر فقط** ويظهر بعد ثوانٍ من فتح الصفحة (الوقت اللازم لتحميل/تقييم chunk الصفحة).

## الإصلاح

نقل استيراد `crypto.server` من المستوى العلوي إلى **داخل كل `.handler()`** كاستيراد ديناميكي. عندها يختفي تماماً من حزمة العميل، ويُحلّ فقط على الخادم وقت الاستدعاء.

### الملف المتأثر
- `src/lib/fb-bot.functions.ts` — يستخدم `encryptJson` (سطر 100) و`decryptJson` (سطرين 292 و342).

### التغيير المحدد

1. حذف السطر العلوي:
   ```ts
   import { encryptJson, decryptJson } from "@/server/crypto.server";
   ```
2. داخل `.handler()` الذي يستدعي `encryptJson` (إضافة حساب):
   ```ts
   const { encryptJson } = await import("@/server/crypto.server");
   const encrypted = encryptJson(payload);
   ```
3. داخل كل `.handler()` يستدعي `decryptJson` (اختبار الحساب + التقاط الجروبات):
   ```ts
   const { decryptJson } = await import("@/server/crypto.server");
   const payload = decryptJson<...>(acc.encrypted_payload);
   ```

### فحص جانبي (نفس النمط يحتمل أن يصيب صفحات أخرى لاحقاً)
- `src/routes/dashboard.facebook.jobs.tsx` و `dashboard.facebook.history.tsx` يستوردان من نفس `fb-bot.functions` — سيُصلَحان تلقائياً بنفس الإصلاح أعلاه.
- `src/routes/api/public/bot/next-job.ts` مسار خادم بحت، لا يحتاج تغيير.

## التحقق بعد الإصلاح

1. النشر (Publish → Update).
2. فتح `/dashboard/facebook/bot` على الدومين المنشور: يجب أن تظهر بطاقة الحسابات بدون انتقال لشاشة الخطأ.
3. الضغط على "اختبر الآن" لحساب: يجب أن يصل الطلب إلى الخادم ويعود بحالة Active/Invalid مع السبب.

## ما لن أُغيّره
- ملفات `client.ts`, `client.server.ts`, `auth-middleware.ts`, `crypto.server.ts` — تبقى كما هي.
- لا تعديل على واجهة المستخدم أو الترجمات أو حالة الاختبار.
