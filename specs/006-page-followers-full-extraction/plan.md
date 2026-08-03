# Implementation Plan: استخراج شامل لمتابعين الصفحات مع إثراء وتتبع مباشر

**Branch**: `006-page-followers-full-extraction` | **Date**: 2026-07-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-page-followers-full-extraction/spec.md`

## Summary

ضمان استخراج ≥ 85% من متابعي صفحة Facebook المستهدفة عبر الاستفادة من multi-session (مُفعّل في `page-followers.ts`) + phase2 XHR replay، مع إثراء النتائج تلقائياً عبر Egypt DB (ميزة 005)، وظهور المهمة فوراً في صفحة المهام (Tasks Page) مع تحديثات دورية للعدد والمرحلة ونسبة التغطية.

الفجوات المطلوب سدّها:
1. قراءة العدد الإجمالي للمتابعين من واجهة الصفحة قبل بدء الاستخراج (لحساب نسبة التغطية)
2. عرض نسبة التغطية والمرحلة في UI صفحة المهام
3. التحقق من بلوغ 85% ومخاطرة المستخدم عند العجز مع توضيح السبب

## Technical Context

**Language/Version**: TypeScript 5.6 (Frontend) + Node.js 20 (Extraction Service)

**Primary Dependencies**: React 19, Playwright 1.48, Express 4.21, Supabase JS 2.45, TanStack Query v5, i18next, Tailwind CSS 4, better-sqlite3 (لـ Egypt DB)

**Storage**: 
- PostgreSQL (Supabase) — جداول `extraction_jobs`, `extraction_results`, `fb_sessions`
- SQLite محلي — `egypt.db` / `Iraq.db` (ميزة 005 للإثراء)

**Testing**: يدوي عبر تشغيل فعلي على صفحة Facebook حقيقية (لا يوجد إطار اختبارات آلية حالياً)

**Target Platform**: متصفح ويب (Frontend RTL) + خادم Node.js على نفس استضافة Playwright

**Project Type**: web-service (SaaS متعدد المستخدمين — Frontend + Extraction microservice)

**Performance Goals**:
- استخراج ≥ 85% من متابعين صفحة (247 مثالاً) خلال ≤ 10 دقائق
- تحديث الـ progress كل ≤ 15 ثانية
- إثراء 1000 متابع خلال ≤ 60 ثانية
- ظهور المهمة في صفحة المهام خلال ≤ 5 ثوانٍ من بدئها

**Constraints**:
- احترام rate limits عبر backoff + multi-session switching
- الحفظ الـ incremental (لا فقدان بيانات عند انقطاع)
- عدم كسر الميزات الموجودة (group-members, post-comments, post-reactions, messenger)
- RTL افتراضي + ترجمات ar/en
- Tenant isolation عبر `user_id` على كل query

**Scale/Scope**: صفحة واحدة لكل مهمة، حتى 100,000 متابع كحد أقصى، job queue بـ concurrency = 2

## Constitution Check

ملف `.specify/memory/constitution.md` يحتوي template placeholders فقط (لم يُملأ بمحتوى فعلي) — لا توجد gates مفروضة.

**الالتزام بمبادئ AGENTS.md (المرجع الفعلي للمشروع)**:
- ✅ **Security**: Tenant isolation عبر `user_id`، RLS مُفعّل، لا SQL injection
- ✅ **Data Integrity**: incremental save، حالة `paused` قابلة للاستئناف، انتقالات حالة محمية
- ✅ **Correctness**: قراءة صحيحة للعدد الإجمالي، حساب دقيق لنسبة التغطية
- ✅ **Existing Architecture**: استخدام `BaseExtractor`, `processBatch`, `supabaseService` الموجودة
- ✅ **Performance**: batch enrichment، استعلامات SQLite مفهرسة (FBID)
- ✅ **Maintainability**: توسيع الموجود لا الاستبدال
- ✅ **Simplicity**: لا إضافة طبقات غير ضرورية

**الحكم**: لا تعارضات، البوابة مفتوحة.

## Project Structure

### Documentation (this feature)

```text
specs/006-page-followers-full-extraction/
├── plan.md              # هذا الملف
├── spec.md              # المواصفات الوظيفية
├── research.md          # Phase 0 — قرارات البحث
├── data-model.md        # Phase 1 — نماذج البيانات والحالات
├── quickstart.md        # Phase 1 — دليل التحقق اليدوي
├── contracts/
│   └── extraction-api.md  # Phase 1 — عقد الـ API المُوسّع
└── checklists/
    └── requirements.md  # من /speckit.specify
```

### Source Code (repository root)

```text
extraction-service/src/
├── extractors/
│   └── page-followers.ts     # توسيع: قراءة العدد الإجمالي + تقرير نسبة التغطية
├── routes/
│   └── extract.ts            # توسيع: تخزين total_followers_count في config
└── services/
    ├── supabase.ts           # تخزين/قراءة total_followers_count و coverage_rate
    └── enrichment-service.ts # موجود من ميزة 005

src/
├── components/
│   ├── extraction/
│   │   └── ExtractionJobCard.tsx   # عرض نسبة التغطية والمرحلة (جديد/توسيع)
│   └── dashboard/
│       └── TasksPage.tsx           # تأكد ظهور المهمة + التحديث المباشر
├── hooks/
│   └── useExtractionJobs.ts        # موجود (refetchInterval كل 3s للحالات النشطة)
├── lib/
│   └── extraction/
│       └── extraction-repository.ts # موجود
└── i18n/locales/
    ├── ar.json              # مفاتيح جديدة: coverage_rate, total_followers, phase_*
    └── en.json
```

**Structure Decision**: استخدام Option 2 (Web application) — الفصل موجود بين `src/` (Frontend React) و `extraction-service/src/` (Backend Playwright). لا إضافة طبقات جديدة، فقط توسيع ملفات موجودة.

## Complexity Tracking

لا توجد انتهاكات لدستور المشروع — الجدول فارغ.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
