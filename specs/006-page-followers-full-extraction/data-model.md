# Data Model: استخراج شامل لمتابعين الصفحات

**Feature**: 006-page-followers-full-extraction
**Date**: 2026-07-31

يصف هذا الملف الكيانات وحقول البيانات المُستخدمة/المُضافة، بدون تكرار الـ schema الكامل لـ Supabase (موجود في `src/types/database.types.ts`).

---

## الكيانات الموجودة (توسيع)

### 1. `extraction_jobs` (PostgreSQL via Supabase)

الجدول الرئيسي للمهام — يخزّن الحالة والـ progress. **لا تعديل على الـ schema**، فقط استخدام أعمق للحقول الموجودة.

#### حقل `config` (JSON) — توسيع

الحقول الموجودة حالياً:
```json
{
  "max_results": 100000,
  "skip_duplicates": true,
  "session_ids": ["uuid1", "uuid2"]
}
```

**حقول جديدة تُضاف لـ `config`**:
```json
{
  "total_followers_count": 247,        // العدد الإجمالي المقروء من الصفحة (R-001)
  "total_followers_source": "page_ui"  // مصدر العدد: "page_ui" أو "unknown"
}
```

#### حقل `progress` (JSON) — توسيع

الحقول الموجودة:
```json
{
  "discovered": 150,
  "processed": 145,
  "duplicates_skipped": 5,
  "estimate": "ongoing",
  "phase": "scrolling",          // موجود — يستخدم في messenger
  "phase_cycle": 8,
  "last_update": "2026-07-31T..."
}
```

**حقول جديدة تُضاف لـ `progress`**:
```json
{
  "coverage_rate": 60.7,         // نسبة التغطية المحسوبة = discovered / total * 100 (R-002)
  "stop_reason": null            // سبب التوقف إذا coverage < 85% (R-005)
                                 // القيم: "session_rate_limited" | "no_secondary_session" 
                                 //        | "source_exhausted" | "max_results_reached" | null
}
```

#### قيم `phase` المُستخدمة في هذه الميزة

| القيمة | المعنى |
|---|---|
| `navigating` | جاري فتح صفحة Facebook |
| `scrolling` | مرحلة التمرير الأولى (DOM-based) |
| `xhr_replay` | مرحلة الـ GraphQL XHR replay (phase2) |
| `enriching` | جاري الإثراء من Egypt DB |
| `completed` | اكتملت المهمة |

#### قيم `stop_reason` (عند `coverage_rate < 85%`)

| القيمة | المعنى | الإجراء المقترح للمستخدم |
|---|---|---|
| `session_rate_limited` | جلسة Facebook أوقفتها | أضف جلسة ثانية |
| `no_secondary_session` | لا توجد جلسة بديلة | أضف جلسة ثانية |
| `source_exhausted` | المصدر لم يعد يعطي نتائج | قد يكون المتابعون مخفيين بخصوصية |
| `max_results_reached` | بلوغ الحد الأقصى المطلوب | ارفع الحد إذا لزم |

---

### 2. `extraction_results` (PostgreSQL) — لا تعديل

النتائج المُستخرجة من نوع `follower` تُحفظ هنا. الإثراء يُضاف في حقل `metadata` (JSON) كجزء من ميزة 005.

```text
extraction_results.metadata = {
  ...original,
  enrichment: {
    phone: "+201110598247",
    first_name: "احمد",
    ...
    source_db: "egypt" | "iraq"
  } | null
}
```

---

### 3. `fb_sessions` (PostgreSQL) — لا تعديل

تُستخدم كما هي لاختيار الجلسات الأساسية والثانوية. لا تعديل في هذه الميزة.

---

## الكيانات الجديدة في الـ Frontend

### 4. `ExtractionJobProgress` (TypeScript type — Frontend)

توسيع النوع الموجود في `src/lib/extraction/types.ts` ليشمل الحقول الجديدة:

```typescript
interface ExtractionJobProgress {
  discovered: number;
  processed: number;
  duplicates_skipped?: number;
  estimate?: string;
  phase?: "navigating" | "scrolling" | "xhr_replay" | "enriching" | "completed";
  phase_cycle?: number;
  coverage_rate?: number;          // جديد
  stop_reason?: StopReason | null; // جديد
  last_update?: string;
}

type StopReason =
  | "session_rate_limited"
  | "no_secondary_session"
  | "source_exhausted"
  | "max_results_reached";
```

### 5. `ExtractionJobConfig` (TypeScript type — Frontend)

توسيع ليشمل:

```typescript
interface ExtractionJobConfig {
  max_results: number;
  skip_duplicates: boolean;
  session_ids: string[];
  total_followers_count?: number;     // جديد
  total_followers_source?: string;    // جديد
}
```

---

## منطق حساب نسبة التغطية

```text
coverage_rate = (discovered / total_followers_count) * 100

// أمثلة:
// discovered=210, total=247  →  coverage_rate=85.0%
// discovered=150, total=247  →  coverage_rate=60.7%
// total=0 أو undefined       →  coverage_rate=null (عرض "غير معروف")
```

**مكان الحساب**: Frontend في `ExtractionJobCard.tsx` (أبسط، لا logic خادم إضافي).

**ألوان شريط التغطية**:
- `coverage_rate >= 85` → أخضر (هدف محقق)
- `65 <= coverage_rate < 85` → أصفر (تحذير)
- `coverage_rate < 65` → أحمر (مخاطرة)

---

## انتقالات الحالة للمهمة

مأخوذة من AGENTS.md، تُذكَّر هنا للسياق (لا تعديل):

```text
queued → running → completed    (نجاح، المصدر نُفد أو بلوغ 85%+)
                 → canceled     (المستخدم أوقفها، بيانات جزئية محفوظة)
                 → paused       (انقطاع نظام، يمكن استئنافها)
                 → failed       (خطأ auth/network)
```

**قاعدة بلوغ الهدف**: 
- المهمة تكتمل بـ `completed` عندما: `coverage_rate >= 85%` **أو** المصدر نُفد (`source_exhausted`) **أو** بلوغ `max_results`.
- لا يتم فرض `failed` على مهمة وصلت لـ 60% بسبب rate limit — بل `completed` مع `stop_reason: session_rate_limited`.

---

## الفهارس والأداء

- `extraction_jobs.user_id` — مفهرس (للـ list per user)
- `extraction_jobs.status` — مفهرس (لفلترة queued/running)
- `extraction_results.job_id` — مفهرس
- Egypt DB `data(FBID, Phone)` — مفهرس (`DataIndex`)، البحث بـ FBID = 1ms

لا فهارس جديدة مطلوبة.

---

## RLS (Row Level Security)

كل الجداول المذكورة عليها RLS policies تنحصر في `user_id = auth.uid()` أو `is_super_admin()` (migration `2026072817`). هذه الميزة لا تضيف query تتجاوز الـ tenant boundaries.

- المهمة: `user_id` يُضبط من الـ session owner
- النتائج: `workspace_id` / `user_id` من الـ job
- الإثراء: يعمل على نفس `job_id` دون cross-tenant
