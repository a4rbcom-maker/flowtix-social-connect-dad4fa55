# Research: Extraction Task Controls

**Date**: 2026-07-29
**Status**: Complete

---

## R-1: Status Overwrite Race Condition

**Question**: How to prevent `extract.ts` from overwriting `"canceled"` to `"completed"`?

**Investigation**: 
The route handler at `extract.ts:102-106` checks `result.done` and unconditionally writes `status: "completed"`. When the extractor detects cancellation via `checkCanceled()`, it returns `{ done: true }`. The handler then overwrites the DB status.

**Decision**: Before writing `"completed"`, re-read the current job status from DB. If it's already `"canceled"`, preserve it.

**Rationale**: The `checkCanceled()` method already polls the DB. The handler can do the same check. This is a 1-line read + conditional.

**Alternatives considered**:
- Have the extractor return a `canceled: boolean` flag in the result → more invasive, changes the return type interface
- Use a separate cancel endpoint that kills the job → over-engineering, current polling approach works fine

---

## R-2: "Paused" vs "Completed" When Max Results Reached

**Question**: Why does reaching max_results cause "paused" instead of "completed"?

**Investigation**:
In `group-members.ts:76`, the while loop exits when `total >= this.ctx.maxResults`. At that point:
- `done = false` (only set true when `total === 0` at line 170, or when `consecutiveEmpty >= max`)
- `nextCursor = url` (line 171) — always the original URL since there's no real pagination cursor

Back in `extract.ts:108-113`, `result.nextCursor` is truthy → status set to `"paused"`.

**Decision**: Two changes:
1. **Extractor**: When the loop exits because `total >= maxResults`, set `done = true` and `nextCursor = undefined`
2. **Route handler**: The `else` branch (line 114-119) already handles the "no more pages" case with `"completed"`

**Rationale**: The group extractor uses scroll-based loading, not cursor-based pagination. The `nextCursor` is always the same URL — it's not a real cursor. Setting `done = true` when max is reached is semantically correct.

**Alternatives considered**:
- Add a `reachedLimit: boolean` to the return type → unnecessary complexity for a simple condition
- Remove `maxResults` from the loop entirely → risky, need a safety ceiling; instead we'll raise the default to 100,000 and remove the UI selector

---

## R-3: Removing max_results From UI

**Question**: Where is max_results exposed in the UI and how to remove it cleanly?

**Investigation**:
Found in 4 frontend files:
1. `ExtractContactsPage.tsx:43` — `useState("10000")`, used in form and progress calculation
2. `ExtractMembersPage.tsx:57` — `useState("10000")`, used in form, Select dropdown, and progress
3. `ExtractionFormPage.tsx:196-197` — Label + Input field
4. `config.ts:95,115` — `maxResults: string` field with default `"10000"`

Frontend sends it to backend: `extraction-repository.ts:74` → `max_results: input.max_results ?? 10000`

**Decision**: 
- Remove the UI selector entirely from all extraction pages
- Keep `max_results` in the API schema (`extract.ts:21`) with default `100000` as safety ceiling
- Frontend always sends `max_results: 100000` (or omits it, letting backend default apply)
- Progress calculation: use a dynamic estimate or show absolute count without percentage

**Rationale**: The user explicitly requested removal. The backend safety ceiling prevents infinite loops. Progress percentage can be replaced with absolute count display.

**Alternatives considered**:
- Keep selector but hide it behind "Advanced" → user said "لا أرى لها لزوم", they want it gone
- Make it advisory only (not enforced) → confusing, current behavior already doesn't enforce properly

---

## R-4: Rate-Limiting and Adaptive Backoff

**Question**: Current delay configuration and what adaptive backoff to add?

**Investigation**:
Current config in `base.ts:202-205`:
```typescript
protected maxExecutionMs = 280_000;   // ~4.6 min
protected requestDelayMs = 600;       // 600ms between scrolls
protected batchSizeForRest = 8;       // rest every 8 scrolls
protected restDelayMs = 10_000;       // 10s rest
```

