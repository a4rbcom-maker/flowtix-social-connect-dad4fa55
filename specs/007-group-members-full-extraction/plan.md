# Implementation Plan: استخراج شامل لأعضاء الجروبات مع إثراء وفواصل زمنية

**Branch**: `007-group-members-full-extraction` | **Date**: 2026-07-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-group-members-full-extraction/spec.md`

## Summary

تطبيق نفس آلية `page-followers.ts` (التي أُنجزت في ميزة 006) على `group-members.ts` لاستخراج حتى 50,000 عضو من الجروب، مع الفواصل الزمنية الموجودة، والإثراء التلقائي، والتتبع المباشر في صفحة المهام.

الفجوات المطلوب سدّها:
1. توسيع `parseFollowersCount` لتشمل "members" + قراءة العدد الإجمالي للجروب
2. إضافة `storeExtractionProgress` لـ `group-members.ts` (phase: navigating → scrolling → completed)
3. إضافة `stop_reason` عند توقف مبكر
4. الفواصل الزمنية + الإثراء + صفحة المهام = موجودة من 006 (تحقق فقط)

## Technical Context

**Language/Version**: TypeScript 5.6 (Frontend) + Node.js 20 (Extraction Service)

**Primary Dependencies**: React 19, Playwright 1.48, Express 4.21, Supabase JS 2.45, TanStack Query v5, better-sqlite3

**Storage**: PostgreSQL (Supabase) + SQLite محلي (Egypt DB)

**Testing**: يدوي عبر `quickstart.md`

**Target Platform**: متصفح ويب + خادم Node.js

**Project Type**: web-service (SaaS)

**Performance Goals**:
- استخراج حتى 50,000 عضو في ≤ 30 دقيقة (حسب حجم الجروب وrate limit)
- تحديث الـ progress كل ≤ 15 ثانية
- إثراء 50,000 عضو خلال ≤ 5 دقائق

**Constraints**:
- احترام rate limits عبر backoff + multi-session
- الحفظ الـ incremental
- عدم كسر الميزات الموجودة
- RTL افتراضي + ترجمات ar/en

**Scale/Scope**: حتى 50,000 عضو لكل مهمة، job queue concurrency = 2

## Constitution Check

`.specify/memory/constitution.md` template فقط — لا gates.

**الالتزام بمبادئ AGENTS.md**:
- ✅ Security: Tenant isolation عبر `user_id`
- ✅ Data Integrity: incremental save، حالة `paused` قابلة للاستئناف
- ✅ Correctness: قراءة صحيحة للعدد، حساب دقيق للتغطية
- ✅ Existing Architecture: توسيع الموجود (BaseExtractor + page-followers pattern)
- ✅ Performance: الفواصل الزمنية موجودة
- ✅ Maintainability: اتباع نفس نمط page-followers
- ✅ Simplicity: لا طبقات جديدة

**الحكم**: لا تعارضات.

## Project Structure

### Documentation (this feature)

```text
specs/007-group-members-full-extraction/
├── plan.md
├── spec.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── extraction-api.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
extraction-service/src/
├── extractors/
│   ├── base.ts                # توسيع parseFollowersCount لتشمل "members"
│   └── group-members.ts       # إضافة storeProgress + phase + stop_reason + قراءة العدد
└── services/
    └── enrichment-service.ts  # موجود من 005 — لا تعديل
```

Frontend لا يحتاج تعديل — البنية موجودة لـ page-followers وتعمل تلقائياً مع group-members (تستخدم نفس `config.total_followers_count` و `progress`).

**Structure Decision**: تعديل ملفّين فقط في الـ extraction-service. Frontend يعمل كما هو.

## Complexity Tracking

لا انتهاكات — الجدول فارغ.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
