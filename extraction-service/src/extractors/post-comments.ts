import { BaseExtractor, parsePostId, parseFollowersCount, detectAuthState, authStateToMessage, authStateToErrorCode } from "./base.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import { supabaseService } from "../services/supabase.js";
import type { Page, Response } from "playwright";
import type { AuthState, ExtractedMember } from "../types.js";

const log = logger;

type CommentStopReason = "session_rate_limited" | "no_secondary_session" | "source_exhausted" | "max_results_reached";

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
]);

function isJunkSlug(slug: string): boolean {
  return JUNK_SLUGS.has(slug.toLowerCase());
}

export class PostCommentsExtractor extends BaseExtractor {
  private totalCommentsCount: number | null = null;
  private totalCommentsSource: string = "unknown";
  private lastStopReason: CommentStopReason | null = null;
  private lastProgressTs = 0;

  async extract(): Promise<{ extracted: number; nextCursor?: string; done: boolean; authState: AuthState }> {
    const pid = parsePostId(this.ctx.sourceUrl);
    if (!pid) throw new ExtractionError(ErrorCodes.INVALID_INPUT, "Invalid post URL");

    let total = 0, done = false, consecutiveEmpty = 0;
    let authState: AuthState = "unknown";
    const seen = new Set<string>();
    let scrollAttempts = 0;

    const url = this.ctx.cursor || this.ctx.sourceUrl;
    log.info("PostComments", `starting`, { jobId: this.ctx.jobId, url });
    await this.storeExtractionProgress(0, "navigating", 0);

    try {
      await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await this.page.waitForTimeout(3000);
      await this.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await this.page.waitForTimeout(2000);
    } catch (err) {
      throw new ExtractionError(ErrorCodes.NETWORK_ERROR, `Navigation error: ${String(err)}`);
    }

    const html = await this.page.content();
    authState = detectAuthState(html, this.page.url());
    if (authState !== "authenticated") throw new ExtractionError(authStateToErrorCode(authState), authStateToMessage(authState));

    const countResult = parseFollowersCount(html);
    this.totalCommentsCount = countResult.count;
    this.totalCommentsSource = countResult.source;
    log.info("PostComments", `total comments: ${countResult.count ?? "unknown"} (source=${countResult.source})`);
    if (countResult.count !== null) {
      await this.persistCommentsCount(countResult.count, countResult.source);
    }
    await this.storeExtractionProgress(0, "scrolling", 0);

    // GraphQL interception: comment nodes carry the real author id + body text.
    const intercepted: InterceptedComment[] = [];
    const onResponse = async (resp: Response): Promise<void> => {
      const respUrl = resp.url();
      if (!respUrl.includes("graphql") || resp.status() !== 200) return;
      try {
        const text = await resp.text();
        for (const c of parseCommentsFromGraphQL(text)) {
          if (!intercepted.some((i) => i.fb_id === c.fb_id && i.comment_id === c.comment_id)) {
            intercepted.push(c);
          }
        }
      } catch { /* response body unavailable */ }
    };
    this.page.on("response", onResponse);

    try {
      while (!done && !this.shouldStop && total < this.ctx.maxResults) {
        if (await this.checkCanceled()) return { extracted: total, done: true, authState };

        await this.clickMoreCommentsButtons();
        await this.page.waitForTimeout(1200);

        const batch = this.drainIntercepted(intercepted, seen);

        log.info("PostComments", `+[${batch.length}] scroll#${scrollAttempts} total=${total} seen=${seen.size} interceptedPending=${intercepted.length}`);

        if (batch.length > 0) {
          total += await this.processBatch(batch, "commenter");
          consecutiveEmpty = 0;
          if (scrollAttempts > 0 && scrollAttempts % this.batchSizeForRest === 0) await this.restDelay();
          if (scrollAttempts % 10 === 9) {
            await this.storeExtractionProgress(total, "scrolling", scrollAttempts + 1);
          }
        } else {
          // DOM fallback (only comment articles — never page-wide link sweeping)
          const domBatch = await this.extractCommentsFromDom(seen);
          if (domBatch.length > 0) {
            total += await this.processBatch(domBatch, "commenter");
            consecutiveEmpty = 0;
            log.info("PostComments", `+[${domBatch.length}] (DOM) total=${total}`);
          } else {
            consecutiveEmpty++;
          }

          if (consecutiveEmpty === 3) {
            const switched = await this.switchToNextSession();
            if (switched) {
              log.info("PostComments", `switched session after 3 empty scrolls, reloading post (session #${this.activeSessionIndex + 1}/${this.totalSessions})`);
              consecutiveEmpty = 0;
              scrollAttempts = 0;
              try {
                await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
                await this.page.waitForTimeout(3000);
                await this.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
                await this.page.waitForTimeout(2000);
              } catch (err) {
                throw new ExtractionError(ErrorCodes.NETWORK_ERROR, `Navigation error after session switch: ${String(err)}`);
              }
              await this.storeExtractionProgress(total, "scrolling", 0);
              continue;
            } else {
              this.lastStopReason = this.totalSessions > 1 ? "session_rate_limited" : "no_secondary_session";
            }
          }

          if (consecutiveEmpty >= 15) {
            if (this.lastStopReason === null) this.lastStopReason = "source_exhausted";
            done = true;
            break;
          }
        }

        scrollAttempts++;
        await this.scrollFeed(this.page);
        await this.delay();
      }
    } finally {
      this.page.off("response", onResponse);
    }

    this.finalizeStopReason(total);
    await this.storeExtractionProgress(total, "completed", 0, this.lastStopReason);
    log.info("PostComments", `extraction finished: total=${total}, coverage=${this.computeCoverage(total)}%, stopReason=${this.lastStopReason ?? "null"}`);

    if (total === 0) done = true;
    return { extracted: total, nextCursor: done ? undefined : url, done, authState };
  }

