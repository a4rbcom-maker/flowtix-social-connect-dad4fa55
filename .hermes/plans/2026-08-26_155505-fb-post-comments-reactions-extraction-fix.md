# FB Post Comments & Reactions Extraction Fix — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Fix `post_comments` / `post_reactions` extracting 3 results from posts with thousands (b7b10674: 3/3421 = 0.1%), and guarantee ≥70% coverage when data + session permissions allow it.

**Architecture:** Replace blind-scroll DOM harvesting with cursor-driven GraphQL pagination (capture FB's own paginated request, replay it with `end_cursor` until `has_next_page=false`) with DOM scrolling kept only as fallback. Add real coverage targets and early-switch backpressure.

**Tech Stack:** TypeScript, Playwright, Supabase (Postgres + RLS), existing `GraphQLInterceptor` + `parseGraphQLResponse` (`extraction-service/src/services/graphql-interceptor.ts`).

---

## 1. The Problem (measured, from live DB)

### Evidence — last 6 real jobs (extraction_jobs, read 2026-08-26):

| Job | Type | Available | Extracted | Coverage | Stop reason | Duration | Switch attempts |
|---|---|---|---|---|---|---|---|
| b7b10674 (today) | reactions | 3,421 | **3** | 0.1% | source_exhausted | 2m47s | 0 |
| 77626bc2 | reactions | unknown | 0 | null | source_exhausted | 4m02s | 0 |
| a1d2d8cb | reactions | 25 | 6 | 24% | session_rate_limited | 1m37s | — |
| f0515051 | reactions | 25 | 6 | 0% | failed (closed page) | 48s | — |
| 8566e00d | comments | 25 | 19 | 76% | session_rate_listed | ~2m | — |
| 50d719a3 | comments | 25 | 25 | 100% | — | — | — |

**Telltale signature:** `phase_cycle=0` everywhere. `phase_cycle` only increments inside the session-switch branch (`post-reactions.ts:175`), meaning **the session-switch branch NEVER RAN in these jobs** — the jobs died at `consecutiveEmpty >= 15` without ever trying another session. `switchToNextSession()` returned `false` (0 secondary pages) and the code fell through to hard stop. Single-session jobs are expected (user picked 1 session at submit) — but then `phase_cycle` stays 0 and the `>= 15` empty stop fires after ~15×2s ≈ 30-50s.

### Why the loop yields nothing (root cause, ranked):

1. **RC1 — No real pagination (both paths).** The loop is scroll-and-hope. For comments: `clickMoreCommentsButtons()` clicks every keyword-matching element, waits 1.2s, then `scrollFeed()`. For reactions: scroll the dialog via `mouse.wheel` 3×300px with 400ms gaps. FB virtualizes both lists — **no dialog/scroll position → no new GraphQL responses → 0 new users → 15 empty rounds → stop at 3 results**. The interceptor sees only the first ~2-3 screens of users (initial dialog render), never pages. `GraphQLInterceptor.replayWithCursor()` (graphql-interceptor.ts:116) already exists and IS NEVER CALLED by either extractor.

2. **RC2 — Comments: initial post state.** Comments collapsed ("View more comments" renders ~3 visible comments), and `clickMoreCommentsButtons()` clicks by keyword text-match on `[role="button"], a, span, div` — the actual modern-FB control is an `[role="button"]` with Arabic/English label OR the "View more comments" bar at the comment-list top; some clicks miss (e.g., the control is a nested `<span>` inside a `<div role=button>` — clicking the span may not trigger React handler), so the thread never opens. Then DOM fallback sees only the same ~3 rendered articles each round → adds ~0 new → 15 empties → stop. (Post 8566e00d got 19/25 = 76% — on small posts the initial render can cover most comments, which is why small posts sometimes look fine.)

3. **RC3 — Reactions dialog detection vs tab click.** `tryOpenReactionsDialog()` tries link/aria/text selectors. If it opens a WRONG dialog (e.g., notification), it escapes and retries. If it opens the reactions dialog but no `scrollBox` found (no child with overflowY scroll + scrollHeight > clientHeight + 10), `scrollFeed(page)` fallback runs **page-wide scroll**, which scrolls the FEED behind the dialog — dialog never pages, 15 empties, stop at ~3 (the first screen). The first screen of the dialog = the 3 results in b7b10674.

4. **RC4 — stop condition counts scroll rounds, not results.** `consecutiveEmpty >= 15` counts empty SCROLL ROUNDS, not empty result-yield per session. With a single session, the switch branch at `=== 3` runs `switchToNextSession()` → returns false → sets `session_rate_limited`/`no_secondary_session` as lastStopReason but keeps looping empties 4..15 with no backoff growth or dialog reopen attempt (reactions only reopens on `dialogActive` false, not on empty batches). ~35-50s wasted, then stop. The stop reason then reports "source_exhausted" (misleading — the source had 3,418 more).

5. **RC5 — `maxExecutionMs` is a hard ceiling of 45min (env `JOB_TIMEOUT_MS=2700000`) minus 2min margin = 43min.** Not the cause of the 3-result stops (jobs died in <3min), but it DOES cap coverage on big posts: 3,421 reactions at DOM-scroll pace (~30-60 users/min when working) = 60-110 min > 43min ceiling → even a working DOM path would cap at ~40-60% on this post. GraphQL replay pagination (~50-100 users/page every ~1.5s) does 3,421 in ~2-4 min.

6. **RC6 — coverage denominator is unreliable.** `parseFollowersCount` scrapes the count from HTML (b7b10674: 3421 read OK). 77626bc2 got `null` (count hidden on that surface) → coverage null → can't prove 70%. The GraphQL reaction payload contains the real total (`feedback.reaction_count` or similar) — parse it from the intercepted dialog payload for a trustworthy denominator.

7. **RC7 — results silently dropped on store failure.** `processBatch` catch returns 0 (base.ts:680-682) — a Supabase blip during a long job erases a whole batch with no retry, no telemetry. Also `getExistingIds(workspaceId, …)` is a no-op today (workspace_id dead → no dedup) — not causing the 3-result bug, but inflating duplicates in exports; note in plan, do not change behavior silently.

8. **RC8 — photo posts (`facebook.com/photo/?fbid=…`): interceptor filter `if (!text.toLowerCase().includes("reaction")) return;` (post-reactions.ts:75)** — on photo posts the reactions GraphQL payload may not contain the literal string "reaction" in the body (field names hashed/aliased) → intercepted users array stays empty → pure DOM fallback. Combined with RC3 → 3 results.

### What is NOT the problem (checked, with proof)
- **Timeout**: JOB_TIMEOUT_MS=45min; jobs died in 2-3min. Not the cause.
- **maxResults**: default 100,000 (routes/extract.ts:156, FE sends 100000). Not the cause.
- **Dedup (`seen` set)**: only filters repeats; b7b10674 saw ~3 unique users total.
- **FB permission wall**: dialog OPENED, 3 users extracted, coverage 0.1% — permissions allow reading; pagination just never happened.
- **session switch recovery** (shipped 2026-08-25 fix): works; simply never invoked (phase_cycle=0).

### Difference between the two paths (asked)
| Aspect | Comments | Reactions |
|---|---|---|
| Main harvest | GraphQL interception + DOM article fallback | GraphQL interception (only when `dialogActive` + body contains "reaction") + dialog-DOM fallback |
| Pagination trigger | `clickMoreCommentsButtons()` + `scrollFeed()` (page-wide) | dialog `scrollBox` mouse-wheel, else `scrollFeed()` (page-wide fallback) |
| Session-switch reload | reload post, restart from top | reload post + reopen dialog |
| Failure mode | thread never opens → 3 comments | dialog opens 1st screen → 3 reactors, then no paging |
| Coverage denominator | page HTML count | page HTML count (null on photo posts) |

---

## 2. What Will Be Fixed

Scope: `post-comments.ts`, `post-reactions.ts`, `base.ts` (additive helpers only), `graphql-interceptor.ts` (additive parsing), tests, one migration-free DB use (config jsonb keys already free-form). **No changes** to groups/pages/messenger paths, job queue, enrichment, or the frontend.

1. **Cursor-driven GraphQL pagination for reactions** (kills RC1+RC3+RC8): capture the reactions list query FB itself fires when the dialog opens; replay with `end_cursor` via `replayWithCursor()` until `has_next_page=false`; per-reaction-tab sub-pagination (All/Like/Love/… tabs each have their own cursor); DOM scroll only as fallback when no GraphQL request was captured.
2. **Cursor-driven GraphQL pagination for comments** (kills RC1+RC2): same capture-replay loop for the comments thread query; DOM `clickMoreCommentsButtons` kept as fallback only.
3. **Real coverage denominator from GraphQL** (kills RC6): parse total count from the first paginated payload (`reaction_count` / `comment_count` on the feedback node); fall back to HTML count; persist to `config.total_followers_count` as today.
4. **Stop-condition rework** (kills RC4): empty rounds escalate — r3: try switch; r5: close+reopen dialog / re-click "more comments"; r8: rate-limit backoff (2s→5s→10s); r15 with zero total yield: stop with honest `stop_reason` (choose `source_exhausted` ONLY if GraphQL said `has_next_page=false`; else `session_rate_limited`). `phase_cycle` increments on every escalation attempt so the DB shows liveness.
5. **43min budget respected, GraphQL-first pace** (kills RC5): page fetch ~1.2-1.5s pacing, adaptive: if a page yields 0 new users 2× consecutively → probe cursor freshness → stop honestly; budget check every page; remaining-time projection logged (ETA to 70%).
6. **storeResults retry ×3 with 1s backoff** (kills RC7); log dropped batch ids to `progress.lost_batches` if all retries fail (counter only — no internal mechanics exposed to end users).
7. **Honest completion semantics** (kills RC4b): `done=true` only when (a) GraphQL `has_next_page=false` AND seen-everything, or (b) maxResults reached, or (c) budget exhausted → return `nextCursor` so the job pauses and can resume (cursor = last good `end_cursor`), never "completed" while `has_next_page=true`.

## 3. Target Architecture

```
runExtractionJob (routes/extract.ts)  [unchanged wiring]
└─ PostCommentsExtractor / PostReactionsExtractor (BaseExtractor)
   ├─ Phase A: open surface (post page / reactions dialog) — as today, plus
   │   GraphQLInterceptor.attach(page) BEFORE first click (capture FB's own query:
   │   doc_id + variables incl. feedback target + first cursor)
   ├─ Phase B: PAGINATED HARVEST (new core, shared helper in base.ts)
   │   while has_next_page && seen < maxResults && budget left:
   │     page = replayWithCursor(captured, endCursor, 50)
   │     users += parseGraphQLResponse(page) → processBatch (retry ×3)
   │     track endCursor, has_next_page, newUnique, emptyPages
   │     pacing 1.2-1.5s; escalate on emptyPages (freshness probe → stop honest)
   ├─ Phase C: DOM fallback (existing extractCommentsFromDom /
   │   extractReactorsFromDialogDom) — only if Phase B captured nothing
   └─ Phase D: finalize — coverage = unique/totalFromGraphQL; stop_reason honest;
       done vs nextCursor per §2.7; progress written every ~10s as today
```

Per-session isolation unchanged: one extractor instance per job, sessions via `switchToNextSession()` on rate-limit signals (captcha / "temporarily blocked" via `detectRateLimit`), GraphQL replay runs in the ACTIVE session's page context (cookies/dtsg auto).

## 4. Guaranteeing Full Pagination (no early stop)

- Pagination authority = FB's own `page_info` (`end_cursor` + `has_next_page`) from the captured query — not scroll heuristics.
- Loop exits ONLY on: `has_next_page=false` | `seen >= maxResults` | budget < 15s | canceled | 3 consecutive empty pages after freshness probe (cursor stale → try recapture once → stop honest).
- **Pause/resume chain**: budget end → `nextCursor = lastGoodEndCursor` → job paused → FE resume re-enters Phase B at that cursor (existing `continueExtraction` + `cursor` wiring, extract.ts:283 handles IG seedResume; FB path passes `ctx.cursor` into URL/navigation — extend to seed Phase B cursor).
- Session-switch mid-pagination: re-attach interceptor on the new page, recapture feedback target, continue from `lastGoodEndCursor` (dedup via `seen` keeps resume safe).
- Watchdog unchanged (jobTimeoutMs + 180s).

## 5. Speed Without Hurting Stability

- GraphQL replay ≈ 50 users/page at ~1.2-1.5s/page → **~2,000-3,500 users/min** per session vs current ~30-60/min DOM pace (50-100× on big posts).
- No parallelism added inside a job (no new ban surface). Multi-session used only for failover, not parallel harvest (same as today).
- Adaptive pacing: on rate-limit signal → backoff 2s→5s→10s→ stop honest; on 2 healthy pages → return to base pacing.
- `restDelay` (10s every 8 batches) reduced to 3s for GraphQL pages (server-side responses, not DOM hammering) — keep 10s for DOM fallback.
- Budget projection: log ETA every 30s (`progress.rate_per_min` as today) so the 70% target is observable mid-run.

## 6. Preventing Hangs/Freezes

- All `page.evaluate`/`replayWithCursor` calls already run under the job watchdog (extract.ts:294-318) — a hung browser call can't freeze the queue slot forever.
- `replayWithCursor` gets a hard 20s timeout (AbortController in the in-page fetch) → never an unresolved promise.
- Per-page try/catch: one bad page ≠ job death; 3 consecutive bad pages → switch session → recapture → continue.
- No main-thread SQLite scans touched (enrichment-worker untouched).
- `storeProgress` throttled at 10s as today; progress writes never block the harvest loop.

## 7. Hitting ≥70% Coverage (when data + permissions allow)

- Coverage = unique users stored / total from GraphQL payload (RC6 fix). Target gate: keep paginating while `coverage < 70%` AND `has_next_page` AND budget remains; the 43min budget at GraphQL pace covers ~85k+ users, far above typical posts.
- If coverage < 70% at stop: `stop_reason` states the binding constraint explicitly:
  - `has_next_page=false` at X% → platform/permission limit (FB hides reactors/commenters beyond a point — e.g. anonymous reactors show as "Facebook user" without id) → honest report, not a bug.
  - budget exhausted → job pauses with cursor; resume continues toward 70%.
  - rate-limited on all sessions → `session_rate_limited` + coverage reached.
- The proof table (§9) makes every shortfall attributable. No silent "completed at 0.1%".

## 8. Testing Each Path Independently

- **Unit (new)**: `src/extractors/__tests__/post-pagination.test.ts` — fixtures of real FB GraphQL payload shapes (reaction list edges, comment thread edges, page_info variants, `for (;;);` prefix, multi-line JSON) → assert users/cursor/hasNext extraction, stop-condition matrix, empty-page escalation logic, budget edge (extract pure functions; DOM replay mocked).
- **Unit (existing)**: `npx tsx --test 'src/extractors/__tests__/*.test.ts' 'src/services/__tests__/*.test.ts'` must stay green.
- **Live probe (diagnostic, no mutation)**: standalone `debug-fb-post-pagination.ts` probe (pattern: `debug-ig-dialog.ts`) against a real connected session — dumps captured doc_id/variables/cursor shape BEFORE implementation (Step 0 task) and after each extractor change.
- **Real-run E2E per path** (Khaled's standard): POST /extract with real session → monitor via `scripts/monitor-job.mjs` → DB numbers.
- **Build gates**: `npm run build` (tsc incl. tests) + `npm run typecheck` (frontend untouched, run once).

## 9. Proving the Fix (before/after numbers)

Baseline (today, from DB): b7b10674 reactions 3/3421 = 0.1%, 2m47s. 8566e00d comments 19/25 = 76%.

After fix, run the SAME posts + one big post (>1,000) per path and report:

| Metric | How measured |
|---|---|
| Available (comments/reactions) | `config.total_followers_count` from GraphQL payload (fallback HTML) |
| Extracted (unique stored) | `extraction_results` count for job_id |
| Coverage % | unique / available |
| Speed | results/min (job duration from started_at→completed_at) |
| Errors | dropped batches (progress.lost_batches), failed pages count |
| Un-extracted reason | stop_reason + `has_next_page` at exit + binding constraint |
| Pagination integrity | pages fetched, cursors advanced (log line count) |

Success gate: **both paths ≥70% coverage on posts where FB returns full pagination**; if FB caps (anonymous reactors, hidden counts), the report shows the cap explicitly with `has_next_page=false` proof instead of a fake success.

---

## Tasks

### Task 0: Live probe — capture real pagination shapes (READ-ONLY)

**Objective:** Ground the implementation in the real FB GraphQL request/response for reactions + comments pagination.

**Files:**
- Create: `extraction-service/src/debug-fb-post-pagination.ts` (standalone probe, not imported by service)

**Steps:**
1. `cd D:/Projects/FlowTix/extraction-service && npx tsx src/debug-fb-post-pagination.ts` against a connected session: open post → open reactions dialog → capture the reactions list query (doc_id, variables, first response's `page_info`) → click "view more comments" → capture the comments query. Print shapes, no DB writes.
2. Record findings (doc_ids, variable names incl. cursor field name, total-count field path, per-tab cursors) at the top of `post-reactions.ts` / `post-comments.ts` as a comment block.
3. Commit: `git add src/debug-fb-post-pagination.ts && git commit -m "chore: probe FB post pagination shapes (diagnostic)"`.

### Task 1: Shared pagination core in base.ts (additive)

**Objective:** One tested pagination engine both extractors call.

**Files:**
- Modify: `extraction-service/src/extractors/base.ts` (add `paginateGraphQL()` protected method + retry-store helper)
- Test: `extraction-service/src/extractors/__tests__/post-pagination.test.ts`

**Steps (TDD):**
1. Write failing test: given a captured request + mocked replay responses (2 pages, then `has_next_page=false`), `paginateGraphQL` returns all unique users, last cursor, pagesFetched, stop reason; budget exhaustion → returns `nextCursor`; empty-page escalation → probe-then-stop.
2. Run: `npx tsx --test src/extractors/__tests__/post-pagination.test.ts` → FAIL (not defined).
3. Implement `paginateGraphQL(opts)` in base.ts using existing `GraphQLInterceptor.replayWithCursor` + `parseGraphQLResponse`; 20s in-page fetch timeout; pacing 1.3s; store via `processBatch` wrapped in retry ×3/1s.
4. Run test → PASS. `npm run build` → green.
5. Commit: `feat(extractors): shared cursor-driven GraphQL pagination core`.

### Task 2: Reactions path — GraphQL-first harvest

**Objective:** Reactions extractor uses captured-query pagination; DOM only as fallback.

**Files:**
- Modify: `extraction-service/src/extractors/post-reactions.ts` (extract() main loop, tryOpenReactionsDialog unchanged), `extraction-service/src/services/graphql-interceptor.ts` (parse total count, additive)

**Steps:**
1. Failing test: interceptor attached before dialog open; captured query → paginate → stop_reason matrix (§4 exits); coverage denominator from payload.
2. Implement: attach before `tryOpenReactionsDialog`; Phase B per architecture; per-tab cursors if probe shows tabs; remove body-contains-"reaction" filter (RC8) replaced by doc_id match from capture; stop-condition rework (§2.4); `done`/`nextCursor` semantics (§2.7).
3. Tests PASS + build green.
4. Commit: `feat(post-reactions): cursor-driven GraphQL pagination replaces scroll-hope`.

### Task 3: Comments path — GraphQL-first harvest

**Objective:** Same for comments; "more comments" click retained only as fallback.

**Files:**
- Modify: `extraction-service/src/extractors/post-comments.ts`, graphql-interceptor.ts (comment total)

**Steps:** mirror Task 2 (attach before first click; captured comments query; paginate; fallback DOM path unchanged for zero-capture case; honest stop reasons; resume via cursor seeds Phase B).
Commit: `feat(post-comments): cursor-driven GraphQL pagination`.

### Task 4: Stop conditions, budget, resume wiring

**Objective:** Honest stops + pause/resume chain end-to-end.

**Files:**
- Modify: `post-reactions.ts`, `post-comments.ts` (escalation ladder), `routes/extract.ts` (only: pass `ctx.cursor` into FB extractor seed — small additive hook mirroring IG `seedResume`).

**Steps:**
1. Failing test: budget exhaustion mid-pagination → `done=false, nextCursor=lastCursor`; resume call seeds from cursor; `phase_cycle` increments on escalations; stop reason mapping table.
2. Implement; tests + build green.
3. Commit: `feat(extract): honest stop conditions + cursor resume for FB post paths`.

### Task 5: storeResults retry + lost-batch telemetry

**Files:** Modify `base.ts` (`processBatch` retry ×3, `progress.lost_batches` counter), test in post-pagination.test.ts.
Commit: `fix(extractors): storeResults retry with lost-batch telemetry`.

### Task 6: E2E real-run proof (both paths independently)

**Steps:**
1. Restart service locally on PORT=3200 (probe port, never 3100), kill-by-port first, verify health + new-code log marker.
2. Run reactions job on the b7b10674 post (3,421 available) → collect §9 metrics.
3. Run comments job on the 8566e00d post (25 available) + one >1,000-comment post.
4. Fill the before/after table; if coverage <70%, capture `has_next_page` at exit + FB cap evidence (anonymous "Facebook user" nodes) and report as platform limit.
5. Clean up test jobs from DB afterwards.
6. Commit (if any test fixtures): `test: FB post pagination fixtures`.

### Task 7: Deploy + verify live

**Steps:**
1. `npm run build` green → push main → watch GitHub Actions run `conclusion: success` on the pushed head_sha (repo `a4rbcom-maker/flowtix-social-connect-dad4fa55`).
2. Re-test on `https://api.flowtixtools.com` with a real session; confirm served bundle hash changed; tell user Ctrl+Shift+R if browser cached old JS.
3. Report final before/after table.

---

## Risks & Open Questions

- **FB doc_id churn**: captured doc_id can change server-side; mitigation: capture at runtime (never hardcode as sole source), fallback DOM path retained.
- **Per-tab cursors (reactions)**: if probe shows each reaction tab paginates separately, harvest All-tab first, then other tabs' cursors (Task 2 handles; probe decides).
- **Anonymous reactors**: FB caps full list on some posts (shows "Facebook user" without numeric id → filtered by `^\d{5,25}$`). If cap is real, 70% may be unreachable on those posts — the proof table will show it explicitly with `has_next_page=false`.
- **dtsg expiry mid-run**: `replayWithCursor` re-reads dtsg per call from DOM; on session switch `cachedDtsg` already invalidated (base.ts:519).
- **No-proxy multi-session**: unchanged warning path; not touched.
- **Not in scope** (explicitly): getExistingIds dead-workspace dedup behavior, UI changes, groups/pages/messenger/IG paths.

## Verification Checklist

- [ ] Both paths: unit tests green, build green
- [ ] Real-run reactions ≥70% on b7b10674 post (or documented FB cap)
- [ ] Real-run comments ≥70% (or documented FB cap)
- [ ] Before/after table with available/extracted/coverage/speed/errors/stop_reason
- [ ] stop_reason never "source_exhausted" while `has_next_page=true`
- [ ] Watchdog + pause/resume exercised (budget-cut job resumes from cursor)
