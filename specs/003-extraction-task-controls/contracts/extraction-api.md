# Contract: Extraction API

**Service**: extraction-service (Express, port 3100)
**Authentication**: `X-API-Key: flowtix-extraction-2026`

---

## POST /extract

Start or resume an extraction job.

### Request

```json
{
  "session_id": "string (required)",
  "type": "groups | pages | post_comments | post_reactions | messenger_contacts",
  "source_url": "string (required) — full Facebook URL",
  "job_name": "string (optional)",
  "max_results": "number (optional, default: 100000, max: 100000)",
  "skip_duplicates": "boolean (optional, default: true)",
  "cursor": "string (optional — for resuming paused jobs)",
  "job_id": "string (optional — for resuming)"
}
```

### Response 200

```json
{
  "job_id": "uuid",
  "status": "running",
  "result_count": 0,
  "progress": 0
}
```

### Response 409

```json
{
  "error": {
    "code": "JOB_ALREADY_ACTIVE",
    "message": "لديك مهمة استخراج قيد التشغيل بالفعل..."
  }
}
```

### Changes (FR-4)

| Field | Before | After |
|---|---|---|
| `max_results` default | 10000 | 100000 (safety ceiling only, not user-facing) |
| `max_results` validation | `min(1).max(100000)` | Unchanged — still validated server-side |

---

## POST /export

Export job results as CSV, JSON, or XLSX.

### Request

```json
{
  "job_id": "string (required)",
  "format": "csv | json | xlsx (default: csv)"
}
```

### Response

- **CSV**: `Content-Type: text/csv; charset=utf-8` with BOM, columns: `id,name,profile_url,avatar_url`
- **JSON**: `Content-Type: application/json`, array of `{ id, name, profile_url, avatar_url }`
- **404**: No results found for this job

### No Changes

Export works for all job statuses with `result_count > 0`, including `canceled` (stopped) jobs.

---

## POST /broadcast

Queue a broadcast message to extracted contacts.

### Request

```json
{
  "job_id": "string (required)",
  "message": "string (required, max 5000 chars)"
}
```

### Response 200

```json
{
  "status": "queued",
  "contact_count": 1300,
  "message": "Broadcast queued successfully"
}
```

### No Changes

Broadcast works for all job statuses with results.

---

## Job Status Transitions (Backend Logic)

### extract.ts — Post-Extraction Handler

```text
IF extractor returns { done: true }:
    currentStatus = getJobStatus(jobId)   // NEW: re-read from DB
    IF currentStatus === "canceled":
        PRESERVE "canceled" — do NOT overwrite
        SET completed_at = now()
    ELSE:
        SET status = "completed"
        SET completed_at = now()

ELSE IF extractor returns { nextCursor }:
    SET status = "paused"
    SET config.cursor = nextCursor

ELSE:
    SET status = "completed"
    SET completed_at = now()
```

### group-members.ts — Loop Exit Conditions

```text
WHILE not done AND not shouldStop AND total < maxResults:
    ...extract members...
    
    IF total >= maxResults:   // NEW: explicit check
        done = true
        nextCursor = undefined
        BREAK

IF shouldStop AND not done:
    // Time budget reached — pausable
    done = false
    nextCursor = url

RETURN { extracted: total, nextCursor, done }
```

---

## Frontend API (extraction-repository.ts)

### stopJob (renamed from cancelJob)

```typescript
async stopJob(jobId: string): Promise<void> {
  await supabase
    .from("extraction_jobs")
    .update({ status: "canceled", completed_at: new Date().toISOString() })
    .eq("id", jobId);
}
```

**Note**: DB status remains `"canceled"` — only the UI label changes to "Stop" / "إيقاف".

### createExtraction (modified)

```typescript
async createExtraction(input: ExtractionInput): Promise<ExtractionProgress> {
  // max_results no longer comes from UI — hardcoded safety ceiling
  const response = await fetch(`${API_BASE}/extract`, {
    method: "POST",
    body: JSON.stringify({
      ...input,
      max_results: 100000,  // safety ceiling, not user-configurable
    }),
  });
}
```

---

## Frontend Tasks Page (TasksPage.tsx)

### Status Grouping (Post-Fix)

```typescript
const activeJobs  = realJobs.filter(j => ["running", "queued", "paused"].includes(j.status));
const completedJobs = realJobs.filter(j => j.status === "completed");
const stoppedJobs = realJobs.filter(j => j.status === "canceled");    // NEW: separate from failed
const failedJobs  = realJobs.filter(j => j.status === "failed");
```

### Filter Tabs

| Tab | Label (AR) | Label (EN) | Statuses |
|---|---|---|---|
| all | الكل | All | * |
| active | نشطة | Active | running, queued, paused |
| completed | مكتملة | Completed | completed |
| stopped | موقوفة | Stopped | canceled |
| failed | فاشلة | Failed | failed |

### Stop Button

```tsx
// Icon: Square (not CircleX)
// Label: t("pages.tasks.stop") — "إيقاف" / "Stop"
// Color: warning (not error)
// Confirmation: "هل تريد إيقاف هذه المهمة؟ سيتم حفظ البيانات المستخرجة."
```
