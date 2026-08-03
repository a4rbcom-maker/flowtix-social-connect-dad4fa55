# FlowTix AI Engineering Constitution

> **⚠️ تنبيه حرج: جميع التواصل مع المستخدم باللغة العربية حصراً.**
> **Technical terms (code, file names, function names, SQL, etc.) remain in English.**

---

## Project Overview

**FlowTix Tools** — منصة SaaS لاستخراج بيانات Facebook وأتمتة WhatsApp.

### Tech Stack
- **Frontend**: React 19 + TypeScript 5.6 + Vite 6 + Tailwind CSS 4 + TanStack Query v5 + i18next (ar/en, RTL default)
- **Backend (extraction)**: Express + Playwright on port 3100 (`API_KEY=flowtix-extraction-2026`)
- **Database**: Supabase (PostgreSQL + RLS + Auth)
- **Package Manager**: npm

### Commands
```bash
# Frontend
npm run dev          # Vite dev server (port 5173)
npm run build        # tsc -b && vite build
npm run typecheck    # tsc -b --noEmit
npm run lint         # eslint . --ext .ts,.tsx

# Extraction Service
cd extraction-service && npm run dev    # tsx watch (port 3100)
cd extraction-service && npm run build  # tsc
```

### Folder Structure
```
src/                          # Frontend React app
├── components/               # Shared UI components
├── pages/dashboard/          # Dashboard pages
├── hooks/                    # React hooks (useExtractionJobs, useFbSessions, etc.)
├── lib/                      # Core libs (supabase, authProvider, extraction repo)
├── i18n/locales/             # ar.json + en.json translations
├── routes/                   # React Router config
└── config/                   # Navigation, feature flags

extraction-service/src/       # Playwright-based extraction microservice
├── extractors/               # base.ts, group-members.ts, page-followers.ts, etc.
├── routes/                   # extract.ts (jobs, export, broadcast)
├── services/                 # supabase.ts, context-manager.ts, job-queue.ts
└── types.ts                  # JobStatus, ExtractionType, JobContext

supabase/migrations/          # SQL migrations
specs/                        # Feature specifications (speckit)
```

---

## Token Efficiency Rules

1. **اقرأ فقط الملفات ذات الصلة** بالمهمة الحالية
2. **لا تُعد قراءة ملفات لم تتغير**
3. **استخدم Grep/Glob للبحث** بدلاً من قراءة ملفات كاملة
4. **اختصر الردود** — جملة واحدة أفضل من فقرة
5. **لا تكرر الشرح** — قل ما فعلته فقط
6. **استخدم Task tool** للبحث المكثف بدلاً من قراءة سياق كبير
7. **خطط داخلياً** قبل التنفيذ — لا تُخرج خطة طويلة إلا إذا طُلب منك

---

## Engineering Priorities

عند تعارض القواعد، اتبع الأولوية الأعلى:

1. **Security** — لا تنتهك الأمان أبداً
2. **Data Integrity** — لا تُفسد البيانات
3. **Correctness** — الكود الصحيح قبل السريع
4. **Existing Architecture** — احترم البنية الموجودة
5. **Performance** — الأداء ميزة أساسية
6. **Maintainability** — الكود يجب أن يكون سهل الصيانة
7. **Simplicity** — الحل الأبسط الكافي

---

## Core Rules

### Before Coding
1. **افهم المطلوب** قبل البدء
2. **ابحث في الكود الموجود** قبل إنشاء جديد (Grep/Glob)
3. **وسّع الموجود** قبل الاستبدال
4. **خطط للتغيير الأصغر** الذي يحل المشكلة بالكامل
5. **توقع الآثار الجانبية** على الميزات الأخرى

### Code Quality
- **Production-ready** فقط — لا prototype ولا placeholder
- **DRY** — لا تكرر المنطق، استخرجه في دالة مشتركة
- **KISS** — الحل الأبسط الكافي
- **No dead code** — احذف imports/variables/functions غير المستخدمة
- **Self-documenting** — أسماء واضحة بدلاً من تعليقات
- **No comments** إلا إذا طُلب منك أو كان حرجاً (business logic)

