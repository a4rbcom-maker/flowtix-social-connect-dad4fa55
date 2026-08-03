# Tasks: استخراج شامل لمتابعين الصفحات مع إثراء وتتبع مباشر

**Input**: Design documents from `/specs/006-page-followers-full-extraction/`

**Prerequisites**: ✅ plan.md, ✅ spec.md, ✅ research.md, ✅ data-model.md, ✅ contracts/extraction-api.md, ✅ quickstart.md

**Tests**: الاختبار يدوي عبر سيناريوهات `quickstart.md` — لا إطار اختبارات آلية في المشروع.

**Organization**: المهام مُقسّمة على مراحل، كل مرحلة = user story مستقلة قابلة للاختبار. MVP = US1 فقط.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: قابل للتشغيل المتوازي (ملفات مختلفة، لا اعتمادات)
- **[Story]**: US1, US2, US3, US4 (من spec.md)
- كل مهمة تتضمن مسار ملف دقيق

## Path Conventions

- Backend (Extraction): `extraction-service/src/`
- Frontend (React): `src/`
- i18n: `src/i18n/locales/`

---

## Phase 1: Setup (تم التحقق منه)

**Purpose**: المشروع موجود، فقط التأكد من الجاهزية.

- [ ] T001 [P] التحقق من تشغيل extraction-service على port 3100 (`cd extraction-service && npm run dev`)
- [ ] T002 [P] التحقق من تشغيل Frontend على port 5173 (`npm run dev`)
- [ ] T003 [P] التحقق من توفر جلسة Facebook واحدة `connected` على الأقل في صفحة Sessions
- [ ] T004 [P] التحقق من توفر Egypt DB (`egypt.db`) في مجلد المشروع

---

## Phase 2: Foundational (متطلبات أساسية مشتركة)

**Purpose**: قراءة العدد الإجمالي للمتابعين — مطلوب لكل user stories (حساب نسبة التغطية).

**⚠️ CRITICAL**: لا يمكن بدء أي user story قبل إكمال هذه المرحلة.

- [ ] T005 إضافة دالة `parseFollowersCount(html: string): { count: number | null; source: string }` في `extraction-service/src/extractors/base.ts` — تستخرج العدد الإجمالي من DOM (دعم "1.2K", "247", "12,345", نصوص عربية/إنجليزية)
- [ ] T006 إضافة دالة `readPageFollowersCount(page: Page): Promise<{ count: number | null; source: string }>` في `extraction-service/src/extractors/page-followers.ts` — تفتح الصفحة وتستدعي `parseFollowersCount` على الـ HTML
- [ ] T007 توسعة `ExtractionJobConfig` في `src/lib/extraction/types.ts` بإضافة `total_followers_count?: number` و `total_followers_source?: string`
- [ ] T008 توسعة `ExtractionJobProgress` في `src/lib/extraction/types.ts` بإضافة `coverage_rate?: number` و `stop_reason?: StopReason | null` وتعريف نوع `StopReason`

**Checkpoint**: البنية الأساسية جاهزة — يمكن بدء user stories.

---

## Phase 3: User Story 1 - استخراج 85%+ من متابعين الصفحة (Priority: P1) 🎯 MVP

**Goal**: استخراج ≥ 85% من متابعين صفحة Facebook عبر multi-session و phase2 XHR replay.

**Independent Test**: تنفيذ سيناريو 1 من `quickstart.md` — استخراج صفحة بـ 247 متابع، التحقق من بلوغ ≥ 85% (≈210).

### Implementation for User Story 1

