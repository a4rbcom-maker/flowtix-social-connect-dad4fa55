import { BaseExtractor, parsePostId, parseFollowersCount, extractUsersFromLinks, detectAuthState, authStateToMessage, authStateToErrorCode } from "./base.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import { supabaseService } from "../services/supabase.js";
import type { AuthState, ExtractedMember } from "../types.js";

const log = logger;

type CommentStopReason = "session_rate_limited" | "no_secondary_session" | "source_exhausted" | "max_results_reached";

interface RawComment {
  href: string;
  name: string;
  comment_text: string;
  comment_id?: string;
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

    while (!done && !this.shouldStop && total < this.ctx.maxResults) {
      if (await this.checkCanceled()) return { extracted: total, done: true, authState };

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
      });
      await this.page.waitForTimeout(1500);

      const rawComments: RawComment[] = await this.page.evaluate(() => {
        const items: { href: string; name: string; comment_text: string; comment_id?: string }[] = [];
        const seenHrefs = new Set<string>();

        const tryExtract = (article: Element) => {
          const userLink = article.querySelector('a[href*="facebook.com/"]') as HTMLAnchorElement | null
            || article.querySelector('a[href*="/user/"]') as HTMLAnchorElement | null;
          if (!userLink) return;
          const href = userLink.getAttribute('href') || '';
          if (!href || href.includes('/help/') || href.includes('/settings/')) return;
          const name = (userLink.innerText || '').trim();
          if (!name || name.length < 2 || name.length > 80) return;

          if (seenHrefs.has(href)) return;

          const textSpans = article.querySelectorAll('span[dir="auto"], div[dir="auto"], [data-ad-comet-preview]');
          let commentText = '';
          for (const span of textSpans) {
            const t = ((span as HTMLElement).innerText || '').trim();
            if (!t || t.length < 3 || t === name) continue;
            if (/^\d+\s*(like|react|reply|comment|share|like|react)/i.test(t)) continue;
            if (/^(like|react|reply|share|أعجبني|ردّ|رد|مشاركة|إعجاب)/i.test(t)) continue;
            if (t.length > 3000) continue;
            commentText = t;
            break;
          }

          const commentIdAttr = (article as HTMLElement).getAttribute('data-comment-id')
            || (article.closest('[data-comment-id]') as HTMLElement)?.getAttribute('data-comment-id')
            || undefined;

          seenHrefs.add(href);
          items.push({
            href,
            name,
            comment_text: commentText,
            comment_id: commentIdAttr || undefined,
          });
        };

        const articles = document.querySelectorAll('[role="article"]');
        if (articles.length > 0) {
          articles.forEach(tryExtract);
        }

        if (items.length === 0) {
          const links = document.querySelectorAll('a[href]');
          for (const link of links) {
            const href = link.getAttribute('href') || '';
            const text = ((link as HTMLElement).innerText || '').trim();
            if (href && text.length >= 2 && text.length <= 80) {
              if (!seenHrefs.has(href)) {
                seenHrefs.add(href);
                items.push({ href, name: text, comment_text: '' });
              }
            }
          }
        }

        return items;
      });

      const users = extractUsersFromLinks(
        rawComments.map(c => ({ href: c.href, text: c.name })),
        { relaxed: true },
      );

      const commentByText = new Map<string, string>();
      const commentIdByText = new Map<string, string | undefined>();
      for (const c of rawComments) {
        if (c.comment_text) {
          commentByText.set(c.name, c.comment_text);
          if (c.comment_id) commentIdByText.set(c.name, c.comment_id);
        }
      }

      let newCount = 0;
      const batch: ExtractedMember[] = [];
      for (const u of users) {
        if (!seen.has(u.fb_id)) {
          seen.add(u.fb_id);
          const commentText = commentByText.get(u.name) || '';
          const commentId = commentIdByText.get(u.name);
          batch.push({
            ...u,
            type: "commenter",
            ...(commentText ? { comment_text: commentText } : {}),
            ...(commentId ? { comment_id: commentId } : {}),
          });
          newCount++;
        }
      }

      log.info("PostComments", `+[${newCount}] scroll#${scrollAttempts} total=${total} seen=${seen.size} raw=${rawComments.length} withText=${commentByText.size}`);

      if (batch.length > 0) {
        total += await this.processBatch(batch, "commenter");
        consecutiveEmpty = 0;
        if (scrollAttempts > 0 && scrollAttempts % this.batchSizeForRest === 0) await this.restDelay();
        if (scrollAttempts % 10 === 9) {
          await this.storeExtractionProgress(total, "scrolling", scrollAttempts + 1);
        }
      } else {
        consecutiveEmpty++;

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

    this.finalizeStopReason(total);
    await this.storeExtractionProgress(total, "completed", 0, this.lastStopReason);
    log.info("PostComments", `extraction finished: total=${total}, coverage=${this.computeCoverage(total)}%, stopReason=${this.lastStopReason ?? "null"}`);

    if (total === 0) done = true;
    return { extracted: total, nextCursor: done ? undefined : url, done, authState };
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
