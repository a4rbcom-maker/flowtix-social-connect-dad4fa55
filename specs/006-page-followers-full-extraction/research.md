# Phase 0 Research: استخراج شامل لمتابعين الصفحات

**Feature**: 006-page-followers-full-extraction
**Date**: 2026-07-31

هذا الملف يوثّق القرارات التقنية للفجوات المحددة في الـ plan، مع البدائل المطروحة ولماذا رُفضت.

---

## R-001: كيفية قراءة العدد الإجمالي للمتابعين من الصفحة

**Decision**: قراءة العدد من DOM في مرحلة ما قبل/أثناء بدء الاستخراج، عبر البحث عن نص الـ "followers" في عناصر الصفحة الرئيسية، ثم تحويله لرقم (معالجة صيغ مثل "1.2K", "247", "12,345").

**Rationale**: 
- العدد الظاهر على صفحة Facebook هو المرجع المتاح الوحيد دون استخدام APIs رسمية (متعطّلة)
- قراءته من DOM متاحة بالفعل في Playwright أثناء `page.goto()`
- التحويل لرقم بسيط (regex + ضرب K/M)

**Alternatives considered**:
- **GraphQL API الرسمي**: متعطّل/يتطلب app review — غير قابل
- **Open Graph meta tags**: تعطي العدد أحياناً عبر `og:description` لكنها غير موثوقة عبر كل الصفحات
- **تقدير العدد من معدل التحميل**: غير دقيق

**Implementation note**: دالة `parseFollowersCount(html)` تُستخرج العدد عبر regex متعدد (阿拉伯/إنجليزي/صيغ مختصرة). يُخزَّن في `extraction_jobs.config.total_followers_count`.

---

## R-002: كيفية حساب وعرض نسبة التغطية (Coverage Rate)

**Decision**: 
- الحساب في الـ Frontend ديناميكياً: `coverage_rate = discovered / total_followers_count * 100`
- يُحدَّث مع كل fetch لتفاصيل المهمة
- يُعرض في `ExtractionJobCard` بشريط تقدّم بصري + رقم
- عند اكتمال المهمة، يُخزَّن `final_coverage_rate` في `progress` JSON

**Rationale**: 
- حساب الـ Frontend أبسط (لا logic خادم إضافي)
- الـ progress JSON موجود بالفعل (`{discovered, processed, ...}`)
- التحديث الـ automatic عبر `useExtractionJob` (refetch كل 3s)

**Alternatives considered**:
- **حساب في الخادم وإرسال كرقم**: يضيف عمود/column أو حقل — تعقيد بلا داعٍ
- **حساب فقط عند الاكتمال**: يفقد قيمة التتبع المباشر

**Implementation note**: 
- إضافة `total_followers_count` لـ `ExtractionJob.config`
- إضافة `coverage_rate` (محسوب) لـ response الـ getJob
- عرض في `ExtractionJobCard` مع شريط تقدّم لونه يتغير (أحمر <50%، أصفر 50-85%، أخضر ≥85%)

---

## R-003: عرض المرحلة الحالية (Phase) للمستخدم

**Decision**: توسيع الـ `progress.phase` الموجود بالفعل في `messenger-contacts.ts` (وليس فقط فيه) ليشمل `page-followers.ts` بالقيم: `navigating`, `scrolling`, `xhr_replay`, `enriching`, `completed`.

**Rationale**: 
- الـ `progress.phase` field موجود في schema (migration `2026072918`)
- الـ `messenger-contacts.ts` يستخدمه بالفعل كنموذج
- ترجمة القيم في `ar.json` / `en.json` عبر مفتاح `phase_{value}`

**Alternatives considered**:
- **حقل منفصل**: تكرار
- **text libre**: لا يدعم الترجمة

**Implementation note**: 
- في `page-followers.ts`: `supabaseService.storeProgress(jobId, { ..., phase: "scrolling" })` عند كل مرحلة
- في `ExtractionJobCard`: عرض `t(\`phase_${job.progress.phase}\`)` 
- مفاتيح الترجمة: `phase_navigating`, `phase_scrolling`, `phase_xhr_replay`, `phase_enriching`, `phase_completed`

---

## R-004: ضمان بلوغ 85% عبر multi-session

**Decision**: الاعتماد على البنية الموجودة:
- `switchToNextSession()` في `base.ts` (مُفعّل)
- استدعاؤه في `page-followers.ts` عند `consecutiveErrors >= 3` (سطر 269، 292)
- phase2XHRReplay يدعم حتى `MAX_PAGES = 1500` مع `consecutiveErrors >= 12` كحد إيقاف

**Rationale**: الكود الحالي مصمّم لهذا الغرض — التبديل تفاعلي عند rate limit، مع backoff أُسي. لا حاجة لتعديل جوهري.

