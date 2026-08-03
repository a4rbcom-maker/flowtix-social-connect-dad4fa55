# Specification: Extraction Task Controls

**Feature**: Extraction Task Controls
**Status**: Draft
**Created**: 2026-07-29
**Owner**: Engineering Team

---

## Problem Statement

The extraction task management system has five critical defects that undermine user trust and data usability:

1. **"Cancel" semantics are wrong** — The user clicks "Cancel" (إلغاء) intending to stop the extraction and keep the collected data. The button label implies destructive intent ("cancel" = discard), when the user actually wants to "Stop" and download what was collected. The partial results ARE saved correctly, but the label causes confusion and hesitation.

2. **Stopped/canceled jobs vanish from Tasks page** — When a user stops a job, it does not appear in the expected location on the Tasks page. Root cause: the extraction route handler overwrites the job status from `"canceled"` to `"completed"` when the extractor returns `done: true` after detecting cancellation. This race condition makes stopped jobs appear under "Completed" instead of a distinct "Stopped" state, confusing the user who expects to find their stopped job clearly marked.

3. **Data quality uncertainty** — After extracting 1,303 contacts from a Facebook group, the user cannot verify whether the results contain duplicates, fake pages, or non-member entities. Previous extraction issues (spec 002) showed pages, bots, and auto-generated names leaking into results. The user needs confidence that every extracted contact is a real group member.

4. **Extraction count limit is ignored** — The user set a limit of 1,000 contacts, but extraction continued past 1,303. While the limit IS enforced in the extraction loop, reaching it marks the job as `"paused"` (not `"completed"`), causing the extraction to appear unfinished. Additionally, the user finds the count limit selector unnecessary and wants it removed from the UI.

5. **Server load concern** — The user is unsure whether group extraction applies rate-limiting delays between requests to avoid overloading Facebook's servers or triggering anti-scraping protections. While delays DO exist (600ms per scroll, 10s rest every 8 scrolls), there is no visibility into this behavior, and the delays are static rather than adaptive.

---

## Goal

Provide reliable, transparent, and user-friendly control over extraction tasks:

- A "Stop" action that clearly communicates "stop collecting and keep what I have"
- Stopped jobs that appear correctly on the Tasks page with their partial results
- Verifiable data quality with zero duplicates and zero non-member entries
- A clean extraction flow that completes naturally when the source is exhausted, without confusing "paused" states
- Transparent rate-limiting that protects against server overload

---

## User Scenarios & Testing

### Scenario 1: Stop and Keep Data
**Actor**: Workspace admin
**Flow**:
1. Admin starts a group extraction
2. After 1,300 contacts are collected, admin clicks "Stop"
3. The button label clearly says "Stop" (إيقاف), not "Cancel" (إلغاء)
4. Extraction halts within a few seconds
5. The job appears on the Tasks page with status "Stopped"
6. Admin can view the 1,300 extracted contacts
7. Admin can export the contacts to CSV/JSON
8. The job status remains "Stopped" — it never silently becomes "Completed"

### Scenario 2: Stopped Job Visibility
**Actor**: Workspace admin
**Flow**:
1. Admin starts an extraction and stops it after collecting partial results
2. Admin navigates to the Tasks page
3. The stopped job is visible in a clearly labeled "Stopped" section or filter
4. The job shows the partial contact count (e.g., "1,300 contacts")
5. Export and broadcast actions are available for the stopped job
6. Admin never needs to wonder "where did my job go?"

### Scenario 3: Extraction Completes at Source Exhaustion
**Actor**: Workspace admin
**Flow**:
1. Admin starts an extraction on a group with 500 members
2. Extraction collects all 500 members
3. The job status becomes "Completed" (not "Paused")
4. No count limit selector is shown in the UI
5. The extraction runs until the group's member list is exhausted

### Scenario 4: Data Quality Verification
**Actor**: Workspace admin
**Flow**:
1. Admin runs a group extraction and gets 1,300 contacts
2. Admin exports the results
3. Admin verifies: no duplicate names or IDs exist in the export
4. Admin verifies: every name corresponds to a real Facebook profile (not a page, bot, or auto-generated name)
5. Admin spot-checks 10 random contacts against the group's member list — all 10 are confirmed members

