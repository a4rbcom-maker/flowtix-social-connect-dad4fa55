# Research: مراسلة جهات الاتصال المستخرجة عبر Facebook Messenger

**Feature**: 004-contact-broadcast | **Date**: 2026-07-30

---

## R1: هل نحتاج جدول جديد أم نعيد استخدام publish_jobs؟

**القرار**: إنشاء جدول جديد `broadcast_jobs` + `broadcast_recipients`.

**السبب**: 
- `publish_jobs` مصمم للنشر في جروبات (group_ids) وليس لمراسلة أفراد
- `publish_jobs` يخزّن النتائج في JSON array (آخر 50 فقط) — غير مناسب لتتبّع دقيق لكل مستلم
- نحتاج تتبّع حالة كل مستلم بشكل فردي (pending/sent/failed) مع وقت المحاولة ورسالة الخطأ
- `publish_jobs` لا يملك RLS policies (فجوة أمنية)

**البدائل المُستبعدة**:
- إعادة استخدام `publish_jobs` مع `type: "messenger_broadcast"` — يخلط نوعين مختلفين من المهام في نفس الجدول
- تخزين في `extraction_jobs.config` — لا يدعم تتبّع لحظي لكل مستلم

---

## R2: كيفية إرسال رسالة Messenger عبر Playwright

**القرار**: استخدام `https://www.facebook.com/messages/t/{fb_id}` + Playwright DOM automation.

**الآلية** (مستنبطة من `publish-worker.ts` pattern):
1. `page.goto("https://www.facebook.com/messages/t/{fb_id}")` مع `waitUntil: "domcontentloaded"`
2. انتظار تحميل حقل المحادثة: `[role="textbox"], [contenteditable="true"]`
3. كتابة النص عبر `page.evaluate` (نفس أسلوب `attemptPost` في publish-worker)
4. إذا وُجدت صورة: `page.setInputFiles()` على `input[type="file"]` في المحادثة
5. الضغط على Enter أو زر الإرسال
6. انتظار `networkidle` للتأكد من الإرسال

**ملاحظة حرجة**: الـ `fb_id` المُخزّن من `messenger_contacts` يكون مسبوقاً بـ `msg_` — يجب إزالة هذا الPrefix قبل بناء الرابط. الأنواع الأخرى (groups, pages, comments, reactions) تخزّن `fb_id` نظيف.

**البدائل المُستبعدة**:
- Facebook GraphQL API لإرسال الرسائل — معقّد جداً ويتطلب tokens خاصة وقد ينتهك TOS بشكل أوضح
- `mbasic.facebook.com/messages/` — واجهة قديمة قد لا تدعم إرفاق الصور بشكل موثوق

---

## R3: كيفية رفع وتخزين الصورة المرفقة

**القرار**: رفع الصورة إلى Supabase Storage (bucket: `broadcast-media`)، ثم تحميلها محلياً في extraction-service لتمريرها لـ Playwright.

**الآلية**:
1. Frontend يرفع الصورة إلى Supabase Storage و يحصل على `signed URL` (صالح 10 دقائق)
2. يُرسل `media_storage_key` في طلب `/broadcast/start`
3. `broadcast-worker` يحمّل الصورة مؤقتاً (`/tmp/broadcast-{jobId}.jpg`)
4. يستخدم `page.setInputFiles()` لتمرير المسار المحلي
5. يحذف الملف المؤقت بعد الإرسال

**حدود**: JPG/PNG، حد أقصى 5 ميجابايت، صورة واحدة لكل رسالة.

---

## R4: تحديث شاشة التقدم لحظياً

**القرار**: Polling كل ثانيتين عبر `useQuery` (React Query) على endpoint `/broadcast/status/:jobId`.

**السبب**:
- Supabase Realtime ممكن لكنه يضيف تعقيداً (channel management, reconnection)
- Polling كل ثانيتين كافٍ لتجربة مستخدم جيدة (الإرسال بطيء أصلاً بسبب rate limiting)
- نفس نمط `useExtractionJob` hook الموجود (refetch every 3s)

**البنية**: `broadcast_jobs.progress` JSON يحتوي على:
```json
{
  "total": 100,
  "sent": 30,
  "failed": 5,
  "remaining": 65,
  "current_name": "أحمد محمد",
  "current_fb_id": "123456789",
  "percent": 30
}
```

---

## R5: استبعاد الجهات بدون fb_id صالح

**القرار**: أثناء إنشاء المهمة، نُنشئ سجلات في `broadcast_recipients` فقط للجهات التي تمتلك `fb_id` غير فار وغير null.

**السبب**: بعض نتائج الاستخراج قد تحتوي على `fb_id: null` (بيانات ناقصة). الجهات بدون معرّف لا يمكن فتح محادثة لها.

---

## R6: معالجة `msg_` prefix في messenger_contacts

**القرار**: عند بناء رابط المحادثة، إذا بدأ `fb_id` بـ `msg_`، نزيل الـ prefix.

```typescript
const cleanId = fb_id.startsWith("msg_") ? fb_id.slice(4) : fb_id;
const chatUrl = `https://www.facebook.com/messages/t/${cleanId}`;
```

**ملاحظة**: سيتم تخزين الـ cleanId في `broadcast_recipients.fb_id` وقت الإنشاء.

---

## R7: منع تعارض المهام (one active broadcast per session)

**القرار**: قبل بدء مهمة جديدة، نتحقق من عدم وجود مهمة broadcast نشطة لنفس الجلسة.

**السبب**: نفس نمط `hasActiveJob` في `extract.ts` و `publish.ts` — منع استهلاك browser pool وتعارض الجلسات.

---

## R8: تنظيف المهام العالقة عند إعادة التشغيل

**القرار**: إضافة `cleanupOrphanedBroadcasts()` تُستدعى عند إقلاع extraction-service.

**السبب**: نفس مشكلة extraction jobs العالقة — إذا أُعيد تشغيل الخادم، المهام الـ `running` تبقى عالقة. نُعلمها كـ `failed` مع رسالة "Service restarted".
