# Tasks: استخراج شامل لأعضاء الجروبات مع إثراء وفواصل زمنية

**Input**: Design documents from `/specs/007-group-members-full-extraction/`

**Prerequisites**: ✅ plan.md, ✅ spec.md, ✅ research.md, ✅ data-model.md, ✅ contracts/extraction-api.md, ✅ quickstart.md

**Tests**: الاختبار يدوي عبر سيناريوهات `quickstart.md`.

**Organization**: مهام مُقسّمة على مراحل. MVP = US1 فقط. **الميزة بسيطة** لأن 90% من البنية موجودة من 006.

## Format: `[ID] [P?] [Story] Description`

## Path Conventions

- Backend (Extraction): `extraction-service/src/`
- Frontend (React): `src/` — **لا تعديل مطلوب** (موجود من 006)

---

## Phase 1: Setup

**Purpose**: التحقق من جاهزية المشروع.

- [ ] T001 [P] التحقق من تشغيل extraction-service على port 3100
- [ ] T002 [P] التحقق من تشغيل Frontend على port 5173
- [ ] T003 [P] التحقق من توفر جلسة Facebook `connected` واحدة على الأقل
- [ ] T004 [P] التحقق من توفر Egypt DB في مجلد المشروع

---

## Phase 2: Foundational

**Purpose**: توسيع دالة قراءة العدد لتشمل "members".

**⚠️ CRITICAL**: يجب إكمالها قبل US1.

- [ ] T005 توسيع دالة `parseFollowersCount` في `extraction-service/src/extractors/base.ts` لتشمل patterns جديدة: "X members" (إنجليزي)، "X أعضاء" / "X عضو" (عربي) — إضافة 2-3 regex patterns للقائمة الموجودة

**Checkpoint**: الدالة تدعم قراءة عدد أعضاء الجروب — جاهزة للاستخدام في US1.

---

## Phase 3: User Story 1 - استخراج 50,000 عضو مع التتبع (Priority: P1) 🎯 MVP

**Goal**: استخراج حتى 50,000 عضو من جروب، مع قراءة العدد الإجمالي، وتحديث الـ progress، و`stop_reason`.

**Independent Test**: سيناريو 1 من `quickstart.md` — استخراج جروب، التحقق من ظهور العدد الإجمالي، تحديث الـ progress، وعدم التوقف المبكر.

### Implementation for User Story 1

- [ ] T006 [US1] إضافة instance fields لـ `GroupMembersExtractor` في `extraction-service/src/extractors/group-members.ts`: `totalFollowersCount: number | null`, `totalFollowersSource: string`, `lastStopReason: string | null`, `lastProgressTs: number`
- [ ] T007 [US1] إضافة helper methods لـ `GroupMembersExtractor` في `extraction-service/src/extractors/group-members.ts`:
  - `computeCoverage(discovered): number | null`
  - `persistMembersCount(count, source): Promise<void>` — يخزّن في `config.total_followers_count`
  - `storeExtractionProgress(discovered, phase, phaseCycle, stopReason?): Promise<void>` — throttle 10s
  - `finalizeStopReason(total): void`
- [ ] T008 [US1] استدعاء `parseFollowersCount(html)` في `extract()` بعد auth check (سطر ~40) لقراءة عدد الأعضاء وتخزينه في `this.totalFollowersCount`
- [ ] T009 [US1] استدعاء `persistMembersCount()` بعد قراءة العدد لتخزينه في `job.config`
- [ ] T010 [US1] إضافة `storeExtractionProgress(0, "navigating", 0)` عند بدء `extract()` (قبل `page.goto`)
- [ ] T011 [US1] إضافة `storeExtractionProgress(seen.size, "scrolling", 0)` قبل بدء الـ while loop
- [ ] T012 [US1] إضافة `storeExtractionProgress` دوري داخل الـ while loop (كل ~10 scrolls أو عند كل batch ناجح)
- [ ] T013 [US1] تعيين `this.lastStopReason = "no_secondary_session"` أو `"session_rate_limited"` في منطق `switchToNextSession` (سطر 75-91) عند الفشل النهائي
- [ ] T014 [US1] تعيين `this.lastStopReason = "source_exhausted"` عند `consecutiveEmpty >= 15` (سطر 93)
- [ ] T015 [US1] تعيين `this.lastStopReason = "max_results_reached"` عند `total >= this.ctx.maxResults`
- [ ] T016 [US1] استدعاء `finalizeStopReason(total)` و `storeExtractionProgress(total, "completed", 0, this.lastStopReason)` في النهاية قبل `return`