  private drainIntercepted(intercepted: InterceptedComment[], seen: Set<string>): ExtractedMember[] {
    const batch: ExtractedMember[] = [];
    while (intercepted.length > 0) {
      const c = intercepted.shift()!;
      if (seen.has(c.fb_id)) continue;
      seen.add(c.fb_id);
      batch.push({
        fb_id: c.fb_id,
        name: c.name,
        profile_url: c.profile_url,
        type: "commenter",
        comment_text: c.comment_text,
        ...(c.comment_id ? { comment_id: c.comment_id } : {}),
      });
    }
    return batch;
  }

  private async clickMoreCommentsButtons(): Promise<void> {
    await this.page.evaluate(() => {
      const all = document.querySelectorAll<HTMLElement>('[role="button"], a, span, div');
      const keywords = ['view more comments', 'عرض المزيد من التعليقات', 'more comments',
        'view more replies', 'عرض المزيد من الردود', 'more replies', 'عرض المزيد', 'view more',
        'see more', 'previous comments', 'التعليقات السابقة', 'view previous comments',
        'عرض التعليقات السابقة', 'الردود', 'replies'];
      for (const el of all) {
        const t = (el.innerText || el.getAttribute('aria-label') || '').trim().toLowerCase();
        if (!t || t.length > 80) continue;
        for (const kw of keywords) { if (t.includes(kw)) { el.click(); break; } }
      }
    }).catch(() => {});
  }

