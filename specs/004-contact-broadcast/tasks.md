# Tasks: مراسلة جهات الاتصال المستخرجة عبر Facebook Messenger

**Input**: Design documents from `/specs/004-contact-broadcast/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/broadcast-api.md, quickstart.md

**Tests**: غير مطلوبة (لا يوجد إطار اختبار في المشروع)

**Organization**: المهام منظّمة حسب قصص المستخدم لتمكين التنفيذ والاختبار المستقلين.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: يمكن تنفيذها بالتوازي (ملفات مختلفة، لا اعتماديات)
- **[Story]**: أي قصة مستخدم تنتمي لها (US1, US2, US3, US4)
- المسارات الدقيقة للملفات مرفقة في كل مهمة

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: تهيئة قاعدة البيانات والـ Storage bucket

- [ ] T001 إنشاء Migration لجدول `broadcast_jobs` و `broadcast_recipients` مع RLS Policies في `supabase/migrations/20260730_create_broadcast_jobs.sql`
- [ ] T002 [P] إنشاء Supabase Storage bucket `broadcast-media` مع RLS Policies (يدوياً في Supabase Dashboard أو عبر Management API)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: بناء البنية الأساسية للـ backend والـ frontend التي تعتمد عليها جميع قصص المستخدم

**⚠️ CRITICAL**: لا يمكن بدء أي قصة مستخدم قبل اكتمال هذه المرحلة

### Backend

- [ ] T003 إنشاء `broadcast-worker.ts` — نسخ من `publish-worker.ts` مع تعديل المنطق لـ Messenger chat في `extraction-service/src/services/broadcast-worker.ts`: worker registry (Map)، `startBroadcastWorker`/`stopBroadcastWorker`، حلقة رئيسية، `sendMessengerMessage(page, fbId, message, mediaPath?)`، checkpoint على `broadcast_recipients` + `broadcast_jobs`
- [ ] T004 إنشاء `broadcast.ts` router في `extraction-service/src/routes/broadcast.ts`: POST `/broadcast/start` (Zod validation + create job + recipients + start worker)، POST `/broadcast/stop`، GET `/broadcast/status/:jobId`، GET `/broadcast/recipients/:jobId` (حسب contracts/broadcast-api.md)
- [ ] T005 تسجيل `broadcastRouter` في `extraction-service/src/index.ts` (إضافة `app.use("/", broadcastRouter)`)
- [ ] T006 [P] إضافة `cleanupOrphanedBroadcasts()` في `extraction-service/src/services/supabase.ts` (تحديث كل `broadcast_jobs` الـ `running` إلى `failed` مع "Service restarted")
- [ ] T007 [P] استدعاء `cleanupOrphanedBroadcasts()` عند بدء تشغيل الخادم في `extraction-service/src/index.ts`
- [ ] T008 حذف stub الـ `/broadcast` القديم من `extraction-service/src/routes/extract.ts` (السطور 267-307)

### Frontend

- [ ] T009 إنشاء `useBroadcast.ts` hook مع React Query hooks في `src/hooks/useBroadcast.ts`: `useStartBroadcast()` (mutation لـ POST `/broadcast/start`)، `useBroadcastStatus(jobId)` (polling كل 2s عبر GET `/broadcast/status/:jobId`)، `useBroadcastRecipients(jobId)` (GET `/broadcast/recipients/:jobId`)، `useStopBroadcast()` (mutation لـ POST `/broadcast/stop`)
- [ ] T010 [P] إضافة دوال `startBroadcast` و `stopBroadcast` و `getBroadcastStatus` في `src/lib/extraction/extraction-repository.ts`

**Checkpoint**: البنية الأساسية جاهزة — يمكن البدء بقصص المستخدم بالتوازي

---

## Phase 3: User Story 1 - كتابة وإرسال رسالة للجهات المستخرجة (Priority: P1) 🎯 MVP

**Goal**: المستخدم يفتح صفحة المراسلة، يكتب رسالة + صورة اختيارية، يضغط إرسال، ويبدأ الـ backend في إرسال الرسالة عبر Facebook Messenger لكل جهة اتصال

**Independent Test**: إنشاء مهمة استخراج مكتملة، فتح صفحة المراسلة، كتابة رسالة، الضغط على إرسال، والتحقق من بدء الإرسال عبر Playwright

### Implementation for User Story 1

- [ ] T011 [P] [US1] إعادة كتابة `MessengerBroadcastPage` — composer form (textarea + image upload) في `src/pages/dashboard/messenger/MessengerBroadcastPage.tsx`:
  - حقل textarea متعدد الأسطر مع دعم RTL
  - زر رفع صورة + معاينة الصورة + زر حذف الصورة
  - تحميل الصورة إلى Supabase Storage bucket `broadcast-media` قبل الإرسال
  - عرض عدد الجهات المستخرجة
  - زر "إرسال" معطّل إذا لم يكن هناك نص أو صورة
  - استدعاء `useStartBroadcast` عند الضغط
- [ ] T012 [US1] تنفيذ `sendMessengerMessage` في `extraction-service/src/services/broadcast-worker.ts`:
  - التنقل لـ `https://www.facebook.com/messages/t/{fb_id}` (مع إزالة `msg_` prefix إن وجد)
  - انتظار تحميل حقل `[role="textbox"]` أو `[contenteditable="true"]`
  - كتابة النص عبر `page.evaluate`
  - إذا وُجدت صورة: `page.setInputFiles()` على `input[type="file"]`
  - الضغط على Enter أو `[aria-label*="send"]` للإرسال
  - معالجة: chat page load timeout، عنصر غير موجود، page crash
