# Tasks: Extraction Task Controls

**Input**: Design documents from `/specs/003-extraction-task-controls/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/extraction-api.md, quickstart.md

**Tests**: لا توجد اختبارات آلية — التحقق يدوي عبر quickstart.md

**Organization**: المهام مجمّعة حسب user story لتمكين التنفيذ والاختبار المستقل

## Format: `[ID] [P?] [Story] Description`

- **[P]**: يمكن تنفيذه بالتوازي (ملفات مختلفة، لا تبعيات)
- **[Story]**: أي user story تنتمي لها المهمة (US1, US2, US3, US4)
- جميع المسارات مذكورة في أوصاف المهام

---

## Phase 1: Setup

**الغرض**: التأكد من سلامة baseline قبل التعديلات

- [ ] T001 التأكد من نجاح `npx tsc --noEmit` و `npx vite build` قبل أي تعديلات (baseline verification)
- [ ] T002 [P] التأكد من تشغيل extraction-service على `http://localhost:3100/health`

---

## Phase 2: User Story 1 — Stop & Keep Data (Priority: P1) 🎯 MVP

**الهدف**: إعادة تسمية "Cancel" إلى "Stop" + منع overwrite الحالة + قسم "Stopped" منفصل

**اختبار مستقل**: شغّل استخراج، اضغط "إيقاف"، تحقق أن المهمة تظهر في قسم "موقوفة" مع البيانات محفوظة

### Implementation for User Story 1

#### Backend: منع status overwrite

- [ ] T003 [US1] إصلاح route handler في `extraction-service/src/routes/extract.ts` — قبل كتابة `status: "completed"` عند `result.done` (السطر 102)، أضف فحص: اقرأ الحالة الحالية من DB عبر `supabaseService.getJobStatus(jobId)`، إذا كانت `"canceled"` احتفظ بها واكتفي بتحديث `completed_at` فقط. المرجع: `contracts/extraction-api.md` قسم "Job Status Transitions"

#### Frontend: زر Stop + قسم Stopped

- [ ] T004 [P] [US1] إضافة مفاتيح i18n الجديدة في `src/i18n/locales/ar.json`: `pages.tasks.stop` = `"إيقاف"`, `pages.tasks.status.canceled` = `"موقوفة"` (بدل `"ملغاة"`), `pages.tasks.stopConfirm` = `"هل تريد إيقاف هذه المهمة؟ سيتم حفظ البيانات المستخرجة."`, `pages.tasks.stopDone` = `"تم إيقاف المهمة"`
- [ ] T005 [P] [US1] إضافة مفاتيح i18n الجديدة في `src/i18n/locales/en.json`: `pages.tasks.stop` = `"Stop"`, `pages.tasks.status.canceled` = `"Stopped"` (بدل `"Canceled"`), `pages.tasks.stopConfirm` = `"Stop this task? Extracted data will be saved."`, `pages.tasks.stopDone` = `"Task stopped"`
- [ ] T006 [US1] تعديل `src/pages/dashboard/TasksPage.tsx`:
  - السطر 116: تغيير `failedJobs` filter لإزالة `"canceled"` — تصبح `j.status === "failed"` فقط
  - إضافة `stoppedJobs = realJobs.filter(j => j.status === "canceled")`
  - إضافة filter tab "stopped" مع label `t("pages.tasks.stopped")` وقيمته `"stopped"`
  - تحديث `filteredJobs` (السطر 119-129) لإضافة `else if (filter === "stopped") jobs = stoppedJobs`
  - السطر 213-215: تغيير `CircleX` إلى `Square` (from lucide-react)، تغيير `t("pages.tasks.cancel")` إلى `t("pages.tasks.stop")`
  - تحديث `statusConfig` لإضافة `"canceled"` بلون amber/warning مميز عن `"failed"` (red)
  - تحديث `handleCancel` (السطر 131) rename إلى `handleStop` مع تحديث رسالة toast إلى `t("pages.tasks.stopDone")`
  - تحديث cancel dialog confirmation text إلى `t("pages.tasks.stopConfirm")`
