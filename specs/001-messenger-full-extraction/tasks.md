# Tasks: Messenger Full Extraction

**Input**: Design documents from `/specs/001-messenger-full-extraction/`

**Prerequisites**: plan.md (done), spec.md (done), research.md (done), data-model.md (done), contracts/ (done), quickstart.md (done)

**Tests**: Not explicitly requested — skip test tasks per spec. Manual verification via quickstart.md scenarios.

**Organization**: Tasks grouped by implementation phase, mapped to functional requirements from spec.md.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Maps to functional requirement (FR1, FR2, ... FR8)
- Include exact file paths in descriptions

## Path Conventions

- **extraction-service**: `extraction-service/src/`
- **Frontend**: `src/`
- **Supabase migrations**: `supabase/migrations/`

---

## Phase 1: Setup & Database Migration

**Purpose**: Add `progress` JSON column and update status route

- [x] T001 [P] Add `progress` JSON column to `extraction_jobs` via Supabase migration at `supabase/migrations/2026072918_add_progress_to_jobs.sql` — defaults to `'{}'`, nullable
- [x] T002 Add `progress` field readback in job status route at `extraction-service/src/routes/extract.ts` — include `progress` column in the SELECT when returning job status
- [x] T003 [P] Update `extraction-service/src/services/supabase.ts` to add `storeProgress(jobId, progress)` method — UPDATE `extraction_jobs` SET progress = $1 WHERE id = $2

**Checkpoint**: Database schema ready, progress API wired

---

## Phase 2: Foundational — Token Extraction & Minimal Request Builder

**Purpose**: Extract fresh tokens from any Facebook page and build minimal GraphQL requests. BLOCKS all pagination work.

**⚠️ CRITICAL**: No pagination work can begin until token extraction is reliable.

- [x] T004 [FR1] Rewrite token extraction in `extraction-service/src/extractors/messenger-contacts.ts` — extract ONLY `fbDtsg` (from `window.DTSGInitData.token`), `lsd` (from HTML `"LSD","token":"..."` pattern), `userId` (from `c_user` cookie pattern or `"userID":"..."`) as a standalone method `extractTokens()` returning `{fbDtsg, lsd, userId}`
- [x] T005 [P] [FR2] Add `buildGraphQLBody(docId, variables, tokens)` helper in `extraction-service/src/extractors/messenger-contacts.ts` — constructs a minimal `URLSearchParams` body with: `av`, `__user`, `__a=1`, `__req` (randomized), `doc_id`, `variables` (JSON stringified), and `fb_dtsg`/`lsd` if available. Exclude `__rev`, `__hsi`, `__dyn`, `jazoest`
- [x] T006 [P] [FR7] Add `logStopReason(reason, details)` helper in `extraction-service/src/extractors/messenger-contacts.ts` — formats and logs: `"=== STOPPED: {reason} | {details} | contacts={N} | time={S}s"`

**Checkpoint**: Foundation ready — pagination can now be built on minimal requests

---

## Phase 3: User Story — Bootstrap + Cursor Pagination (FR-1, FR-2, FR-4) 🎯 MVP

**Goal**: Always get the first batch of conversations and paginate through ALL pages using cursor.

**Independent Test**: Run extraction on any page; verify it yields ≥ 90 contacts and status is `completed` (not `partial`).

### Implementation

- [x] T007 [FR1] Add `bootstrapAndPaginate(pageId, contacts, seen)` method in `extraction-service/src/extractors/messenger-contacts.ts` — the core loop:
  - Step 1: Navigate to `business.facebook.com/latest/inbox/all?asset_id=551321368296102&mailbox_id=551321368296102`
  - Step 2: Wait for page load + network idle (5s + networkidle + 3s)
  - Step 3: Extract fresh tokens via `extractTokens()`
  - Step 4: If `batchListCursor` exists (83-contact response fired), use it as start cursor. Skip variable discovery
  - Step 5: If NO batchListCursor, try all 10 variable patterns (see research.md R3) with `cursor: null` for `doc_id = "27615938851434506"`. Use first pattern that returns >10 contacts
  - Step 6: Log discovery result with progress