- [ ] T013 [US1] تنفيذ POST `/broadcast/start` flow الكامل في `extraction-service/src/routes/broadcast.ts`:
  - التحقق من جلسة Facebook (متصل؟)
  - التحقق من عدم وجود `broadcast_jobs` نشطة لنفس `session_id` (status = running/queued)
  - جلب `extraction_results` حيث `job_id = extraction_job_id`
  - فلترة `fb_id` غير فار/غير null
  - إنشاء `broadcast_jobs` row (status=`queued`)
  - إدراج `broadcast_recipients` دفعة واحدة (batch insert)
  - تشغيل `startBroadcastWorker(jobId, sessionId, mediaStorageKey?)`
  - إرجاع `{ job_id, status, total_recipients }`

**Checkpoint**: US1 مكتمل — يمكن إرسال رسالة جماعية ومراقبتها من الـ logs

---

## Phase 4: User Story 2 - شاشة تقدم الإرسال الاحترافية (Priority: P1) 🎯 MVP

**Goal**: أثناء الإرسال، يرى المستخدم شاشة احترافية مع شريط تقدم، عدّادات (ناجح/فشل/متبقي)، اسم الجهة الحالية، وزر إيقاف

**Independent Test**: بدء إرسال جماعي، مراقبة شريط التقدم والأرقام تتحدث كل ثانيتين

### Implementation for User Story 2

- [ ] T014 [US2] إضافة شاشة التقدم في `src/pages/dashboard/messenger/MessengerBroadcastPage.tsx`:
  - Progress bar (نسبة مئوية) مع animation سلس
  - مؤشر دائري (circular progress) أو linear progress bar
  - عدّادات: `{sent}/{total}` ناجح، `{failed}` فشل، `{remaining}` متبقي
  - اسم الجهة الحالية من `current_name`
  - زر "إيقاف" (استدعاء `useStopBroadcast`) مع تأكيد
  - Polling كل 2 ثانية عبر `useBroadcastStatus`
  - الانتقال من شاشة composer → شاشة التقدم عند بدء الإرسال
- [ ] T015 [US2] تنفيذ GET `/broadcast/status/:jobId` في `extraction-service/src/routes/broadcast.ts`: قراءة `broadcast_jobs` + حساب `percent` + إرجاع JSON
- [ ] T016 [US2] تنفيذ POST `/broadcast/stop` في `extraction-service/src/routes/broadcast.ts`: استدعاء `stopBroadcastWorker` + تحديث `status = 'canceled'` + `completed_at`
- [ ] T017 [US2] إضافة شاشة الملخّص النهائي في `MessengerBroadcastPage` (عند `status === 'completed'` أو `canceled`): عرض إجمالي/ناجح/فشل مع أيقونة نجاح، زر "إرسال رسالة أخرى" و "العودة للمهام"

