# Implementation Plan: إثراء بيانات المستخدمين المستخرجة من قاعدة بيانات خارجية

**Branch**: `005-data-enrichment` | **Date**: 2026-07-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-data-enrichment/spec.md`

## Summary

بعد أي عملية استخراج من Facebook، يُنفّذ تلقائياً بحث في قواعد بيانات SQLite خارجية (Egypt DB, Iraq DB) باستخدام `FBID` كمفتاح مطابقة. عند العثور على تطابق، تُرفق بيانات المستخدم الكاملة (رقم الهاتف، الاسم، الجنس، الموقع...) مع نتيجة الاستخراج. البيانات المُثراة تُحفظ في حقل `metadata` بسجل `extraction_results`، وتظهر في التصدير والواجهة.

**النهج التقني**: خدمة `EnrichmentService` في extraction-service تُحمّل ملفات SQLite مع `better-sqlite3`، تبحث بـ `FBID IN (...)` على دفعات (batch 500)، وتحدّث `extraction_results.metadata` ببيانات الإثراء. تُنفذ كمرحلة منفصلة بعد اكتمال الاستخراج مباشرة.

## Technical Context

**Language/Version**: TypeScript 5.6 (Node.js 22 + tsx)

**Primary Dependencies**: 
- Backend: Express + `better-sqlite3` (جديد — للوصول لملفات SQLite المحلية) + Supabase Service Role
- Frontend: React 19 + TanStack Query v5 + i18next (تعديلات طفيفة فقط)

**Storage**: 
- SQLite محلي (ملفات `.db` للقراءة فقط) — `egypt.db` (13GB) + `Iraq.db` (1.2GB)
- Supabase PostgreSQL — تحديث `extraction_results.metadata` ببيانات الإثراء

**Testing**: يدوي

**Target Platform**: extraction-service على port 3100

**Project Type**: SaaS web application — إثراء يتم بالكامل في backend

**Performance Goals**: البحث المفهرس ~1ms لكل مستخدم؛ إثراء 500 مستخدم في <30 ثانية

**Constraints**: ملفات SQLite للقراءة فقط؛ `egypt.db` تالف جزئياً (الاستعلامات المفهرسة تعمل)

**Scale/Scope**: حتى 13GB ملف SQLite؛ آلاف السجلات لكل عملية استخراج

## Constitution Check

| القاعدة | الحالة | ملاحظات |
|---------|--------|---------|
| **Security** | ✅ | ملفات SQLite محلية للقراءة فقط؛ لا تُعرّض بيانات للمستخدمين غير المصرح لهم |
| **Data Integrity** | ✅ | البيانات المُثراة تُضاف لحقل `metadata` فقط — لا تُعدّل البيانات الأصلية |
| **Correctness** | ✅ | معالجة BOM + قاعدة تالفة + FBID فارغ |
| **Existing Architecture** | ✅ | يتبع نفس نمط `processBatch` + `storeResults` في `supabase.ts` |
| **Performance** | ✅ | استعلامات مفهرسة فقط + batch processing |
| **Tenant isolation** | ✅ | الإثراء scoped بـ `user_id` عبر RLS على `extraction_results` |

## Project Structure

### Documentation (this feature)

```text
specs/005-data-enrichment/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── enrichment-api.md
└── tasks.md
```

### Source Code (repository root)

```text
extraction-service/
├── src/
│   ├── services/
│   │   ├── enrichment-service.ts    # [جديد] خدمة الإثراء — فتح SQLite + بحث + تحديث
│   │   └── supabase.ts              # [تعديل] إضافة enrichResults() و updateResultMetadata()
│   ├── extractors/
│   │   └── base.ts                  # [تعديل] استدعاء enrichment بعد اكتمال الاستخراج
│   └── routes/
│       └── extract.ts               # [تعديل] توسيع export ليشمل بيانات الإثراء
├── db/                              # [جديد] مجلد ملفات SQLite (egypt.db, Iraq.db)
└── package.json                     # [تعديل] إضافة better-sqlite3

src/
├── pages/dashboard/
│   └── TasksPage.tsx                # [تعديل طفيف] عرض نسبة التغطية
└── i18n/locales/
    ├── ar.json                      # [تعديل] ترجمات الإثراء
    └── en.json                      # [تعديل] ترجمات الإثراء
```

**Structure Decision**: الميزة backend-heavy — 90% من العمل في extraction-service. الواجهة تحتاج تعديلات طفيفة فقط (عرض نسبة التغطية + توسيع التصدير).

## Complexity Tracking

> لا توجد انتهاكات — جميع القواعد محترمة.
