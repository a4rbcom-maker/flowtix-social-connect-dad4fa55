import { BaseExtractor, parsePageId, parseFollowersCount, detectAuthState } from "./base.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import { supabaseService } from "../services/supabase.js";
import { GraphQLInterceptor } from "../services/graphql-interceptor.js";
import { extractEngagers } from "../services/engager-extractor-v2.js";
import { multiSessionScrollFollowers } from "../services/multi-session-followers.js";
import type { AuthState, ExtractedMember } from "../types.js";
import type { Page } from "playwright";

const log = logger;

type StopReason = "max_results_reached" | "canceled" | "completed";

interface PostInfo {
  postId: string;
  permalink: string;
}

const AUTO_GEN = /^(Adventurous|Playful|Shiny|Brave|Clever|Happy|Jolly|Mysterious|Silly|Friendly)\w+\d+/i;
function validName(name: string): boolean {
  if (!name || name.length < 3) return false;
  if (AUTO_GEN.test(name)) return false;
  if (/^User\d{3,}$/i.test(name)) return false;
  return true;
}

export class PageFollowersExtractor extends BaseExtractor {
  private totalFollowersCount: number | null = null;
  private lastStopReason: StopReason | null = null;
  private lastProgressTs = 0;
  private lastCancelCheckTs = 0;