- [ ] T009 [US1] استدعاء `readPageFollowersCount(page)` في `extraction-service/src/extractors/page-followers.ts` أثناء المرحلة الأولى (قبل/أثناء بدء الاستخراج) وتخزين النتيجة في سياق المهمة
- [ ] T010 [US1] تعديل `extraction-service/src/routes/extract.ts` في `runExtractionJob` لتخزين `total_followers_count` و `total_followers_source` في `extraction_jobs.config` عبر `supabaseService.updateJob`
- [ ] T011 [US1] إضافة استدعاء `supabaseService.storeProgress(jobId, { ..., phase: "navigating" })` عند بدء `page-followers.ts` (استبدال/تكامل مع الـ logs الحالية)
- [ ] T012 [US1] إضافة `phase: "scrolling"` ثم `phase: "xhr_replay"` في `page-followers.ts` عبر `storeProgress` عند انتقال المرحلة (سطر ~27 phase1، سطر ~174 phase2)
- [ ] T013 [US1] إضافة تحديث `storeProgress` كل 10 صفحات في `phase2XHRReplay` (نفس نمط `lastLogPage >= 10` الموجود في سطر 327) لإبقاء الـ progress منعشاً
- [ ] T014 [US1] التحقق من استمرار عمل `switchToNextSession()` في `page-followers.ts` (سطر 269، 292) — لا تعديل، فقط اختبار فعلي على صفحة كبيرة
- [ ] T015 [US1] إضافة منطق `stop_reason` في نهاية `page-followers.ts`: تحديد القيمة المناسبة عند `coverage_rate < 85%` بناءً على شرط التوقف (راجع جدول `stop_reason` في `data-model.md`)
- [ ] T016 [US1] تخزين `stop_reason` النهائي في `progress` عبر `supabaseService.storeProgress` عند اكتمال المهمة

**Checkpoint**: ✅ MVP جاهز — استخراج 85%+ يعمل + العدد الإجمالي محفوظ + progress يتحدث.

---

## Phase 4: User Story 2 - الإثراء التلقائي بعد الاستخراج (Priority: P1)

**Goal**: تشغيل الإثراء من Egypt DB تلقائياً بعد اكتمال استخراج متابعي الصفحة.

**Independent Test**: تنفيذ سيناريو 2 من `quickstart.md` — إكمال استخراج، التحقق من ظهور أرقام هواتف في النتائج.

### Implementation for User Story 2

- [ ] T017 [US2] التحقق من استدعاء `enrichmentService.enrichJobResults(jobId)` في `extraction-service/src/routes/extract.ts` بعد اكتمال كل مهمة استخراج (متوقع موجود من ميزة 005 — راجع `runExtractionJob` في الـ `finally` أو بعد الـ extract)
- [ ] T018 [US2] إضافة `phase: "enriching"` في `extraction-service/src/services/enrichment-service.ts` عند بدء الإثراء عبر `storeProgress`
- [ ] T019 [US2] إضافة `phase: "completed"` في `extraction-service/src/routes/extract.ts` عند اكتمال المهمة بعد الإثراء
- [ ] T020 [US2] التحقق من أن النتائج تحتوي على `metadata.enrichment` (Phone, first_name, ...) للنتائج المُثراة من Egypt DB (راجع `data-model.md`)

**Checkpoint**: ✅ US2 جاهز — الإثراء تلقائي + الـ phase يظهر التقدم.

---

## Phase 5: User Story 3 - ظهور المهمة في صفحة المهام (Priority: P1)

**Goal**: المهمة تظهر فوراً في صفحة Tasks مع تحديثات مباشرة للعدد والمرحلة.

**Independent Test**: تنفيذ سيناريو 3 من `quickstart.md` — بدء مهمة، فتح Tasks خلال 5 ثوانٍ، التحقق من الظهور والتحديث.

### Implementation for User Story 3

- [ ] T021 [US3] التحقق من `useExtractionJobs()` في `src/hooks/useExtractionJobs.ts` يعيد المهمة الجديدة فوراً (invalidateQueries موجود في `useStartExtraction.onSuccess` — راجع)
- [ ] T022 [US3] التحقق من `useExtractionJob(jobId)` في `src/hooks/useExtractionJobs.ts` يعمل `refetchInterval: 3000` للحالات `running`/`queued` (موجود سطر 28-31)
- [ ] T023 [US3] تعديل `src/components/extraction/ExtractionJobCard.tsx` (أو إنشائه إن لم يوجد) لعرض:
  - `phase` الحالية مترجمة (`t(\`phase_${job.progress?.phase}\`)`)
  - `discovered` و `processed`
  - حالة "running" مع spinner بصري