These are static. No detection of rate-limit signals.

**Decision**: Add lightweight adaptive backoff:
1. Detect rate-limit signals: empty responses after non-empty ones, HTTP errors, captcha redirects
2. On detection: increase delay to 2000ms for next 5 scrolls, then return to normal
3. After 3 consecutive rate-limit signals: pause job with clear status message
4. Log all backoff events for transparency

**Rationale**: Facebook doesn't always send HTTP 429. More common signals are empty responses, partial page loads, or captcha challenges. Detection should be heuristic, not HTTP-status-based.

**Alternatives considered**:
- Exponential backoff → overkill for this use case, linear increase is sufficient
- HTTP response header analysis → Playwright intercepts don't expose HTTP status of the main page load easily
- Proxy rotation → out of scope, user didn't request

---

## R-5: "Stopped" Section on Tasks Page

**Question**: How to display stopped jobs distinctly from failed jobs?

**Investigation**:
Current `TasksPage.tsx:114-116`:
```typescript
const activeJobs = ...filter(j => j.status === "running" || j.status === "queued" || j.status === "paused")
const completedJobs = ...filter(j => j.status === "completed")
const failedJobs = ...filter(j => j.status === "failed" || j.status === "canceled")  // canceled grouped with failed
```

Filter tabs: "all", "active", "completed", "failed"

**Decision**:
- Add a "stopped" filter tab
- Move `"canceled"` jobs from `failedJobs` to a new `stoppedJobs` array
- Add status badge config for "stopped" with distinct color (amber/orange, not red)
- Rename button from "Cancel" to "Stop" with appropriate icon

**Rationale**: The user explicitly said canceled ≠ failed. Stopped is an intentional user action with preserved data. Failed is an error condition. Mixing them causes confusion.

**Alternatives considered**:
- Rename the DB status from "canceled" to "stopped" → unnecessary migration risk, keep DB value, change UI label only
- Merge stopped into completed → user wants distinction, they may stop early and want to know which jobs ran to completion vs were stopped

---

## R-6: Data Quality for Group Extraction

**Question**: Does the group extractor apply the same quality filters as messenger contacts (spec 002)?

**Investigation**:
The group extractor (`group-members.ts`) extracts ALL links matching user profile patterns. It does NOT apply:
- `__typename` filtering (not available in scroll-based DOM extraction)
- Auto-generated name exclusion
- Page/business exclusion

However, it does have:
- In-memory dedup via `Set<string>` (line 27, 137)
- DB-level dedup via `processBatch` → `getExistingIds` (base.ts:292-295)
- Navigation word exclusion (`PAGE_NAV_WORDS` array, lines 8-15)

The DOM-based extraction is inherently different from GraphQL response parsing. It extracts from rendered `<a>` tags, which are user profile links. Pages and businesses appear differently in group member lists.

**Decision**: Add lightweight name validation to the group extractor:
1. Filter out names matching auto-generated patterns (same regex as spec 002)
2. Filter out names with business keywords (store, news, etc.) as a secondary check
3. Log quality summary at the end

**Rationale**: While DOM extraction is cleaner than GraphQL response parsing, adding the name validation as defense-in-depth is cheap and effective.

**Alternatives considered**:
- Full GraphQL interception for groups → major rewrite, different architecture, out of scope
- Trust DOM extraction completely → risky, user reported quality concerns

---

## Summary

| Research Item | Decision | Risk | Files Affected |
|---|---|---|---|
| R-1: Status overwrite | Re-check DB status before writing "completed" | Low | `extract.ts` |
| R-2: Paused vs completed | Set `done=true` when maxResults reached | Low | `group-members.ts`, `extract.ts` |
| R-3: Remove max_results UI | Delete selector, keep backend default | Medium | 4 frontend files |
| R-4: Adaptive backoff | Heuristic detection + delay increase | Medium | `base.ts` |
| R-5: Stopped section | New filter tab + status config | Low | `TasksPage.tsx`, i18n |
| R-6: Data quality | Name pattern filtering in group extractor | Low | `group-members.ts` |