  async extract(): Promise<{ extracted: number; nextCursor?: string; done: boolean; authState: AuthState }> {
    const pid = parsePageId(this.ctx.sourceUrl);
    if (!pid) throw new ExtractionError(
      ErrorCodes.INVALID_INPUT,
      `رابط الصفحة غير صالح: [${this.ctx.sourceUrl}]. الصيغة المتوقعة: https://www.facebook.com/اسم-الصفحة أو https://www.facebook.com/profile.php?id=123456789 — إذا كان الرابط جروباً فاستخدم نوع "استخراج أعضاء الجروب" بدلاً منه.`,
    );

    log.info("PageFollowers", `========================================`);
    log.info("PageFollowers", `TWO-PHASE v4 — followers list + posts cascade`);
    log.info("PageFollowers", `jobId=${this.ctx.jobId} page=${pid} max=${this.ctx.maxResults} sessions=${1 + this.secondarySessionPages.length}`);
    log.info("PageFollowers", `========================================`);

    // Setup all available pages
    const allPages: Array<{ sessionId: string; page: Page }> = [
      { sessionId: this.ctx.sessionId, page: this.page },
      ...this.secondarySessionPages,
    ];

    // Navigate main page to the target
    try {
      await this.page.goto(`https://www.facebook.com/${pid}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await this.page.waitForTimeout(2500);
    } catch (err) {
      throw new ExtractionError(ErrorCodes.NETWORK_ERROR, `Navigation error: ${String(err)}`);
    }

    const html = await this.page.content();
    const authState = detectAuthState(html, this.page.url());
    if (authState !== "authenticated") throw new ExtractionError(ErrorCodes.AUTH_FAILED, `Auth: ${authState}`);

    // Persist followers count
    const countResult = parseFollowersCount(html);
    this.totalFollowersCount = countResult.count;
    if (countResult.count !== null) {
      try {
        const job = await supabaseService.getJob(this.ctx.jobId);
        await supabaseService.updateJob(this.ctx.jobId, {
          config: { ...((job.config || {}) as Record<string, unknown>), total_followers_count: countResult.count, total_followers_source: countResult.source },
        });
      } catch { /* skip */ }
    }

    const coverageTarget = this.totalFollowersCount
      ? Math.max(1, Math.round(this.totalFollowersCount * 0.85))
      : this.ctx.maxResults;
    const targetCount = Math.min(this.ctx.maxResults, coverageTarget);

    const seenIds = new Set<string>();
    const startTime = Date.now();
    let total = 0;

    // ====== Phase 1: followers list — extract what Facebook allows ======
    if (this.timeRemainingSec > 150) {
      const phase1Budget = Math.min(
        Math.max(180_000, Math.floor(this.timeRemainingMs * 0.55)),
        Math.max(60_000, this.timeRemainingMs - 120_000),
      );
      const phase1 = await this.runFollowersListPhase(pid, allPages, seenIds, targetCount, phase1Budget);
      total += phase1.persisted;
    }

    // ====== Phase 2: posts cascade — when the followers list topped out ======
    let posts = { extracted: 0, postsDone: 0, discovered: 0 };
    if (
      seenIds.size < targetCount &&
      this.timeRemainingSec > 120 &&
      !(await this.checkCanceled())
    ) {
      log.info("PageFollowers", `followers list capped at ${seenIds.size}/${targetCount} — starting posts cascade phase`);
      posts = await this.runPostsCascadePhase(pid, allPages, seenIds, targetCount);
      total += posts.extracted;
    }

    // Final flush
    if (!this.lastStopReason) {
      this.lastStopReason = seenIds.size >= targetCount ? "max_results_reached" : "completed";
    }

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = Number(elapsedSec) > 0 ? (total / (Number(elapsedSec) / 60)).toFixed(1) : "0";
    log.info("PageFollowers", `========================================`);
    log.info("PageFollowers", `DONE: ${total} users (list+posts) from ${posts.postsDone}/${posts.discovered} posts in ${elapsedSec}s (${rate} users/min)`);
    log.info("PageFollowers", `stop reason: ${this.lastStopReason}`);
    log.info("PageFollowers", `========================================`);
    await this.storeProgress("completed", posts.discovered, posts.postsDone, total, this.lastStopReason);

    return { extracted: total, done: true, authState };
  }

  /**
   * Phase 1: scroll the /followers/ tab with every session in parallel
   * (GraphQL interception + human-like scrolling). Stops naturally when
   * Facebook caps pagination (idle detection + wake-up attempts), returning
   * whatever it managed to extract.
   */
  private async runFollowersListPhase(
    pid: string,
    allPages: Array<{ sessionId: string; page: Page }>,
    seenIds: Set<string>,
    targetCount: number,
    budgetMs: number,
  ): Promise<{ persisted: number; stoppedReason: string }> {
    log.info("PageFollowers", `=== Phase 1: followers list (direct) ===`);
    log.info("PageFollowers", `sessions=${allPages.length} target=${targetCount} budget=${Math.round(budgetMs / 60000)}min`);

    // multiSessionScrollFollowers derives the /followers/ URL from each page's
    // current URL — point every session at the target page first.
    await Promise.all(allPages.map(async ({ sessionId, page }) => {
      try {
        await page.goto(`https://www.facebook.com/${pid}`, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(1500 + Math.random() * 1500);
      } catch (err) {
        log.warn("PageFollowers", `session ${sessionId.slice(0, 8)}: nav failed — ${String(err).substring(0, 80)}`);
      }
    }));

    const shared: Array<{ fb_id: string; name: string; profile_url: string }> = [];
    let flushedUpTo = 0;
    let persisted = 0;
    let flushing = false;
    let lastFlushTs = 0;

    // Incremental save: flush only the not-yet-persisted slice of `shared`
    // (the array itself must keep growing — its length drives progress/target).
    const flushNew = async (): Promise<void> => {
      if (flushing || flushedUpTo >= shared.length) return;
      flushing = true;
      const batch = shared.slice(flushedUpTo);
      flushedUpTo = shared.length;
      const members: ExtractedMember[] = [];
      for (const u of batch) {
        if (!validName(u.name) || seenIds.has(u.fb_id)) continue;
        seenIds.add(u.fb_id);
        members.push({ fb_id: u.fb_id, name: u.name.trim().substring(0, 200), profile_url: u.profile_url, type: "follower" });
      }
      if (members.length > 0) {
        persisted += await this.processBatch(members, "follower");
      }
      flushing = false;
    };

    const result = await multiSessionScrollFollowers(allPages, shared, {
      maxDurationMs: budgetMs,
      targetCount,
      onProgress: (totalSeen) => {
        const now = Date.now();
        if (now - lastFlushTs > 4000) {
          lastFlushTs = now;
          void flushNew().catch(() => {});
          void this.storeProgress("scrolling", totalSeen, 0, persisted);
        }
      },
      shouldStop: () => this.periodicCancelCheck(),
    });

    await flushNew().catch(() => {});
    await this.storeProgress("scrolling", result.totalSeen, 0, persisted);

    log.info("PageFollowers", `Phase 1 finished: seen=${result.totalSeen} persisted=${persisted} (reason=${result.stoppedReason})`);
    for (const s of result.perSession) {
      log.info("PageFollowers", `  session ${s.sessionId.slice(0, 8)}: ${s.extracted} users (${s.rounds} rounds, ${s.stoppedReason})`);
    }
    return { persisted, stoppedReason: result.stoppedReason };
  }

  /**
   * Phase 2: discover posts on the page feed (DOM links + GraphQL post ids)
   * while one worker per session extracts reactors + commenters from each
   * post, merged into the same deduplicated set started by Phase 1.
   */
  private async runPostsCascadePhase(
    pid: string,
    allPages: Array<{ sessionId: string; page: Page }>,
    seenIds: Set<string>,
    targetCount: number,
  ): Promise<{ extracted: number; postsDone: number; discovered: number }> {
    log.info("PageFollowers", `=== Phase 2: posts cascade ===`);
    log.info("PageFollowers", `sessions=${allPages.length} remaining target=${targetCount - seenIds.size}`);

    // The main page hosted the followers list during Phase 1 — return it to
    // the page feed so discovery can scroll it.
    try {
      await this.page.goto(`https://www.facebook.com/${pid}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await this.page.waitForTimeout(2500);
    } catch (err) {
      throw new ExtractionError(ErrorCodes.NETWORK_ERROR, `Navigation error: ${String(err)}`);
    }

    const discoveredPosts: PostInfo[] = [];
    const seenPostIds = new Set<string>();
    const phaseUsers = new Map<string, ExtractedMember>();
    const processedPostIds = new Set<string>();
    let postsDone = 0;
    let discoveryDone = false;
    const startTime = Date.now();
    let nextPostIdx = 0;

    // Producer: scroll feed and discover posts (runs on main page)
    const discoveryPromise = (async () => {
      const interceptor = new GraphQLInterceptor();
      interceptor.attach(this.page);

      const MAX_SCROLLS = 80;
      for (let round = 0; round < MAX_SCROLLS; round++) {
        if (await this.checkCanceled()) break;
        await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await this.page.waitForTimeout(350);

        // Collect from DOM every 5 rounds (faster collection)
        if (round % 5 === 4) {
          const domPosts = await this.collectPostLinksFromDOM(this.page);
          for (const p of domPosts) {
            if (!seenPostIds.has(p.postId)) {
              seenPostIds.add(p.postId);
              discoveredPosts.push(p);
            }
          }
          // Log discovery progress
          if (discoveredPosts.length % 10 === 0) {
            log.info("PageFollowers", `discovery: ${discoveredPosts.length} posts found (round ${round + 1}/${MAX_SCROLLS})`);
            await this.storeProgress("discovering", discoveredPosts.length, postsDone, seenIds.size);
          }
        }
      }

      // Final GraphQL + DOM collection
      const interceptedTexts = interceptor.drainInterceptedTexts();
      for (const text of interceptedTexts) {
        const ids = extractPostIdsFromJSON(text);
        for (const id of ids) {
          if (!seenPostIds.has(id)) {
            seenPostIds.add(id);
            discoveredPosts.push({ postId: id, permalink: `https://www.facebook.com/${pid}/posts/${id}` });
          }
        }
      }
      const domPosts = await this.collectPostLinksFromDOM(this.page);
      for (const p of domPosts) {
        if (!seenPostIds.has(p.postId)) { seenPostIds.add(p.postId); discoveredPosts.push(p); }
      }

      interceptor.detach(this.page);
      discoveryDone = true;
      log.info("PageFollowers", `discovery complete: ${discoveredPosts.length} posts`);
    })();

    // Consumers: worker for each session (runs in parallel with discovery)
    const workerFn = async (sessionIdx: number, workerPage: Page) => {
      // Worker 0 uses the SAME page as discovery — must wait until discovery is done
      // Workers 1+ have their own pages — can start immediately
      if (sessionIdx === 0) {
        while (!discoveryDone) {
          await new Promise(r => setTimeout(r, 500));
        }
        log.info("PageFollowers", `[S1] discovery done, worker 0 starting extraction`);
      }

      while (true) {
        // Check if we should stop
        if (seenIds.size >= targetCount) return;
        if (this.timeRemainingSec <= 60) return;
        if (await this.periodicCancelCheck()) { this.lastStopReason = "canceled"; return; }

        // Get next post atomically
        const idx = nextPostIdx;
        nextPostIdx++;

        if (idx >= discoveredPosts.length) {
          if (discoveryDone) return; // no more posts coming
          // Wait for more posts to be discovered
          await new Promise(r => setTimeout(r, 500));
          nextPostIdx = idx; // retry same index
          continue;
        }

        const post = discoveredPosts[idx];
        if (!post || processedPostIds.has(post.postId)) continue;
        processedPostIds.add(post.postId);

        try {
          const result = await extractEngagers(workerPage, post.permalink, {
            maxReactions: 1000,
            maxCommenters: 500,
            scrollDialogSeconds: 8,  // reduced from 15
          });

          let newCount = 0;
          for (const u of result.reactors) {
            if (!seenIds.has(u.id)) {
              seenIds.add(u.id);
              phaseUsers.set(u.id, { fb_id: u.id, name: u.name, profile_url: u.url, type: "follower" });
              newCount++;
            }
          }
          for (const u of result.commenters) {
            if (!seenIds.has(u.id)) {
              seenIds.add(u.id);
              phaseUsers.set(u.id, { fb_id: u.id, name: u.name, profile_url: u.url, type: "follower" });
              newCount++;
            }
          }

          postsDone++;

          if (newCount > 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            const rate = Number(elapsed) > 0 ? (seenIds.size / (Number(elapsed) / 60)).toFixed(1) : "0";
            log.info("PageFollowers", `[S${sessionIdx + 1}] [${postsDone}/${discoveredPosts.length}] +${newCount} → total ${seenIds.size} (${rate} users/min)`);
          } else if (postsDone % 15 === 0) {
            log.info("PageFollowers", `[S${sessionIdx + 1}] [${postsDone}/${discoveredPosts.length}] +0 → total ${seenIds.size}`);
          }

          // Flush every 3 posts
          if (postsDone % 3 === 0 || phaseUsers.size >= 300) {
            await this.flushResults(phaseUsers).catch(() => {});
          }
          if (postsDone % 3 === 0) {
            await this.storeProgress("extracting", discoveredPosts.length, postsDone, seenIds.size);
          }

          // Small jitter
          await new Promise(r => setTimeout(r, 300 + Math.random() * 500));

        } catch {
          postsDone++;
          continue;
        }
      }
    };

    // Start all workers in parallel + discovery
    const workerPromises = allPages.map((sp, idx) => workerFn(idx, sp.page));
    await Promise.all([discoveryPromise, ...workerPromises]);

    // Final flush
    await this.flushResults(phaseUsers).catch(() => {});

    log.info("PageFollowers", `Phase 2 finished: +${phaseUsers.size} users from ${postsDone}/${discoveredPosts.length} posts`);

    return { extracted: phaseUsers.size, postsDone, discovered: discoveredPosts.length };
  }

  private async collectPostLinksFromDOM(page: Page): Promise<PostInfo[]> {
    return await page.evaluate(() => {
      const results: { postId: string; permalink: string }[] = [];
      const seen = new Set<string>();
      const links = document.querySelectorAll(
        'a[href*="/posts/"], a[href*="/reel/"], a[href*="/videos/"], a[href*="permalink.php"], a[href*="story_fbid="]'
      );
      for (const link of links) {
        const href = link.getAttribute("href") || "";
        const m = href.match(/\/posts\/([a-zA-Z0-9_-]{8,80})/) ||
                  href.match(/story_fbid=([a-zA-Z0-9_-]{8,80})/) ||
                  href.match(/\/reel\/([a-zA-Z0-9_-]{8,80})/) ||
                  href.match(/\/videos\/([a-zA-Z0-9_-]{8,80})/);
        if (!m) continue;
        const postId = m[1];
        if (!postId || seen.has(postId)) continue;
        seen.add(postId);
        const permalink = href.startsWith("http") ? href : `https://www.facebook.com${href}`;
        results.push({ postId, permalink });
      }
      return results;
    }).catch(() => []);
  }

  private async periodicCancelCheck(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastCancelCheckTs < 5000) return false;
    this.lastCancelCheckTs = now;
    return await this.checkCanceled();
  }

  private async flushResults(users: Map<string, ExtractedMember>): Promise<void> {
    if (users.size === 0) return;
    const all = Array.from(users.values());
    try {
      const n = await this.processBatch(all, "follower");
      if (n > 0) log.info("PageFollowers", `flushed ${n}`);
    } catch (err) {
      log.warn("PageFollowers", `flush err: ${String(err).slice(0, 80)}`);
    }
  }

  private async storeProgress(phase: string, total: number, done: number, users: number, stopReason?: StopReason): Promise<void> {
    const now = Date.now();
    if (phase !== "completed" && phase !== "discovering" && now - this.lastProgressTs < 6000) return;
    this.lastProgressTs = now;
    const coverage = this.totalFollowersCount && this.totalFollowersCount > 0
      ? Math.round((users / this.totalFollowersCount) * 1000) / 10 : null;
    const p: Record<string, unknown> = {
      discovered: users, processed: users, phase,
      posts_total: total, posts_done: done,
      coverage_rate: coverage,
      last_update: new Date().toISOString(),
    };
    if (stopReason) p.stop_reason = stopReason;
    try { await supabaseService.storeProgress(this.ctx.jobId, p); } catch { /* skip */ }
  }
}

function extractPostIdsFromJSON(text: string): string[] {
  const ids: string[] = [];
  let jsonText = text;
  const forIdx = text.indexOf("for (;;);");
  if (forIdx >= 0) jsonText = text.substring(forIdx + 9).trim();
  try {
    const data = JSON.parse(jsonText);
    findPostIds(data, ids, new Set(), 6);
  } catch { /* skip */ }
  return ids;
}

function findPostIds(obj: any, ids: string[], seen: Set<string>, depth: number): void {
  if (!obj || depth < 0) return;
  if (Array.isArray(obj)) { for (const item of obj) findPostIds(item, ids, seen, depth - 1); return; }
  if (typeof obj !== "object") return;
  const cid = obj.id || obj.post_id || obj.story_key || obj.legacy_story_hideable_id || obj.post_global_id;
  if (cid && /^[a-zA-Z0-9_:-]{6,80}$/.test(String(cid)) && !seen.has(String(cid))) {
    seen.add(String(cid)); ids.push(String(cid));
  }
  for (const k of ["edges", "nodes", "data", "pageItems", "timeline_feed_units", "all_pages", "page_item", "feedItems"]) {
    if (obj[k]) findPostIds(obj[k], ids, seen, depth - 1);
  }
}
