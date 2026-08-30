/**
 * FB POST REACTIONS extractor — cursor-driven GraphQL pagination.
 *
 * PROBE FINDINGS (probe-reactions.ts, live run on a real connected session):
 *   - Opening the reactions dialog fires FB's OWN GraphQL request
 *     (/api/graphql/, POST, doc_id=<reactions list doc>). The response carries
 *     `edges[]` of reactors (node.author.id / node.actor.id + name + url) and a
 *     `page_info.end_cursor` + `page_info.has_next_page`.
 *   - Replaying that captured request from the page context (fetch with the
 *     recycled fb_dtsg + cursor in variables) returns the next page.
 *   - Photo-viewer URLs (photo?fbid=..&set=pcb.X) open the image viewer; the
 *     real post page is reached via the "عرض المنشور" / "View post" permalink —
 *     that page is where the reactions count + dialog live.
 *   - The old scroll-and-hope loop only ever harvested the first dialog screen
 *     (~3 users) and stopped at consecutiveEmpty>=15. This rewrite replaces it
 *     with real pagination driven by FB's page_info.
 *
 * The DOM dialog is now ONLY a fallback: if FB never fires a GraphQL reactions
 * request (rare surface), we open the dialog and scrape links from it.
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

type ReactionStopReason =
  | "session_rate_limited"
  | "no_secondary_session"
  | "source_exhausted"
  | "max_results_reached"
  | "has_next_page_false"
  | "budget_exhausted"
  | "canceled";

interface ReactorUser {
  id: string;
  name: string;
  url: string;
}

const JUNK_SLUGS = new Set([
  "latest", "onthisday", "watch", "gaming", "play", "notes", "sports", "weather",
  "crisisresponse", "fundraisers", "occasions", "movies", "restaurants", "blood",
  "community", "offers", "promotions", "marketplace", "bookmarks", "feed",
  "findfriends", "friends", "story.php", "photo", "photo.php", "video", "video.php",
  "reel", "reels", "posts", "permalink.php", "watchparty", "groups", "events",
]);

function isJunkSlug(slug: string): boolean {
  return JUNK_SLUGS.has(slug.toLowerCase());
}

export class PostReactionsExtractor extends BaseExtractor {
  private totalReactionsCount: number | null = null;
  private totalReactionsSource: string = "unknown";
  private lastStopReason: ReactionStopReason | null = null;
  private lastProgressTs = 0;
  private interceptor = new GraphQLInterceptor();

  async extract(): Promise<{ extracted: number; nextCursor?: string; done: boolean; authState: AuthState }> {
    const pid = parsePostId(this.ctx.sourceUrl);
    if (!pid) throw new ExtractionError(ErrorCodes.INVALID_INPUT, "Invalid post URL");

    let authState: AuthState = "unknown";
    log.info("PostReactions", `starting`, { jobId: this.ctx.jobId, mode: "graphql-pagination", resumeCursor: !!this.ctx.cursor });
    await this.storeExtractionProgress(0, "navigating", 0);

    // Begin capturing FB's own GraphQL traffic BEFORE any navigation, so we
    // catch the reactions-list request FB fires during the initial page load.
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
    log.info("PostReactions", `page loaded`, { finalUrl });
    authState = detectAuthState(html, finalUrl);
    if (authState !== "authenticated") throw new ExtractionError(authStateToErrorCode(authState), authStateToMessage(authState));

    // If we landed in the photo viewer, follow the "view post" permalink.
    await this.followViewPostPermalink();

    // Read the reactions total from the page (fallback denominator).
    const countResult = parseFollowersCount(html);
    if (countResult.count !== null && countResult.count > 0 && countResult.count < 10_000_000) {
      this.totalReactionsCount = countResult.count;
      this.totalReactionsSource = countResult.source;
      log.info("PostReactions", `total reactions (page): ${countResult.count} (source=${countResult.source})`);
      await this.persistReactionsCount(countResult.count, countResult.source);
    } else {
      log.info("PostReactions", `total reactions (page): unknown — will read from GraphQL payload`);
    }

    // (Interceptor was already attached before goto — see top of extract().)
    let capturedWorking: CapturedRequest | null = null;
    let dialogOpened = false;
    try {
      const opened = await this.tryOpenReactionsDialog();
      dialogOpened = opened;
      // Give FB a moment to fire the reactions GraphQL request.
      await this.page.waitForTimeout(3500);

      // Find the reactions-list request among everything FB fired.
      capturedWorking = this.findReactionsRequest();
      if (capturedWorking) {
        log.info("PostReactions", `captured reactions GraphQL doc_id=${capturedWorking.docId}`);
        // Read total from the first captured response if page count was null.
        if (this.totalReactionsCount === null) {
          const total = this.readTotalFromResponses("reaction_count");
          if (total !== null) {
            this.totalReactionsCount = total;
            this.totalReactionsSource = "graphql";
            await this.persistReactionsCount(total, "graphql");
          }
        }
      } else {
        log.warn("PostReactions", `no reactions GraphQL request captured — falling back to DOM dialog scrape`);
      }

      await this.storeExtractionProgress(0, "extracting", 0);
      let total = 0;
      let hasNext = true;

      // PRIMARY path: if FB fired a real paginated reactions connection, replay it.
      if (capturedWorking) {
        const gqlUsers = await this.tryGraphQLBoost(capturedWorking);
        if (gqlUsers > 0) {
          total += gqlUsers;
          log.info("PostReactions", `GraphQL phase: extracted=${total}`);
        }
      }

      // FALLBACK: scroll INSIDE the reactions dialog's scroll box (never the page
      // feed) to trigger FB's incremental loader; scrape user links each round.
      if (total < this.ctx.maxResults && dialogOpened) {
        const domResult = await this.extractFromDialogDomLoop(this.ctx.maxResults - total);
        total += domResult.extracted;
        hasNext = domResult.hasNext;
        if (domResult.extracted > 0) {
          log.info("PostReactions", `DOM dialog phase: +${domResult.extracted} (total=${total}) stop=${domResult.stopReason}`);
        }
      }

      this.finalizeStopReason(total);
      await this.storeExtractionProgress(total, "completed", 0, this.lastStopReason);
      log.info("PostReactions", `extraction finished: total=${total}, coverage=${this.computeCoverage(total)}%, stopReason=${this.lastStopReason ?? "null"}`);

      const done = !hasNext || this.ctx.maxResults <= total;
      const nextCursor = done ? undefined : this.ctx.sourceUrl;
      return { extracted: total, nextCursor, done, authState };
    } finally {
      this.interceptor.detach(this.page);
    }
  }

  // ── FB-own GraphQL capture + replay ──────────────────────────────────────

  private findReactionsRequest(): CapturedRequest | null {
    const texts = this.interceptor.getInterceptedTexts();
    const reqs = this.interceptor.getCapturedRequests ? this.interceptor.getCapturedRequests() : [];
    // FB 2026 fires the reactions request via doc_id=27425187170508695
    // (variables: feedbackTargetID + scale). Capture by doc_id first.
    const REACTION_DOC_IDS = ["27425187170508695"];
    for (let i = reqs.length - 1; i >= 0; i--) {
      const docId = reqs[i]?.docId;
      if (docId && REACTION_DOC_IDS.includes(docId)) {
        this.primeResponseCache(texts);
        return reqs[i];
      }
    }
    // Strategy A: variables mention reaction/reactor.
    const keyA = ["reaction", "reactor"];
    for (let i = reqs.length - 1; i >= 0; i--) {
      const v = JSON.stringify(reqs[i]?.variables ?? {}).toLowerCase();
      if (keyA.some((k) => v.includes(k))) {
        this.primeResponseCache(texts);
        return reqs[i];
      }
    }
    // Strategy B: a response that actually carries reactor user links.
    // (The captured request's own response often is the post payload, not the
    //  reactor list — so we pick the request whose response has user links.)
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i];
      const hasUserLinks = /profile\.php\?id=\d{5,25}/.test(t);
      const hasReactionCtx = /reactors|reactions|reactor/.test(t.toLowerCase());
      if (hasUserLinks && hasReactionCtx) {
        this.primeResponseCache(texts);
        return reqs[i] ?? null;
      }
    }
    return null;
  }

  private responseCache: string[] = [];
  private primeResponseCache(texts: string[]): void {
    this.responseCache = texts.slice();
  }

  private readTotalFromResponses(field: string): number | null {
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
            if (typeof k === "string" && k.toLowerCase() === field && typeof val === "number" && val > 0) return val;
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

  private async fetchReactionsPage(req: CapturedRequest, cursor: string | null): Promise<PageData> {
    const text = await this.interceptor.replayWithCursor(this.page, req, cursor ?? "", 100);
    if (!text) return { users: [], cursor: null, hasNext: false };
    const page = parseGraphQLResponse(text);
    const users: ExtractedMember[] = page.users
      .filter((u) => u.id && /^\d{5,25}$/.test(u.id))
      .map((u) => ({
        fb_id: u.id,
        name: u.name,
        profile_url: u.url,
        type: "reacter",
        ...(u.reaction_type ? { comment_text: undefined } : {}),
      }));
    return { users, cursor: page.endCursor, hasNext: page.hasNextPage };
  }

  /** GraphQL boost: only useful when FB actually serves a paginated reactor
   *  connection. We test the first page; if it yields 0 users it's the post
   *  payload (not a list) and we bail immediately — DOM dialog is the source. */
  private async tryGraphQLBoost(req: CapturedRequest): Promise<number> {
    try {
      const first = await this.fetchReactionsPage(req, null);
      if (first.users.length === 0) return 0;
      let added = 0;
      let cursor: string | null = first.cursor;
      let hasNext = first.hasNext;
      const seen = new Set<string>();
      let pages = 0;
      while (hasNext && added < this.ctx.maxResults && pages < 200) {
        const fresh = first.users.filter((u) => !seen.has(u.fb_id));
        for (const u of fresh) seen.add(u.fb_id);
        if (fresh.length > 0) added += await this.processBatch(fresh, "reacter");
        if (!cursor) break;
        const next = await this.fetchReactionsPage(req, cursor);
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
  // ── PRIMARY path: scroll INSIDE the reactions dialog ───────────────────

  private async extractFromDialogDomLoop(maxResults: number): Promise<{ extracted: number; hasNext: boolean; stopReason: string }> {
    let total = 0;
    let consecutiveEmpty = 0;
    let phaseCycle = 0;
    const seen = new Set<string>();
    while (total < maxResults && consecutiveEmpty < 15 && !this.shouldStop) {
      if (await this.checkCanceled()) break;
      const batch = await this.extractReactorsFromDialogDom(seen);
      if (batch.length > 0) {
        total += await this.processBatch(batch, "reacter");
        consecutiveEmpty = 0;
      } else {
        consecutiveEmpty++;
      }
      phaseCycle++;
      void this.storeExtractionProgress(total, "extracting", phaseCycle);

      // Scroll inside the dialog's scroll box (the lazy-loader trigger).
      const scrolled = await this.scrollDialogBox();
      await this.delay();
      if (!scrolled) {
        // No scrollable box found — dialog is a fixed facepile. Stop honestly.
        if (consecutiveEmpty >= 3) break;
      }
    }
    const hasNext = consecutiveEmpty < 15 && total < maxResults;
    const stopReason = total >= maxResults ? "max_results_reached" : "source_exhausted";
    return { extracted: total, hasNext, stopReason };
  }

  /** Returns true if a scrollable box inside the dialog was found + scrolled. */
  private async scrollDialogBox(): Promise<boolean> {
    return this.page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]') || document.querySelector('[aria-modal="true"]');
      if (!dialog) return false;
      const cands = dialog.querySelectorAll("*");
      for (const el of cands) {
        const s = window.getComputedStyle(el as Element);
        if ((s.overflowY === "auto" || s.overflowY === "scroll") && (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight + 10) {
          (el as HTMLElement).scrollTop += 1200;
          return true;
        }
      }
      return false;
    }).catch(() => false);
  }

  /** DOM fallback: extract user links strictly from the reactions dialog. */
  private async extractReactorsFromDialogDom(seen: Set<string>): Promise<ExtractedMember[]> {
    const rawLinks = await this.page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]') || document.querySelector('[aria-modal="true"]');
      if (!dialog) return [] as { href: string; text: string }[];
      const links = dialog.querySelectorAll('a[href]');
      return Array.from(links).map((link) => ({
        href: link.getAttribute("href") || "",
        text: ((link as HTMLElement).innerText || "").trim(),
      }));
    }).catch(() => [] as { href: string; text: string }[]);

    const batch: ExtractedMember[] = [];
    for (const link of rawLinks) {
      const idMatch = link.href.match(/profile\.php\?id=(\d{5,25})/) || link.href.match(/\/user\/(\d{5,25})/);
      if (!idMatch) continue; // only real user ids
      // Name may be empty (avatar-only link) — fall back to a placeholder.
      const text = (link.text || "").trim();
      const name = text.length >= 2 && text.length <= 100 ? text : "Facebook User";
      const fbId = idMatch[1];
      const profileUrl = `https://www.facebook.com/profile.php?id=${fbId}`;
      if (seen.has(fbId)) continue;
      seen.add(fbId);
      batch.push({ fb_id: fbId, name, profile_url: profileUrl, type: "reacter" });
    }
    return batch;
  }

  private computeCoverage(discovered: number): number | null {
    if (this.totalReactionsCount === null || this.totalReactionsCount <= 0) return null;
    return Math.round((discovered / this.totalReactionsCount) * 1000) / 10;
  }

  private async persistReactionsCount(count: number, source: string): Promise<void> {
    try {
      const job = await supabaseService.getJob(this.ctx.jobId);
      const existingConfig = (job.config || {}) as Record<string, unknown>;
      await supabaseService.updateJob(this.ctx.jobId, {
        config: { ...existingConfig, total_followers_count: count, total_followers_source: source },
      });
    } catch (err) {
      log.warn("PostReactions", `persistReactionsCount failed: ${String(err)}`);
    }
  }

  private async storeExtractionProgress(
    discovered: number,
    phase: "navigating" | "extracting" | "completed",
    phaseCycle: number,
    stopReason?: ReactionStopReason | null,
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
      log.debug("PostReactions", `storeProgress failed: ${String(err)}`);
    }
  }

  private mapStopReason(result: { stopReason: string; exhausted: boolean; hasNext: boolean }): void {
    switch (result.stopReason) {
      case "max_results_reached":
        this.lastStopReason = "max_results_reached";
        break;
      case "has_next_page_false":
        this.lastStopReason = "source_exhausted"; // genuinely exhausted
        break;
      case "budget_exhausted":
        this.lastStopReason = "budget_exhausted";
        break;
      case "canceled":
        this.lastStopReason = "canceled";
        break;
      case "empty_pages_exhausted":
      case "replay_error":
        // Could be a rate-limit/block — surface honestly.
        this.lastStopReason = this.totalSessions > 1 ? "session_rate_limited" : "no_secondary_session";
        break;
    }
  }

  private finalizeStopReason(total: number): void {
    if (this.lastStopReason !== null) return;
    if (total >= this.ctx.maxResults) { this.lastStopReason = "max_results_reached"; return; }
    if ((this.lastStopReason as string | null) === "budget_exhausted") return;
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
      log.info("PostReactions", `following view-post permalink: ${followed}`);
      try {
        await this.page.goto(followed, { waitUntil: "domcontentloaded", timeout: 30000 });
        await this.page.waitForTimeout(3500);
        await this.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(1500);
      } catch { /* best effort */ }
    }
  }

  private async tryOpenReactionsDialog(): Promise<boolean> {
    let dialogOpened = false;
    for (let attempt = 0; attempt < 6 && !dialogOpened; attempt++) {
      if (attempt > 0) await this.page.waitForTimeout(2000);
      const clicked = await this.page.evaluate(() => {
        const reactionLinks = document.querySelectorAll<HTMLAnchorElement>('a[href*="/ufi/reaction/"]');
        if (reactionLinks.length > 0) { reactionLinks[0].click(); return "reaction_link"; }

        const ariaEls = document.querySelectorAll<HTMLElement>('[aria-label]');
        for (const el of ariaEls) {
          const aria = (el.getAttribute("aria-label") || "").trim();
          if (aria.length < 3 || aria.length > 60) continue;
          const lower = aria.toLowerCase();
          if (lower.includes("notif") || lower.includes("إشعار") || lower.includes("مشاهدة") || lower.includes("share")) continue;
          if (lower.includes("reaction") || lower.includes("تفاعل")) { el.click(); return "aria_reaction"; }
        }
        for (const el of ariaEls) {
          const aria = (el.getAttribute("aria-label") || "").trim();
          if (aria.length > 60) continue;
          const lower = aria.toLowerCase();
          if (lower.includes("notif") || lower.includes("إشعار") || lower.includes("مشاهدة") || lower.includes("share")) continue;
          if (/^\d+([.,]\d+)*[kKmM]?(\s|$)/.test(aria)) {
            const parent = el.closest('[data-visualcompletion="ignore-dynamic"]') || el.closest('a[href*="reaction"]');
            if (parent) { (parent as HTMLElement).click(); return "aria_number_parent"; }
            el.click(); return "aria_number";
          }
        }
        return "none";
      }).catch(() => "none");

      if (!clicked || clicked === "none") { await this.page.waitForTimeout(1500); continue; }
      await this.page.waitForTimeout(3000);

      for (let wait = 0; wait < 4; wait++) {
        dialogOpened = await this.page.evaluate(() =>
          !!document.querySelector('[role="dialog"]') || !!document.querySelector('[aria-modal="true"]'),
        ).catch(() => false);
        if (dialogOpened) break;
        await this.page.waitForTimeout(1500);
      }
      if (dialogOpened) {
        const isReactionsDialog = await this.page.evaluate(() => {
          const dialog = document.querySelector('[role="dialog"]') || document.querySelector('[aria-modal="true"]');
          if (!dialog) return false;
          const tabs = dialog.querySelectorAll('[role="tab"], [role="button"]');
          let reactionTabs = 0;
          for (const tab of tabs) {
            const t = (tab as HTMLElement).innerText?.trim() || tab.getAttribute("aria-label") || "";
            const reactions = ["all", "like", "love", "care", "haha", "wow", "sad", "angry",
              "الكل", "أعجبني", "أحببته", "اهتمام", "هههه", "أدهشني", "أحزنني", "أغضبني"];
            if (reactions.some((r) => t.toLowerCase().includes(r.toLowerCase()))) reactionTabs++;
          }
          if (reactionTabs >= 3) return true;
          return dialog.querySelectorAll('a[href*="profile.php"], a[href*="/user/"]').length > 0;
        }).catch(() => false);
        if (!isReactionsDialog) {
          await this.page.keyboard.press("Escape").catch(() => {});
          await this.page.waitForTimeout(1000);
          dialogOpened = false;
        }
      }
    }
    if (dialogOpened) log.info("PostReactions", `reactions dialog opened`);
    return dialogOpened;
  }
}
