# Data Model: إعادة تصميم واجهة محادثات واتساب

**Date**: 2026-08-08 | **Feature**: `008-wa-inbox-redesign`

## الكيانات الموجودة (بدون تعديل)

### WaConversation
جدول `wa_conversations` في Supabase — **لا تعديل**.

| الحقل | النوع | الوصف |
|---|---|---|
| `id` | UUID (PK) | معرّف المحادثة |
| `contact_id` | UUID (FK → wa_contacts) | جهة الاتصال |
| `wa_session_id` | UUID (FK → wa_sessions) | جلسة واتساب |
| `workspace_id` | UUID | نطاق العمل |
| `status` | string | `open` / `waiting` / `resolved` |
| `unread_count` | number | عدد الرسائل غير المقروءة |
| `is_archived` | boolean | مؤرشف |
| `is_spam` | boolean | مزعج |
| `is_starred` | boolean | مميز |
| `last_message_at` | timestamptz? | وقت آخر رسالة |
| `last_message_preview` | text? | معاينة آخر رسالة |
| `assigned_to` | UUID? | المسؤول |
| `metadata` | JSONB | بيانات إضافية |

### WaMessage
جدول `wa_messages` — **لا تعديل**.

| الحقل | النوع | الوصف |
|---|---|---|
| `id` | UUID (PK) | معرّف الرسالة |
| `conversation_id` | UUID (FK) | المحادثة |
| `wa_session_id` | UUID (FK) | الجلسة |
| `direction` | enum | `inbound` / `outbound` / `system` |
| `status` | enum | `pending` / `sent` / `delivered` / `read` / `failed` |
| `type` | enum | `text` / `image` / `video` / `audio` / `document` / `location` / `contact` / `buttons` / `list` / `template` |
| `body` | text? | نص الرسالة |
| `metadata` | JSONB | `media_url`, `signed_url`, `mime_type`, `file_name`, `dimensions` |
| `sent_by_ai` | boolean | مرسلة بواسطة AI |
| `created_at` | timestamptz | وقت الإنشاء |

**حالة التسليم (Delivery Status)**:
```
pending → sent → delivered → read
                 ↘ failed
```

### WaContact
جدول `wa_contacts` — **لا تعديل**.

| الحقل | النوع | الوصف |
|---|---|---|
| `id` | UUID (PK) | معرّف جهة الاتصال |
| `phone` | text (مطلوب) | رقم الهاتف |
| `name` | text? | الاسم |
| `push_name` | text? | اسم واتساب |
| `avatar_url` | text? | الصورة |
| `tags` | text[] | وسوم |
| `notes` | text? | ملاحظات |
| `is_vip` | boolean | عميل VIP |
| `message_count` | number | عدد الرسائل |
| `last_seen` | timestamptz? | آخر ظهور |

### WaNote
جدول `wa_notes` — **لا تعديل**.

| الحقل | النوع | الوصف |
|---|---|---|
| `id` | UUID (PK) | معرّف الملاحظة |
| `conversation_id` | UUID (FK) | المحادثة |
| `body` | text (مطلوب) | نص الملاحظة |
| `user_id` | UUID? | الكاتب |
| `workspace_id` | UUID? | النطاق |
| `created_at` | timestamptz | وقت الإنشاء |

---

## الكيانات الجديدة

### SavedReply (Local)
تُخزَّن في `localStorage` — مفتاح: `flowtix_saved_replies`

| الحقل | النوع | الوصف |
|---|---|---|
| `id` | string | معرّف فريد (crypto.randomUUID) |
| `name` | string | اسم العرض (مثل "ترحيب جديد") |
| `shortcut` | string | اختصار بدون `/` (مثل `welcome`) |
| `body` | string | نص الرد (قد يحوي متغيرات مستقبلية) |
| `category` | enum | `greeting` / `follow_up` / `offer` / `reminder` / `thanks` / `survey` |
| `created_at` | number | timestamp (Date.now()) |
| `updated_at` | number | timestamp |

### AiComposeAction (Type فقط)
لا تخزين — طلب مؤقت للـ AI.

| الحقل | النوع | الوصف |
|---|---|---|
| `action` | enum | `rephrase` / `fix_grammar` / `professional` / `casual` / `shorten` / `expand` / `translate` / `suggest_reply` |
| `text` | string? | النص المراد معالجته (null عند `suggest_reply`) |
| `context` | string? | سياق المحادثة (آخر 5 رسائل) عند `suggest_reply` |

### MediaAttachment (Type محلي)
يُستخدم في صندوق الكتابة قبل الإرسال.

| الحقل | النوع | الوصف |
|---|---|---|
| `file` | File / Blob | الملف الفعلي |
| `previewUrl` | string | `URL.createObjectURL` للمعاينة |
| `type` | enum | `image` / `video` / `audio` / `document` |
| `size` | number | حجم الملف بالبايت |

---

## قواعد التحقق (Validation Rules)

### Media Upload
- الحد الأقصى: **16MB** (حد WhatsApp API للوسائط)
- الأنواع المسموحة: `image/*`, `video/*`, `audio/*`, `.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.txt`
- عند تجاوز الحد: عرض رسالة "حجم الملف يتجاوز 16 ميجابايت"

### SavedReply Shortcut
- أحرف صغيرة إنجليزية فقط + أرقام + شرطة سفلية: `^[a-z0-9_]+$`
- الطول: 2-30 حرف
- فريد (لا تكرار)

### Composer Text
- الحد الأقصى: **4096 حرف** (حد WhatsApp للرسائل النصية)
- العدّاد يظهر عند تجاوز 3500 حرف

---

## تحولات الحالة (State Transitions)

### Conversation Status
```
open ⇄ waiting    (عند استلام رسالة جديدة أثناء resolved)
open → resolved   (يدوي بواسطة المستخدم)
resolved → open   (يدوي بواسطة المستخدم)
```

### Message Status (Read State)
```
unread → read     (تلقائي عند فتح المحادثة)
```

### Recording State
```
idle → recording → recorded → sent
                ↘ canceled (إلغاء → idle)
```