- [ ] T024 [US3] التحقق من أن `src/pages/dashboard/TasksPage.tsx` يستخدم `useExtractionJobs` ويعرض `ExtractionJobCard` لكل مهمة، مُرتّبة `created_at DESC`
- [ ] T025 [US3] التحقق من زر "Cancel" في `ExtractionJobCard` يستدعي `useCancelExtraction().mutate(jobId)` ويوقف المهمة فعلياً
- [ ] T026 [US3] التحقق من حفظ النتائج partial عند الإيقاف (incremental save عبر `processBatch`)

**Checkpoint**: ✅ US3 جاهز — المهمة ظاهرة + تُحدَّث + قابلة للإيقاف.

---

## Phase 6: User Story 4 - عرض نسبة التغطية ورسالة السبب (Priority: P2)

**Goal**: عرض `total_followers_count`, `coverage_rate`, و `stop_reason` في `ExtractionJobCard`.

**Independent Test**: تنفيذ سيناريوهات 4 و 6 من `quickstart.md` — التحقق من ظهور النسبة، شريط التقدّم الملوّن، ورسالة السبب.

### Implementation for User Story 4

- [ ] T027 [US4] تعديل `src/components/extraction/ExtractionJobCard.tsx` لحساب `coverage_rate = discovered / total_followers_count * 100` (أو null إذا `total = 0`)
- [ ] T028 [US4] إضافة شريط تقدّم ملوّن في `ExtractionJobCard`:
  - 🟢 أخضر إذا `coverage_rate >= 85`
  - 🟡 أصفر إذا `65 <= coverage_rate < 85`
  - 🔴 أحمر إذا `coverage_rate < 65`
  - استخدام design tokens من `src/index.css` (`var(--color-*)`)
- [ ] T029 [US4] إضافة عرض `total_followers_count` بجانب `discovered` في `ExtractionJobCard` (مثال: "150 / 247 متابع")
- [ ] T030 [US4] إضافة عرض رسالة `stop_reason` في `ExtractionJobCard` عند `coverage_rate < 85%` مترجمة (`t(\`stop_reason_${reason}\`)`) مع اقتراح إجراء
- [ ] T031 [US4] التحقق من عرض "غير معروف" بدل النسبة عندما `total_followers_count` غير متوفر

**Checkpoint**: ✅ US4 جاهز — نسبة التغطية ظاهرة + شريط ملوّن + رسالة سبب.

---

## Phase 7: Polish & Cross-Cutting

**Purpose**: ترجمات، فحص نهائي، تحقق شامل.

- [ ] T032 [P] إضافة مفاتيح الترجمة في `src/i18n/locales/ar.json`:
  - `phase_navigating`, `phase_scrolling`, `phase_xhr_replay`, `phase_enriching`, `phase_completed`
  - `stop_reason_session_rate_limited`, `stop_reason_no_secondary_session`, `stop_reason_source_exhausted`, `stop_reason_max_results_reached`
  - `coverage_rate_label`, `total_followers_label`, `coverage_unknown`
- [ ] T033 [P] إضافة نفس المفاتيح في `src/i18n/locales/en.json` (ترجمة إنجليزية)
- [ ] T034 تشغيل `npm run typecheck` في `extraction-service/` والتأكد من نجاحه بدون أخطاء
- [ ] T035 تشغيل `npm run typecheck` في جذر المشروع (Frontend) والتأكد من نجاحه
- [ ] T036 التحقق من عدم وجود `any` في الكود الجديد (استخدام `StopReason` type explicitly)
- [ ] T037 التحقق من عدم وجود dead code أو unused imports
- [ ] T038 تنفيذ **سيناريو 1** من `quickstart.md` (صفحة بـ ~247 متابع) وتأكيد بلوغ ≥ 85%
- [ ] T039 تنفيذ **سيناريو 3** من `quickstart.md` والتأكد من ظهور المهمة في Tasks خلال 5 ثوانٍ
- [ ] T040 تنفيذ **سيناريو 5** من `quickstart.md` (جلستان + صفحة كبيرة) للتأكد من multi-session
- [ ] T041 تنفيذ **سيناريو 6** من `quickstart.md` للتأكد من رسالة `stop_reason` عند `coverage < 85%`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: لا اعتمادات — تحقق فقط
- **Phase 2 (Foundational)**: يجب إكماله قبل أي user story (يوفّر `parseFollowersCount` + types)
- **Phase 3 (US1)**: يعتمد على Phase 2 — **MVP**
- **Phase 4 (US2)**: يعتمد على Phase 2 — يمكن تشغيله بالتوازي مع US1
- **Phase 5 (US3)**: يعتمد على Phase 2 (يحتاج `phase` field) — ينصح بعده US1 (لأن phase قيمه من US1)
- **Phase 6 (US4)**: يعتمد على US1 (يحتاج `total_followers_count` + `stop_reason`)
- **Phase 7 (Polish)**: بعد كل user stories

