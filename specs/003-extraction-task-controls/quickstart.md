# Quickstart: Extraction Task Controls Validation

**Feature**: 003-extraction-task-controls
**Date**: 2026-07-29

---

## Prerequisites

- extraction-service running on `http://localhost:3100`
- Frontend dev server on `http://localhost:5173`
- Connected Facebook session (`test3` — ID: `025f9bfd-cb80-408a-9e84-9d15fa8af772`)
- Target group: `https://www.facebook.com/groups/229633034457112`

---

## Scenario 1: Stop and Keep Data (FR-1, FR-2, FR-3)

### Steps

1. Navigate to `http://localhost:5173/dashboard/facebook/extract-members`
2. Select session `test3`
3. Enter group URL: `https://www.facebook.com/groups/229633034457112`
4. Start extraction
5. Wait until ~200+ contacts are collected
6. Navigate to `http://localhost:5173/dashboard/tasks`
7. Find the running job in "Active" tab
8. Verify button says **"إيقاف"** (Arabic) or **"Stop"** (English) — NOT "Cancel" / "إلغاء"
9. Verify icon is `Square` — NOT `CircleX`
10. Click Stop, confirm in dialog
11. Wait 3-5 seconds

### Expected Outcome

- [ ] Job moves to **"Stopped"** filter tab — NOT "Failed", NOT "Completed"
- [ ] Job status badge shows **"موقوفة"** / **"Stopped"** (amber color)
- [ ] Job `result_count` shows the partial count (e.g., "200")
- [ ] Export buttons (CSV, Excel, JSON) are available
- [ ] Job status in DB remains `"canceled"` — check extraction-service logs for `job ... canceled` line

---

## Scenario 2: Natural Completion (FR-4, FR-5)

### Steps

1. Navigate to extraction page
2. Start extraction on a small group (e.g., `https://www.facebook.com/groups/229633034457112`)
3. Let it run until the group's members are exhausted
4. Monitor extraction-service console output

### Expected Outcome

- [ ] No **count limit selector** visible in the UI
- [ ] Extraction runs until consecutive empty scrolls trigger completion
- [ ] Console log shows: `stopping: N consecutive empty scrolls`
- [ ] Job status becomes **"Completed"** — NOT "Paused"
- [ ] Job appears in "Completed" tab on Tasks page

---

## Scenario 3: Data Quality (FR-6)

### Steps

1. Run extraction on `https://www.facebook.com/groups/229633034457112`
2. Wait for completion or stop after 500+ contacts
3. Export results as CSV
4. Open CSV in a spreadsheet application

### Expected Outcome

- [ ] **Zero duplicate IDs** — run `=COUNTIF(B:B, B2)` on ID column, all counts = 1
- [ ] **Zero duplicate names** — verify no name appears twice with different IDs
- [ ] **No auto-generated names** — search for "Adventurous", "Playful", "Shiny", "Brave", "Clever"
- [ ] **No business names** — search for "store", "news", "school", "restaurant", "bot"
- [ ] **Spot-check**: open 5 random `profile_url` values in browser — all should be real Facebook user profiles and members of the group

---

## Scenario 4: Rate-Limiting Transparency (FR-7)

### Steps

1. Start a large extraction (5,000+ member group)
2. Monitor extraction-service console output
3. Look for delay/rest log entries

### Expected Outcome

- [ ] Log shows `resting 10000ms after 8 scrolls` every 8 iterations
- [ ] Average request rate stays under 2/second
- [ ] No Facebook captcha or block appears during extraction
- [ ] If rate-limit backoff triggers, log shows `backoff: increasing delay` message

---

## Scenario 5: Stopped Job Visibility (FR-3)

### Steps

1. Start and stop 2 extractions (different types)
2. Complete 1 extraction naturally
3. Fail 1 extraction (use expired session `test2`)
4. Navigate to `http://localhost:5173/dashboard/tasks`

### Expected Outcome

- [ ] **"Stopped"** tab shows 2 jobs with amber badges
- [ ] **"Completed"** tab shows 1 job with green badge
- [ ] **"Failed"** tab shows 1 job with red badge — does NOT contain stopped jobs
- [ ] All filter tabs have correct count badges
- [ ] Each stopped job has working export buttons

---

## Cleanup After Testing

1. Delete test jobs from Supabase if needed:
   ```sql
   DELETE FROM extraction_jobs WHERE name LIKE 'Extract%' AND created_at > '2026-07-29';
   ```
2. Verify extraction-service is idle (no orphaned browser contexts):
   ```bash
   curl http://localhost:3100/health
   ```