- [x] T008 [P] [FR2] Add `paginate(contacts, seen, workingDocId, workingVars, cursor, tokens)` method in `extraction-service/src/extractors/messenger-contacts.ts`:
  - Loop: build body via `buildGraphQLBody(workingDocId, vars-with-cursor, tokens)`, send via `page.evaluate(fetch)`, parse with `deepParse`, extract next cursor
  - Track `prevCursor`, `emptyCycles` (increment if gained === 0, reset if gained > 0)
  - Stop when: `emptyCycles >= 3` (end of list) OR `nextCursor === prevCursor` (stall) OR timeout
  - After each page: call `storeProgress()` with updated counts
  - Log each page as: `"[direct-gql] page N: +X (total=Y, Z chars) nextCursor=..." `
- [x] T009 [FR4] Remove ALL hardcoded limits from `extraction-service/src/extractors/messenger-contacts.ts`:
  - Delete `maxPages = 20/100` → replace with `while true` + explicit stop conditions
  - Delete `contacts.size >= 50` break in inbox URL loop → keep only `contacts.size >= batchCountFromPageLoad`
  - Delete `scrollEmpty < 2` → change to `scrollEmpty < 3` (3 empty cycles = genuine end)
  - Delete `graphqlReqs.length < 30` → increase to 100 (capture more requests for debugging)
  - Delete `contacts.size >= this.ctx.maxResults` as hard stop → change to: if maxResults reached, mark `partial` with message but DON'T break mid-loop; complete current cycle then stop
- [x] T010 [FR2] Fix `extractCursor` in `extraction-service/src/extractors/messenger-contacts.ts` — reprioritize patterns: `page_info.end_cursor` first, then `end_cursor`, then `paging.cursors.after`, then `after:"AQ..."`. Remove the plain `"cursor":` pattern (it matches the REQUEST cursor echoed in response)

**Checkpoint**: MVP complete — extraction exhaustively paginates through all conversations

---

## Phase 4: User Story — Virtual Scroll Backup (FR-3)

**Goal**: If API pagination fails (all patterns return 0, or error 1357004), fall back to targeted scrolling of the Meta Business Suite Inbox conversation panel.

**Independent Test**: Mock/trigger a pagination failure; verify scroll phase activates and finds additional contacts.

### Implementation

- [x] T011 [FR3] Rewrite `inboxScrollPhase` in `extraction-service/src/extractors/messenger-contacts.ts`:
  - After navigating to business inbox, use `page.evaluate` to find the conversation-list scrollable container
  - Selectors: `[role="navigation"]`, `[data-testid="mbs-inbox-list"]`, `div[role="list"]` parent, or any `div[style*="overflow"]` with `scrollHeight > 1000 && clientHeight > 300`
  - Scroll in small increments (200px each, 5 times per cycle) instead of jumping to bottom
  - Wait 2s between scroll increments for lazy-load GraphQL to fire
  - Count new contacts from response handler (already auto-collected)
  - Stop after 3 consecutive scroll cycles with 0 new contacts
- [x] T012 [P] [FR3] Update `scrollAggressively` in `extraction-service/src/extractors/messenger-contacts.ts` to target the conversation panel FIRST (before generic elements):
  - Use `document.evaluate('//div[contains(@role, "list") or contains(@aria-label, "Conversation") or contains(@aria-label, "Chat")]//ancestor::div[@style]', ...)` to find panel
  - Then fallback to generic scrollable elements

**Checkpoint**: Backup scroll path works when API pagination fails

---

## Phase 5: User Story — Deduplication, Failure Logging, Stop Conditions (FR-5, FR-7, FR-4 remainder)

**Goal**: No duplicates, clear failure logs, meaningful stop conditions.

**Independent Test**: Run extraction twice; verify zero duplicate contacts in results. Intentionally expire session; verify job marked `failed` with clear message.

### Implementation

- [x] T013 [FR5] Preload existing contacts from DB in `extraction-service/src/extractors/messenger-contacts.ts` — call `getExistingIds()` before extraction starts; store in a `Set<string>`; skip any contact already in this set during `flushContacts`
- [x] T014 [FR5] Track `duplicatesSkipped` counter in progress — increment when a discovered contact ID is already in the dedup set; include in `storeProgress()`
- [x] T015 [FR7] Replace all existing `break` statements in `extraction-service/src/extractors/messenger-contacts.ts` with calls to `logStopReason()`. Every exit path must record:
  - `"end_of_list"` — 3 empty cycles
  - `"cursor_stall"` — same cursor returned 2x
  - `"auth_failed"` — page redirects to login
  - `"timeout"` — `JOB_TIMEOUT_MS` elapsed
  - `"user_cancelled"` — `shouldStop` flag
  - `"unexpected_error"` — catch block with `e.message`