  /** DOM fallback: only real comment articles with author links (relative or absolute). */
  private async extractCommentsFromDom(seen: Set<string>): Promise<ExtractedMember[]> {
    const raw: { href: string; name: string; comment_text: string; comment_id?: string }[] = await this.page.evaluate(() => {
      const items: { href: string; name: string; comment_text: string; comment_id?: string }[] = [];
      const seenHrefs = new Set<string>();

      const articles = document.querySelectorAll('[role="article"]');
      articles.forEach((article) => {
        // author link: profile.php?id=…, /user/…, or a relative/absolute profile href
        const candidates = Array.from(article.querySelectorAll('a[href]')) as HTMLAnchorElement[];
        const userLink = candidates.find((a) => {
          const href = a.getAttribute('href') || '';
          return /profile\.php\?id=\d+/.test(href) || /\/user\/\d+/.test(href);
        }) || candidates.find((a) => {
          const href = a.getAttribute('href') || '';
          if (href.includes('/help/') || href.includes('/settings/')) return false;
          // relative profile link like /username?comment_id=…
          const m = href.match(/^\/([a-zA-Z0-9.]{3,60})(?:[/?#]|$)/);
          if (!m) return false;
          const slug = m[1].toLowerCase();
          if (['help', 'settings', 'login', 'watch', 'reel', 'videos', 'photos', 'groups', 'events', 'marketplace', 'photo.php', 'story.php', 'permalink.php', 'posts'].includes(slug)) return false;
          return true;
        });
        if (!userLink) return;

        const href = userLink.getAttribute('href') || '';
        const name = (userLink.innerText || '').trim();
        if (!name || name.length < 2 || name.length > 80) return;
        if (seenHrefs.has(href)) return;

        const textSpans = article.querySelectorAll('span[dir="auto"], div[dir="auto"], [data-ad-comet-preview]');
        let commentText = '';
        for (const span of textSpans) {
          const t = ((span as HTMLElement).innerText || '').trim();
          if (!t || t.length < 3 || t === name) continue;
          if (/^\d+\s*(like|react|reply|comment|share)/i.test(t)) continue;
          if (/^(like|react|reply|share|أعجبني|ردّ|رد|مشاركة|إعجاب)/i.test(t)) continue;
          if (t.length > 3000) continue;
          commentText = t;
          break;
        }

        const commentIdAttr = (article as HTMLElement).getAttribute('data-comment-id')
          || (article.closest('[data-comment-id]') as HTMLElement | null)?.getAttribute('data-comment-id')
          || undefined;

        seenHrefs.add(href);
        items.push({ href, name, comment_text: commentText, comment_id: commentIdAttr || undefined });
      });

      return items;
    }).catch(() => []);

    const batch: ExtractedMember[] = [];
    for (const c of raw) {
      const idMatch = c.href.match(/profile\.php\?id=(\d{5,25})/) || c.href.match(/\/user\/(\d{5,25})/);
      let fbId: string | null = null;
      let profileUrl: string;
      if (idMatch) {
        fbId = idMatch[1];
        profileUrl = `https://www.facebook.com/profile.php?id=${fbId}`;
      } else {
        const abs = c.href.startsWith("http") ? c.href : `https://www.facebook.com${c.href}`;
        const vanity = abs.match(/facebook\.com\/([a-zA-Z0-9.]{3,60})(?:[/?#]|$)/i);
        if (!vanity || isJunkSlug(vanity[1])) continue;
        fbId = vanity[1];
        profileUrl = `https://www.facebook.com/${fbId}`;
      }
      if (!fbId || seen.has(fbId)) continue;
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
    phase: "navigating" | "scrolling" | "completed",
    phaseCycle: number,
    stopReason?: CommentStopReason | null,
  ): Promise<void> {
    const now = Date.now();
    if (phase !== "navigating" && phase !== "completed" && now - this.lastProgressTs < 10_000) {
      return;
    }
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

  private finalizeStopReason(total: number): void {
    if (this.lastStopReason !== null) return;

    if (total >= this.ctx.maxResults) {
      this.lastStopReason = "max_results_reached";
      return;
    }

    const coverage = this.computeCoverage(total);
    if (coverage === null || coverage >= 85) {
      this.lastStopReason = null;
      return;
    }

    this.lastStopReason = "source_exhausted";
  }
}

/**
 * Parse comment nodes out of a Facebook GraphQL response text.
 * A comment node carries the comment body plus a nested author —
 * the AUTHOR id is the user id (node.id is the comment's own id).
 */
function parseCommentsFromGraphQL(text: string): InterceptedComment[] {
  const out: InterceptedComment[] = [];
  const seen = new Set<string>();
  let jsonText = text;
  const forIdx = text.indexOf("for (;;);");
  if (forIdx >= 0) jsonText = text.substring(forIdx + 9).trim();
  try {
    walkForComments(JSON.parse(jsonText), out, seen, 8);
  } catch { /* not JSON */ }
  return out;
}

function walkForComments(obj: any, out: InterceptedComment[], seen: Set<string>, depth: number): void {
  if (!obj || depth < 0) return;
  if (Array.isArray(obj)) { for (const item of obj) walkForComments(item, out, seen, depth - 1); return; }
  if (typeof obj !== "object") return;

  const actor = obj.actor || obj.author || obj.commenter;
  const body = obj.body?.text ?? obj.body?.text?.text ?? obj.text ?? obj.message?.text ?? obj.comment_text;

  if (
    actor?.id && /^\d{5,25}$/.test(String(actor.id)) &&
    typeof actor.name === "string" && actor.name.trim().length >= 2 &&
    typeof body === "string" && body.trim().length > 0
  ) {
    const fbId = String(actor.id);
    const commentId = typeof obj.id === "string" ? obj.id : undefined;
    const dedupKey = `${fbId}:${commentId ?? ""}`;
    if (!seen.has(dedupKey)) {
      seen.add(dedupKey);
      const url = typeof actor.url === "string" && actor.url.includes("facebook.com")
        ? (actor.url.startsWith("http") ? actor.url : `https://www.facebook.com${actor.url}`)
        : `https://www.facebook.com/profile.php?id=${fbId}`;
      out.push({
        fb_id: fbId,
        name: actor.name.trim().substring(0, 200),
        profile_url: url,
        comment_text: body.substring(0, 2000),
        comment_id: commentId,
      });
      return;
    }
  }

  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === "object" && obj[key] !== null) {
      walkForComments(obj[key], out, seen, depth - 1);
    }
  }
}
