# عقد الـ API: استخراج متابعي الصفحات

**Feature**: 006-page-followers-full-extraction
**Service**: extraction-service (port 3100)
**Auth**: `X-API-Key: flowtix-extraction-2026` (كل الطلبات)

يصف هذا الملف العقد المُوسّع لـ endpoint الاستخراج ليشمل قراءة العدد الإجمالي ونسبة التغطية. لا يضيف endpoints جديدة، فقط يوسّع استجابة الـ `/extract` و `/jobs/{id}`.

---

## Endpoint 1: `POST /extract` — بدء استخراج متابعين

### الطلب (Request)

لا تغيير عن الموجود — الـ payload يُحدد نوع `pages` لاستخراج متابعين صفحة:

```json
{
  "session_id": "uuid-primary",
  "session_ids": ["uuid-primary", "uuid-secondary"],
  "type": "pages",
  "source_url": "https://www.facebook.com/MarwaHssanofficial",
  "job_name": "استخراج متابعين مروة حسن",
  "max_results": 100000,
  "skip_duplicates": true
}
```

### الاستجابة (Response 200)

```json
{
  "job_id": "uuid-job",
  "status": "running",
  "result_count": 0,
  "progress": 0
}
```

### السلوك الجديد (داخلياً)

عند بدء المهمة، الـ `runExtractionJob` يضيف خطوة **قراءة العدد الإجمالي** قبل المرور للاستخراج:

```text
1. createContext لكل session
2. pre-flight auth check
3. [جديد] page.goto(source_url) → parseFollowersCount(html) → تخزين في job.config.total_followers_count
4. createExtractor(page-followers) → extract()
```

### حالات الفشل (Error Codes — لا تغيير)

| HTTP | Code | السبب |
|------|------|-------|
| 400 | INVALID_INPUT | URL غير صالح أو ليس صفحة |
| 400 | SESSION_NOT_CONNECTED | الجلسة الأساسية غير متصلة |
| 401 | API_KEY_MISSING | مفتاح API ناقص |
| 409 | JOB_ALREADY_ACTIVE | مهمة أخرى قيد التشغيل |

---

## Endpoint 2: `GET /jobs/{jobId}` — تفاصيل المهمة (مُوسّع)

### الاستجابة (Response 200) — حقول جديدة

```json
{
  "id": "uuid-job",
  "name": "استخراج متابعين مروة حسن",
  "type": "pages",
  "status": "running",
  "result_count": 150,
  "config": {
    "max_results": 100000,
    "skip_duplicates": true,
    "session_ids": ["uuid1", "uuid2"],
    "total_followers_count": 247,           // جديد
    "total_followers_source": "page_ui"     // جديد
  },
  "progress": {
    "discovered": 150,
    "processed": 145,
    "phase": "xhr_replay",                  // موجود
    "phase_cycle": 8,
    "coverage_rate": 60.7,                  // جديد
    "stop_reason": null,                    // جديد
    "last_update": "2026-07-31T22:30:00Z"
  },
  "started_at": "2026-07-31T22:25:00Z",
  "completed_at": null
}
```

### حساب `coverage_rate` في الاستجابة

يُحسب إما في الخادم أو الـ Frontend (الأخير مُختار للبساطة):

```text
coverage_rate = total_followers_count > 0 
  ? round(discovered / total_followers_count * 100, 1)
  : null
```

---

## Endpoint 3: `POST /extract` بـ `job_id` — استئناف (Resume)

عند استئناف مهمة `paused`، الـ route يستخرج `session_ids` و `total_followers_count` من `config` الـ job السابق (مُنفّذ في ميزة سابقة لـ `session_ids`).

### الطلب

```json
{
  "job_id": "uuid-existing-job",
  "cursor": "https://www.facebook.com/MarwaHssanofficial/followers",
  "session_id": "uuid-primary",
  "type": "pages",
  "source_url": "https://www.facebook.com/MarwaHssanofficial",
  "max_results": 100000,
  "skip_duplicates": true
}
```

### السلوك

- إذا `config.total_followers_count` موجود في الـ job السابق ← يُعاد استخدامه (لا إعادة قراءة)
- إذا غير موجود ← يُعاد قراءته من الصفحة

---

## عقد الـ progress update (داخلي)

الـ `page-followers.ts` يستدعي `supabaseService.storeProgress(jobId, progress)` دورياً:

```text
كل 10 صفحات في phase2XHRReplay (نمط موجود في messenger-contacts.ts)
```

شكل الـ payload:

```typescript
{
  discovered: number,         // cumulative
  processed: number,          // after dedup
  phase: "navigating" | "scrolling" | "xhr_replay" | "enriching" | "completed",
  phase_cycle: number,        // pages/scrolls في المرحلة الحالية
  coverage_rate?: number,     // محسوب في الـ Frontend من discovered / total
  stop_reason?: string | null,
  last_update: ISO8601
}
```

---

## عقد التوقف مع `stop_reason`

عند `coverage_rate < 85%` عند الاكتمال، يحدّد `page-followers.ts` الـ `stop_reason`:

| الشرط | `stop_reason` |
|---|---|
| انتهت كل الجلسات بـ rate limit (consecutiveErrors >= 12) و `secondarySessionPages.length === 0` | `no_secondary_session` |
| انتهت كل الجلسات بـ rate limit (consecutiveErrors >= 12) و `secondarySessionPages.length > 0` | `session_rate_limited` |
| `consecutiveEmpty >= 15` (المصدر لم يعد يعطي نتائج) | `source_exhausted` |
| `total >= max_results` | `max_results_reached` |
| وإلا (نجح بلوغ ≥ 85% أو المصدر طبيعياً نُفد) | `null` |

---

## عقد الـ Frontend queries

### `useExtractionJob(jobId)` — polling

- `refetchInterval`: 3000ms للحالات `running`/`queued`، `false` عدا ذلك
- يستخرج `coverage_rate` و `phase` و `stop_reason` من `progress`
- يمررها لـ `ExtractionJobCard`

### `useExtractionJobs()` — قائمة المهام (صفحة المهام)

- `queryKey`: `["extraction-jobs", userId]`
- تُعيد كل مهام المستخدم بترتيب `created_at DESC`
- تُحدَّث عبر `invalidateQueries` عند بدء/إلغاء مهمة

---

## قيود العقد

- **API key إلزامي** على كل endpoint
- **Tenant isolation**: كل query scoped بـ `user_id`
- **Rate limit داخلي**: 600ms بين scrolls، 10s راحة كل 8 دورات، timeout 10 دقائق لكل مهمة
- **Pagination**: list jobs يدعم limit/offset (موجود)
- **لا تغيير** على endpoints الـ export أو broadcast — خارج نطاق هذه الميزة