**Checkpoint**: US1 + US2 مكتملان — MVP يعمل بالكامل مع شاشة تقدم

---

## Phase 5: User Story 3 - التحقق من جلسة Facebook (Priority: P2)

**Goal**: المستخدم يرى جلسة Facebook المتصلة، يختارها، ويُمنع من الإرسال إذا لم تكن متصلة

**Independent Test**: فتح صفحة المراسلة بدون جلسة متصلة، التحقق من ظهور رسالة تنبيه وزر لإضافة جلسة

### Implementation for User Story 3

- [ ] T018 [P] [US3] إضافة `useFbSessions` hook (موجود مسبقاً — تحقق من `src/hooks/useFbSessions.ts` وإذا لم يكن موجوداً أنشئه) لاستعلام الجلسات المتصلة
- [ ] T019 [US3] إضافة Session Selector في `MessengerBroadcastPage`:
  - قائمة منسدلة (Select/Dropdown) لجلسات Facebook بحالة `connected`
  - عرض اسم الجلسة + حالة الاتصال
  - اختيار أول جلسة متصلة افتراضياً
  - إرسال `session_id` مع طلب `/broadcast/start`
- [ ] T020 [US3] إضافة Empty State في `MessengerBroadcastPage` عندما لا توجد جلسات متصلة:
  - رسالة "لا توجد جلسة فيسبوك متصلة"
  - زر "إضافة جلسة" ينقل إلى `/dashboard/facebook/sessions`
  - زر الإرسال معطّل

**Checkpoint**: US3 مكتمل — المستخدم يعرف أي جلسة تُستخدم ويُمنع من الإرسال بدون جلسة

---

## Phase 6: User Story 4 - دعم الاستبدال الذكي للأسماء (Priority: P3)

**Goal**: المستخدم يمكنه استخدام `{{name}}` في الرسالة ليُستبدل باسم كل جهة تلقائياً

**Independent Test**: كتابة رسالة بـ `{{name}}`، الإرسال، والتحقق من استبدال الاسم لكل جهة

### Implementation for User Story 4

- [ ] T021 [US4] تنفيذ استبدال `{{name}}` في `broadcast-worker.ts` عند إرسال كل رسالة: `message.replace(/\{\{name\}\}/g, recipientName || "صديق")`
- [ ] T022 [US4] إضافة hint في `MessengerBroadcastPage` textarea: "يمكنك استخدام `{{name}}` للاسم" (بالعربية والإنجليزية حسب i18n)

**Checkpoint**: US4 مكتمل — الرسائل مخصّصة باسم كل جهة

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: تحسينات شاملة، ترجمات، ربط الأزرار

- [ ] T023 [P] إضافة ترجمات i18n في `src/i18n/locales/ar.json` و `src/i18n/locales/en.json`:
  - مفاتيح: `broadcast.title`, `broadcast.message`, `broadcast.attachImage`, `broadcast.send`, `broadcast.stop`, `broadcast.sending`, `broadcast.completed`, `broadcast.noSession`, `broadcast.addSession`, `broadcast.recipients`, `broadcast.sent`, `broadcast.failed`, `broadcast.remaining`, `broadcast.sendingTo`, `broadcast.nameHint`, `broadcast.summary`
- [ ] T024 [P] تعديل `TasksPage.tsx` — زر "مراسلة" لكل أنواع الاستخراج (وليس فقط `messenger_contacts`): إزالة شرط `job.type === "messenger_contacts"` من السطر 245 في `src/pages/dashboard/TasksPage.tsx`
- [ ] T025 [P] تعديل `ExtractContactsPage.tsx` — زر "مراسلة" في شاشة النتائج (إذا لم يكن موجوداً) في `src/pages/dashboard/extraction/ExtractContactsPage.tsx`
- [ ] T026 [P] تعديل `ExtractMembersPage.tsx` — زر "مراسلة" في شاشة النتائج (إذا لم يكن موجوداً) في `src/pages/dashboard/extraction/ExtractMembersPage.tsx`
- [ ] T027 التحقق من عمل الميزة بالكامل حسب quickstart.md (جميع السيناريوهات الخمسة)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: لا اعتماديات — يمكن البدء فوراً
- **Foundational (Phase 2)**: يعتمد على Phase 1 — **يحجب جميع قصص المستخدم**
- **User Stories (Phase 3-6)**: جميعها تعتمد على Phase 2
  - US1 و US2 كلاهما P1 — يُنفّذان معاً ليكوّنا MVP
  - US3 (P2) — مستقل، يمكن تنفيذه بعد Phase 2
  - US4 (P3) — مستقل، يمكن تنفيذه بعد Phase 2