- [ ] T007 [P] [US1] إعادة تسمية `cancelJob` إلى `stopJob` في `src/lib/extraction/extraction-repository.ts` (السطر 56-62) مع تحديث جميع المراجع في `src/hooks/useExtractionJobs.ts`

**Checkpoint**: زر "إيقاف" يظهر، المهمة الموقفة تظهر في قسم "موقوفة"، الحالة `"canceled"` لا تُكتب فوقها `"completed"`

---

## Phase 3: User Story 2 — Remove Limit & Natural Completion (Priority: P2)

**الهدف**: حذف محدد عدد النتائج من الواجهة + جعل الاستخراج يكتمل بـ `"completed"` بدل `"paused"`

**اختبار مستقل**: ابدأ استخراج، تحقق من عدم وجود محدد عدد، اتركه حتى نهاية المصدر، تحقق أن الحالة `"completed"`

### Implementation for User Story 2

#### Backend: إكمال طبيعي بدل paused

- [ ] T008 [US2] تعديل `extraction-service/src/extractors/group-members.ts`:
  - بعد السطر 164 (خروج الـ while loop)، أضف فحص: إذا خرج اللوب بسبب `total >= this.ctx.maxResults` (وليس بسبب `shouldStop` أو `done`)، اضبط `done = true` و `nextCursor = undefined`
  - هذا يضمن أن بلوغ safety ceiling يُعطي `completed` (عبر branch السطر 102 في extract.ts) بدل `paused`
- [ ] T009 [P] [US2] تطبيق نفس الإصلاح على باقي الـ extractors: `extraction-service/src/extractors/page-followers.ts`, `post-comments.ts`, `post-reactions.ts` — أضف `done = true; nextCursor = undefined` عند بلوغ `maxResults`
- [ ] T010 [US2] تعديل `extraction-service/src/routes/extract.ts` السطر 21: تغيير default من `10000` إلى `100000` (`max_results: z.number().int().min(1).max(100000).default(100000)`)

#### Frontend: حذف محدد العدد

- [ ] T011 [P] [US2] حذف محدد العدد من `src/pages/dashboard/extraction/ExtractContactsPage.tsx`: إزالة `useState("10000")` (السطر 43)، إزالة عنصر الـ UI (السطر ~418)، استخدام `100000` كقيمة ثابتة في `max_results` (السطر 92, 120)، تعديل حساب الـ progress (السطر 179) لإظهار العدد المطلق بدل النسبة المئوية
- [ ] T012 [P] [US2] حذف محدد العدد من `src/pages/dashboard/extraction/ExtractMembersPage.tsx`: إزالة `useState("10000")` (السطر 57)، إزالة `<Select>` (السطر 244)، استخدام `100000` في `max_results` (السطر 130)، تعديل حساب الـ progress (السطر 265)
- [ ] T013 [P] [US2] حذف حقل `maxResults` من `src/pages/dashboard/extraction/config.ts` (السطر 95, 115) ومن `ExtractionFormPage.tsx` (السطر 109, 196-197)
- [ ] T014 [P] [US2] تحديث `src/lib/extraction/extraction-repository.ts` السطر 74: تغيير `input.max_results ?? 10000` إلى ثابت `100000`

**Checkpoint**: لا يوجد محدد عدد في UI، الاستخراج يكتمل بـ `"completed"` عند نفاد المصدر

---

## Phase 4: User Story 3 — Data Quality (Priority: P3)

**الهدف**: ضمان جودة بيانات استخراج الجروبات — صفر تكرارات، صفر صفحات/bots، أعضاء حقيقيون فقط

**اختبار مستقل**: استخرج من جروب، صدّر CSV، تحقق من عدم تكرارات وأسماء حقيقية

### Implementation for User Story 3

