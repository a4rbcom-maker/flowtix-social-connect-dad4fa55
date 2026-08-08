# Research: إعادة تصميم واجهة محادثات واتساب

**Date**: 2026-08-08 | **Feature**: `008-wa-inbox-redesign`

## R-001: مكتبة Virtualization للرسائل

**القرار**: `@tanstack/react-virtual`

**السبب**: 
- نفس منصة `@tanstack/react-query` الموجودة في المشروع → توافق وثبات عالٍ
- خفيفة (8KB gzipped) — لا تضيف wrapper components، مجرد hook `useVirtualizer`
- تدعم dynamic heights تلقائياً (مهم لفقاعات الرسائل ذات الأحجام المختلفة)
- API بسيط: `useVirtualizer({ count, getScrollElement, estimateSize })`

**البدائل المُقيّمة**:
| البديل | السبب للرفض |
|---|---|
| `react-window` | ثقيل (40KB)، يتطلب `FixedSizeList` أو `VariableSizeList` بأعمدة قياس يدوية |
| `react-virtuoso` | الأكبر حجماً، API مغلق أكثر، أصعب للتخصيص |
| تنفيذ يدوي | معقد جداً، عرض متغير الارتفاعات لـ 100K رسالة ليس عملياً |

## R-002: مكتبة Emoji Picker

**القرار**: `emoji-picker-react`

**السبب**:
- خفيفة جداً (~35KB gzipped)
- API بسيط: `<EmojiPicker onEmojiClick={fn} />`
- تدعم البحث، التصنيفات، الإيموجي المستخدمة مؤخراً، الوضع الداكن
- تتكيف مع RTL تلقائياً
- لا تتطلب CSS import منفصل (مدمجة)

**البدائل المُقيّمة**:
| البديل | السبب للرفض |
|---|---|
| `emoji-mart` | أثقل (100KB+)، تتطلب data set منفصل، تكوين أكثر تعقيداً |
| تنفيذ يدوي | غير عملي لقاعدة بيانات الإيموجي الكبيرة (3000+) |

## R-003: مساعد AI — آلية الاستدعاء

**القرار**: إضافة endpoint جديد `POST /ai/compose` على extraction-service يستخدم `kieChat` الموجود

**السبب**:
- `kieChat` في `extraction-service/src/ai/kie-client.ts` يدعم بالفعل `/chat/completions` مع timeout و error handling
- الـ config (apiKey, baseUrl, models) مخزّن في `ai_provider_configs` ويُحمَّل عبر `loadProviderConfig`
- إضافة endpoint جديد على نفس الـ router الموجود (`/ai/test` موجود بالفعل) هو الحل الأبسط
- الواجهة تستدعي extraction-service (وليس Kie.ai مباشرة) → لا تعريض للمفاتيح

**البدائل المُقيّمة**:
| البديل | السبب للرفض |
|---|---|
| استدعاء Kie.ai من الواجهة مباشرة | تعريض API key في الـ bundle |
| استخدام `kie-service.ts` الموجود | يحتوي فقط على credit check، لا chat function |
| إضافة OpenAI منفصل | تعقيد إضافي ومرءوسية، المشروع يستخدم Kie.ai بالفعل |

**تفاصيل الـ endpoint المقترح**:
```
POST /ai/compose
Body: { workspace_id, action, text?, context? }
Response: { success, content, error? }
```
حيث `action` ∈ `{ rephrase, fix_grammar, professional, casual, shorten, expand, translate, suggest_reply }`

## R-004: تخزين الردود المحفوظة

**القرار**: localStorage عبر hook مخصص `useSavedReplies`

**السبب**:
- الـ spec ينص صراحةً على localStorage في v1 لعدم تعديل قاعدة البيانات
- الردود المحفوظة هي تفضيلات مستخدم، لا بيانات حرجة
- أبسط حل كافٍ — لا حاجة لـ Supabase table في هذه المرحلة

**هيكل البيانات في localStorage**:
```json
{
  "flowtix_saved_replies": [
    {
      "id": "uuid",
      "name": "ترحيب جديد",
      "shortcut": "welcome",
      "body": "أهلاً وسهلاً بك...",
      "category": "greeting"
    }
  ]
}
```

