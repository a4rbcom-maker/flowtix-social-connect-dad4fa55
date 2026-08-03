# Tasks: إثراء بيانات المستخدمين المستخرجة من قاعدة بيانات خارجية

**Input**: Design documents from `/specs/005-data-enrichment/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/enrichment-api.md, quickstart.md

**Tests**: غير مطلوبة (لا يوجد إطار اختبار)

**Organization**: المهام منظّمة حسب قصص المستخدم لتمكين التنفيذ والاختبار المستقلين.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: يمكن تنفيذها بالتوازي (ملفات مختلفة، لا اعتماديات)
- **[Story]**: أي قصة مستخدم تنتمي لها (US1, US2, US3, US4)
- المسارات الدقيقة للملفات مرفقة في كل مهمة

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: تهيئة الاعتماديات والمجلدات

- [ ] T001 تثبيت `better-sqlite3` في `extraction-service/package.json` عبر `npm install better-sqlite3`
- [ ] T002 [P] إنشاء مجلد `extraction-service/db/` ونسخ ملفات `.db` (egypt.db, Iraq.db) إليه
- [ ] T003 [P] إضافة متغيرات البيئة في `extraction-service/src/config.ts`: `ENRICHMENT_DB_PATH` (default: `./db`), `ENRICHMENT_ENABLED` (default: `true`), `ENRICHMENT_BATCH_SIZE` (default: `500`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: بناء خدمة الإثراء الأساسية — جميع قصص المستخدم تعتمد عليها

**⚠️ CRITICAL**: لا يمكن بدء أي قصة مستخدم قبل اكتمال هذه المرحلة

- [ ] T004 إنشاء `enrichment-service.ts` — خدمة الإثراء الأساسية في `extraction-service/src/services/enrichment-service.ts`:
  - `scanDatabases()`: مسح مجلد `ENRICHMENT_DB_PATH` وإرجاع قائمة ملفات `.db` المتاحة
  - `openDatabase(dbPath)`: فتح اتصال SQLite readonly بـ `better-sqlite3`
  - `searchBatch(db, fbIds[])`: `SELECT FBID, Phone, first_name, last_name, email, gender, hometown, location, work FROM data WHERE FBID IN (...)` — تنظيف BOM prefix تلقائياً
  - `enrichJobResults(jobId)`: دالة رئيسية — جلب fb_ids من `extraction_results`، تقسيم دفعات، بحث في كل DB، تحديث `metadata`
  - معالجة الأخطاء: try/catch لكل دفعة، fallback لـ batch أصغر عند فشل الدفعة
  - تسجيل logs: `[Enrichment]` لكل خطوة
- [ ] T005 إضافة `updateResultMetadata` في `extraction-service/src/services/supabase.ts`:
  - دالة `updateResultMetadata(jobId: string, resultId: string, metadata: Record<string, unknown>)`: تحديث `metadata` لسجل واحد في `extraction_results`
  - دالة `updateResultMetadataBatch(jobId: string, updates: { id: string, metadata: Record<string, unknown> }[])`: تحديث دفعة (batch update) عبر Promise.all
- [ ] T006 إضافة `getJobResultsForEnrichment` في `extraction-service/src/services/supabase.ts`:
  - دالة `getJobResultsForEnrichment(jobId: string)`: جلب `id, fb_id, data` من `extraction_results` حيث `job_id = jobId` و `fb_id IS NOT NULL`

**Checkpoint**: خدمة الإثراء جاهزة — يمكن استدعاؤها يدوياً من أي مكان

---

## Phase 3: User Story 1 - إثراء تلقائي بعد الاستخراج (Priority: P1) 🎯 MVP

**Goal**: بعد أي عملية استخراج، يُنفّذ الإثراء تلقائياً ويرفق بيانات الهاتف والاسم والجنس والموقع لكل مستخدم موجود في قاعدة البيانات

**Independent Test**: بدء استخراج، انتظار اكتماله، التحقق من `extraction_results.metadata` يحتوي `enrichment` للمستخدمين المطابقين

### Implementation for User Story 1

- [ ] T007 [US1] استدعاء `enrichmentService.enrichJobResults(jobId)` في `extraction-service/src/routes/extract.ts` — بعد كتابة status `completed` في `runExtractionJob` (السطر ~95)، استدعاء الإثراء بشكل async (لا يؤثر على الـ response)
- [ ] T008 [US1] تحديث `extraction_jobs.progress` بعد الإثراء في `enrichment-service.ts`: حفظ `{ enrichment: { total, enriched, not_found, coverage_percent, sources } }` في `extraction_jobs.progress`
- [ ] T009 [US1] معالجة `msg_` prefix من `fb_id` في `enrichment-service.ts` عند مصدره من `messenger_contacts`: `fb_id.startsWith('msg_') ? fb_id.slice(4) : fb_id`

**Checkpoint**: US1 مكتمل — الإثراء يعمل تلقائياً بعد كل استخراج

---

## Phase 4: User Story 2 - عرض نسبة التغطية (Priority: P2)

**Goal**: بعد الإثراء، يرى المستخدم في الواجهة ملخّص يوضح عدد المستخدمين المُثراة مقابل الإجمالي

**Independent Test**: إكمال استخراج + إثراء، التحقق من ظهور نسبة التغطية في صفحة المهمة

### Implementation for User Story 2

- [ ] T010 [US2] عرض نسبة التغطية في `src/pages/dashboard/TasksPage.tsx` — في قسم تفاصيل المهمة (بجانب `result_count`)، إذا كان `progress.enrichment` موجوداً، عرض: "60 مُثراة من أصل 100 (60%)" مع أيقونة
- [ ] T011 [P] [US2] إضافة ترجمات i18n في `src/i18n/locales/ar.json` و `src/i18n/locales/en.json`:
  - مفاتيح: `enrichment.coverage`, `enrichment.enriched`, `enrichment.notFound`, `enrichment.sources`

**Checkpoint**: US2 مكتمل — المستخدم يرى نسبة التغطية بعد الإثراء

---

## Phase 5: User Story 3 - تصدير البيانات المُثراة (Priority: P2)

**Goal**: تصدير CSV/JSON يشمل أعمدة الإثراء (Phone, first_name, last_name, gender...) عند وجودها

**Independent Test**: تصدير CSV/JSON بعد إثراء، التحقق من وجود أعمدة الإثراء للمستخدمين المطابقين

### Implementation for User Story 3

- [ ] T012 [US3] توسيع `GET /export` (أو POST) في `extraction-service/src/routes/extract.ts` — في قسم CSV و JSON:
  - CSV: إضافة أعمدة `phone, first_name, last_name, gender, hometown, location, work, email` بعد `avatar_url` — قراءة من `metadata.enrichment` لكل سجل
  - JSON: إضافة حقل `enrichment` للكائن المُصدر من `metadata.enrichment`
- [ ] T013 [US3] توسيع `extraction-repository.ts` في `src/lib/extraction/extraction-repository.ts` — دالة `exportResults` (إن لم تكن موجودة) أو تعديل الـ `exportResults` الحالية لدعم التنسيق الجديد مع بيانات الإثراء

**Checkpoint**: US3 مكتمل — التصدير يشمل كل بيانات الإثراء

---

## Phase 6: User Story 4 - دعم قواعد بيانات متعددة (Priority: P3)

**Goal**: النظام يبحث في جميع ملفات `.db` المتاحة (مصر، العراق، إلخ) تلقائياً

**Independent Test**: وجود ملفي `egypt.db` و `Iraq.db`، إثراء استخراج، التحقق من `sources` في الإحصائيات

### Implementation for User Story 4

- [ ] T014 [US4] تنفيذ `scanDatabases()` في `enrichment-service.ts` — قراءة `ENRICHMENT_DB_PATH`، سرد جميع ملفات `.db`، إرجاع قائمة بأسماء الملفات (يُستخدم اسم الملف كـ `source_db`)
- [ ] T015 [US4] حلقة البحث في جميع قواعد البيانات في `enrichJobResults()`: لكل ملف `.db`، فتح، بحث عن fb_ids المتبقية (غير المُثراة)، إغلاق. كل بحث يُضيف لـ `sources` في الإحصائيات
- [ ] T016 [US4] تنظيف BOM prefix من `fb_id` في `searchBatch()` — `fb_id.replace(/^\uFEFF/, '')` — لمعالجة سجلات Iraq.db

**Checkpoint**: US4 مكتمل — النظام يبحث في كل قواعد البيانات المتاحة

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: تحسينات شاملة، تنظيف، ربط الأزرار

- [ ] T017 [P] إضافة `.gitignore` لملفات `.db` في `extraction-service/.gitignore` — استبعاد `db/*.db` من الـ git
- [ ] T018 [P] عرض زر "إثراء" يدوي في `TasksPage.tsx` (للحالات التي لم يُنفذ فيها الإثراء تلقائياً) — استدعاء `enrichmentService.enrichJobResults` عبر API
- [ ] T019 [P] إضافة `enrichment` اختياري في `useExtractionJobs` hook في `src/hooks/useExtractionJobs.ts` — تضمين `progress` في البيانات المُعاد استخدامها
- [ ] T020 التحقق من عمل الميزة بالكامل حسب quickstart.md (جميع السيناريوهات الخمسة)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: لا اعتماديات — يمكن البدء فوراً
- **Foundational (Phase 2)**: يعتمد على Phase 1 — **يحجب جميع قصص المستخدم**
- **US1 (Phase 3)**: يعتمد على Phase 2 — جوهر الميزة
- **US2 (Phase 4)**: يعتمد على US1 (يحتاج `progress.enrichment` من US1)
- **US3 (Phase 5)**: يعتمد على US1 (يحتاج `metadata.enrichment` من US1)
- **US4 (Phase 6)**: يعتمد على Phase 2 فقط — يمكن تنفيذه بالتوازي مع US1
- **Polish (Phase 7)**: يعتمد على جميع القصص المرغوبة

### User Story Dependencies

- **US1 (P1)**: يعتمد على Phase 2 — لا اعتماد على قصص أخرى
- **US2 (P2)**: يعتمد على US1 (يحتاج `progress.enrichment`)
- **US3 (P2)**: يعتمد على US1 (يحتاج `metadata.enrichment`) — يمكن تنفيذه بالتوازي مع US2
- **US4 (P3)**: يعتمد على Phase 2 فقط — يمكن تنفيذه بالتوازي مع US1

### Parallel Opportunities

- T001 ∥ T002 ∥ T003 (Phase 1 — ملفات مختلفة)
- T005 ∥ T006 (ملفات supabase.ts مختلفة)
- US2 ∥ US3 (بعد US1 — ملفات مختلفة)
- US4 ∥ US1 (يعتمد على Phase 2 فقط)
- T017, T018, T019 ∥ (ملفات مختلفة في Phase 7)

---

## Parallel Example: US2 + US3

```bash
# بعد اكتمال US1، يمكن تنفيذ US2 و US3 بالتوازي:
# US2: T010 (Frontend TasksPage) + T011 (i18n)
# US3: T012 (Backend export endpoint) + T013 (Frontend repository)
# هذه الملفات مختلفة تماماً ولا تعتمد على بعضها
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Setup (3 مهام)
2. Complete Phase 2: Foundational (3 مهام)
3. Complete Phase 3: US1 (3 مهام)
4. **STOP and VALIDATE**: اختبار US1 حسب quickstart.md سيناريو 1
5. Deploy/demo — الإثراء يعمل تلقائياً!

### Incremental Delivery

1. Phase 1 + 2 → الأساس جاهز
2. US1 → MVP (إثراء تلقائي) ✅
3. US2 → عرض نسبة التغطية في الواجهة
4. US3 → تصدير CSV/JSON مع بيانات الإثراء
5. US4 → دعم قواعد بيانات متعددة
6. Phase 7 → تنظيف وتحسينات

### Suggested MVP Scope

**User Story 1 (P1)**: إثراء تلقائي بعد كل استخراج — 9 مهام من أصل 20 تغطي 80% من قيمة الميزة.

---

## Notes

- [P] tasks = ملفات مختلفة، لا اعتماديات
- [Story] label يربط المهمة بقصة المستخدم للتتبّع
- كل قصة مستخدم يجب أن تكون قابلة للاختبار المستقل
- Commit بعد كل مهمة أو مجموعة منطقية
- توقف عند أي checkpoint للتحقق من القصة بشكل مستقل

**إجمالي المهام**: 20 مهمة
- Phase 1 (Setup): 3
- Phase 2 (Foundational): 3
- Phase 3 (US1 - P1): 3
- Phase 4 (US2 - P2): 2
- Phase 5 (US3 - P2): 2
- Phase 6 (US4 - P3): 3
- Phase 7 (Polish): 4