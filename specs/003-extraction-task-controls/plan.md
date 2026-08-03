# Implementation Plan: Extraction Task Controls

**Branch**: `003-extraction-task-controls` | **Date**: 2026-07-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-extraction-task-controls/spec.md`

## Summary

إصلاح خمسة عيوب حرجة في إدارة مهام الاستخراج:
1. إعادة تسمية "Cancel" إلى "Stop" (إيقاف) لتوضيح أن البيانات تُحفظ
2. منع `extract.ts` من overwriting حالة `"canceled"` إلى `"completed"`
3. إظهار المهام الموقفة في قسم "Stopped" منفصل على صفحة المهام
4. حذف محدد عدد النتائج من الواجهة + جعل الاستخراج يكتمل طبيعياً بدل `"paused"`
5. إضافة adaptive rate-limiting مع backoff عند تلقي إشارات من Facebook

## Technical Context

**Language/Version**: TypeScript 5.6 (Frontend: React 19 + Vite 6 / Backend: Node.js + Express)

**Primary Dependencies**:
- Frontend: React 19, TanStack Query v5, i18next, Tailwind CSS 4
- Backend: Express, Playwright, Supabase JS v2
- Database: Supabase (PostgreSQL)

**Storage**: Supabase PostgreSQL — `extraction_jobs` table (status, result_count, config JSONB, completed_at), `extraction_results` table (fb_id, data JSONB, workspace_id, job_id)

**Testing**: Manual validation via browser + extraction-service logs. No automated test framework.

**Target Platform**: Web browser (Chrome/Edge) for Playwright-based extraction

**Project Type**: Web application (React frontend + Express extraction microservice)

**Performance Goals**:
- Extraction: 600ms delay between scrolls, 10s rest every 8 scrolls
- UI: Stop detected within 5 seconds of click
- Job list refreshes within 3 seconds of status change

**Constraints**:
- `JOB_TIMEOUT_MS=600000` (10 min max execution per job)
- One active job per user at a time
- Facebook rate-limiting: max 2 requests/second average

**Scale/Scope**: 6 files to modify (3 frontend, 3 backend), ~200 lines of changes

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

الدستور الحالي هو template placeholder — لا توجد قواعد محددة للتحقق منها.

التحقق مع `AGENTS.md` Engineering Constitution:
- ✅ **Security**: لا تغييرات على auth/RLS — جميع العمليات تحترم workspace isolation الموجود
- ✅ **Data Integrity**: `processBatch` incremental save يضمن حفظ النتائج الجزئية
- ✅ **Correctness**: إصلاح race condition في status overwrite
- ✅ **Existing Architecture**: تعديلات على الملفات الموجودة فقط — لا جديد
- ✅ **Backward Compatibility**: `"canceled"` status يبقى كما هو في DB، فقط UI label يتغير
- ✅ **Minimum Safe Change**: أصغر تغيير ممكن لكل إصلاح

## Project Structure

### Documentation (this feature)

```text
specs/003-extraction-task-controls/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── extraction-api.md
└── tasks.md             # Phase 2 output (NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
# Backend (extraction microservice)
extraction-service/src/
├── routes/
│   └── extract.ts           # Job status transitions fix (FR-2, FR-5)
├── extractors/
│   ├── base.ts              # Rate-limiting config + adaptive backoff (FR-7)
│   └── group-members.ts     # Completion logic fix (FR-5)
└── types.ts                 # No changes needed (JobStatus already has "canceled")

# Frontend (React app)
src/
├── pages/dashboard/
│   ├── TasksPage.tsx        # Stop button + Stopped section (FR-1, FR-3)
│   └── extraction/
│       ├── ExtractContactsPage.tsx  # Remove max_results selector (FR-4)
│       ├── ExtractMembersPage.tsx   # Remove max_results selector (FR-4)
│       └── config.ts                # Remove maxResults field (FR-4)
├── lib/extraction/
│   └── extraction-repository.ts     # cancelJob → stopJob rename (FR-1)
├── i18n/locales/
│   ├── ar.json              # "إلغاء" → "إيقاف", add "stopped" status (FR-1, FR-3)
│   └── en.json              # "Cancel" → "Stop", add "stopped" status (FR-1, FR-3)
```

**Structure Decision**: تعديل ملفات موجودة فقط — لا إنشاء ملفات جديدة. الهيكل الحالي للـ monorepo (frontend + extraction-service) يُحترم بالكامل.

## Complexity Tracking

لا توجد انتهاكات للدستور — لا حاجة لتتبع تعقيد.