**Checkpoint**: ✅ MVP جاهز — استخراج 50k + قراءة العدد + تحديث الـ progress + stop_reason.

---

## Phase 4: User Story 2 - الإثراء التلقائي (Priority: P1)

**Goal**: تشغيل الإثراء من Egypt DB تلقائياً بعد اكتمال استخراج أعضاء الجروب.

**Independent Test**: سيناريو 2 من `quickstart.md` — إكمال استخراج، التحقق من ظهور أرقام هواتف.

### Implementation for User Story 2

- [ ] T017 [US2] التحقق من استدعاء `enrichmentService.enrichJobResults(jobId)` في `extraction-service/src/routes/extract.ts` بعد اكتمال كل مهمة استخراج (موجود من 005 — راجع السطور 133، 141، 150، 158)
- [ ] T018 [US2] التحقق من أن `enrichment-service.ts` يضع `phase: "enriching"` عند البدء و `phase: "completed"` عند الانتهاء (موجود من 006 — يعمل تلقائياً لـ group-members)
- [ ] T019 [US2] التحقق من أن النتائج تحتوي على `metadata.enrichment` للنتائج الموجودة في Egypt DB (موجود من 005)

**Checkpoint**: ✅ US2 جاهز — لا تعديل مطلوب (البنية موجودة).

---

## Phase 5: User Story 3 - الفواصل الزمنية لعدم ضغط الخادم (Priority: P1)

**Goal**: احترام rate limiting أثناء الاستخراج.

**Independent Test**: سيناريو 3 من `quickstart.md` — مراقبة الفواصل في logs.

### Implementation for User Story 3

- [ ] T020 [US3] التحقق من أن `BaseExtractor.requestDelayMs = 600` يُحترم بين كل scroll في `group-members.ts` (موجود — يستدعي `this.delay()`)
- [ ] T021 [US3] التحقق من أن `BaseExtractor.batchSizeForRest = 8` و `restDelayMs = 10_000` يُحترم (موجود — `restDelay()` عند `scrollAttempts % batchSizeForRest === 0`)
- [ ] T022 [US3] التحقق من أن `maxExecutionMs = 1_700_000` (~28 دقيقة) كافٍ لاستخراج 50,000 (لو احتاج أكثر، قد تتوقف المهمة عند `paused`)

**Checkpoint**: ✅ US3 جاهز — لا تعديل مطلوب (الفواصل موجودة في BaseExtractor).

---

## Phase 6: User Story 4 - ظهور المهمة في صفحة المهام (Priority: P1)

**Goal**: المهمة تظهر فوراً في صفحة Tasks مع تحديثات مباشرة.

**Independent Test**: سيناريو 4 من `quickstart.md` — ظهور المهمة خلال 5 ثوانٍ + شريط التغطية.

### Implementation for User Story 4

- [ ] T023 [US4] التحقق من أن `useExtractionJobs()` polling كل 3s للحالات النشطة (موجود من 006)
- [ ] T024 [US4] التحقق من أن `TasksPage.tsx` يعرض الـ phase لـ group-members تلقائياً (يستخدم `progress.phase` بدون تمييز type)
- [ ] T025 [US4] التحقق من أن شريط التغطية في `TasksPage.tsx` يعمل لـ group-members تلقائياً (يستخدم `config.total_followers_count` بدون تمييز type)
- [ ] T026 [US4] التحقق من زر "Stop" يستدعي `cancelMutation` (موجود من 006)