- [x] T016 [P] [FR7] Set final job status correctly in `extraction-service/src/extractors/messenger-contacts.ts`:
  - `completed` ONLY when `logStopReason` was `end_of_list`
  - `partial` when `timeout` or `maxResults_reached`
  - `failed` when `auth_failed` or `unexpected_error`
  - `canceled` when `user_cancelled`
  - Write stop reason to `extraction_jobs.error` column
- [x] T017 [FR7] Persist partial results on early stop in `extraction-service/src/extractors/messenger-contacts.ts` — before returning from any non-completed path, call `flushContacts` to save whatever was collected

**Checkpoint**: Robust error handling, no data loss on failure

---

## Phase 6: User Story — Real-Time Progress Reporting (FR-6)

**Goal**: Frontend shows live progress bar with discovered/processed counts and phase indicator.

**Independent Test**: Start extraction; poll status every 3s; verify `progress.discovered` increments during pagination and UI bar updates.

### Implementation

- [x] T018 [FR6] Wire progress updates into extraction loop at `extraction-service/src/extractors/messenger-contacts.ts` — after every pagination page, scroll cycle, or initial batch, call `storeProgress()` with:
  - `discovered`: total unique contact IDs seen
  - `processed`: contacts saved to DB
  - `duplicatesSkipped`: skipped due to dedup
  - `estimate`: 100 if end-of-list detected, else `"ongoing"`
  - `phase`: `"paginating"` / `"scrolling"` / `"mbasic_fallback"` / `"finishing"`
  - `phase_cycle`: iteration counter
  - `last_update`: ISO timestamp
- [x] T019 [P] [FR6] Add debounce to progress updates — max 1 update per 15 seconds (avoid DB spam on fast pages)
- [x] T020 [FR6] Update frontend progress display at `src/pages/dashboard/extraction/ExtractContactsPage.tsx`:
  - Read `job.progress` from Supabase poll response
  - Render progress bar: width = `progress.estimate` (0-100) or indeterminate animation if `"ongoing"`
  - Show text: `{t('progress_discovered')}: {progress.discovered} | {t('progress_processed')}: {progress.processed}`
  - Show phase label: translated string based on `progress.phase`
  - Show stop reason from `job.error` when job is `partial` or `failed`
- [x] T021 [P] [FR6] Add Arabic/English translations for progress UI in `src/i18n/locales/ar.json` and `en.json`:
  - `progress_discovered`, `progress_processed`, `progress_duplicates`
  - Phase labels: `phase_paginating`, `phase_scrolling`, `phase_mbasic`, `phase_finishing`
  - Stop reason labels: `stop_end_of_list`, `stop_timeout`, `stop_auth_failed`, `stop_cancelled`

**Checkpoint**: User sees real-time extraction progress

---

## Phase 7: Polish & Validation

**Purpose**: Ensure stability, no regressions, pass all quickstart scenarios.

- [x] T022 [FR8] Run WhatsApp extraction smoke test — submit a WhatsApp job (if test session available), verify it completes without errors at `extraction-service/src/routes/extract.ts`
- [x] T023 [P] [FR8] Run the 7 validation scenarios from `specs/001-messenger-full-extraction/quickstart.md` — document results (pass/fail) for each scenario
- [x] T024 [FR8] Verify `listJobs` still returns correct data at `src/lib/extraction/extraction-repository.ts` — job list with user_id filtering, sort by created_at descending
- [x] T025 Type-check extraction service: `cd extraction-service && npx tsc --noEmit`
- [x] T026 Type-check frontend: `cd . && npx tsc -b --noEmit`
- [x] T027 Remove dead code from `extraction-service/src/extractors/messenger-contacts.ts`:
  - Delete old `tryCursorPagination` method (replaced by `bootstrapAndPaginate`)
  - Delete old `tryPagination` method (unused)
  - Delete old `tryDirectGraphQL` method (replaced)
  - Delete internal-only `postData` capture from response handler (keep `graphqlReqs` for debugging only)
  - Keep: `deepParse`, `walkJSON`, `extractCursor`, `collectDOMContacts`, `injectDOMObserver`, `tryMbasic`

