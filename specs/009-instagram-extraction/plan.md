# LANGUAGE REQUIREMENT (MANDATORY)

يجب كتابة جميع محتويات هذا الملف باللغة العربية.
يُسمح باستخدام الإنجليزية فقط في:
- أسماء الملفات
- أسماء الدوال
- الأكواد
- APIs
- Commands
## Language

IMPORTANT

Generate this entire document in Arabic.

Write all:
- headings
- explanations
- requirements
- acceptance criteria
- implementation plan
- task descriptions

in Arabic.

Keep ONLY:
- code
- file names
- function names
- class names
- API names
- SQL
- terminal commands

in English.

# Implementation Plan: استخراج بيانات إنستجرام (Instagram Extraction)

**Branch**: `009-instagram-extraction` | **Date**: 2026-08-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-instagram-extraction/spec.md`

## Summary

إضافة منصة إنستجرام كطابع استخراج جديد للمنتج بنفس أنماط فيسبوك القائمة: جلسات بكوكيز متصفح، استخراج عبر متصفح مؤتمت (Playwright + stealth)، مهام تظهر في صفحة المهام مع حفظ تدريجي وإيقاف، ثم إثراء تلقائي من قاعدة Egypt DB بشارة ثقة. أنواع الاستخراج الأربعة: متابعي/متابَعي حساب عام، معلّقون على منشور، أصحاب منشورات هاشتاج (نتائج جزئية معلنة)، وبيانات ملف شخصي مع استخلاص وسائل التواصل من الـ bio. النتائج تُدمج في نفس بنية النتائج والجهات (Contacts) مع حقل منصة `instagram` قابل للفلترة — قرار Clarifications. تدعم المهام تشغيل عدة جلسات بالتوازي (نفس سلوك فيسبوك) مع إعادة التوزيع عند حظر أي جلسة.

## Technical Context

**Language/Version**: TypeScript 5.6 — frontend (React 19 + Vite 6) و backend (extraction-service، Node 20 ESM)

**Primary Dependencies**: Express، Playwright (playwright-extra + stealth plugin)، @supabase/supabase-js، TanStack Query v5، i18next (ar/en, RTL default)

**Storage**: Supabase PostgreSQL (RLS + Auth) — جداول جديدة `ig_sessions` و`ig_browser_profiles`، وإعادة استخدام `extraction_jobs` و`extraction_results` (مع عمود `platform` جديد). الإثراء عبر better-sqlite3 (Egypt DB المحلية)

**Testing**: لا يوجد إطار اختبارات في المستودع — التحقق عبر `npm run typecheck` + `npm run lint` + سيناريوهات تحقق يدوية موثقة في [quickstart.md](./quickstart.md)

**Target Platform**: خدمة الاستخراج على السيرفر (PM2, Node 20) + الواجهة على `flowtixtools.com` — نفس بيئة الإنتاج الحالية

**Project Type**: web-service (extraction microservice) + web-app frontend

**Performance Goals**: من الـ spec — ظهور المهمة في صفحة المهام خلال 5 ثوانٍ، تحديث التقدم كل ≤ 15 ثانية، تغطية ≥ 80% لمتابعي حساب حتى 10K (SC-002)، بدء الإثراء خلال 30 ثانية من اكتمال الاستخراج (SC-009)

**Constraints**: إنستجرام أشد حظراً من فيسبوك (Action Blocked) — pacing 1.5–3 ثوانٍ بين التمريرات لكل جلسة، backoff عند أول إشارة حظر ثم التبديل/إعادة التوزيع على الجلسات؛ `JOB_TIMEOUT_MS=600000` كما هو

**Scale/Scope**: خمسة أنواع استخراج جديدة، جدولان جديدان + عمود واحد، 4 مكونات frontend رئيسية (إدارة الجلسات، إنشاء مهمة، النتائج، الفلترة)، ترجمات ar/en

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`​.specify/memory/constitution.md` قالب غير معبّأ (لا مبادئ مقيدة مُصادق عليها). لذلك اعتُمد دستور المشروع الفعلي `AGENTS.md` كمرجع البوابات:

| البوابة (من AGENTS.md) | الحالة | ملاحظات |
| --- | --- | --- |
| Existing Architecture — احترام البنية | ✅ تمر | إعادة استخدام extraction_jobs/extraction_results/صفحة المهام/الإثراء؛ لا استبدال لأي مكوّن قائم |
| Security — RLS على كل جداول tenant | ✅ تمر | الجداول الجديدة بسياسات RLS مطابقة لـ fb_sessions (انظر data-model.md) |
| Tenant isolation — scoping بـ workspace/user | ✅ تمر | كل استعلامات IG بـ `user_id`/`workspace_id` كما في fb_* |
| Minimum Safe Change | ✅ تمر | عمود `platform` بـ DEFAULT 'facebook' لا يكسر أي مستهلك حالي |
| DRY | ✅ تمر | IgBaseExtractor يرث من BaseExtractor القائم؛ فاصل واحد جديد للتحقق (instagram.com) |
| No secrets in code | ✅ تمر | كوكيز في `cookies_enc` وproxy عبر env — نفس نمط fb_* |

**لا توجد مخالفات** — لا حاجة لجدول Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/009-instagram-extraction/
├── plan.md              # هذا الملف
├── research.md          # مخرجات Phase 0
├── data-model.md        # مخرجات Phase 1
├── quickstart.md        # مخرجات Phase 1
├── contracts/
│   └── api.md           # عقود واجهات extraction-service الجديدة
└── tasks.md             # مخرجات /speckit.tasks (لا يُنشأ هنا)
```