**Alternatives considered**:
- **Round-robin استباقي**: يستهلك sessions بسرعة دون دليل على rate limit — مرفوض
- **فصل الجلسات على page distinctes**: معقد ولا فائدة منه (نفس الـ target)

**Implementation note**: لا تعديل مطلوب في `page-followers.ts` نفسه — فقط التحقق من فعاليته. الفجوة في **عدم وجود العدد الإجمالي لقياس النسبة**، وهو ما يعالجه R-001 + R-002.

---

## R-005: رسالة واضحة عند العجز عن بلوغ 85%

**Decision**: عند اكتمال المهمة بـ `coverage_rate < 85%`، عرض رسالة سبب مُحددة:
- `SESSION_RATE_LIMITED`: "وصلنا لـ X% لأن Facebook أوقف الجلسة"
- `NO_SECONDARY_SESSION`: "أضف جلسة ثانية لتحسين النسبة"
- `SOURCE_EXHAUSTED`: "المصدر لم يعد يقدّم نتائج جديدة (قد يكون المتابعون مخفيين)"
- `MAX_RESULTS_REACHED`: "تم الوصول للحد الأقصى المطلوب"

**Rationale**: المستخدم يحتاج لفهم **لماذا** النسبة أقل من المتوقع لاتخاذ قرار (إضافة جلسة؟ إعادة المحاولة؟).

**Alternatives considered**:
- **رسالة عامة "لم يكتمل"**: غير مفيدة
- **عدم عرض شيء**: يُحبط المستخدم

**Implementation note**: 
- في `page-followers.ts`: عند الاكتمال بـ coverage < 85%، حدّد `stop_reason` في `progress`
- في `ExtractionJobCard`: عرض `t(\`stop_reason_${reason}\`)` عند توفره

---

## R-006: التعامل مع تحديثات الـ progress المباشرة

**Decision**: استخدام البنية الموجودة:
- Backend: `supabaseService.storeProgress(jobId, {...})` موجود
- Frontend: `useExtractionJob` يعمل `refetchInterval` كل 3s للحالات `running`/`queued`
- الـ `progress` JSON field في `extraction_jobs` يخزّن `{discovered, processed, phase, last_update}`

**Rationale**: البنية مُفعّلة — فقط نضمن أن `page-followers.ts` يستدعي `storeProgress` بشكل دوري (كل ~15 ثانية أو كل 10 صفحات).

**Alternatives considered**:
- **WebSockets**: تعقيد إضافي بلا داعٍ (3s polling كافٍ)
- **Server-Sent Events**: يحتاج infra إضافي

**Implementation note**: 
- في `page-followers.ts` phase2 loop: استدعاء `storeProgress` كل 10 صفحات (متاح بالفعل في messenger، نضيفه لـ page-followers)
- التحقق من `lastLogPage >= 10` pattern الموجود (سطر 327) — نفس النمط يُستخدم لتحديث progress

---

## R-007: ضمان ظهور المهمة فوراً في صفحة المهام

**Decision**: التحقق من أن `createJob` في `routes/extract.ts` يُنشئ المهمة **قبل** بدء `runExtractionJob` (موجود بالفعل، سطر 234-247).

**Rationale**: الكود الحالي ينشئ الـ job أولاً بحالة `queued`/`running` ثم يُشغّل الاستخراج — لذا المهمة تظهر فوراً.

**Alternatives considered**:
- **إنشاء بعد الاكتمال**: خطأ جوهري في التصميم الحالي — مرفوض

**Implementation note**: 
- التحقق من أن `useExtractionJobs` query يُعيد المهمة الجديدة فوراً (invalidateQueries موجود في `useStartExtraction` onSuccess)
- قد نحتاج `invalidateQueries` إضافي على `JOBS_KEY` إذا لم تظهر فوراً

---

## خلاصة القرارات

| القرار | الملف المتأثر | حالة الكود |
|---|---|---|
| R-001 قراءة العدد الإجمالي | `page-followers.ts` + `extract.ts` | **جديد** |
| R-002 حساب/عرض التغطية | `ExtractionJobCard.tsx` + `supabase.ts` | **جديد** |
| R-003 عرض المرحلة | `page-followers.ts` + i18n | **توسيع** |
| R-004 multi-session | `page-followers.ts` | **موجود — تحقق فقط** |
| R-005 رسالة العجز | `page-followers.ts` + i18n + `ExtractionJobCard.tsx` | **جديد** |
| R-006 تحديث progress | `page-followers.ts` | **توسيع** |
| R-007 ظهور فوري | `extract.ts` + `useExtractionJobs.ts` | **موجود — تحقق فقط** |

**الخلاصة**: الفجوة الفعلية المطلوب سدّها = قراءة العدد الإجمالي + حساب/عرض نسبة التغطية + رسالة السبب عند العجز. باقي البنية مُفعّل.
