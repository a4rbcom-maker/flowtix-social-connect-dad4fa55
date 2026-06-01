# خطة WhatsApp Bridge الكاملة

## نظرة عامة
بناء وحدة WhatsApp متكاملة داخل الـ Dashboard، تربط مع سكربت البريدج الموجود عندك على الـ VPS عبر REST + Webhook. كل مستخدم يقدر يربط حسابات WhatsApp متعددة بالـ QR، يستقبل ويرسل رسائل، ويفعّل وكيل AI للرد التلقائي.

---

## 1) البنية المعمارية

```text
[Client Dashboard]  ⇄  [TanStack Server Fns]  ⇄  [WA Bridge (VPS)]
                              ↑                          ↓
                              └──── Webhook ──── (رسائل واردة)
                              ↓
                        [Supabase DB + Realtime]
                              ↓
                        [AI Agent (Lovable AI)]
```

- **WA Bridge**: السكربت الشغال عندك (Baileys/whatsapp-web.js) — يدير الجلسات والـ QR.
- **TanStack Server Fns**: كل الاتصال بالبريدج (إنشاء جلسة، إرسال، استعلام).
- **Webhook**: `/api/public/wa/webhook` يستقبل الرسائل الواردة + تحديثات الحالة.
- **Realtime**: تحديث الواجهة فوراً عند وصول رسالة جديدة.

---

## 2) هيكل الصفحات (داخل Dashboard)

### قائمة جانبية فرعية لـ WhatsApp:
```
WhatsApp
├── 📱 الحسابات (Accounts)        — ربط/إدارة الحسابات بالـ QR
├── 💬 المحادثات (Conversations)   — Inbox شامل لكل المحادثات
├── 🤖 وكيل AI (AI Agent)          — إعدادات الرد التلقائي
├── 📤 الإرسال الجماعي (موجود)     — Bulk send (متوفر بالفعل)
└── ⚙️ الإعدادات (Settings)        — Bridge URL، Webhook، تفضيلات
```

---

## 3) الصفحات بالتفصيل

### أ) صفحة الحسابات `/dashboard/whatsapp/accounts`
- جدول بكل الحسابات المربوطة (الاسم، الرقم، الحالة، آخر اتصال).
- زر **"+ ربط حساب جديد"** → Modal فيه:
  - اسم الحساب (مثلاً: "حساب المبيعات").
  - QR Code يظهر مباشرة (polling كل 3 ثواني للحالة).
  - عند المسح → الحالة تتحول لـ `connected` تلقائياً.
- لكل حساب: زر **قطع الاتصال**، **إعادة المسح**، **حذف**.
- مؤشر حالة بصري (أخضر/أصفر/أحمر).

### ب) صفحة المحادثات `/dashboard/whatsapp/conversations`
- تخطيط **WhatsApp Web style**:
  - **يسار**: قائمة المحادثات (بحث، فلتر حسب الحساب، آخر رسالة، عداد غير المقروء).
  - **يمين**: نافذة المحادثة (Bubbles, timestamps, ticks).
  - شريط الإرسال (نص، إيموجي، إرفاق صورة/ملف).
- **Realtime**: الرسائل الجديدة تظهر فوراً عبر Supabase Realtime.
- تمييز الرسائل المُرسلة بواسطة AI بأيقونة 🤖.
- زر **"تفعيل AI لهذه المحادثة"** أو إيقافه.

### ج) صفحة وكيل AI `/dashboard/whatsapp/ai-agent`
- **مفتاح تشغيل/إيقاف** عام للـ AI.
- **اختيار الموديل** (Gemini Flash, GPT-5 Mini, إلخ).
- **System Prompt** قابل للتخصيص (شخصية البوت، أسلوب الرد، اللغة).
- **رسالة الترحيب** (تُرسل لأول رسالة من رقم جديد).
- **ساعات العمل** (اختياري — يرد فقط في وقت معين).
- **قائمة سوداء** (أرقام لا يرد عليها AI).
- **قاعدة معرفة** (نصوص/FAQ يستخدمها AI كمرجع).
- **سجل الردود** (آخر 50 رد من AI مع إمكانية تقييم).

