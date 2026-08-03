# Specification: Exhaustive Messenger Contact Extraction

**Feature**: Messenger Full Extraction
**Status**: Draft
**Created**: 2026-07-29
**Owner**: Engineering Team

---

## Problem Statement

After selecting a Facebook page, the system extracts only **3–25 people** out of what could be **hundreds or thousands** of conversations stored in the page's Meta Business Suite Inbox. The extraction stops prematurely without reaching the full conversation list, meaning the majority of people who contacted the page are never captured.

The root causes are:

1. **Single-batch dependency**: The extractor relies on one initial GraphQL response (which loads ~80 conversations) and treats it as complete. When that response fires inconsistently (sometimes returning 0–14 contacts), the total collapses.

2. **Pagination does not advance**: Even when a pagination cursor and `has_next = true` are detected, the cursor-replay logic either sends the same cursor repeatedly (resulting in the same page returned), uses stale CSRF tokens (causing error 1357004), or stores the wrong request body (detail-query body overwriting the list-query body — same `doc_id`, different variables).

3. **Inbox scroll is non-functional**: The Meta Business Suite Inbox renders conversations in a virtual-scroll container. The current `scrollAggressively` method scrolls the entire page (or generic scrollable elements) rather than the specific conversation-list panel, so no lazy-loading GraphQL requests are triggered.

4. **Early-exit conditions**: Multiple `break` and threshold checks (`contacts.size >= 50`, `contacts.size >= 80`, `scrollEmpty < 2`, `maxPages = 20`) abort the extraction long before the conversation list is exhausted.

5. **No deduplication-aware continuation**: The extractor does not distinguish "no new contacts because we've seen them all" from "no new contacts because the scroll/pagination didn't fire." It treats both the same and stops.

6. **No real progress reporting**: The user sees a spinning indicator with no indication of how many conversations were discovered, how many were processed, or how far along the extraction is.

---

## Goal

A dynamic, exhaustive extraction algorithm that iterates through **every** conversation in a page's Meta Business Suite Inbox — regardless of whether the page has 50 or 50,000 conversations — and captures the contact information of every person who messaged the page.

The algorithm must:
- Continue automatically until it reaches the genuine end of the conversation list.
- Report real-time progress (discovered / processed / estimated completion).
- Never stop early due to an arbitrary limit or threshold.
- Record the actual reason for stopping in logs (e.g., "reached last page", "timeout", "session expired").

---

## User Scenarios & Testing

### Primary Scenario: Small Page (50–200 conversations)
**Actor**: Page admin with a moderate conversation volume
**Flow**:
1. Admin selects a page and initiates "Extract Messenger Contacts."
2. System authenticates, navigates to the Business Suite Inbox.
3. Progress bar appears: "Discovered: 0 | Processed: 0".
4. As conversations load, numbers increase: "Discovered: 87 | Processed: 87".
5. System continues paginating/scrolling until no new conversations appear for 3 consecutive attempts.
6. Job completes with a final count and a clear log explaining why it stopped ("reached end of list — 3 empty cycles").

### Large Page Scenario (1,000–50,000 conversations)
**Actor**: Page admin with high conversation volume
**Flow**:
1. Same initiation as above.
2. System paginates in batches of ~80–200 conversations per cycle.
3. Progress updates continuously: "Discovered: 2,400 | Processed: 2,400 | Est. 60% complete".
4. Extraction runs for several minutes (up to job timeout) without stopping.
5. If the job timeout is reached, the system logs "timeout reached at 2,400/estimated 4,000" and saves partial results — it does **not** mark the job as successful with incomplete data.

### Inconsistent Initial Load Scenario
**Actor**: Any page
**Flow**:
1. The initial page navigation fires the batch GraphQL response for 80 conversations — **sometimes**.
2. If the batch response does NOT fire, the system must NOT give up at 14 contacts.
3. Instead, the system proactively triggers the conversation-list query via a direct API call (cursor = null) to bootstrap the list.
4. Once the first batch is obtained, pagination proceeds normally.

### Failure Scenario: Session Expired Mid-Extraction
**Actor**: Page admin
**Flow**:
1. Extraction is running, 500 contacts processed.
2. Facebook session expires or page redirects to login.
3. System detects the auth failure.
4. Logs the exact error ("session expired at 500 contacts, page redirected to login").
5. Saves partial results.
6. Marks the job as **failed** (not completed) with the error code for session expiry.

---

## Functional Requirements

### FR-1: Bootstrap Conversation List Reliably
The system must obtain the first page of conversations **every time**, regardless of whether the Meta Business Suite Inbox fires its initial GraphQL response automatically.

**Acceptance Criteria**:
- If the automatic response fires, use it.
- If it does NOT fire within 10 seconds of page load, the system proactively sends a GraphQL request with cursor=null to fetch the first batch.
- First batch is obtained in ≥ 95% of runs (measured over 20 consecutive test runs).

### FR-2: Cursor-Based Pagination with Correct Variable Injection
The system must paginate through all conversation pages using the cursor returned by each response.

**Acceptance Criteria**:
- The cursor from response N is correctly injected into the request for page N+1.
- The system detects when `cursor` is absent or identical to the previous cursor and records the reason in logs.
- The system distinguishes between "same cursor returned" (server says no more data) and "0 new contacts but cursor changed" (data already seen, continue).
- The system replaces stale tokens (fb_dtsg, lsd, __user) with fresh values extracted from the current page before each request.

### FR-3: Inbox Virtual-Scroll as Backup
If cursor-based pagination fails (server rejects, error 1357004, or returns empty), the system falls back to programmatically scrolling the conversation-list container in the Meta Business Suite Inbox to trigger lazy-loaded GraphQL requests.

