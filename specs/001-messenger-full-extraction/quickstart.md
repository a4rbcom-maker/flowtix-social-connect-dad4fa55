# Quickstart: Validating Messenger Full Extraction

**Feature**: Messenger Full Extraction  
**Date**: 2026-07-29

---

## Prerequisites

1. **Extraction service running**:
   ```powershell
   cd D:\Projects\FlowTix\extraction-service
   npx tsx src/index.ts
   ```
   Service should log: `FlowTix Extraction Service v1.0.0 starting on port 3100`

2. **Valid Facebook session** for page `manfaz.alnasr` with `session_id = 109ad6c5-0612-485a-8735-ca48e94e32e2`

3. **Any running jobs from previous tests cancelled**:
   ```powershell
   Invoke-RestMethod "http://localhost:3100/extract/cancel" -Method POST -Headers @{"x-api-key"="flowtix-extraction-2026"}
   ```

---

## Validation Scenarios

### Scenario 1: Small Page — Basic Extraction

**Goal**: Verify bootstrap + pagination works end-to-end.

1. Start a new extraction:
   ```powershell
   $body = @{ session_id = "109ad6c5-0612-485a-8735-ca48e94e32e2"; type = "messenger_contacts"; source_url = "manfaz.alnasr" } | ConvertTo-Json
   $r = Invoke-RestMethod -Uri "http://localhost:3100/extract" -Method POST -ContentType "application/json" -Headers @{"x-api-key"="flowtix-extraction-2026"} -Body $body
   Write-Output "Job: $($r.job_id)"
   ```

2. Poll status every 10 seconds:
   ```powershell
   while ($true) {
     $status = Invoke-RestMethod "http://localhost:3100/extract/$jobId/status" -Headers @{"x-api-key"="flowtix-extraction-2026"}
     Write-Output "$($status.status) | Contacts: $($status.result_count) | Progress: $($status.progress | ConvertTo-Json -Compress)"
     if ($status.status -ne "running") { break }
     Start-Sleep 10
   }
   ```

3. **Expected outcome**:
   - First batch of contacts (≥ 50) appears within 60 seconds.
   - `progress.discovered` increments with each pagination cycle.
   - Final status is `completed` with a clear stop reason in `error`.
   - Total contacts ≥ 90 (the minimum known for this page).
   - No duplicate contacts in `extraction_results` for this `job_id`.

### Scenario 2: Consistency — 3 Consecutive Runs

**Goal**: Verify same page yields consistent results.

1. Run Scenario 1 three times in succession.
2. Compare `result_count` across runs.

3. **Expected outcome**:
   - All three runs yield within ±5% of each other.
   - All three complete with status `completed`.

### Scenario 3: Large Page — 1,000+ Contacts

**Goal**: Verify the system handles high contact volumes.

1. Use a test page with 1,000+ conversations (or increase `maxResults` to 5,000).

2. **Expected outcome**:
   - Extraction continues beyond 100, 200, 500, 1,000 contacts.
   - Progress bar shows `"estimate": "ongoing"` until near completion.
   - The system does NOT stop at arbitrary thresholds (50, 80, 100).
   - If `JOB_TIMEOUT_MS` is reached, status is `partial` (not `completed`) with message "timeout reached at N contacts".

### Scenario 4: Failure Handling

**Goal**: Verify correct failure reporting.

1. Stop the extraction mid-run (send cancel request).
   ```powershell
   Invoke-RestMethod "http://localhost:3100/extract/$jobId/cancel" -Method POST -Headers @{"x-api-key"="flowtix-extraction-2026"}
   ```

2. **Expected outcome**:
   - Job status becomes `canceled`.
   - Partial results are preserved in `extraction_results`.
   - Log contains: `"job $jobId canceled by user at N contacts"`.

### Scenario 5: Deduplication

**Goal**: Verify no duplicate contacts.

1. Run Scenario 1 twice.

2. Query results:
   ```sql
   SELECT COUNT(*) as total,
          COUNT(DISTINCT fb_id) as unique_count
   FROM extraction_results
   WHERE job_id IN ('job1', 'job2');
   ```

3. **Expected outcome**:
   - `total = unique_count` (no duplicates within jobs).
   - Second job's results may overlap with first (contacts already in DB) but `progress.duplicates_skipped` counts them.

### Scenario 6: Progress Visibility

**Goal**: Verify progress updates within 30 seconds.

1. Start a job and immediately poll.

2. **Expected outcome**:
   - Progress timestamp (`last_update`) updates within 30 seconds of job start.
   - Each subsequent progress update is within 30 seconds of the previous.
   - `discovered` and `processed` count monotonically increase.

### Scenario 7: No Regression — WhatsApp

**Goal**: Verify WhatsApp extraction is unaffected.

1. Submit a WhatsApp extraction job (if supported).
2. **Expected outcome**: WhatsApp extraction works identically to before — no errors, full functionality.

---

## Log Inspection

The extraction service writes detailed logs to `svc.log`. Key log patterns to check:

| Pattern | Meaning |
|---------|---------|
| `BATCH cursor saved for doc_id=27615938851434506` | Initial batch response fired — good |
| `no batchListCursor — searching for working pattern` | Batch didn't fire — fallback searching |
| `FOUND working pattern: doc_id=27615938851434506` | Found a working variable pattern |
| `[direct-gql] page N: +X (total=Y, ...)` | Each paginated page result |
| `cursor unchanged, stopping` | End of list detected |
| `=== DONE === total=N` | Final summary |
| `job ... completed/failed/partial` | Final status |

---

## Troubleshooting

| Symptom | Likely Cause | Action |
|---------|-------------|--------|
| Job stuck at `queued` | Service not running or job queue blocked | Check `svc.log` for errors, restart service |
| `no working pattern found` in logs | Facebook changed doc_id or variable fields | Check `svc.log` for attempted patterns; update `varPatterns` array |
| `status=failed: session expired` | FB session cookies invalid | Re-authenticate the session in the dashboard |
| `status=partial: timeout` | Page has more contacts than can be extracted in 600s | Increase `JOB_TIMEOUT_MS` in `.env` |
| Contacts < expected | Scroll/pagination not reaching all pages | Check logs for `cursor unchanged` — if absent, cursor extraction may need updating |