### د) صفحة الإعدادات `/dashboard/whatsapp/settings`
- إعدادات الـ Bridge (URL، API Key — موجودة في Secrets).
- Webhook URL للنسخ (يحطه في البريدج).
- تفضيلات الإشعارات.

---

## 4) قاعدة البيانات (تعديلات)

### جداول جديدة:
- **`wa_conversations`**: محادثة لكل رقم (session_id, remote_jid, contact_name, last_message_at, unread_count, ai_enabled).
- **`wa_ai_settings`** (توسيع `whatsapp_settings` الموجود): system_prompt, welcome_message, working_hours, blacklist, knowledge_base.
- **`wa_ai_logs`**: سجل ردود AI (conversation_id, prompt, response, model, tokens, rating).

### الجداول الموجودة (نستخدمها كما هي):
- `wa_sessions` ✅ (للحسابات والـ QR)
- `wa_messages` ✅ (الرسائل)
- `whatsapp_settings` ✅ (نوسعها)

---

## 5) Server Functions و API

### Server Functions (`createServerFn`):
- `createWhatsAppSession` — يطلب QR من البريدج وينشئ صف في `wa_sessions`.
- `getSessionQR` — polling لحالة الجلسة والـ QR.
- `disconnectSession` / `deleteSession`.
- `sendWhatsAppMessage` — يرسل رسالة عبر البريدج.
- `listConversations` / `getMessages(conversationId)`.
- `toggleAiForConversation`.
- `updateAiSettings`.

### Server Route (Webhook):
- `POST /api/public/wa/webhook` — يستقبل من البريدج:
  - حفظ الرسالة في `wa_messages`.
  - تحديث `wa_conversations`.
  - لو AI مفعّل → استدعاء Lovable AI → إرسال الرد عبر البريدج.
  - حماية بـ `WA_BRIDGE_WEBHOOK_SECRET` (موجود في Secrets ✅).

---

## 6) تكامل الـ AI

- استخدام **Lovable AI Gateway** (لا يحتاج API Key إضافي).
- موديل افتراضي: `google/gemini-2.5-flash` (سريع ورخيص).
- يُمرَّر للـ AI:
  - System Prompt من الإعدادات.
  - آخر 10 رسائل من المحادثة (context).
  - قاعدة المعرفة (لو موجودة).
- الرد يُرسل تلقائياً عبر البريدج ويُسجّل في `wa_ai_logs`.

---

## 7) خطوات التنفيذ (مرتبة)

1. **Migration**: جداول `wa_conversations`، `wa_ai_logs`، توسيع `whatsapp_settings`.
2. **Server Functions** للحسابات + QR polling.
3. **صفحة الحسابات** مع Modal الـ QR.
4. **Webhook endpoint** لاستقبال الرسائل + التحقق من التوقيع.
5. **صفحة المحادثات** (UI شبيه WhatsApp Web) + Realtime.
6. **إرسال الرسائل** من الواجهة.
7. **صفحة وكيل AI** + إعداداته.
8. **منطق AI Auto-Reply** في الـ Webhook.
9. **سجل AI** + التقييم.
10. **اختبار شامل** (ربط حساب حقيقي، إرسال/استقبال، رد AI).

---

## 8) ملاحظات تقنية

- البريدج عندك بالفعل — هنحتاج فقط الـ endpoints الآتية منه:
  - `POST /sessions` (إنشاء + QR)
  - `GET /sessions/:id` (الحالة)
  - `POST /sessions/:id/send` (إرسال)
  - `DELETE /sessions/:id`
- لو الـ endpoints بأسماء مختلفة في بريدجك، قوليلي بعد الموافقة وأعدّل.
- كل البيانات الحساسة (tokens) مشفّرة في DB.
- RLS مفعّل على كل الجداول الجديدة.

---

## 9) ما هو خارج هذه الخطة (مراحل لاحقة)

- مكتبة قوالب جاهزة للردود السريعة.
- تصنيف المحادثات بـ Labels.
- تكامل CRM (ربط المحادثة بـ Contact).
- إحصائيات تفصيلية (متوسط وقت الرد، رضا العملاء).
- Multi-agent (توزيع المحادثات على فريق).

---

**هل أبدأ التنفيذ بالترتيب المذكور؟ أو تحبي تعدّلي/تضيفي أي حاجة قبل ما نبدأ؟**
