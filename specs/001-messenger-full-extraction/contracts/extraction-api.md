# Extraction API Contract

**Feature**: Messenger Full Extraction  
**Date**: 2026-07-29

---

## POST /extract

Create a new extraction job. Existing endpoint, no changes to request/response shape.

### Request

```http
POST /extract HTTP/1.1
Content-Type: application/json
x-api-key: flowtix-extraction-2026

{
  "session_id": "109ad6c5-0612-485a-8735-ca48e94e32e2",
  "type": "messenger_contacts",
  "source_url": "manfaz.alnasr"
}
```

### Response (200)

```json
{
  "job_id": "ea948f34-7297-4294-ba6f-1a0a6cafc851",
  "status": "queued"
}
```

---

## GET /extract/:jobId/status

Get job status including progress. **Updated response** — adds `progress` field.

### Response (200)

```json
{
  "job_id": "ea948f34-7297-4294-ba6f-1a0a6cafc851",
  "status": "running",
  "type": "messenger_contacts",
  "source_url": "manfaz.alnasr",
  "result_count": 1350,
  "error": null,
  "started_at": "2026-07-29T18:00:00Z",
  "progress": {
    "discovered": 1400,
    "processed": 1350,
    "duplicates_skipped": 0,
    "estimate": "ongoing",
    "phase": "paginating",
    "phase_cycle": 8,
    "last_update": "2026-07-29T18:03:30Z"
  }
}
```

### Status Field Values

| `status` | Meaning | When Set |
|----------|---------|----------|
| `queued` | Waiting in queue | Immediately after job creation |
| `running` | Executing extraction | When Playwright session starts |
| `completed` | End of list reached (3 empty cycles) | When pagination/scroll exhausts all pages |
| `partial` | Timeout or user limit reached | `JOB_TIMEOUT_MS` elapsed OR `maxResults` achieved |
| `failed` | Error occurred | Auth failure, page unavailable, unexpected exception |
| `canceled` | User cancelled | Explicit cancellation request |

### Progress Phase Values

| `phase` | Description |
|---------|-------------|
| `initializing` | Opening browser, loading cookies, navigating to page |
| `paginating` | Cursor-based GraphQL pagination active |
| `scrolling` | Virtual-scroll fallback active on inbox page |
| `mbasic_fallback` | Using mbasic.facebook.com as last resort |
| `finishing` | Flushing remaining contacts, cleaning up |

---

## Frontend Polling Contract

The frontend polls `GET /extract/:jobId/status` every 3 seconds while `status` is `queued` or `running`.

### Progress Display

The frontend renders:
- A progress bar: width = `progress.estimate` (clamped 0–100, or indeterminate animation for `"ongoing"`)
- Text: `"Discovered: {progress.discovered} | Processed: {progress.processed}"`
- Phase label: translated phase name (e.g., "جارٍ التصفح..." for `scrolling`)
- Elapsed time

When `status` changes to `completed`, `partial`, or `failed`:
- Show final count and stop reason (from `error` field)
- If `partial`: warn that results are incomplete with the reason
- If `failed`: show error message

---

## Supabase Direct Reads (Frontend)

The frontend reads job status from the `extraction_jobs` table directly via Supabase JS client:

```typescript
const { data: job } = await supabase
  .from('extraction_jobs')
  .select('id, status, type, source, result_count, error, progress, started_at, completed_at')
  .eq('id', jobId)
  .single();
```

The `progress` JSON column is returned as-is. The frontend parses it to drive the progress bar.
