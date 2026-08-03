# Research: Messenger Full Extraction

**Feature**: Messenger Full Extraction  
**Date**: 2026-07-29  
**Status**: Complete

---

## R1: Root Cause — Why does extraction stop at 3–25 contacts?

**Decision**: The extractor has **6 overlapping failure modes** that each prevent exhaustive extraction.

**Rationale** (from log analysis of ~20 test runs):

1. **Inconsistent initial batch**: The Meta Business Suite Inbox fires a GraphQL response (`doc_id=27615938851434506`) that returns 83 contacts — but only on ~40% of runs. On other runs, it returns 0–14 contacts. The `tryDirectGraphQL` fallback only triggers when `batchListCursor` is non-empty (i.e., when the batch already fired), meaning it never rescues the "zero batch" case.

2. **Cursor replacement fails**: When pagination runs, `setCursorField` only replaces cursor fields that are `null`. But the first page request often has `"cursor":"Cg8Ob3Jn..."` (already a non-null string). The cursor is never updated, so the same first page is requested repeatedly. The `extractCursor` also matches the request cursor echoed in the response rather than the next-page cursor.

3. **Wrong postData stored**: `doc_id=27615938851434506` is used by BOTH the conversation-list query (83 contacts, cursor) and the contact-detail query (1 contact, no cursor). The detail query often fires first and stores its `postData` in `bestPaginationReq`. The list query (83 contacts) has the same `doc_id`, so its postData is never stored. Pagination then sends the detail query's variables (`sellerID`, `identity`) instead of the list query's variables (`mailbox_id`, `count`).

4. **Fresh token extraction fails**: When navigating to `www.facebook.com/` for same-origin pagination, the page is a minimal redirect with no `<script>` tags — `fb_dtsg`, `lsd`, `__rev`, `__hsi`, `jazoest` all fail to extract. Requests with stale tokens return error 1357004.

5. **Inbox scroll targets wrong container**: `scrollAggressively` iterates ALL DOM elements with `overflow-y: auto/scroll`, but Meta Business Suite uses virtual scrolling in a specific panel. The scroll never triggers lazy-loaded GraphQL requests.

6. **Early exits**: `contacts.size >= 50`, `contacts.size >= 80`, `maxPages = 20`, `scrollEmpty < 2`, `graphqlReqs.length < 30` — all cause premature termination.

**Alternatives considered**:
- Fixing each bug individually: Too fragile — the architecture depends on intercepting and replaying captured POST data, which is inherently unreliable (stale tokens, wrong postData, race conditions).
- Using the official Facebook Graph API: Requires a page access token, which is not available from web session cookies.

---

## R2: Best Approach — Direct GraphQL with Constructed Requests

**Decision**: Build GraphQL requests from scratch using only essential parameters (fb_dtsg, __user, __a, doc_id, variables), extracted fresh from the current page. No captured postData dependency.

**Rationale**:
- The existing `tryDirectGraphQL` method proved that `page.evaluate()` + `fetch("/api/graphql/")` works (200 responses, no CORS, cookies included automatically).
- Minimal requests (5–6 URL parameters) avoid error 1357004 because they don't carry stale `__rev`, `__hsi`, `__dyn`, etc.
- Token extraction succeeds on the Meta Business Suite Inbox page (which has full `<script>` sections with `DTSGInitData`).

**Alternatives considered**:
- Replaying captured postData with token replacement: Error-prone, wrong postData stored, stale `__dyn` parameter.
- Using `page.request.post()` (Playwright context): Doesn't include auth cookies or returns cross-origin errors.
- Using GraphQL query language (POST JSON): Facebook's `/api/graphql/` expects `application/x-www-form-urlencoded`, not JSON.

---

## R3: Variable Pattern Discovery

**Decision**: Try 10 variable patterns and use the first one that returns contacts.

**Rationale**: The exact variable field names for the conversation-list query are unknown (Facebook internal API, undocumented). Testing identified:
- `mailbox_id`: The Meta Business Suite mailbox ID (551321368296102) — known
- `cursor`: Pagination cursor — known
- `thread_type`: Probably `"FB_MESSAGE"` — educated guess
- `count` / `page_size` / `first` / `limit`: Unknown field name — try all