### Scenario 5: Rate-Limiting Transparency
**Actor**: Workspace admin
**Flow**:
1. Admin starts a large group extraction (5,000+ members)
2. Extraction progresses steadily without triggering Facebook blocks or captchas
3. The extraction does not overwhelm the server with rapid-fire requests
4. If the extraction encounters rate-limiting signals, it backs off adaptively

---

## Functional Requirements

### FR-1: Rename "Cancel" to "Stop"
The action that halts an in-progress extraction must be labeled "Stop" (إيقاف in Arabic), clearly communicating that partial results are preserved.

**Acceptance Criteria**:
- The button on the Tasks page and any extraction progress UI reads "Stop" in English and "إيقاف" in Arabic
- The icon reflects a stop/pause semantic (e.g., `Square` or `CircleStop`), not a destructive cancel icon (`CircleX`)
- The confirmation dialog says "Stop this task? Extracted data will be saved." — not "Cancel"
- The action behavior is unchanged: it sets the job status to `"canceled"` in the database and the backend detects it on the next poll cycle

### FR-2: Prevent Status Overwrite on Cancellation
The extraction route handler must NOT overwrite a `"canceled"` job status to `"completed"` when the extractor returns after detecting cancellation.

**Acceptance Criteria**:
- When the extractor returns `done: true` due to cancellation, the route handler must check the current job status before writing
- If the job status is already `"canceled"`, the handler must preserve it — not overwrite to `"completed"`
- If the job status is `"running"` (natural completion), the handler sets `"completed"` as before
- A stopped job's `completed_at` timestamp is set to the stop time
- Stopped jobs retain all partial results stored during extraction

### FR-3: "Stopped" Status on Tasks Page
The Tasks page must display stopped jobs clearly and distinctly.

**Acceptance Criteria**:
- Jobs with status `"canceled"` are shown in a "Stopped" section or filter tab — separate from "Failed" and "Completed"
- The stopped job card shows the partial result count and a "Stopped" label (not "Failed" or "Completed")
- Export and broadcast actions are available for stopped jobs
- A stopped job's results are fully accessible — clicking through shows all extracted contacts

### FR-4: Remove Count Limit Selector
The count limit selector (`max_results` input) must be removed from the extraction UI.

**Acceptance Criteria**:
- The extraction form no longer shows a "max results" or "count limit" dropdown/input
- The backend still accepts `max_results` as an optional parameter with a high default (e.g., 100,000) as a safety ceiling
- Extractions run until the source is exhausted or the user manually stops them
- When the source is exhausted, the job status becomes `"completed"` — never `"paused"`

### FR-5: Natural Completion Instead of Paused
When an extraction finishes because the data source is exhausted (no more pages/members to load), the job must be marked `"completed"`, not `"paused"`.

**Acceptance Criteria**:
- If the extractor returns `done: true` with no `nextCursor`, the job is set to `"completed"`
- If the extractor returns `done: true` because it reached the safety-ceiling `max_results`, the job is set to `"completed"` (not `"paused"`)
- The `"paused"` status is reserved exclusively for system interruptions (e.g., server restart, timeout) where the extraction can be resumed
- A `"paused"` job resulting from a timeout clearly indicates it can be resumed

### FR-6: Data Quality Assurance for Group Extraction
Group extraction results must contain only real group members with zero duplicates.

**Acceptance Criteria**:
- Each extracted contact has a unique Facebook user ID — no ID appears more than once in a single job's results
- Each extracted contact has a unique name — no duplicate names with different IDs
- Pages, businesses, and auto-generated accounts are excluded using the same filtering logic as spec 002
- The extraction log includes a quality summary: total extracted, duplicates prevented, non-member entities excluded
- A spot-check of 10 random contacts from any group extraction must confirm ≥ 90% are verifiable group members

### FR-7: Rate-Limiting with Adaptive Backoff
The extraction must apply delays between requests and adapt when rate-limiting signals are detected.

