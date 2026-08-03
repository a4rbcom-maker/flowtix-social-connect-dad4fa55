# عقد الـ API: استخراج أعضاء الجروبات

**Feature**: 007-group-members-full-extraction
**Service**: extraction-service (port 3100)
**Auth**: `X-API-Key: flowtix-extraction-2026`

نفس عقد 006، الفرق الوحيد هو `type: "groups"` بدل `"pages"`.

---

## Endpoint 1: `POST /extract` — بدء استخراج أعضاء جروب

### الطلب

```json
{
  "session_id": "uuid-primary",
  "session_ids": ["uuid-primary", "uuid-secondary"],
  "type": "groups",
  "source_url": "https://www.facebook.com/groups/123456789/members",
  "job_name": "استخراج أعضاء جروب",
  "max_results": 50000,
  "skip_duplicates": true
}
```

### الاستجابة (200)

```json
{
  "job_id": "uuid-job",
  "status": "running",
  "result_count": 0,
  "progress": 0
}
```

### السلوك الجديد (داخلياً)

```text
1. createContext لكل session
2. pre-flight auth check
3. [جديد] page.goto(source_url) → parseFollowersCount(html) → تخزين في config.total_followers_count
4. createExtractor(group-members) → extract()
```

---

## Endpoint 2: `GET /jobs/{jobId}` — تفاصيل المهمة

نفس استجابة 006 (تستخدم نفس الحقول):

```json
{
  "id": "uuid-job",
  "type": "groups",
  "status": "running",
  "result_count": 5000,
  "config": {
    "max_results": 50000,
    "session_ids": ["uuid1", "uuid2"],
    "total_followers_count": 10000,
    "total_followers_source": "page_ui"
  },
  "progress": {
    "discovered": 5000,
    "processed": 4950,
    "phase": "scrolling",
    "phase_cycle": 120,
    "coverage_rate": 50.0,
    "stop_reason": null,
    "last_update": "..."
  }
}
```

---

## عقد الـ progress update (داخلي)

`group-members.ts` يستدعي `supabaseService.storeProgress(jobId, progress)` دورياً (كل ~10 scrolls):

```typescript
{
  discovered: number,
  processed: number,
  phase: "navigating" | "scrolling" | "enriching" | "completed",
  phase_cycle: number,
  coverage_rate?: number | null,
  stop_reason?: string | null,
  last_update: ISO8601
}
```

---

## عقد الـ Frontend queries

نفس ميزة 006 — لا تعديل:
- `useExtractionJobs()` polling كل 3s للحالات النشطة
- `useExtractionJob(jobId)` polling كل 3s
- `TasksPage` يعرض phase + شريط التغطية + stop_reason تلقائياً (لا تمييز بين types)

---

## قيود العقد

- **API key إلزامي** على كل endpoint
- **Tenant isolation** عبر `user_id`
- **Rate limit داخلي**: 600ms بين scrolls، 10s راحة كل 8 دورات
- **Pagination**: list jobs يدعم limit/offset
- **Job timeout**: ~28 دقيقة كحد أقصى (jobTimeoutMs في الـ queue)
