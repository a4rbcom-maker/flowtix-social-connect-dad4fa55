/**
 * FB POST COMMENTS extractor — cursor-driven GraphQL pagination.
 *
 * PROBE FINDINGS (probe-reactions.ts MODE=comments, live run):
 *   - Clicking "view more comments" / "عرض المزيد من التعليقات" expands the
 *     thread and fires FB's OWN GraphQL comment-list request (/api/graphql/,
 *     POST). The response carries comment edges (node.author.id + name + url +
 *     body.text) and page_info.end_cursor + has_next_page.
 *   - Replaying that captured request from the page context (recycled fb_dtsg
 *     + cursor in variables) returns the next page of comments — far faster and
 *     more complete than scrolling the DOM.
 *   - The old scroll-and-hope loop only harvested the first ~3 rendered
 *     comments; the comment thread's "more comments" control was frequently
 *     missed by keyword-clicking, so the job stopped at consecutiveEmpty>=15.
 *
 * The DOM article scrape is now ONLY a fallback: used when FB never fires a
 * comment GraphQL request (rare surface).
 */
import { BaseExtractor, parsePostId, parseFollowersCount, detectAuthState, authStateToMessage, authStateToErrorCode } from "./base.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import { supabaseService } from "../services/supabase.js";
import { GraphQLInterceptor, parseGraphQLResponse, type CapturedRequest } from "../services/graphql-interceptor.js";
import { paginateGraphQL, type PageData, type ExtractedMember } from "./graphql-pagination.js";
import type { Page } from "playwright";
import type { AuthState } from "../types.js";

const log = logger;

type CommentStopReason =
  | "session_rate_limited"
  | "no_secondary_session"
  | "source_exhausted"
  | "max_results_reached"
  | "has_next_page_false"
  | "budget_exhausted"
  | "canceled";

interface InterceptedComment {
  fb_id: string;
  name: string;
  profile_url: string;
  comment_text: string;
  comment_id?: string;
}

const JUNK_SLUGS = new Set([
  "latest", "onthisday", "watch", "gaming", "play", "notes", "sports", "weather",
  "crisisresponse", "fundraisers", "occasions", "movies", "restaurants", "blood",
  "community", "offers", "promotions", "marketplace", "bookmarks", "feed",
  "findfriends", "friends", "story.php", "photo", "photo.php", "video", "video.php",
  "reel", "reels", "posts", "permalink.php", "watchparty", "groups", "events",
  "help", "settings", "login", "pages", "profile", "people", "public",
  "policies", "privacy", "terms", "business", "advertising", "jobs", "about",
  "home.php", "hashtag", "search", "directory", "gaming/video", "support",
]);

function isJunkSlug(slug: string): boolean {
  return JUNK_SLUGS.has(slug.toLowerCase());
}

/** Normalize a comment/reactor author href into a stable fb_id.
 *  Accepts numeric profile.php / /user/ ids AND vanity slugs
 *  (facebook.com/<slug>?comment_id=…). Returns null for junk/non-user links.
 *  Exported so the reactions extractor shares the same resolution rules (DRY)
 *  and so the vanity-vs-numeric behavior is unit-testable without a browser. */