**Acceptance Criteria**:
- The scroll targets the specific conversation-list panel (not the whole page).
- Each scroll triggers a new GraphQL request that loads additional conversations.
- Scrolling continues until 3 consecutive scrolls produce no new contacts.

### FR-4: No Arbitrary Limits
The system must NOT stop early due to hardcoded limits.

**Acceptance Criteria**:
- No `maxPages`, `maxResults`, `contacts.size >= N`, or `scrollEmpty < N` threshold causes premature termination (except the configured job timeout).
- The only valid stop conditions are: (a) 3 consecutive pagination attempts with 0 new contacts AND no cursor change, (b) job timeout, (c) session/auth failure, (d) user cancellation.

### FR-5: Deduplication
The system must never store the same contact twice.

**Acceptance Criteria**:
- Each contact is keyed by a unique identifier (Facebook user ID or thread ID).
- Contacts seen in earlier batches are recognized and skipped in later batches.
- The deduplication counter ("already seen") is reported in progress.

### FR-6: Real-Time Progress Reporting
The system must report extraction progress to the user throughout the job.

**Acceptance Criteria**:
- Progress includes: conversations discovered (total unique IDs seen), conversations processed (saved to database), duplicates skipped, and estimated completion percentage.
- Progress updates are written to the job record at least every 30 seconds.
- The frontend displays a live progress bar with the current count.
- When `has_next = true` and a cursor exists, the estimated completion is computed as "ongoing" rather than a fixed percentage.

### FR-7: Accurate Failure Logging
If the extraction stops for any reason, the system must record the actual cause in logs.

**Acceptance Criteria**:
- Stop reasons include: "reached end of list", "cursor unchanged after N attempts", "session expired", "job timeout reached at N contacts", "user cancelled", "unexpected error: [details]".
- The job's final status reflects reality: `completed` only if the end of the list was genuinely reached; `failed` if stopped due to error/timeout; `partial` if timeout reached with saved results.
- Logs contain enough detail to diagnose why extraction stopped.

### FR-8: Preservation of Existing Features
The extraction changes must not break any existing functionality.

**Acceptance Criteria**:
- WhatsApp contact extraction continues to work unchanged.
- Session management, cookie injection, auth checking, and context lifecycle remain intact.
- The job queue, duplicate-job prevention, and API key authentication are unaffected.
- Frontend pages (dashboard, extraction page, session management) render and function correctly.
- Arabic/English translations and RTL layout are preserved.

---

## Success Criteria

| # | Criterion | Measurement |
|---|-----------|-------------|
| SC-1 | **Contact yield for large pages** | A page with 1,000+ conversations yields ≥ 90% of the total conversation count (verified against manual count in Business Suite Inbox). |
| SC-2 | **Consistency across runs** | The same page yields within ±5% of contacts across 5 consecutive extraction runs. |
| SC-3 | **No false success** | A job is marked `completed` only when 3 consecutive pagination/scroll attempts yield 0 new contacts with no cursor change. All other stops are `failed` or `partial`. |
| SC-4 | **Progress visibility** | The user sees updated contact counts within 30 seconds of the job starting and every 30 seconds thereafter until completion. |
| SC-5 | **Deduplication accuracy** | Zero duplicate contacts in the final output. |
| SC-6 | **Time to first contact** | First batch of contacts (≥ 50) appears within 60 seconds of job start. |
| SC-7 | **Error transparency** | 100% of failed/partial jobs have a human-readable error message in the job record explaining why extraction stopped. |
| SC-8 | **Extraction completeness** | When a page reports `has_next = false` (or cursor unchanged 3×), the extracted count matches or exceeds the count visible in Business Suite Inbox. |

---

## Key Entities

| Entity | Description |
|--------|-------------|
| **Extracted Contact** | A person who sent a message to the page. Identified by Facebook user ID. Contains: name, profile URL, avatar URL, extraction source ("messenger_contact"). |
| **Extraction Job** | A background job that orchestrates the extraction. Contains: status (pending/running/completed/failed/partial), progress (discovered/processed/total_estimated), error message, started_at, completed_at. |
| **Pagination Cursor** | An opaque token returned by each GraphQL response that identifies the position in the conversation list. Used to fetch the next page. |
| **Deduplication Set** | An in-memory set of contact IDs that have already been extracted, preventing duplicate storage. |

---

## Assumptions

1. The Facebook session (cookies) provided by the user has valid access to the selected page's Meta Business Suite Inbox.
2. The page's `asset_id` and `mailbox_id` can be extracted from the page profile or derived from the redirect URL when navigating to `/messages/`.
3. The GraphQL `doc_id` for the conversation-list query (`27615938851434506`) remains valid. If Facebook changes it, the system should log a clear error rather than silently returning 0 contacts.
4. The job timeout (currently 600 seconds) is sufficient for pages with up to ~5,000 conversations. For larger pages, the user may need to increase the timeout or run multiple sessions.
5. The Meta Business Suite Inbox loads conversations in batches of approximately 80–200 per GraphQL response.
6. The frontend already has a mechanism to poll job status and display results; only the progress fields need to be wired up.

---

## Dependencies

- **Extraction Service** (`extraction-service/`): Playwright browser automation, GraphQL interception, job queue.
- **Supabase**: `extraction_jobs` table for job status/progress, `extracted_members` table for contact storage.
- **Frontend** (`src/pages/dashboard/extraction/`): Job status polling and progress display.
- **Session Management**: Valid Facebook session cookies in `fb_sessions` table.

---

## Out of Scope

- Extracting message content or conversation history (only contact information).
- Extracting contacts from pages the user does not manage.
- Real-time monitoring of new incoming messages.
- Exporting contacts to external systems (CRM, email, etc.).
- Modifying the WhatsApp extraction pipeline.
- Changing authentication or session management logic.
