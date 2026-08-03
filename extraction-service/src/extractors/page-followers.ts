import { BaseExtractor, parsePageId, parseFollowersCount, detectAuthState } from "./base.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import { supabaseService } from "../services/supabase.js";
import { GraphQLInterceptor } from "../services/graphql-interceptor.js";
import { extractEngagers } from "../services/engager-extractor-v2.js";
import type { AuthState, ExtractedMember } from "../types.js";
import type { Page } from "playwright";

const log = logger;

type StopReason = "max_results_reached" | "posts_exhausted" | "canceled" | "completed";

interface PostInfo {
  postId: string;
  permalink: string;
}

export class PageFollowersExtractor extends BaseExtractor {
  private totalFollowersCount: number | null = null;
  private lastStopReason: StopReason | null = null;
  private lastProgressTs = 0;
  private lastCancelCheckTs = 0;

  async extract(): Promise<{ extracted: number; nextCursor?: string; done: boolean; authState: AuthState }> {
    const pid = parsePageId(this.ctx.sourceUrl);
    if (!pid) throw new ExtractionError(ErrorCodes.INVALID_INPUT, "Invalid page URL");

    log.info("PageFollowers", `========================================`);
    log.info("PageFollowers", `STREAMING v3 — parallel + fast discovery`);
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

    // ====== STREAMING: discover + extract in parallel ======
    const discoveredPosts: PostInfo[] = [];
    const seenPostIds = new Set<string>();
    const allUsers = new Map<string, ExtractedMember>();
    const processedPostIds = new Set<string>();
    let postsDone = 0;
    let discoveryDone = false;
    const startTime = Date.now();

    // Shared queue index for workers
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
            await this.storeProgress("discovering", discoveredPosts.length, postsDone, allUsers.size);
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
        if (allUsers.size >= this.ctx.maxResults) return;
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
            if (!allUsers.has(u.id)) {
              allUsers.set(u.id, { fb_id: u.id, name: u.name, profile_url: u.url, type: "follower" });
              newCount++;
            }
          }
          for (const u of result.commenters) {
            if (!allUsers.has(u.id)) {
              allUsers.set(u.id, { fb_id: u.id, name: u.name, profile_url: u.url, type: "follower" });
              newCount++;
            }
          }

          postsDone++;

          if (newCount > 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            const rate = Number(elapsed) > 0 ? (allUsers.size / (Number(elapsed) / 60)).toFixed(1) : "0";
            log.info("PageFollowers", `[S${sessionIdx + 1}] [${postsDone}/${discoveredPosts.length}] +${newCount} → total ${allUsers.size} (${rate} users/min)`);
          } else if (postsDone % 15 === 0) {
            log.info("PageFollowers", `[S${sessionIdx + 1}] [${postsDone}/${discoveredPosts.length}] +0 → total ${allUsers.size}`);
          }

          // Flush every 3 posts
          if (postsDone % 3 === 0 || allUsers.size >= 300) {
            await this.flushResults(allUsers).catch(() => {});
          }
          if (postsDone % 3 === 0) {
            await this.storeProgress("extracting", discoveredPosts.length, postsDone, allUsers.size);
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
    await this.flushResults(allUsers).catch(() => {});

    if (!this.lastStopReason) {
      this.lastStopReason = allUsers.size >= this.ctx.maxResults ? "max_results_reached" : "completed";
    }

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = Number(elapsedSec) > 0 ? (allUsers.size / (Number(elapsedSec) / 60)).toFixed(1) : "0";
    log.info("PageFollowers", `========================================`);
    log.info("PageFollowers", `DONE: ${allUsers.size} users from ${postsDone} posts in ${elapsedSec}s (${rate} users/min)`);
    log.info("PageFollowers", `stop reason: ${this.lastStopReason}`);
    log.info("PageFollowers", `========================================`);
    await this.storeProgress("completed", discoveredPosts.length, postsDone, allUsers.size, this.lastStopReason);

    return { extracted: allUsers.size, done: true, authState: "authenticated" };
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
