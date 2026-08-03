# Implementation Plan: مراسلة جهات الاتصال المستخرجة عبر Facebook Messenger

**Branch**: `004-contact-broadcast` | **Date**: 2026-07-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-contact-broadcast/spec.md`

## Summary

إضافة ميزة مراسلة جماعية عبر Facebook Messenger للجهات المستخرجة (متابعين، أعضاء، متفاعلين، معلّقين). المستخدم يكتب رسالة + صورة اختيارية، يضغط إرسال، فيبدأ الخادم بفتح محادثة كل جهة عبر Playwright وإرسال الرسالة. شاشة تقدم احترافية تعرض النتائج لحظياً.

**النهج التقني**: إنشاء `broadcast-worker.ts` بنفس نمط `publish-worker.ts` الموجود (Playwright + checkpoint + rate limiting). جدول جديد `broadcast_jobs` + `broadcast_recipients` لتتبّع دقيق لكل رسالة.

## Technical Context

**Language/Version**: TypeScript 5.6 (Frontend: React 19, Backend: Node.js + tsx)

**Primary Dependencies**:
- Frontend: React 19 + Vite 6 + Tailwind CSS 4 + TanStack Query v5 + i18next + Supabase JS
- Backend: Express + Playwright + Zod (validation) + Supabase Service Role
- موجود: `@whiskeysockets/baileys` (لـ WhatsApp — غير مستخدم هنا)

**Storage**: Supabase (PostgreSQL + RLS + Storage للصور المرفقة)

**Testing**: يدوي (لا يوجد إطار اختبار آلي في المشروع)

**Target Platform**: Web (Frontend: Vite dev server port 5173; Backend: extraction-service port 3100)

**Project Type**: SaaS web application (frontend + extraction microservice)

**Performance Goals**: إرسال رسالة كل 60-180 ثانية (rate limiting)؛ تحديث شاشة التقدم كل ثانيتين

**Constraints**: جلسة Facebook واحدة نشطة لكل عملية إرسال؛ Playwright browser pool محدود (pool size=2)

**Scale/Scope**: حتى 500+ مستلم لكل مهمة؛ مستخدم واحد لكل جلسة

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| القاعدة | الحالة | ملاحظات |
|---------|--------|---------|
| **Security** — لا تنتهك الأمان | ✅ | RLS على الجداول الجديدة؛ API key على كل endpoint؛ session_id مطلوب |
| **Data Integrity** — لا تُفسد البيانات | ✅ | Incremental save مثل publish-worker؛ checkpoint لكل رسالة |
| **Correctness** — الكود الصحيح قبل السريع | ✅ | معالجة أخطاء فردية لكل رسالة |
| **Existing Architecture** — احترم البنية | ✅ | نفس نمط publish-worker + context-manager + supabase.ts |
| **Performance** — الأداء ميزة أساسية | ✅ | Rate limiting ذكي + backoff |
| **Tenant isolation** — scoped بـ user_id | ✅ | جميع queries بـ `user_id` (workspaces أُزيلت) |

## Project Structure

### Documentation (this feature)

```text
specs/004-contact-broadcast/
├── plan.md              # هذا الملف
├── research.md          # Phase 0 — قرارات تقنية
├── data-model.md        # Phase 1 — schema الجداول
├── quickstart.md        # Phase 1 — دليل التحقق
├── contracts/           # Phase 1 — API contracts
│   └── broadcast-api.md
└── tasks.md             # Phase 2 (يُنشأ بواسطة /speckit.tasks)
```

### Source Code (repository root)

```text
extraction-service/src/
├── routes/
│   ├── broadcast.ts          # [جديد] POST /broadcast/start, /broadcast/stop, /broadcast/status/:jobId
│   └── extract.ts            # [تعديل] حذف stub القديم في /broadcast
├── services/
│   └── broadcast-worker.ts   # [جديد] Playwright Messenger worker (نمط publish-worker)
└── index.ts                  # [تعديل] تسجيل broadcastRouter

src/
├── pages/dashboard/
│   ├── messenger/
│   │   └── MessengerBroadcastPage.tsx  # [إعادة كتابة كاملة] session selector + composer + progress screen
│   └── extraction/
│       ├── ExtractContactsPage.tsx     # [تعديل طفيف] زر المراسلة لكل الأنواع
│       └── ExtractMembersPage.tsx      # [تعديل طفيف] زر المراسلة لكل الأنواع
├── pages/dashboard/
│   └── TasksPage.tsx                   # [تعديل] زر "مراسلة" لكل أنواع الاستخراج
├── hooks/
│   └── useBroadcast.ts                 # [جديد] React Query hooks للـ broadcast
├── lib/
│   └── extraction/
│       └── extraction-repository.ts    # [تعديل] إضافة broadcast methods
├── i18n/locales/
│   ├── ar.json                         # [تعديل] ترجمات البث
│   └── en.json                         # [تعديل] ترجمات البث
└── routes/
    └── index.tsx                       # [تعديل] تحديث مسار البث (يدعم extraction_job_id)

supabase/migrations/
└── 20260730_create_broadcast_jobs.sql  # [جديد] جدول broadcast_jobs + broadcast_recipients + RLS
```

**Structure Decision**: Web application (frontend + extraction microservice). يتبع البنية الموجودة بالكامل — استخراج المنطق في `extraction-service` وإعادة استخدام `context-manager` و `publish-worker` كنماذج.

## Complexity Tracking

> لا توجد انتهاكات — جميع القواعد محترمة.
