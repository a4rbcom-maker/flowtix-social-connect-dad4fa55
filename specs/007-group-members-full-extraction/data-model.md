# Data Model: استخراج شامل لأعضاء الجروبات

**Feature**: 007-group-members-full-extraction
**Date**: 2026-07-31

نفس بنية data-model.md من ميزة 006 (تُعاد للسياق). لا تعديل على schema — فقط استخدام أعمق للحقول الموجودة.

---

## الكيانات الموجودة (توسيع استخدام)

### 1. `extraction_jobs` — حقل `config` (JSON)

الحقل `total_followers_count` (المُضاف في 006) يُعاد استخدامه لـ group-members كـ "العدد الإجمالي للجمهور المستهدف" (أعضاء الجروب):

```json
{
  "max_results": 50000,
  "skip_duplicates": true,
  "session_ids": ["uuid1", "uuid2"],
  "total_followers_count": 10000,        // عدد أعضاء الجروب المقروء
  "total_followers_source": "page_ui"    // "page_ui" أو "unknown"
}
```

> **ملاحظة semantic**: اسم الحقل `total_followers_count` يبقى كما هو (للتوافق مع 006) لكن semantic ي encompass جميع أنواع الاستخراج (followers/members).

### 2. `extraction_jobs` — حقل `progress` (JSON)

```json
{
  "discovered": 5000,
  "processed": 4950,
  "phase": "scrolling",          // navigating / scrolling / enriching / completed
  "phase_cycle": 120,
  "coverage_rate": 50.0,         // محسوب في الـ Frontend
  "stop_reason": null,           // session_rate_limited | source_exhausted | max_results_reached | null
  "last_update": "2026-07-31T...",
  "enrichment": {                // يُضاف من enrichment-service بعد الاكتمال
    "total": 4950,
    "enriched": 1200,
    "not_found": 3750,
    "coverage_percent": 24,
    "sources": { "egypt": 1200 }
  }
}
```

### 3. `extraction_results` (PostgreSQL) — لا تعديل

النتائج من نوع `member` تُحفظ هنا، والإثراء يُضاف في `metadata.enrichment`.

---

## قيم `phase` لـ group-members

| القيمة | المعنى |
|---|---|
| `navigating` | جاري فتح صفحة الجروب |
| `scrolling` | جاري التمرير وجمع الأعضاء |
| `enriching` | جاري الإثراء من Egypt DB |
| `completed` | اكتملت المهمة |

> **ملاحظة**: لا `xhr_replay` لأن group-members لا تستخدم phase2 XHR replay (تستخدم DOM scrolling فقط).

---

## قيم `stop_reason` لـ group-members

| القيمة | المعنى | الإجراء المقترح |
|---|---|---|
| `session_rate_limited` | جلسات FB أوقفت العمل | أضف جلسات أكثر |
| `no_secondary_session` | لا توجد جلسة بديلة | أضف جلسة ثانية |
| `source_exhausted` | المصدر لم يعد يعطي نتائج | قد يكون الأعضاء مخفيين |
| `max_results_reached` | بلوغ 50,000 | OK — ارفع الحد إذا لزم |
| `null` | اكتمال طبيعي | — |

---

## منطق حساب نسبة التغطية

```text
coverage_rate = (discovered / total_followers_count) * 100

// مثال: جروب 10,000 عضو، استخرج 8,500 → 85.0%
// مثال: جروب 50,000 عضو، استخرج 50,000 → 100% (max_results_reached)
```

**مكان الحساب**: Frontend في `TasksPage.tsx` (موجود من 006، يعمل تلقائياً).

---

## انتقالات الحالة للمهمة

نفس ميزة 006:

```text
queued → running → completed    (نجاح)
                 → canceled     (مستخدم أوقفها)
                 → paused       (انقطاع، قابل للاستئناف)
                 → failed       (خطأ auth/network)
```

---

## الفواصل الزمنية (Rate Limiting)

موجودة في `BaseExtractor` وتُحترم تلقائياً في `group-members.ts`:

| الفاصل | القيمة | الموقع |
|---|---|---|
| `requestDelayMs` | 600ms | بين كل scroll |
| `batchSizeForRest` | 8 scrolls | كل N scrolls يأخذ راحة |
| `restDelayMs` | 10,000ms (10s) | راحة كل 8 scrolls |
| `maxExecutionMs` | 1,700,000ms (~28min) | الحد الأقصى لكل مهمة |
| `maxConsecutiveEmpty` | 15 | حد التوقف عند فراغ متواصل |

---

## RLS (Row Level Security)

كل الجداول عليها RLS policies تنحصر في `user_id = auth.uid()`. لا تغيير في هذه الميزة.