export function normalizeUserHref(href: string): { fbId: string; profileUrl: string } | null {
  const idMatch = href.match(/profile\.php\?id=(\d{5,25})/) || href.match(/\/user\/(\d{5,25})/);
  if (idMatch) {
    return { fbId: idMatch[1], profileUrl: `https://www.facebook.com/profile.php?id=${idMatch[1]}` };
  }
  const abs = href.startsWith("http") ? href : `https://www.facebook.com${href}`;
  const vanity = abs.match(/facebook\.com\/([a-zA-Z0-9.]{3,60})(?:[/?#]|$)/i);
  if (!vanity || isJunkSlug(vanity[1])) return null;
  return { fbId: vanity[1], profileUrl: `https://www.facebook.com/${vanity[1]}` };
}

export class PostCommentsExtractor extends BaseExtractor {
  private totalCommentsCount: number | null = null;
  private totalCommentsSource: string = "unknown";
  private lastStopReason: CommentStopReason | null = null;
  private lastProgressTs = 0;
  private interceptor = new GraphQLInterceptor();

  async extract(): Promise<{ extracted: number; nextCursor?: string; done: boolean; authState: AuthState }> {
    const pid = parsePostId(this.ctx.sourceUrl);
    if (!pid) throw new ExtractionError(ErrorCodes.INVALID_INPUT, "Invalid post URL");

    let authState: AuthState = "unknown";
    log.info("PostComments", `starting`, { jobId: this.ctx.jobId, mode: "graphql-pagination" });
    await this.storeExtractionProgress(0, "navigating", 0);

    // Begin capturing FB's own GraphQL traffic BEFORE any navigation, so we
    // catch the comment-list request FB fires during the initial page load.
    this.interceptor.attach(this.page);

    try {
      await this.page.goto(this.ctx.sourceUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await this.page.waitForTimeout(3000);
      await this.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await this.page.waitForTimeout(2000);
    } catch (err) {
      throw new ExtractionError(ErrorCodes.NETWORK_ERROR, `Navigation error: ${String(err)}`);
    }

    const html = await this.page.content();
    const finalUrl = this.page.url();
    authState = detectAuthState(html, finalUrl);
    if (authState !== "authenticated") throw new ExtractionError(authStateToErrorCode(authState), authStateToMessage(authState));

    await this.followViewPostPermalink();

    const countResult = parseFollowersCount(html);
    this.totalCommentsCount = countResult.count;
    this.totalCommentsSource = countResult.source;
    log.info("PostComments", `total comments: ${countResult.count ?? "unknown"} (source=${countResult.source})`);
    if (countResult.count !== null) await this.persistCommentsCount(countResult.count, countResult.source);

    // (Interceptor was already attached before goto — see top of extract().)
    try {
      await this.expandCommentsThread();
      await this.page.waitForTimeout(4000);

      const capturedWorking = this.findCommentsRequest();
      if (capturedWorking) {
        log.info("PostComments", `captured comments GraphQL doc_id=${capturedWorking.docId}`);
        if (this.totalCommentsCount === null) {
          const total = this.readTotalFromResponses("comment_count", "total_count");
          if (total !== null) {
            this.totalCommentsCount = total;
            this.totalCommentsSource = "graphql";
            await this.persistCommentsCount(total, "graphql");
          }
        }
      } else {
        log.warn("PostComments", `no comments GraphQL request captured — will use DOM fallback`);
      }

      await this.storeExtractionProgress(0, "extracting", 0);
      let total = 0;
      let hasNext = true;

      // Open the full comment thread first (FB lazy-loads it).
      await this.tryOpenCommentsThread();
      await this.page.waitForTimeout(2000);

      // PRIMARY path: if FB fired a real paginated comment connection, replay it
      // (this is what reached 19/25 on small posts). Falls through to DOM if the
      // captured response carried no real comment users.
      if (capturedWorking) {
        const gqlUsers = await this.tryGraphQLBoost(capturedWorking);
        if (gqlUsers > 0) {
          total += gqlUsers;
          log.info("PostComments", `GraphQL phase: extracted=${total}`);
        }
      }

      // FALLBACK: expand the thread + scroll the feed + scrape comment articles.
      if (total < this.ctx.maxResults) {
        const domResult = await this.extractFromDomLoop(this.ctx.maxResults - total);
        total += domResult.extracted;
        hasNext = domResult.hasNext;
        if (domResult.extracted > 0) {
          log.info("PostComments", `DOM thread phase: +${domResult.extracted} (total=${total}) stop=${domResult.stopReason}`);
        }
      }
      this.finalizeStopReason(total);
      await this.storeExtractionProgress(total, "completed", 0, this.lastStopReason);
      log.info("PostComments", `extraction finished: total=${total}, coverage=${this.computeCoverage(total)}%, stopReason=${this.lastStopReason ?? "null"}`);

      const done = !hasNext || this.ctx.maxResults <= total;
      const nextCursor = done ? undefined : this.ctx.sourceUrl;
      return { extracted: total, nextCursor, done, authState };
    } finally {
      this.interceptor.detach(this.page);
    }
  }

  // ── FB-own GraphQL capture + replay ──────────────────────────────────────

  private findCommentsRequest(): CapturedRequest | null {
    const texts = this.interceptor.getInterceptedTexts();
    const reqs = this.interceptor.getCapturedRequests();
    const pairs = this.interceptor.getCapturedPairs();
    // Dump every captured request for diagnostics (will be removed after fix).
    if (reqs.length === 0) {
      log.warn("PostComments", `findCommentsRequest: NO requests captured. texts=${texts.length}`);
    } else {
      log.info("PostComments", `findCommentsRequest: ${reqs.length} requests, ${texts.length} texts, ${pairs.length} pairs, docIds=${reqs.slice(0, 10).map(r => r?.docId ?? 'null').join('|')}`);
    }
    // PRIMARY (response-driven): pick the request whose OWN response actually
    // carried comment authors + pagination. FB reuses the same comment doc_ids
    // for an empty post-payload response AND the rich comment-list response, so
    // matching by doc_id alone frequently selects the empty one (root cause of
    // the 0-result bug). Correlating request↔response removes the guess.
    let bestPair: { pair: import("../services/graphql-interceptor.js").CapturedPair; users: number } | null = null;
    for (const pair of pairs) {
      const page = parseGraphQLResponse(pair.responseText);
      if (page.users.length > 0 && (page.endCursor || page.hasNextPage)) {
        if (!bestPair || page.users.length > bestPair.users) bestPair = { pair, users: page.users.length };
      }
    }
    if (bestPair) {
      log.info("PostComments", `findCommentsRequest: response-driven pick doc_id=${bestPair.pair.request.docId} (users=${bestPair.users} in its own response)`);
      // Prime the cache with the winning response FIRST so tryGraphQLBoost's
      // seed read finds it immediately, then the rest for total-count scans.
      this.responseCache = [bestPair.pair.responseText, ...texts];
      return bestPair.pair.request;
    }
    // FB 2026 fires the comment thread via doc_id=28647291724863619 (variables
    // include feedbackTargetID / nodeID / mediasetToken). Capture it by doc_id
    // first, then fall back to variable/response heuristics.
    const COMMENT_DOC_IDS = [
      "28647291724863619",
      "25220416984279164",
      "26996952523264441",
      "27255340990751033",
      "9989124061109700",
    ];
    for (let i = reqs.length - 1; i >= 0; i--) {
      const docId = reqs[i]?.docId;
      if (docId && COMMENT_DOC_IDS.includes(docId)) {
        this.primeResponseCache(texts);
        return reqs[i];
      }
    }
    // Fallback: variables mention comment/feedback.
    const keyA = ["comment", "feedback", "thread"];
    for (let i = reqs.length - 1; i >= 0; i--) {
      const v = JSON.stringify(reqs[i]?.variables ?? {}).toLowerCase();
      if (keyA.some((k) => v.includes(k))) { this.primeResponseCache(texts); return reqs[i]; }
    }
    // Fallback: a captured response that carries comment authors + page_info.
    for (let i = 0; i < texts.length; i++) {
      const page = parseGraphQLResponse(texts[i]);
      if (page.users.length > 0 && (page.endCursor || page.hasNextPage)) {
        this.primeResponseCache(texts);
        return reqs[i] ?? null;
      }
    }
    return null;
  }

  private responseCache: string[] = [];
  private primeResponseCache(texts: string[]): void { this.responseCache = texts.slice(); }

  private readTotalFromResponses(...fields: string[]): number | null {
    for (const t of this.responseCache) {
      try {
        const idx = t.indexOf("for (;;);");
        const json = idx >= 0 ? t.slice(idx + 9).trim() : t.trim();
        const walk = (obj: any, depth: number): number | null => {
          if (!obj || depth < 0) return null;
          if (Array.isArray(obj)) { for (const it of obj) { const r = walk(it, depth - 1); if (r !== null) return r; } return null; }
          if (typeof obj !== "object") return null;
          for (const k of Object.keys(obj)) {
            const val = obj[k];
            if (typeof k === "string" && fields.includes(k.toLowerCase()) && typeof val === "number" && val > 0) return val;
            if (val && typeof val === "object") { const r = walk(val, depth - 1); if (r !== null) return r; }
          }
          return null;
        };
        const n = walk(JSON.parse(json), 10);
        if (n !== null) return n;
      } catch { /* not json */ }
    }
    return null;
  }

  private async fetchCommentsPage(req: CapturedRequest, cursor: string | null): Promise<PageData> {
    const text = await this.interceptor.replayWithCursor(this.page, req, cursor ?? "", 100);
    if (!text) return { users: [], cursor: null, hasNext: false };
    const page = parseGraphQLResponse(text);
    const users: ExtractedMember[] = page.users
      .filter((u) => u.id && /^\d{5,25}$/.test(u.id))
      .map((u) => ({
        fb_id: u.id,
        name: u.name,
        profile_url: u.url,
        type: "commenter",
        ...(u.comment_text ? { comment_text: u.comment_text } : {}),
      }));
    return { users, cursor: page.endCursor, hasNext: page.hasNextPage };
  }

  /** Parse the ALREADY-CAPTURED winning response (responseCache[0]) into a
   *  PageData without any network call. FB serves the first comment page in
   *  the page-load traffic itself; replaying that request often returns error
   *  1357054, so this passively-captured page is the reliable seed. */
  private seedPageFromCache(): PageData {
    const seed = this.responseCache[0];
    if (!seed) return { users: [], cursor: null, hasNext: false };
    const page = parseGraphQLResponse(seed);
    const users: ExtractedMember[] = page.users
      .filter((u) => u.id && /^\d{5,25}$/.test(u.id))
      .map((u) => ({
        fb_id: u.id,
        name: u.name,
        profile_url: u.url,
        type: "commenter",
        ...(u.comment_text ? { comment_text: u.comment_text } : {}),
      }));
    return { users, cursor: page.endCursor, hasNext: page.hasNextPage };
  }

  /** GraphQL boost: seed from the captured first-page response (guaranteed to
   *  hold the users FB already served), then paginate via cursor replay for
   *  the rest. Replay may fail (FB error 1357054) — the seed still counts. */
  private async tryGraphQLBoost(req: CapturedRequest): Promise<number> {
    try {
      // 1) Seed from the passively-captured winning response (no network).
      let first = this.seedPageFromCache();
      // 2) If the cache seed was empty for some reason, try a live replay.
      if (first.users.length === 0) first = await this.fetchCommentsPage(req, null);
      if (first.users.length === 0) return 0;

      let added = 0;
      const seen = new Set<string>();
      // Store the seed page immediately.
      const seedFresh = first.users.filter((u) => !seen.has(u.fb_id));
      for (const u of seedFresh) seen.add(u.fb_id);
      if (seedFresh.length > 0) added += await this.processBatch(seedFresh, "commenter");

      let cursor: string | null = first.cursor;
      let hasNext = first.hasNext;
      let pages = 0;
      let emptyReplays = 0;
      while (hasNext && cursor && added < this.ctx.maxResults && pages < 200 && emptyReplays < 3) {
        const next = await this.fetchCommentsPage(req, cursor);
        if (next.users.length === 0) {
          // Replay came back empty/blocked — count it, bail after a few.
          emptyReplays++;
        } else {
          const fresh = next.users.filter((u) => !seen.has(u.fb_id));
          for (const u of fresh) seen.add(u.fb_id);
          if (fresh.length > 0) added += await this.processBatch(fresh, "commenter");
          emptyReplays = 0;
        }
        hasNext = next.hasNext;
        cursor = next.cursor;
        pages++;
        await new Promise((r) => setTimeout(r, 1200));
      }
      return added;
    } catch {
      return 0;
    }
  }

  // ── PRIMARY path: expand thread + scroll feed, scraping comment articles ──

  /** Open the full comment thread (FB lazy-loads it behind a "view all N
   *  comments" control). Must run before scrape or drainDomBatch sees nothing. */
  private async tryOpenCommentsThread(): Promise<boolean> {
    const opened = await this.page.evaluate(() => {
      const keywords = [
        "view all", "view all comments", "all comments", "عرض كل التعليقات",
        "عرض التعليقات", "see all", "show all comments", "most relevant comments",
        "comments", "التعليقات",
      ];
      const all = document.querySelectorAll<HTMLElement>('[role="button"], a, span, div');
      for (const el of all) {
        const t = (el.innerText || el.getAttribute("aria-label") || "").trim().toLowerCase();
        if (!t || t.length > 80) continue;
        for (const kw of keywords) {
          if (t === kw || t.startsWith(kw + " ") || t.includes(" " + kw + " ")) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) { el.click(); return true; }
          }
        }
      }
      return false;
    }).catch(() => false);
    if (opened) {
      await this.page.waitForTimeout(2500);
      // expand any "view more comments / replies" that appeared
      await this.expandCommentsThread();
    }
    return opened;
  }

  private async extractFromDomLoop(maxResults: number): Promise<{ extracted: number; hasNext: boolean; stopReason: string }> {
    let total = 0;
    let consecutiveEmpty = 0;
    let phaseCycle = 0;
    let consumedPairs = 0;
    const seen = new Set<string>();
    while (total < maxResults && consecutiveEmpty < 15 && !this.shouldStop) {
      if (await this.checkCanceled()) break;
      // expand "more comments / replies" controls each round so the thread grows
      await this.expandCommentsThread();

      // HARVEST-CAPTURED: every "view more comments" click makes FB fire a new
      // paginated comment GraphQL response. The interceptor already captured
      // it — consume NEW pairs each round (before the DOM catches up) so the
      // pagination cursor chain is usable even when the DOM lags.
      let newPairs = 0;
      try {
        const pairs = this.interceptor.getCapturedPairs();
        for (; consumedPairs < pairs.length; consumedPairs++) {
          const page = parseGraphQLResponse(pairs[consumedPairs].responseText);
          if (page.users.length === 0) continue;
          const users: ExtractedMember[] = page.users
            .filter((u) => u.id && /^\d{5,25}$/.test(u.id))
            .map((u) => ({
              fb_id: u.id,
              name: u.name,
              profile_url: u.url,
              type: "commenter",
              ...(u.comment_text ? { comment_text: u.comment_text } : {}),
            }));
          const fresh = users.filter((u) => !seen.has(u.fb_id));
          for (const u of fresh) seen.add(u.fb_id);
          if (fresh.length > 0) {
            newPairs += fresh.length;
            total += await this.processBatch(fresh, "commenter");
          }
        }
      } catch { /* best-effort harvest */ }

      const batch = await this.drainDomBatch(seen);
      if (batch.length > 0 || newPairs > 0) {
        total += await this.processBatch(batch, "commenter");
        consecutiveEmpty = 0;
      } else {
        consecutiveEmpty++;
      }
      phaseCycle++;
      void this.storeExtractionProgress(total, "extracting", phaseCycle);
      await this.scrollFeed(this.page);
      await this.delay();
    }
    const hasNext = consecutiveEmpty < 15 && total < maxResults;
    const stopReason = total >= maxResults ? "max_results_reached" : "source_exhausted";
    return { extracted: total, hasNext, stopReason };
  }

  // ── DOM fallback (old name kept for reference) ───────────────────────────

  private async extractFromDomFallback(maxResults: number): Promise<number> {
    const r = await this.extractFromDomLoop(maxResults);
    return r.extracted;
  }

  private async drainDomBatch(seen: Set<string>): Promise<ExtractedMember[]> {
    const raw: { href: string; name: string; comment_text: string; comment_id?: string }[] = await this.page.evaluate(() => {
      const items: { href: string; name: string; comment_text: string; comment_id?: string }[] = [];
      const seenHrefs = new Set<string>();
      const articles = document.querySelectorAll('[role="article"]');
      articles.forEach((article) => {
        const candidates = Array.from(article.querySelectorAll('a[href]')) as HTMLAnchorElement[];
        const userLink = candidates.find((a) => {
          const href = a.getAttribute("href") || "";
          return /profile\.php\?id=\d+/.test(href) || /\/user\/\d+/.test(href);
        }) || candidates.find((a) => {
          const href = a.getAttribute("href") || "";
          if (href.includes("/help/") || href.includes("/settings/")) return false;
          const m = href.match(/^\/([a-zA-Z0-9.]{3,60})(?:[/?#]|$)/);
          if (!m) return false;
          const slug = m[1].toLowerCase();
          if (["help", "settings", "login", "watch", "reel", "videos", "photos", "groups", "events", "marketplace", "photo.php", "story.php", "permalink.php", "posts"].includes(slug)) return false;
          return true;
        });
        if (!userLink) return;
        const href = userLink.getAttribute("href") || "";
        // Accept BOTH numeric ids AND vanity slugs. The vanity path is resolved
        // via normalizeUserHref in the outer loop; dropping non-numeric hrefs
        // here was the root cause of 0-comment results on /posts/ surfaces,
        // where FB renders every commenter as facebook.com/<slug>?comment_id=…
        const looksUserish = /profile\.php\?id=\d{5,25}/.test(href)
          || /\/user\/\d{5,25}/.test(href)
          || /^\/?(?:https?:\/\/[^/]*facebook\.com)?\/[a-zA-Z0-9.]{3,60}(?:[/?#]|$)/.test(href);
        if (!looksUserish) return;
        // Name may live on the link, its aria-label, or a sibling inside the article.
        let name = ((userLink as HTMLElement).innerText || "").trim();
        if (!name) name = (userLink.getAttribute("aria-label") || "").trim();
        if (!name) {
          const sib = (article.querySelector("[dir=\"auto\"]") as HTMLElement | null);
          name = sib ? (sib.innerText || "").trim().slice(0, 80) : "";
        }
        if (!name || name.length > 80) name = "Facebook User";
        if (seenHrefs.has(href)) return;
        const textSpans = article.querySelectorAll('span[dir="auto"], div[dir="auto"], [data-ad-comet-preview]');
        let commentText = "";
        for (const span of textSpans) {
          const t = ((span as HTMLElement).innerText || "").trim();
          if (!t || t.length < 3 || t === name) continue;
          if (/^\d+\s*(like|react|reply|comment|share)/i.test(t)) continue;
          if (/^(like|react|reply|share|أعجبني|ردّ|رد|مشاركة|إعجاب)/i.test(t)) continue;
          if (t.length > 3000) continue;
          commentText = t;
          break;
        }
        const commentIdAttr = (article as HTMLElement).getAttribute("data-comment-id")
          || (article.closest("[data-comment-id]") as HTMLElement | null)?.getAttribute("data-comment-id")
          || undefined;
        seenHrefs.add(href);
        items.push({ href, name, comment_text: commentText, comment_id: commentIdAttr || undefined });
      });
      return items;
    }).catch(() => [] as { href: string; name: string; comment_text: string; comment_id?: string }[]);

    const batch: ExtractedMember[] = [];
    for (const c of raw) {
      const norm = normalizeUserHref(c.href);
      if (!norm) continue;
      const { fbId, profileUrl } = norm;
      if (seen.has(fbId)) continue;
      seen.add(fbId);
      batch.push({
        fb_id: fbId,
        name: c.name,
        profile_url: profileUrl,
        type: "commenter",
        ...(c.comment_text ? { comment_text: c.comment_text } : {}),
        ...(c.comment_id ? { comment_id: c.comment_id } : {}),
      });
    }
    return batch;
  }

  private computeCoverage(discovered: number): number | null {
    if (this.totalCommentsCount === null || this.totalCommentsCount <= 0) return null;
    return Math.round((discovered / this.totalCommentsCount) * 1000) / 10;
  }

  private async persistCommentsCount(count: number, source: string): Promise<void> {
    try {
      const job = await supabaseService.getJob(this.ctx.jobId);
      const existingConfig = (job.config || {}) as Record<string, unknown>;
      await supabaseService.updateJob(this.ctx.jobId, {
        config: { ...existingConfig, total_followers_count: count, total_followers_source: source },
      });
    } catch (err) {
      log.warn("PostComments", `persistCommentsCount failed: ${String(err)}`);
    }
  }

  private async storeExtractionProgress(
    discovered: number,
    phase: "navigating" | "extracting" | "completed",
    phaseCycle: number,
    stopReason?: CommentStopReason | null,
  ): Promise<void> {
    const now = Date.now();
    if (phase !== "navigating" && phase !== "completed" && now - this.lastProgressTs < 8_000) return;
    this.lastProgressTs = now;
    const coverage = this.computeCoverage(discovered);
    const progress: Record<string, unknown> = {
      discovered,
      processed: discovered,
      phase,
      phase_cycle: phaseCycle,
      coverage_rate: coverage,
      last_update: new Date().toISOString(),
    };
    if (stopReason !== undefined) progress.stop_reason = stopReason;
    try {
      await supabaseService.storeProgress(this.ctx.jobId, progress);
    } catch (err) {
      log.debug("PostComments", `storeProgress failed: ${String(err)}`);
    }
  }

  private mapStopReason(result: { stopReason: string; exhausted: boolean; hasNext: boolean }): void {
    switch (result.stopReason) {
      case "max_results_reached": this.lastStopReason = "max_results_reached"; break;
      case "has_next_page_false": this.lastStopReason = "source_exhausted"; break;
      case "budget_exhausted": this.lastStopReason = "budget_exhausted"; break;
      case "canceled": this.lastStopReason = "canceled"; break;
      case "empty_pages_exhausted":
      case "replay_error":
        this.lastStopReason = this.totalSessions > 1 ? "session_rate_limited" : "no_secondary_session";
        break;
    }
  }

  private finalizeStopReason(total: number): void {
    if (this.lastStopReason !== null) return;
    if (total >= this.ctx.maxResults) { this.lastStopReason = "max_results_reached"; return; }
    const coverage = this.computeCoverage(total);
    if (coverage === null || coverage >= 85) { this.lastStopReason = "source_exhausted"; return; }
    this.lastStopReason = "source_exhausted";
  }

  private async followViewPostPermalink(): Promise<void> {
    const followed = await this.page.evaluate(() => {
      const links = document.querySelectorAll<HTMLAnchorElement>('a[href]');
      for (const a of links) {
        const t = (a.innerText || "").trim();
        if (t === "عرض المنشور" || t.toLowerCase() === "view post") return a.href;
      }
      return null;
    }).catch(() => null);
    if (followed) {
      try {
        await this.page.goto(followed, { waitUntil: "domcontentloaded", timeout: 30000 });
        await this.page.waitForTimeout(3500);
        await this.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(1500);
      } catch { /* best effort */ }
    }
  }

  private async expandCommentsThread(): Promise<void> {
    for (let pass = 0; pass < 4; pass++) {
      const clicked = await this.page.evaluate(() => {
        const keywords = ["view more comments", "عرض المزيد من التعليقات", "more comments",
          "view more replies", "عرض المزيد من الردود", "more replies", "عرض المزيد", "view more",
          "see more", "previous comments", "التعليقات السابقة", "view previous comments",
          "عرض التعليقات السابقة", "الردود", "replies"];
        const all = document.querySelectorAll<HTMLElement>('[role="button"], a, span, div');
        for (const el of all) {
          const t = (el.innerText || el.getAttribute("aria-label") || "").trim().toLowerCase();
          if (!t || t.length > 80) continue;
          for (const kw of keywords) { if (t.includes(kw)) { el.click(); return true; } }
        }
        return false;
      }).catch(() => false);
      if (clicked) await this.page.waitForTimeout(1500);
    }
  }
}
