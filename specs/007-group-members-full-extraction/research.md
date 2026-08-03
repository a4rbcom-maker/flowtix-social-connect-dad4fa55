# Phase 0 Research: استخراج شامل لأعضاء الجروبات

**Feature**: 007-group-members-full-extraction
**Date**: 2026-07-31

معظم القرارات مأخوذة من ميزة 006 (page-followers) لأن النمط مطابق. هنا الفروقات الخاصة بـ group-members.

---

## R-001: قراءة العدد الإجمالي لأعضاء الجروب

**Decision**: توسيع دالة `parseFollowersCount` في `base.ts` لتشمل pattern "members" / "أعضاء" / "X members" (نفس الدالة، patterns إضافية).

**Rationale**: 
- الدالة موجودة وتعمل لـ page-followers
- إضافة patterns "members" تحوّلها لدالة عامة لقراءة أعداد الـ social profiles
- تجنب تكرار دالة جديدة بنفس المنطق

**Alternatives considered**:
- **دالة جديدة `parseGroupMembersCount`**: تكرار — مرفوض
- **GraphQL API**: متعطّل

**Implementation note**: إضافة patterns:
```text
X members / X people · X members (إنجليزي)
X أعضاء / X عضو / عضو X (عربي)
```

---

## R-002: الفواصل الزمنية لعدم ضغط الخادم

**Decision**: الاعتماد على البنية الموجودة في `BaseExtractor`:
- `requestDelayMs = 600` بين كل scroll
- `batchSizeForRest = 8`، `restDelayMs = 10_000` (10s راحة كل 8 scrolls)
- `group-members.ts` يستدعي `this.restDelay()` عند `scrollAttempts % batchSizeForRest === 0` (موجود سطر 71)

**Rationale**: الكود الحالي يطبّق الفواصل الزمنية المطلوبة. لا تعديل مطلوب.

**Alternatives considered**:
- **فواصل أكبر (10s بين كل scroll)**: مرفوض — يجعل استخراج 50k بطيئاً جداً (ساعات)
- **فواصل أصغر (100ms)**: مرفوض — سيُحظر الجلسة بسرعة

**Implementation note**: لا تعديل. فقط التحقق من استمرار العمل بالفواصل الحالية.

---

## R-003: تخزين العدد الإجمالي وعرض نسبة التغطية

**Decision**: اتباع نفس نمط page-followers (ميزة 006):
- `group-members.ts` يقرأ العدد بعد auth check
- يخزّنه في `job.config.total_members_count` عبر `supabaseService.updateJob`
- TasksPage يعرض الشريط تلقائياً لأنه يستخدم `config.total_followers_count` — **سأعيد تسمية الحقل ليكون عاماً**

**Rationale**: 
- تجنب تكرار UI logic للـ group-members
- الحقل `total_followers_count` حالياً — لكنه يعمل لأي نوع
- البساطة: استخدم نفس اسم الحقل `total_followers_count` (يُفهم ضمنياً كـ "العدد الإجمالي للجمهور المستهدف")

**Alternatives considered**:
- **حقل جديد `total_members_count`**: يتطلب تعديل TasksPage لإضافة condition آخر — مرفوض
- **إعادة تسمية `total_audience_count`**: كسر backward compat مع 006

**Implementation note**: استخدم نفس الحقل `total_followers_count` (semantic: "العدد الإجمالي للجمهور") في config. TasksPage سيعرض الشريط تلقائياً لـ group-members أيضاً.

---

## R-004: storeProgress و phase لـ group-members

**Decision**: إضافة استدعاءات `storeProgress` في `group-members.ts` بنفس نمط page-followers:
- `phase: "navigating"` عند بدء extract()
- `phase: "scrolling"` قبل الـ while loop
- تحديث كل ~10 scrolls
- `phase: "completed"` في النهاية (ثم enrichment-service يضع "enriching" → "completed")

**Rationale**: 
- الـ phase تشير لتقدم المهمة في صفحة المهام
- نفس قيم phase الموجودة في 006 (navigating / scrolling / enriching / completed)
- لا حاجة لـ "xhr_replay" لأن group-members لا يستخدم phase2 XHR replay

**Implementation note**: 
- إضافة helper methods لـ group-members: `storeExtractionProgress`, `persistMembersCount`, `computeCoverage`, `finalizeStopReason`
- أو استخراجها لـ BaseExtractor لتُشارك مع page-followers (أنظف لكن أكبر تغيير)

**قرار**: تكرار الـ helpers في group-members.ts (أقل مخاطر، نطاق محصور).

---

## R-005: stop_reason لـ group-members

**Decision**: اتباع نفس منطق page-followers:
- `max_results_reached` عند `total >= maxResults` (50,000)
- `no_secondary_session` / `session_rate_limited` عند توقف multi-session
- `source_exhausted` عند `consecutiveEmpty >= 15` (المصدر نُفد)
- `null` إذا تم استخراج كل المتاح بنجاح

**Rationale**: نفس منطق page-followers، يعطي المستخدم توضيحاً عند التوقف المبكر.

**Implementation note**: تعيين `stop_reason` في كل break point.

---

## R-006: multi-session الموجود

**Decision**: لا تعديل — الـ `switchToNextSession()` موجود في `group-members.ts` (سطر 75-91، مُضاف سابقاً).

**Rationale**: البنية مُفعّلة. فقط نضمن استخدامها بشكل صحيح مع الـ storeProgress الجديد.

---

## خلاصة القرارات

| القرار | الملف المتأثر | حالة الكود |
|---|---|---|
| R-001 قراءة العدد + patterns members | `base.ts` (parseFollowersCount) | **توسيع** |
| R-002 الفواصل الزمنية | `base.ts` (موجود) | **لا تعديل** |
| R-003 تخزين العدد ونسبة التغطية | `group-members.ts` | **جديد** |
| R-004 storeProgress + phase | `group-members.ts` | **جديد** |
| R-005 stop_reason | `group-members.ts` | **جديد** |
| R-006 multi-session | `group-members.ts` (موجود) | **لا تعديل** |

**الخلاصة**: تعديلان فقط:
1. توسيع `parseFollowersCount` في `base.ts` (إضافة patterns members)
2. توسيع `group-members.ts` بـ storeProgress + phase + stop_reason + قراءة العدد (نفس نمط page-followers)

باقي البنية (الفواصل الزمنية، الإثراء، صفحة المهام، الشريط الملوّن) موجودة من 006 وتعمل تلقائياً.