**Checkpoint**: ✅ US4 جاهز — لا تعديل مطلوب (UI موجود من 006 ويعمل لكل types).

---

## Phase 7: Polish & Cross-Cutting

**Purpose**: تحقق نهائي.

- [ ] T027 تشغيل `npm run typecheck` في `extraction-service/` والتأكد من نجاحه
- [ ] T028 تشغيل `npm run typecheck` في جذر المشروع (Frontend) والتأكد من نجاحه
- [ ] T029 التحقق من عدم وجود dead code أو unused imports في `group-members.ts` و `base.ts`
- [ ] T030 تنفيذ **سيناريو 1** من `quickstart.md` (استخراج جروب ~10,000 عضو) وتأكيد عدم التوقف المبكر
- [ ] T031 تنفيذ **سيناريو 3** من `quickstart.md` والتأكد من الفواصل الزمنية في logs
- [ ] T032 تنفيذ **سيناريو 5** من `quickstart.md` (جلستان) للتأكد من multi-session
- [ ] T033 تنفيذ **سيناريو 6** من `quickstart.md` للتأكد من رسالة `stop_reason`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: لا اعتمادات — تحقق فقط
- **Phase 2 (Foundational)**: يجب إكماله قبل US1 (يوفّر patterns "members")
- **Phase 3 (US1)**: يعتمد على Phase 2 — **MVP**
- **Phase 4 (US2)**: لا اعتمادات — البنية موجودة
- **Phase 5 (US3)**: لا اعتمادات — البنية موجودة
- **Phase 6 (US4)**: لا اعتمادات — البنية موجودة
- **Phase 7 (Polish)**: بعد كل user stories

### User Story Dependencies

- **US1 (P1)**: ← Phase 2 فقط — **مستقل**
- **US2 (P1)**: لا اعتماد على الكود — تحقق فقط (موجود من 005/006)
- **US3 (P1)**: لا اعتماد — تحقق فقط (موجود في BaseExtractor)
- **US4 (P1)**: لا اعتماد — تحقق فقط (موجود من 006)

### Parallel Opportunities

- Setup (T001-T004) — كلها [P]
- US2, US3, US4 يمكن تنفيذها بالتوازي (كلها تحقق فقط)
- T027 و T028 (typecheck) — [P]

---

## Parallel Example: Phase 2

```text
Task: T005 Expand parseFollowersCount patterns in extraction-service/src/extractors/base.ts
# US1 تبدأ بعد إكمال T005
```

---

## Implementation Strategy

### MVP First (User Story 1 فقط)

1. ✅ أكمل Phase 1 (Setup تحقق)
2. ✅ أكمل Phase 2 (T005 — توسيع parseFollowersCount)
3. ✅ أكمل Phase 3 (T006-T016 — group-members.ts updates)
4. **STOP و VALIDATE**: اختبر US1 مستقلاً (سيناريو 1)

### Incremental Delivery

1. Phase 1 + 2 → البنية جاهزة
2. + US1 → MVP! استخراج 50k + التتبع
3. + US2-US4 → التحقق فقط (موجود)

### تنفيذ مقترح (دفعة واحدة)

لأن الميزة بسيطة (تعديل ملفّين)، يمكن تنفيذها في **دفعة واحدة**:

| المهمة | الملف | المخرج |
|---|---|---|
| T005 | `base.ts` | patterns "members" |
| T006-T016 | `group-members.ts` | storeProgress + phase + stop_reason + قراءة العدد |

ثم typecheck + اختبار يدوي.

---

## Notes

- الميزة بسيطة جداً — تعديل ملفّين فقط
- Frontend لا يحتاج تعديل (موجود من 006)
- الفواصل الزمنية + الإثراء + صفحة المهام + multi-session = **كلها موجودة**
- MVP صالح للإنتاج بعد إكمال T005-T016
- الاختبار اليدوي عبر `quickstart.md` (7 سيناريوهات)