- **Polish (Phase 7)**: يعتمد على جميع القصص المرغوبة

### User Story Dependencies

- **US1 (P1)**: يعتمد على Phase 2 فقط — لا اعتماد على قصص أخرى
- **US2 (P1)**: يعتمد على Phase 2 + US1 (يحتاج الـ frontend composer من US1 + backend worker من Phase 2) — يُنفّذ مع US1 معاً
- **US3 (P2)**: يعتمد على Phase 2 فقط — إضافة Session Selector فوق composer
- **US4 (P3)**: يعتمد على Phase 2 + US1 (استبدال النص في الـ worker)

### Within Each User Story

- Backend قبل Frontend (الـ worker والـ endpoint قبل استدعائهم من الواجهة)
- Components بترتيب: model → service → endpoint → UI → integration

### Parallel Opportunities

- T001 و T002 يمكن تنفيذهما بالتوازي (DB + Storage)
- T006 و T007 بالتوازي مع T005 (ملفات مختلفة)
- T009 و T010 بالتوازي (hook + repository)
- T023 و T024 و T025 و T026 بالتوازي (ملفات مختلفة)
- US3 و US4 يمكن تنفيذهما بالتوازي بعد Phase 2

---

## Parallel Example: US1 + US2

```bash
# بعد اكتمال Phase 2، يمكن تنفيذ هذه المهام بالتوازي:
# US1: T011 (Frontend composer) - مستقل
# US1: T012 (Backend sendMessage) - مستقل (ملف مختلف)
# US1: T013 (Backend /start endpoint) - يعتمد على T012 جزئياً

# US2: T014 (Frontend progress screen) - نفس ملف T011، لذا بالتتابع
# US2: T015 (Backend /status endpoint) - مستقل عن T014
# US2: T016 (Backend /stop endpoint) - مستقل
```

---

## Implementation Strategy

### MVP First (US1 + US2 Only)

1. Complete Phase 1: Setup (DB + Storage)
2. Complete Phase 2: Foundational (Worker + Router + Frontend Hook)
3. Complete Phase 3 + 4: US1 + US2
4. **STOP and VALIDATE**: اختبار US1 + US2 حسب quickstart.md
5. Deploy/demo

### Incremental Delivery

1. Phase 1 + 2 → الأساس جاهز
2. US1 + US2 → MVP (إرسال + شاشة تقدم) ✅
3. US3 → اختيار الجلسة + التحقق
4. US4 → استبدال `{{name}}`
5. Phase 7 → ترجمات + ربط الأزرار + تنظيف

### Suggested MVP Scope

**User Story 1 + 2 (P1)**: إرسال رسالة + صورة + شاشة تقدم احترافية — هذا هو الـ MVP الذي يغطي 90% من قيمة الميزة

---

## Notes

- [P] tasks = ملفات مختلفة، لا اعتماديات
- [Story] label يربط المهمة بقصة المستخدم للتتبّع
- كل قصة مستخدم يجب أن تكون قابلة للاختبار المستقل
- Commit بعد كل مهمة أو مجموعة منطقية
- توقف عند أي checkpoint للتحقق من القصة بشكل مستقل

**إجمالي المهام**: 27 مهمة
- Phase 1 (Setup): 2
- Phase 2 (Foundational): 8
- Phase 3 (US1 - P1): 3
- Phase 4 (US2 - P1): 4
- Phase 5 (US3 - P2): 3
- Phase 6 (US4 - P3): 2
- Phase 7 (Polish): 5