**الترحيل المستقبلي**: عند إنشاء جدول `wa_saved_replies` في Supabase، يمكن ترحيل البيانات من localStorage بقراءة + insert جماعي.

## R-005: التسجيل الصوتي

**القرار**: واجهة `MediaRecorder` الأصلية في المتصفح

**السبب**:
- مدعومة في جميع المتصفحات الحديثة (Chrome, Firefox, Safari, Edge)
- لا تتطلب مكتبة خارجية
- التسجيل يتم كـ `audio/webm` أو `audio/mp4` (حسب المتصفح)
- يمكن رفع النتيجة مباشرة عبر `waInboxRepository.uploadMedia(blob)`

**التحديات والحلول**:
| التحدي | الحل |
|---|---|
| الاعتماد على المتصفح للـ codec | استخدام `MediaRecorder.mimeType` المتاح + تجربة `audio/webm;codecs=opus` ثم `audio/mp4` |
| التصور البصري أثناء التسجيل | `AnalyserNode` + `Canvas` لرسم الموجة الصوتية |
| إلغاء التسجيل | `MediaRecorder.stop()` + تجاهل الـ blob |
| HTTPS مطلوب | متوفر في الإنتاج (Cloudflare) |

## R-006: إصلاح Realtime للرسائل

**المشكلة الحالية**: `useWaMessages` يستمع لـ `INSERT` فقط، فلا تتحدث حالة الرسائل (delivered/read/failed) لحظياً.

**القرار**: تغيير event من `INSERT` إلى `*` (الكل)

**التأثير**: سيؤدي إلى invalidation عند أي UPDATE على `wa_messages` (مثل تغيير status). الـ invalidation يعيد جلب كل الرسائل لكن مع React Query caching هذا مقبول للمحادثات الفردية.

**التحسين المستقبلي**: بدلاً من invalidation كامل، استخدام `queryClient.setQueryData` لتحديث الرسالة المعنية فقط من payload الـ Realtime. لكن هذا تحسين اختياري.

## R-007: إصلاح فلتر Realtime للمحادثات

**المشكلة الحالية**: الـ subscription يستخدم `user_id=eq.${ws}` لكن جدول `wa_conversations` لا يحتوي عمود `user_id` (يحتوي `workspace_id`, `assigned_to`).

**القرار**: تغيير الفلتر إلى `workspace_id=eq.${workspaceId}`

**التأثير**: الاشتراك سيطابق الصفوف فعلياً → تحديثات لحظية حقيقية لقائمة المحادثات.

## R-008: بنية المكونات والـ State Management

**القرار**: `WaInboxPage` كـ orchestrator مع state مرفوع (lifted state)

**السبب**:
- State مشترك بين الأعمدة: `activeConvId` (يؤثر على 3 أعمدة), `searchQuery`, `filter`, `showContactPanel`
- رفع state إلى `WaInboxPage` وتمريره كـ props هو أبسط من Context (KISS)
- لا تكرار لـ server state — يبقى في React Query hooks

**الـ State العام في WaInboxPage**:
```
activeConvId, filter, searchQuery, showContactPanel, draftText
```

**الـ Server State (في React Query عبر hooks)**:
```
conversations (useWaConversations), messages (useWaMessages), notes (محلي)
```

## R-009: RTL مع Virtualization

**القرار**: Virtualization لا تؤثر على RTL — التمرير أفقي/عمودي مستقل عن الاتجاه

**السبب**: `@tanstack/react-virtual` يتعامل مع positions رياضياً (translateY) بغضّ النظر عن `dir`. فقاعات الرسائل تستخدم `flex-row-reverse` أو `ms-auto` للتمييز بين incoming/outgoing.

## R-010: البحث داخل المحادثة

**القرار**: فلترة client-side على الرسائل المحمّلة

**السبب**:
- الرسائل محمّلة بالفعل في React Query cache
- البحث client-side فوري بدون طلبات شبكة
- للمحادثات الطويلة جداً، البحث يفلتر الصفحة المعروضة + خيار "تحميل المزيد"

**التحدي**: مع Virtualization، البحث يجب أن يتفاعل مع قائمة افتراضية. الحل: عند تفعيل البحث، يتم فلترة المصفوفة قبل تمريرها لـ `useVirtualizer` + scroll تلقائي لأول نتيجة مطابقة.