### Changes
- **Minimum Safe Change** — غيّر أقل عدد من الملفات والأسطر
- **No unnecessary refactoring** — لا تُعد هيكلة كود يعمل
- **Preserve backward compatibility** — لا تكسر APIs موجودة
- **One problem at a time** — لا تدمج إصلاحات غير مرتبطة

### Error Handling
- عالج الأخطاء عند المصدر
- لا تخفي الأخطاء (no empty catch)
- رسائل خطأ واضحة للمستخدم بدون تفاصيل تقنية
- لا تسرب secrets/tokens/logs في رسائل الخطأ

---

## Security Rules

- **Zero Trust** — تحقق من كل input (user, API, DB, third-party)
- **RLS enabled** — كل جداول tenant يجب أن يكون عليها Row Level Security
- **Parameterized queries** — لا SQL concatenation أبداً
- **No secrets in code** — استخدم environment variables
- **Tenant isolation** — كل query يجب أن تكون scoped بـ `workspace_id`
- **Auth on every layer** — UI + API + DB policies

---

## React + Frontend Rules

- **Logical CSS properties**: استخدم `ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `border-s`, `border-e` للـ RTL
- **لا تستخدم `rtl:` variant** — لا يعمل بشكل موثوق في Tailwind 4، استخدم `i18n.language` بدلاً منه
- **State محلي** — ارفع state فقط عند الحاجة الفعلية
- **Server state في React Query** — لا تكرر server state في local state
- **Lazy load** الصفحات الثقيلة والإدارية
- **Loading/Empty/Error states** — كل شاشة async يجب أن تعالجها
- **Types strict** — لا `any`، استخدم interfaces و utility types
- **Tailwind utilities** — استخدم design tokens من `index.css` (`var(--color-*)`)

---

## Backend (Extraction Service) Rules

- **Incremental save** — احفظ النتائج جزئياً عبر `processBatch` وليس في النهاية
- **Check cancellation** — تحقق من `checkCanceled()` في كل دورة استخراج
- **Rate limiting** — 600ms بين كل scroll، 10s راحة كل 8 دورات
- **Job status transitions** — تحقق من الحالة الحالية قبل كتابة حالة جديدة (منع race conditions)
- **Timeout** — `JOB_TIMEOUT_MS=600000` (10 دقائق لكل مهمة)

### Job Status Values
`queued` → `running` → `completed` | `failed` | `canceled` | `paused`

- `completed`: المصدر نفد أو بلوغ safety ceiling
- `canceled`: المستخدم أوقفها (بيانات جزئية محفوظة)
- `paused`: انقطاع نظام (timeout/restart) — يمكن استئنافها
- `failed`: خطأ (auth/network)

---

## Database (Supabase) Rules

- **Migration files** فقط — لا تعديل يدوي على schema
- **Soft delete** للبيانات الحرجة
- **Select only needed columns** — لا `SELECT *`
- **Pagination** للمجموعات الكبيرة
- **Indexes** على أعمدة الفلترة الشائعة

---

## Anti-Hallucination Rules

- **لا تخترع** APIs أو Database tables أو Routes أو Functions
- **إذا لم تعرف** — ابحث في الكود أو اسأل المستخدم
- **تحقق من existence** قبل الاستخدام
- **اقرأ الملف الفعلي** قبل التعديل

---

## Validation Checklist

قبل اعتبار أي مهمة مكتملة:

- [ ] `tsc --noEmit` يمر بدون أخطاء
- [ ] `vite build` ينجح
- [ ] لا dead code أو unused imports
- [ ] الميزة تعمل كما هو متوقع
- [ ] لا regression في الميزات الموجودة
- [ ] RTL يعمل بشكل صحيح (إذا كان هناك تغيير UI)
- [ ] Arabic translations مضافة (إذا كان هناك نصوص جديدة)

---

## Language & Communication

- **جميع الردود بالعربية** —Plans, summaries, errors, progress, completion reports
- **الكود بالإنجليزية** — File names, function names, variables, SQL, commands
- **لا تخلط** — لا تكتب جمل عربية مع كلمات إنجليزية إلا للمصطلحات التقنية

### Examples
- ❌ `Let me update the todo list.`
- ✅ `سأقوم الآن بتحديث قائمة المهام.`
- ❌ `Migration completed successfully.`
- ✅ `تم تنفيذ الـ Migration بنجاح.`