### Source Code (repository root)

```text
extraction-service/src/
├── types.ts                      # + IgExtractionType, ExtractedMember.ig_* fields
├── extractors/
│   ├── index.ts                  # + ig_* cases في createExtractor
│   ├── ig-base.ts                # IgBaseExtractor: تحقق جلسة IG، pacing، حظر
│   ├── ig-followers.ts           # followers/following (dialog lazy-load)
│   ├── ig-post-comments.ts       # معلّقو منشور (load-more)
│   ├── ig-hashtag-posts.ts       # منشورات هاشتاج (grid + modal)
│   └── ig-profile-info.ts        # بيانات ملف + استخلاص bio (email/phone)
├── routes/
│   ├── ig-sessions.ts            # POST /ig/session-check, POST /ig/sessions/import
│   └── extract.ts                # توسيع: ig_* types + session_ids
├── services/
│   ├── ig-supabase.ts            # getSessionAndCookies لـ ig_sessions
│   ├── ig-context-manager.ts     # contexts على instagram.com (فحص منفصل)
│   └── enrichment-service.ts     # + IG matching (bio→مؤكدة، اسم→محتملة)
└── config.ts                     # + IG_PROXY_{SESSION_ID}, IG pacing

supabase/migrations/
└── 2026081810_ig_extraction.sql  # ig_sessions, ig_browser_profiles, platform column

src/ (frontend)
├── pages/dashboard/
│   ├── IgSessionsPage.tsx        # إدارة جلسات إنستجرام
│   └── ExtractIgPage.tsx         # إنشاء مهام IG (4 أنواع)
├── hooks/
│   ├── useIgSessions.ts
│   └── useIgExtraction.ts
├── lib/
│   └── extraction-repo.ts        # + أنواع IG وplatform filter
├── routes/ + config/navigation.ts # + مسارات وقائمة التنقل
└── i18n/locales/{ar,en}.json     # + ترجمات IG
```

**Structure Decision**: بنية الويب الحالية (frontend + extraction microservice) دون تغيير — ملفات IG جديدة بجانب نظيراتها fb_* مع بادئة `ig-`، والتوسيع الحقيقي الوحيد في ملفات قائمة (`types.ts`, `extract.ts`, `enrichment-service.ts`, `extraction-repo.ts`) لأنها نقاط التسجيل المركزية.