- [ ] T015 [US3] إضافة دالة `isValidMemberName` في `extraction-service/src/extractors/group-members.ts` (قبل الكلاس): تفلتر الأسماء حسب القواعد في `data-model.md` قسم "Group Member Name Filtering":
  - Auto-generated patterns: `/^(Adventurous|Playful|Shiny|Brave|Clever|Happy|Jolly|Mysterious|Silly|Friendly)\w+\d+/i`
  - User+digits: `/^User\d{3,}$/i`
  - Business keywords: name.includes("store"|"shop"|"news"|"restaurant"|"cafe"|"school"|"university"|"bot") — case-insensitive
  - Short names: `name.length < 3`
  - WhatsApp placeholder: `name === "WA Not Available"`
- [ ] T016 [US3] دمج `isValidMemberName` في حلقة الاستخراج بـ `group-members.ts` السطر 136-141: قبل `seen.add(m.id)`، أضف `if (!isValidMemberName(m.name)) continue` — مع عدّاد `excludedCount` للـ logging
- [ ] T017 [US3] إضافة quality summary log في نهاية `extract()` في `group-members.ts` (قبل return السطر 172): `log.info("GroupMembers", "quality summary", { total, seen: seen.size, excludedByFilter: excludedCount })`

**Checkpoint**: النتائج المستخرجة لا تحتوي على تكرارات أو أسماء صفحات/bots

---

## Phase 5: User Story 4 — Adaptive Rate-Limiting (Priority: P4)

**الهدف**: إضافة adaptive backoff عند تلقي إشارات rate-limit من Facebook

**اختبار مستقل**: شغّل استخراج كبير (5000+)، تحقق من عدم ظهور captcha/block، راجع logs للتأخيرات

### Implementation for User Story 4

- [ ] T018 [US4] إضافة خصائص rate-limiting في `extraction-service/src/extractors/base.ts` (بعد السطر 206):
  - `protected backoffDelayMs = 2000` — التأخير عند backoff
  - `protected backoffScrolls = 0` — عدّاد scrolls المتبقية في وضع backoff
  - `protected rateLimitHits = 0` — عدد مرات تلقي إشارات rate-limit
  - `protected maxRateLimitRetries = 3` — الحد الأقصى قبل pause
- [ ] T019 [US4] إضافة دالة `detectRateLimit` في `base.ts`: تستقبل `memberCount: number` (عدد الأعضاء الجدد في الـ scroll الحالي)، تُعيد `boolean`:
  - `true` إذا كان `memberCount === 0` وكان الـ scroll الساسي به أعضاء (تحول مفاجئ من نتائج إلى فراغ)
  - `true` إذا اكتُشف captcha/block في الـ HTML (عبر `page.content().includes("captcha")` أو `includes("temporarily blocked")`)
  - تحديث `backoffScrolls = 5` و `rateLimitHits++` عند الكشف
  - إذا `rateLimitHits >= maxRateLimitRetries`: إرجاع الاستخراع مع `done: false` + `nextCursor` (ليُحفظ كـ paused)
- [ ] T020 [US4] إضافة override لـ `delay()` في `base.ts`: إذا `backoffScrolls > 0`، استخدم `backoffDelayMs` بدل `requestDelayMs`، وقلّل `backoffScrolls--`. سجل log عند تفعيل/إلغاء backoff
- [ ] T021 [US4] دمج `detectRateLimit` في حلقة `group-members.ts` (بعد السطر 142، بعد حساب `newCount`):
  - استدعاء `if (await this.detectRateLimit(newCount))` مع معالجة النتيجة
  - تمرير `newCount` للكشف

**Checkpoint**: الاستخراج يبطئ تلقائياً عند تلقي إشارات rate-limit، ويتوقف كـ paused بعد 3 محاولات فاشلة

---

## Phase 6: Polish & Cross-Cutting Concerns

**الغرض**: تحسينات شاملة والتأكد من السلامة