The discovery loop sends requests with `cursor: null` for each pattern combination. The first pattern that returns >10 contacts or >10KB of data is used for all subsequent pagination.

**Alternatives considered**:
- Decoding the page's JavaScript bundle to find the query definition: Fragile, changes with every Facebook deploy.
- Hardcoding one pattern: Risk of choosing the wrong one and never getting data.

---

## R4: Inbox Virtual Scroll Targeting

**Decision**: Target the conversation-list panel specifically using CSS selectors derived from Meta Business Suite's DOM structure.

**Rationale**: The conversation list is rendered in a `<div>` inside the business inbox page. Key selectors:
- `[role="navigation"]` — the left sidebar containing the conversation list
- `div[style*="overflow-y: auto"]` with `scrollHeight > clientHeight + 100` — the scrollable container

The `scrollAggressively` method already finds scrollable elements but doesn't prioritize the conversation panel. Adding targeted selectors first ensures the right container is scrolled.

**Alternatives considered**:
- Using `page.keyboard.press("End")` to scroll: Only affects the main viewport, not the conversation panel.
- Using Playwright locator API: Requires stable selectors that Facebook frequently changes.

---

## R5: Progress Reporting Implementation

**Decision**: Use the existing `extraction_jobs` table, adding a `progress` JSON column and updating it every 30 seconds.

**Rationale**: The frontend already polls job status. Adding progress data to the existing row requires no new endpoints.

**Progress JSON schema**:
```json
{
  "discovered": 2400,
  "processed": 2400,
  "estimate": "ongoing",
  "phase": "paginating",
  "last_update": "2026-07-29T18:00:00Z"
}
```

When a `has_next=false` or cursor disappears for 3 consecutive attempts, `estimate` changes to `100`.

**Alternatives considered**:
- WebSocket push: Over-engineered for a polling-based frontend.
- New API endpoint: Unnecessary; job status endpoint already returns `extraction_jobs` data.

---

## R6: Stop Conditions

**Decision**: The extraction stops ONLY when one of these occurs:

1. **End of list**: 3 consecutive pagination attempts return 0 new contacts AND the cursor is unchanged or absent.
2. **Job timeout**: `Date.now() - startTime > JOB_TIMEOUT_MS` → job marked `partial` with saved results.
3. **Auth failure**: Page redirects to login → job marked `failed`.
4. **User cancellation**: `shouldStop` flag set → job marked `canceled`.

**Rationale**: These are the only semantically meaningful stop conditions. All hardcoded `maxPages`, `contacts.size >= N`, and `scrollEmpty` thresholds are removed or relaxed to serve only as safeguards against infinite loops (not data ceilings).

---

## R7: Deduplication Strategy

**Decision**: Two-level deduplication:
1. **In-memory**: `Set<string>` of Facebook user IDs seen during this extraction session.
2. **Database-level**: `getExistingIds()` queries `extraction_results` by `workspace_id` for already-persisted contacts (preloading before extraction starts).

**Rationale**: The dual approach prevents both intra-job duplicates (same contact appearing in multiple pagination pages) and inter-job duplicates (contact already extracted in a previous run).

---

## R8: Maximum Results Default

**Decision**: Remove `this.ctx.maxResults` as a hard stop. If set by the user (e.g., "extract 500 contacts"), treat it as a target; once reached, stop BUT mark the job as `partial` (not `completed`) with a log message "stopped at user-requested limit of N contacts."

**Rationale**: The user explicitly requested no arbitrary limits. The `maxResults` parameter is user-configurable and should not silently mask incomplete extraction.

---

## R9: Error Code 1357004 Resolution

**Decision**: Construct minimal GraphQL requests that exclude Facebook's volatile anti-CSRF parameters (`__rev`, `__hsi`, `__dyn`, `jazoest`).

**Rationale**: Testing showed that error 1357004 occurs when ANY single CSRF parameter mismatches the current page state. Facebook validates the entire CSRF chain. By sending only the essential parameters (`fb_dtsg`, `__user`, `__a`, `doc_id`, `variables`, `__req`), the request passes validation. The `fb_dtsg` is extracted fresh from `window.DTSGInitData.token` on the current page.

The current page cookie (`c_user`) is automatically included by `fetch()` via `credentials: "include"`, so `__user` is optional but kept for completeness.