### User Story Dependencies

- **US1 (P1)**: ← Phase 2 فقط — **مستقل**
- **US2 (P1)**: ← Phase 2 فقط — مستقل (يمكن بالتوازي مع US1)
- **US3 (P1)**: ← Phase 2 + يفضّل بعد US1 (ليظهر قيم `phase` حقيقية)
- **US4 (P2)**: ← US1 (يحتاج `total_followers_count` و `stop_reason`)

### Within Each User Story

- Models/Types قبل Services
- Services قبل UI
- Backend قبل Frontend
- التحقق بعد كل مهمة (typecheck)

### Parallel Opportunities

- T001, T002, T003, T004 (Setup) — كلها [P]
- T005 و T007 و T008 (Foundational) — [P] (ملفات مختلفة)
- T032 و T033 (Polish) — [P]
- US1 و US2 يمكن تشغيلهما بالتوازي بعد Phase 2

---

## Parallel Example: Phase 2 (Foundational)

```text
Task: T005 parseFollowersCount in extraction-service/src/extractors/base.ts
Task: T007 ExtractionJobConfig in src/lib/extraction/types.ts
Task: T008 ExtractionJobProgress in src/lib/extraction/types.ts
# ثم تسلسلياً:
Task: T006 readPageFollowersCount depends on T005
```

---

## Implementation Strategy

### MVP First (User Story 1 فقط)

1. ✅ أكمل Phase 1 (Setup تحقق)
2. ✅ أكمل Phase 2 (Foundational)
3. ✅ أكمل Phase 3 (US1 — استخراج 85%+)
4. **STOP و VALIDATE**: اختبر US1 مستقلاً (سيناريو 1)
5. عرض/تجريب إن جاهز

### Incremental Delivery

1. Phase 1 + 2 → البنية جاهزة
2. + US1 → MVP! اختبر → تجريب
3. + US2 → الإثراء تلقائي → اختبر → تجريب
4. + US3 → صفحة المهام حية → اختبر → تجريب
5. + US4 → نسبة التغطية ورسالة السبب → اختبر → تجريب
6. Phase 7 (Polish) → التحقق النهائي

### تنفيذ مقترح (نظراً لطلب المستخدم "على مراحل")

ينصح بالتنفيذ على 4 مراحل منفصلة:

| المرحلة | المهام | المخرج |
|---|---|---|
| **دفعة 1** | T001–T016 | MVP: US1 يعمل (استخراج 85%+ + العدد الإجمالي) |
| **دفعة 2** | T017–T020 | US2: الإثراء تلقائي |
| **دفعة 3** | T021–T026 | US3: صفحة المهام حية |
| **دفعة 4** | T027–T041 | US4 + Polish: نسبة التغطية والترجمة |

كل دفعة قابلة للاختبار مستقلاً قبل الانتقال للتالية.

---

## Notes

- لا إطار اختبارات آلية — الاختبار يدوي عبر `quickstart.md`
- كل مهمة محددة بمسار ملف — جاهزة لـ LLM ينفّذها بدون سياق إضافي
- الالتزام بـ AGENTS.md: تقليل التعديلات، احترام البنية الموجودة، RTL، ترجمات
- لا إضافة comments إلا للـ business logic الحرج
- توقّع أخطاء قراءة العدد الإجمالي على بعض الصفحات (Facebook يُغيّر واجهته) — عالجها بلطف عبر `source: "unknown"`
- MVP صالح للإنتاج بعد الدفعة الأولى