**Checkpoint**: All features work, no regressions, code clean

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user story phases
- **MVP (Phase 3)**: Depends on Foundational — core extraction logic
- **Scroll Backup (Phase 4)**: Depends on Phase 3 (shares inbox page navigation)
- **Robustness (Phase 5)**: Depends on Phase 3 (modifies same stop/log paths)
- **Progress UI (Phase 6)**: Depends on Phase 3 (needs extraction data to report), can parallel with Phases 4-5
- **Polish (Phase 7)**: Depends on all previous phases

### Within Each Phase

- Models/tokens (T004) before request builder (T005)
- Request builder (T005) before pagination (T008)
- Pagination (T008) before stop conditions (T009, T015)
- Backend progress stores (T018) before frontend display (T020)

### Parallel Opportunities

| Group | Tasks | Reason |
|-------|-------|--------|
| Phase 1 | T001, T003 | Different files |
| Phase 2 | T005, T006 | Different concerns in same file but independent |
| Phase 5 | T013, T015, T016, T017 | Related but trackable separately |
| Phase 6 | T019, T020, T021 | Different files (backend debounce, frontend, translations) |
| Phase 7 | T022, T023, T024, T025, T026 | Different areas (WhatsApp, validation, listing, typechecks) |

### User Story (FR) Dependencies

- **FR-1 (Bootstrap)**: Foundation of all extraction — MUST be first
- **FR-2 (Pagination)**: Depends on FR-1 — cannot paginate without first batch
- **FR-3 (Scroll Backup)**: Independent of FR-2, depends on FR-1 page navigation
- **FR-4 (No Limits)**: Must be applied to FR-1/FR-2/FR-3 — last infrastructure change
- **FR-5 (Dedup)**: Independent, but best after pagination is stable
- **FR-6 (Progress)**: Independent, but reports on FR-1/FR-2/FR-3 data
- **FR-7 (Failure Logging)**: Applied across all extraction code
- **FR-8 (No Regression)**: Final validation gate

---

## Parallel Example: Phase 3 MVP (after Foundation)

```bash
# Sequential within Phase 3:
Task T007: "Add bootstrapAndPaginate method in messenger-contacts.ts"
Task T008: "Add paginate method in messenger-contacts.ts"  (depends on T007)
Task T009: "Remove hardcoded limits in messenger-contacts.ts"  (depends on T008)
Task T010: "Fix extractCursor in messenger-contacts.ts"  (can run with T009)
```

---

## Implementation Strategy

### MVP First (Phase 1-3)

1. Complete Phase 1: Setup (3 tasks, all [P])
2. Complete Phase 2: Foundational (3 tasks) — **CRITICAL BLOCKER**
3. Complete Phase 3: Bootstrap + Pagination (4 tasks) — **MVP CORE**
4. **STOP and VALIDATE**: Run Scenario 1 from quickstart.md
5. Verify: 90+ contacts, status `completed`, no early stops

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add Phase 3 (MVP) → Test → Deploy (already better than current!)
3. Add Phase 5 (Robustness) → Test → Deploy (failure-resistant)
4. Add Phase 6 (Progress UI) → Test → Deploy (user-visible progress)
5. Add Phase 4 (Scroll Backup) → Test → Deploy (resilience)
6. Add Phase 7 (Polish) → Final validation → Release

### Single Developer Strategy

Total: 27 tasks across 7 phases. Estimated effort: **2-3 days**.

1. Day 1 AM: Phase 1-2 (Setup + Foundation)
2. Day 1 PM: Phase 3 (MVP) — test and verify
3. Day 2 AM: Phase 5 (Robustness) + Phase 6 (Progress)
4. Day 2 PM: Phase 4 (Scroll Backup)
5. Day 3: Phase 7 (Polish, validation, cleanup)

---

## Notes

- [P] tasks = different files or independent concerns within same file
- [FRx] labels map tasks to functional requirements for traceability
- All extraction logic changes are concentrated in `messenger-contacts.ts` (~1030 lines → ~800 lines after removal)
- No test framework exists — manual validation via quickstart.md scenarios
- Commit after each phase completion for rollback safety
- The `batchListCursor` variable and the `BATCH cursor saved` log are the indicators that the initial 83-contact response fired — check these first when debugging