**Acceptance Criteria**:
- A minimum delay of 500-800ms exists between each scroll/pagination request
- A longer cooldown of 8-12 seconds occurs every 7-10 scroll cycles
- If Facebook returns a rate-limit signal (HTTP 429, captcha challenge, or temporary block), the extractor pauses for 30-60 seconds before retrying
- If rate-limiting persists after 3 retries, the job is paused with a clear status message
- The extraction never sends more than 2 requests per second on average

---

## Success Criteria

| # | Criterion | Measurement |
|---|-----------|-------------|
| SC-1 | **Stop button clarity** | 100% of users understand that "Stop" preserves data — zero support questions about lost extraction data after stopping |
| SC-2 | **Stopped job status accuracy** | A stopped job's status remains "canceled" (never overwritten to "completed") in 100% of test cases |
| SC-3 | **Stopped job visibility** | Stopped jobs appear in a dedicated "Stopped" section on the Tasks page within 5 seconds of stopping |
| SC-4 | **No count limit UI** | The extraction form has no visible count limit selector — extractions run until source exhaustion or user stop |
| SC-5 | **Natural completion** | Jobs that exhaust the data source are marked "completed" (not "paused") in 100% of test cases |
| SC-6 | **Zero duplicates** | Exported results from any single extraction contain 0 duplicate user IDs and 0 duplicate names |
| SC-7 | **Member authenticity** | ≥ 90% of extracted contacts from a group are verifiable as actual group members |
| SC-8 | **No server blocks** | Extractions of 5,000+ members complete without triggering Facebook blocks or captchas in 95% of runs |
| SC-9 | **Rate-limit transparency** | Extraction logs show delay timing and any rate-limit backoff events |

---

## Key Entities

| Entity | Description |
|--------|-------------|
| **Extraction Job** | A single extraction task. Has status (queued, running, completed, failed, canceled, paused), target URL, result count, and timestamps. |
| **Stopped Job** | A job that was intentionally halted by the user. Status = "canceled". Partial results are preserved and accessible. |
| **Completed Job** | A job that finished naturally — either source exhausted or safety ceiling reached. All results stored. |
| **Paused Job** | A job interrupted by a system event (timeout, server restart). Can be resumed. NOT used for user-initiated stops or natural completion. |
| **Extraction Result** | A single extracted contact. Has fb_id, name, profile_url, type, workspace_id, job_id. |
| **Rate-Limit Signal** | An indicator from Facebook that requests are too frequent: HTTP 429, captcha challenge, temporary IP block, or empty responses after rapid requests. |

---

## Assumptions

1. Partial results saved via incremental `processBatch` calls are reliable and complete — no data loss occurs between the last batch save and the stop signal detection.
2. The `"canceled"` status value in the database is semantically correct for user-initiated stops — only the UI label needs to change from "Cancel" to "Stop".
3. Group member extraction via GraphQL API responses provides enough data (id, name, profile_url) to verify membership.
4. The existing 600ms delay and 10s rest cycle are sufficient baseline protection, but adaptive backoff should be added for robustness.
5. Removing the count limit selector from the UI does not break backend functionality — the safety ceiling remains as a backend guard rail.

---

## Dependencies

- **`extraction-service/src/routes/extract.ts`**: Route handler that manages job status transitions — must stop overwriting "canceled" to "completed"
- **`extraction-service/src/extractors/base.ts`**: Base extractor with delay configuration and cancellation detection
- **`extraction-service/src/extractors/group-members.ts`**: Group extraction loop with deduplication logic
- **`src/pages/dashboard/TasksPage.tsx`**: Tasks page with status filtering and stop button
- **`src/lib/extraction/extraction-repository.ts`**: Frontend repository for job management
- **`specs/002-messenger-data-accuracy/`**: Data quality filtering logic (page/bot/auto-generated exclusion) applies to all extraction types

---

## Out of Scope

- Changing the extraction polling interval or job timeout duration
- Adding WebSocket-based real-time progress (current polling approach remains)
- Modifying the WhatsApp extraction pipeline
- Changing the authentication or session management flow
- Adding new extraction types beyond pages, groups, comments, reactions, and messenger contacts
