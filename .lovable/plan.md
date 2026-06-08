## المشكلة

عند الضغط على «ربط واتساب» لا يظهر الباركود لأن عميل الـ Bridge في Flowtix لا يتوافق مع عقد API الفعلي لخادم Bot-Xtra (`public/bridge-server/server.js`).

### الفروقات المكتشفة بين الكودين

| العملية | Flowtix يرسل/يتوقع | Bot-Xtra الفعلي |
|---|---|---|
| إنشاء الجلسة `POST /api/sessions` | body: `{ id }` | يتطلب `{ sessionId }` → يرد **400 "sessionId required"** |
| حالة الجلسة `GET /api/sessions/:id/status` | يقرأ `status / state / phoneNumber` | يرجّع `{ connected, qr, exists, phone, name }` — لا يوجد حقل `status` |
| كود الـ QR `GET /api/sessions/:id/qr` | يفترض base64 لصورة PNG ويلفّها بـ `data:image/png;base64,...` | يرجّع **نص QR خام** (whatsapp pairing string)، ليس صورة |
| Pairing code | `POST /api/sessions/:id/pairing-code` | المسار الصحيح `POST /api/sessions/:id/request-pairing-code` |
| رقم الهاتف | `phoneNumber` | `phone` |

النتيجة: createSession يفشل بـ 400، فالكود الحالي (بعد إصلاح سابق) يعيد `disconnected` بصمت — فلا يظهر QR أبداً.

## الخطة

### 1) محاذاة عميل الـ Bridge داخل Flowtix

تعديل `src/lib/wa-bridge.server.ts`:
- `createSession(id)` ترسل `{ sessionId: id }` بدل `{ id }`.
- `BridgeStatusResponse` يضاف له `qr`, `phone`, `name`, `exists`، ويُستنتج `status` كالتالي:
  - `connected === true` → `"connected"`
  - `connected === false && qr` → `"qr"`
  - `exists === false` → `"disconnected"` (نعيد الإنشاء)
  - غير ذلك → `"connecting"`
- `BridgeQrResponse` يدعم QR كنص خام: يولّد Data URL باستخدام مكتبة `qrcode` (تثبيت `qrcode` كاعتمادية سيرفر فقط).
- `pairingCode` → المسار `/request-pairing-code`.

### 2) تبسيط منطق `readState` في `src/lib/wa.functions.ts`

- استخدام الحالة المستنتجة من `getStatus` مباشرة.
- جلب QR فقط عندما `status === "qr"` أو `"connecting"`.
- تخزين `qr_data_url` (Data URL مولّد) في `wa_sessions` كما هو حالياً.

### 3) معالجة الأخطاء (تبقى UX سليمة)

- إبقاء السلوك الحالي: عند فشل الـ Bridge نرجع حالة `disconnected` بدل رمي خطأ يكسر الصفحة.
- إضافة سجل تشخيصي مختصر بالحالة + رمز الاستجابة لتسهيل التتبع.

### 4) رسالة التنسيق مع فريق Bot-Xtra

سأضيف في نهاية الرد بعد التنفيذ نصاً جاهزاً للإرسال لفريق Bot-Xtra يلخّص:
- إصدار الـ Bridge المتوقع (1.8.3 كما في deploy workflow).
- الحقول الموحّدة في الاستجابات (`status`, `phoneNumber`, `qrCode` بـ data URL) كاقتراح لتحسين التوافق المستقبلي.
- مفاتيح السيرفر المطلوبة (`WA_BRIDGE_URL`, `WA_BRIDGE_API_KEY`, `WA_BRIDGE_WEBHOOK_SECRET`) المضبوطة بالفعل.

### الملفات التي ستتغير

- `src/lib/wa-bridge.server.ts` — محاذاة عقد الـ API + توليد QR Data URL.
- `src/lib/wa.functions.ts` — تبسيط `readState`.
- `package.json` — إضافة `qrcode` + `@types/qrcode`.

### تحقق بعد التنفيذ

- تسجيل دخول كمستخدم → الذهاب لـ `/dashboard/whatsapp/accounts` → الضغط على «ربط».
- التأكد من ظهور صورة QR ومن أن استدعاء `connectWaSession` يرجع `status: "qr"` مع `qrDataUrl`.
- بعد المسح: التحقق أن polling يحوّل الحالة إلى `connected` ويظهر رقم الهاتف.
