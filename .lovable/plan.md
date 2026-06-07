
# خطة ربط Bot-Xtra WhatsApp Bridge

الأسرار الثلاثة (`WA_BRIDGE_URL` / `WA_BRIDGE_API_KEY` / `WA_BRIDGE_WEBHOOK_SECRET`) موجودة فعلاً في Lovable Cloud، والـ wrapper والـ webhook الأساسي مكتوبين. لكن في 3 فروقات بين الكود الحالي والمستند الرسمي لازم نصلّحها، بالإضافة لشاشة السوبر أدمن المطلوبة.

## الفروقات اللي هتتصلّح

1. **مسار الـ Webhook**
   - الكود حالياً: `/api/public/wa/webhook`
   - المستند الرسمي: `/api/public/wa-webhook`
   - الحل: نقل/إعادة تسمية الملف لـ `src/routes/api/public/wa-webhook.ts` ليطابق المستند بالظبط (لأن Bot-Xtra يستدعي العنوان ده).

2. **ترويسة المصادقة**
   - الكود حالياً: `X-API-Key: <key>` فقط
   - المستند: `Authorization: Bearer <key>` (أو `x-api-key` كبديل)
   - الحل: تعديل `src/lib/wa-bridge.server.ts` ليستخدم `Authorization: Bearer` كأساسي مع إبقاء `X-API-Key` معه للتوافق.

3. **نقص Endpoint كود الإقران (Pairing Code)**
   - إضافة `pairingCode(id, phoneNumber)` في الـ wrapper مقابل `POST /api/sessions/:id/pairing-code` (لمستقبل دعم الربط بالكود بدل QR).

## شاشة السوبر أدمن — WhatsApp Bridge

تحديث `src/routes/admin.whatsapp.tsx` بإضافة قسم "حالة البريدج" في أعلى الصفحة يحتوي:
- عرض `WA_BRIDGE_URL` (مقروء، بدون كشف المفتاح) — مع شارة "مُهيّأ ✓" أو "غير مُهيّأ ✗" لكل سر من الثلاثة.
- زر **«فحص الاتصال»** يستدعي server function جديدة `pingWaBridge` تنفّذ `GET /api/health` وتعرض الحالة + الإصدار + زمن الاستجابة.
- توست نجاح/خطأ واضح بالعربي والإنجليزي.

> لا نضيف حقول إدخال URL/Key في الـ UI — الأسرار تُدار من Lovable Cloud Secrets فقط (أأمن).

## ملفات تتعدّل/تُنشأ

| ملف | الإجراء |
|---|---|
| `src/lib/wa-bridge.server.ts` | تعديل الـ headers + إضافة `pairingCode` |
| `src/routes/api/public/wa-webhook.ts` | إنشاء جديد (نسخة من `wa/webhook.ts`) |
| `src/routes/api/public/wa/webhook.ts` | حذف بعد التأكد |
| `src/lib/wa.functions.ts` | إضافة `pingWaBridge` server fn |
| `src/routes/admin.whatsapp.tsx` | إضافة قسم "حالة البريدج" + زر فحص |

## ما لن نغيّره

- ملفات قاعدة البيانات (`wa_sessions`, `wa_messages`) ومنطق الـ AI auto-reply.
- صفحة `/dashboard/whatsapp/accounts` (تشتغل تمام عبر الـ wrapper الحالي).
- الأسرار الموجودة (القيم الفعلية يدخلها المستخدم/فريق Bot-Xtra من Project Settings).

## بعد التنفيذ

نتأكّد أن `bun run build:dev` يمرّ، ثم نطلب من المستخدم الضغط على زر **«فحص الاتصال»** في `/admin/whatsapp` للتحقق من أن البريدج فعلاً واصل ويرجع `{"status":"ok"}`.
