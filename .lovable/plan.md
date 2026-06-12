## الهدف

ترتيب الرسائل والمحادثات اعتمادًا على وقت الرسالة الفعلي من واتساب (messageTimestamp) بدل وقت إدخال السجل في قاعدة البيانات. ده بيحل مشكلة ظهور الرسائل القديمة المستوردة بترتيب غلط، وبيخلي تجربة الترتيب مطابقة لتطبيق واتساب.

## الخطوات

1. **Migration** على `wa_messages`:
   - إضافة عمود `wa_timestamp timestamptz` (nullable مبدئيًا للتوافق مع البيانات القديمة).
   - Backfill: تعيين القيمة من `raw->>'messageTimestamp'` أو `raw->>'t'` (ثواني Unix) عند توفرها، وإلا = `created_at`.
   - Index على `(user_id, remote_jid, wa_timestamp)` لتسريع الاستعلامات.

2. **Webhook** (`src/lib/wa-webhook.server.ts`):
   - استخراج التايمستامب من حقول الـ Baileys/BotXtra الشائعة: `messageTimestamp`, `t`, `timestamp`, `key.timestamp`, `data.timestamp` (ثواني أو ميلي ثانية).
   - تحويلها لـ ISO وتخزينها في `wa_timestamp` عند الإدراج.

3. **إرسال من داخل النظام** (`src/lib/wa-chat.functions.ts` + `src/lib/wa-ai.server.ts`):
   - تعيين `wa_timestamp = now()` للرسائل الصادرة من واجهتنا.

4. **القراءة والترتيب**:
   - تحديث استعلامات `getConversationMessages` و`getLatestMessagePreviews` لاستخدام `wa_timestamp` بدل `created_at` مع fallback عبر `COALESCE(wa_timestamp, created_at)`.
   - تحديث `upsertConversationFromMessage` في `src/lib/wa-ai.server.ts` لتعيين `last_message_at` من تايمستامب الرسالة الفعلي (مع الحفاظ على الأحدث فقط، عشان رسالة قديمة مستوردة ما ترفعش المحادثة لأعلى القائمة).
   - ترتيب `wa_conversations` يبقى زي ما هو على `last_message_at` بعد التصحيح.

5. **ترقيع البيانات الموجودة**: SQL تشغيل لمرة واحدة يحدّث `wa_conversations.last_message_at` لكل محادثة من أحدث `wa_timestamp` في رسائلها.

## الملفات المتأثرة

- `supabase/migrations/<new>.sql` — العمود + الـ index + الـ backfill.
- `src/lib/wa-webhook.server.ts` — استخراج وتخزين التايمستامب.
- `src/lib/wa-chat.functions.ts` — ترتيب الرسائل والمحادثات + رسائل صادرة.
- `src/lib/wa-ai.server.ts` — تعيين `last_message_at` من تايمستامب الرسالة + رسائل AI صادرة.
- `src/routes/dashboard.whatsapp.inbox.tsx` — تأكد إن العرض يقرأ `wa_timestamp` (مع fallback).
- `src/integrations/supabase/types.ts` — يتحدث تلقائيًا بعد الـ migration.

## ملاحظة

مفيش تغيير في حقل `created_at` (يفضل بيسجل وقت الاستلام عندنا للتدقيق)، التغيير بس في الترتيب والعرض.