- [ ] T022 تشغيل `npx tsc --noEmit` والتأكد من عدم وجود أخطاء types
- [ ] T023 تشغيل `npx vite build` والتأكد من نجاح البناء
- [ ] T024 [P] التحقق من عدم وجود مراجع متبقية لـ `cancelJob` أو `handleCancel` أو `maxResults` في الـ frontend
- [ ] T025 [P] إزالة أي dead code ناتج عن التعديلات (imports غير مستخدمة، متغيرات مهجورة)
- [ ] T026 تنفيذ سيناريوهات التحقق من `quickstart.md`:
  - Scenario 1: Stop and Keep Data
  - Scenario 2: Natural Completion
  - Scenario 3: Data Quality
  - Scenario 5: Stopped Job Visibility

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: لا تبعيات — ابدأ فوراً
- **Phase 2 (US1)**: يعتمد على Phase 1 فقط
- **Phase 3 (US2)**: يعتمد على Phase 1 فقط — مستقل عن US1
- **Phase 4 (US3)**: يعتمد على Phase 1 فقط — مستقل عن US1 و US2
- **Phase 5 (US4)**: يعتمد على Phase 1 فقط — مستقل عن باقي الـ stories
- **Phase 6 (Polish)**: يعتمد على اكتمال جميع الـ stories المطلوبة

### User Story Dependencies

- **US1 (Stop & Keep Data)**: لا تبعيات على stories أخرى — يمكن تنفيذها أولاً
- **US2 (Remove Limit)**: لا تبعيات على stories أخرى — يمكن تنفيذها بالتوازي مع US1
- **US3 (Data Quality)**: لا تبعيات على stories أخرى — يمكن تنفيذها بالتوازي
- **US4 (Rate-Limiting)**: لا تبعيات على stories أخرى — يمكن تنفيذها بالتوازي

### Within Each User Story

- Backend قبل Frontend (حيث ينطبق)
- i18n keys قبل استخدامها في المكونات
- Core logic قبل UI changes

### Parallel Opportunities

- T004 + T005 (ar.json + en.json) — ملفات مختلفة [P]
- T011 + T012 + T013 + T014 — ملفات frontend مختلفة [P]
- T008 + T009 — extractors مختلفة [P]
- US1 و US2 و US3 و US4 — مستقلة تماماً، يمكن تنفيذها بالتوازي

---

## Parallel Example: User Story 2

```text
# Frontend changes can all run in parallel (different files):
Task T011: Remove max_results from ExtractContactsPage.tsx
Task T012: Remove max_results from ExtractMembersPage.tsx
Task T013: Remove maxResults from config.ts + ExtractionFormPage.tsx
Task T014: Update extraction-repository.ts default

# Backend changes:
Task T008: Fix group-members.ts completion logic
Task T009: Fix other extractors (parallel — different files)
Task T010: Update extract.ts default max_results
```

---

## Implementation Strategy

### MVP First (US1 فقط)

1. Phase 1: Setup — baseline verification
2. Phase 2: US1 — Stop button + Status fix + Stopped section
3. **تحقق**: شغّل استخراج، اضغط "إيقاف"، أكد أن البيانات محفوظة والمهمة في قسم "موقوفة"
4. جاهز للاستخدام

### Incremental Delivery

1. Setup → baseline جاهز
2. US1 → إيقاف يعمل بشكل صحيح → تحقق → Deploy
3. US2 → لا محدد عدد + إكمال طبيعي → تحقق → Deploy
4. US3 → جودة بيانات نظيفة → تحقق → Deploy
5. US4 → rate-limiting adaptive → تحقق → Deploy

---

## Notes

- جميع المهام تعمل على ملفات موجودة — لا إنشاء ملفات جديدة
- [P] = ملفات مختلفة، لا تبعيات على مهام غير مكتملة
- كل user story مستقلة وقابلة للاختبار منفرداً
- المرجع للتفاصيل التقنية: `research.md` + `contracts/extraction-api.md` + `data-model.md`
- المرجع لسيناريوهات التحقق: `quickstart.md`
