import { BaseExtractor, parsePostId, parseFollowersCount, detectAuthState, authStateToMessage, authStateToErrorCode } from "./base.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import { supabaseService } from "../services/supabase.js";
import { parseGraphQLResponse } from "../services/graphql-interceptor.js";
import type { Page, Response } from "playwright";
import type { AuthState, ExtractedMember } from "../types.js";

const log = logger;

type ReactionStopReason = "session_rate_limited" | "no_secondary_session" | "source_exhausted" | "max_results_reached";

interface InterceptedReactor {
  fb_id: string;
  name: string;
  profile_url: string;
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

  async extract(): Promise<{ extracted: number; nextCursor?: string; done: boolean; authState: AuthState }> {
    const pid = parsePostId(this.ctx.sourceUrl);
    if (!pid) throw new ExtractionError(ErrorCodes.INVALID_INPUT, "Invalid post URL");

    let total = 0, done = false, consecutiveEmpty = 0;
    let authState: AuthState = "unknown";
    const seen = new Set<string>();
    let scrollAttempts = 0;

    const url = this.ctx.cursor || this.ctx.sourceUrl;
    log.info("PostReactions", `starting`, { jobId: this.ctx.jobId, url });
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
    const finalUrl = this.page.url();
    log.info("PostReactions", `page loaded`, { finalUrl });
    authState = detectAuthState(html, finalUrl);
    if (authState !== "authenticated") throw new ExtractionError(authStateToErrorCode(authState), authStateToMessage(authState));

    // GraphQL interception: only while the reactions dialog is open, only
    // responses mentioning reactions — keeps comment-thread users out.
    let dialogActive = false;
    const intercepted: InterceptedReactor[] = [];
    const onResponse = async (resp: Response): Promise<void> => {
      if (!dialogActive) return;
      const respUrl = resp.url();
      if (!respUrl.includes("graphql") || resp.status() !== 200) return;
      try {
        const text = await resp.text();
        if (!text.toLowerCase().includes("reaction")) return;
        for (const u of parseGraphQLResponse(text).users) {
          if (!u.id || seen.has(u.id)) continue;
          if (intercepted.some((i) => i.fb_id === u.id)) continue;
          intercepted.push({ fb_id: u.id, name: u.name, profile_url: u.url });
        }
      } catch { /* response body unavailable */ }
    };
    this.page.on("response", onResponse);

    let dialogOpened = false;
    let scrollBox: { x: number; y: number; width: number; height: number } | null = null;

    try {
      ({ dialogOpened, scrollBox } = await this.tryOpenReactionsDialog());
      dialogActive = dialogOpened;

      const countHtml = await this.page.content().catch(() => "");
      if (countHtml) {
        const countResult = parseFollowersCount(countHtml);
        if (countResult.count !== null && countResult.count > 0 && countResult.count < 10_000_000) {
          this.totalReactionsCount = countResult.count;
          this.totalReactionsSource = countResult.source;
          log.info("PostReactions", `total reactions: ${countResult.count} (source=${countResult.source})`);
          await this.persistReactionsCount(countResult.count, countResult.source);
        } else {
          log.info("PostReactions", `total reactions: unknown`);
        }
      }
      await this.storeExtractionProgress(0, "scrolling", 0);

      while (!done && !this.shouldStop && total < this.ctx.maxResults) {
        if (await this.checkCanceled()) return { extracted: total, done: true, authState };

        // Drain intercepted GraphQL reactors
        let batch: ExtractedMember[] = [];
        while (intercepted.length > 0) {
          const r = intercepted.shift()!;
          if (seen.has(r.fb_id)) continue;
          seen.add(r.fb_id);
          batch.push({ fb_id: r.fb_id, name: r.name, profile_url: r.profile_url, type: "reacter" });
        }

        // DOM fallback — ONLY from inside the reactions dialog, never the page
        if (batch.length === 0 && dialogActive) {
          batch = await this.extractReactorsFromDialogDom(seen);
        }

        log.info("PostReactions", `+[${batch.length}] scroll#${scrollAttempts} total=${total} seen=${seen.size}`);

        if (batch.length > 0) {
          total += await this.processBatch(batch, "reacter");
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
              log.info("PostReactions", `switched session after 3 empty scrolls, reloading post and reopening dialog (session #${this.activeSessionIndex + 1}/${this.totalSessions})`);
              consecutiveEmpty = 0;
              scrollAttempts = 0;
              try {
                await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
                await this.page.waitForTimeout(3000);
                await this.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
                await this.page.waitForTimeout(2000);
                this.page.off("response", onResponse);
                this.page.on("response", onResponse);
                ({ dialogOpened, scrollBox } = await this.tryOpenReactionsDialog());
                dialogActive = dialogOpened;
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
        if (dialogOpened && scrollBox) {
          const cx = scrollBox.x + scrollBox.width / 2;
          const cy = scrollBox.y + scrollBox.height / 2;
          await this.page.mouse.move(cx, cy);
          for (let s = 0; s < 3; s++) { await this.page.mouse.wheel(0, 300); await this.page.waitForTimeout(400); }
          await this.page.waitForTimeout(800);
          // Re-sync: Facebook sometimes closes the dialog mid-scroll
          dialogActive = await this.page.evaluate(() =>
            !!document.querySelector('[role="dialog"]') || !!document.querySelector('[aria-modal="true"]'),
          ).catch(() => false);
          if (!dialogActive) {
            log.info("PostReactions", `dialog closed mid-scroll — reopening`);
            ({ dialogOpened, scrollBox } = await this.tryOpenReactionsDialog());
            dialogActive = dialogOpened;
            if (!dialogActive) {
              // give up reopening this cycle; empty rounds will escalate properly
              await this.page.waitForTimeout(1500);
            }
          }
        } else {
          await this.scrollFeed(this.page);
        }
        await this.delay();
      }
    } finally {
      this.page.off("response", onResponse);
    }

    this.finalizeStopReason(total);
    await this.storeExtractionProgress(total, "completed", 0, this.lastStopReason);
    log.info("PostReactions", `extraction finished: total=${total}, coverage=${this.computeCoverage(total)}%, stopReason=${this.lastStopReason ?? "null"}`);

    if (total === 0) done = true;
    return { extracted: total, nextCursor: done ? undefined : url, done, authState };
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
      if (!link.text || link.text.length < 2 || link.text.length > 100) continue;

      const idMatch = link.href.match(/profile\.php\?id=(\d{5,25})/) || link.href.match(/\/user\/(\d{5,25})/);
      let fbId: string;
      let profileUrl: string;
      if (idMatch) {
        fbId = idMatch[1];
        profileUrl = `https://www.facebook.com/profile.php?id=${fbId}`;
      } else {
        const abs = link.href.startsWith("http") ? link.href : `https://www.facebook.com${link.href}`;
        const vanity = abs.match(/facebook\.com\/([a-zA-Z0-9.]{3,60})(?:[/?#]|$)/i);
        if (!vanity || isJunkSlug(vanity[1])) continue;
        fbId = vanity[1];
        profileUrl = `https://www.facebook.com/${fbId}`;
      }
      if (seen.has(fbId)) continue;
      seen.add(fbId);
      batch.push({ fb_id: fbId, name: link.text.substring(0, 200), profile_url: profileUrl, type: "reacter" });
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
    phase: "navigating" | "scrolling" | "completed",
    phaseCycle: number,
    stopReason?: ReactionStopReason | null,
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
      log.debug("PostReactions", `storeProgress failed: ${String(err)}`);
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

  private async tryOpenReactionsDialog(): Promise<{ dialogOpened: boolean; scrollBox: { x: number; y: number; width: number; height: number } | null }> {
    let dialogOpened = false;
    let scrollBox: { x: number; y: number; width: number; height: number } | null = null;

    for (let attempt = 0; attempt < 8 && !dialogOpened; attempt++) {
      if (attempt > 0) await this.page.waitForTimeout(2000);
      const clicked = await this.page.evaluate(() => {
        const reactionLinks = document.querySelectorAll<HTMLAnchorElement>('a[href*="/ufi/reaction/"]');
        if (reactionLinks.length > 0) { reactionLinks[0].click(); return "reaction_link"; }

        const ariaEls = document.querySelectorAll<HTMLElement>('[aria-label]');
        for (const el of ariaEls) {
          const aria = (el.getAttribute('aria-label') || '').trim();
          if (aria.length < 3 || aria.length > 60) continue;
          const lower = aria.toLowerCase();
          if (lower.includes('notif') || lower.includes('إشعار') || lower.includes('مشاهدة') || lower.includes('share')) continue;
          if (lower.includes('reaction') || lower.includes('تفاعل')) { el.click(); return "aria_reaction"; }
        }

        for (const el of ariaEls) {
          const aria = (el.getAttribute('aria-label') || '').trim();
          if (aria.length > 60) continue;
          const lower = aria.toLowerCase();
          if (lower.includes('notif') || lower.includes('إشعار') || lower.includes('مشاهدة') || lower.includes('share')) continue;
          if (/^\d+([.,]\d+)*[kKmM]?(\s|$)/.test(aria)) {
            const parent = el.closest('[data-visualcompletion="ignore-dynamic"]') || el.closest('a[href*="reaction"]');
            if (parent) { (parent as HTMLElement).click(); return "aria_number_parent"; }
            el.click(); return "aria_number";
          }
        }

        const allEls = document.querySelectorAll<HTMLElement>('span, a, div');
        for (const el of allEls) {
          const text = (el.innerText || '').trim();
          if (/^\d+([.,]\d*)*[kKmM]?$/.test(text) && text.length <= 8) {
            const parent = el.closest('[data-visualcompletion="ignore-dynamic"]') || el.closest('a[href*="reaction"]');
            if (parent) { (parent as HTMLElement).click(); return "text_number_parent"; }
            el.click(); return "text_number";
          }
        }

        const shareLink = document.querySelector('a[href*="reaction"]:not([href*="notif"])');
        if (shareLink) { (shareLink as HTMLElement).click(); return "any_reaction_link"; }

        return "none";
      });

      if (!clicked) { await this.page.waitForTimeout(1500); continue; }

      await this.page.waitForTimeout(3000);

      for (let wait = 0; wait < 4; wait++) {
        dialogOpened = await this.page.evaluate(() =>
          !!document.querySelector('[role="dialog"]') || !!document.querySelector('[aria-modal="true"]')
        );
        if (dialogOpened) break;
        await this.page.waitForTimeout(1500);
      }

      if (dialogOpened) {
        const isReactionsDialog = await this.page.evaluate(() => {
          const dialog = document.querySelector('[role="dialog"]') || document.querySelector('[aria-modal="true"]');
          if (!dialog) return false;
          const text = (dialog as HTMLElement).innerText || '';
          if (text.includes('إشعار') || text.includes('Notification')) return false;
          const tabs = dialog.querySelectorAll('[role="tab"], [role="button"]');
          let reactionTabs = 0;
          for (const tab of tabs) {
            const t = (tab as HTMLElement).innerText?.trim() || tab.getAttribute('aria-label') || '';
            const reactions = ['all', 'like', 'love', 'care', 'haha', 'wow', 'sad', 'angry',
              'الكل', 'أعجبني', 'أحببته', 'اهتمام', 'هههه', 'أدهشني', 'أحزنني', 'أغضبني',
              'اعجاب', 'حب', 'دهشة', 'حزن', 'غضب'];
            if (reactions.some(r => t.toLowerCase().includes(r.toLowerCase()))) reactionTabs++;
          }
          if (reactionTabs >= 3) return true;
          const hasUserLinks = dialog.querySelectorAll('a[href*="profile.php"], a[href*="/user/"]').length;
          return hasUserLinks > 0;
        });

        if (!isReactionsDialog) {
          log.info("PostReactions", `attempt ${attempt + 1}: dialog opened but NOT reactions, closing`);
          await this.page.keyboard.press('Escape').catch(() => {});
          await this.page.waitForTimeout(1000);
          dialogOpened = false;
          continue;
        }

        for (let wait = 0; wait < 5; wait++) {
          const hasContent = await this.page.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"]');
            if (!dialog) return false;
            return dialog.querySelectorAll('a[href*="profile.php"], a[href*="/user/"], [role="listitem"]').length > 0 ||
                   dialog.innerHTML.length > 15000;
          });
          if (hasContent) break;
          await this.page.waitForTimeout(2000);
        }

        scrollBox = await this.page.evaluate(() => {
          const dialog = document.querySelector('[role="dialog"]') || document.querySelector('[aria-modal="true"]');
          if (!dialog) return null;
          const candidates = dialog.querySelectorAll('*');
          for (let i = 0; i < candidates.length; i++) {
            const el = candidates[i] as HTMLElement;
            const style = window.getComputedStyle(el);
            if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 10) {
              const rect = el.getBoundingClientRect();
              if (rect.width > 100 && rect.height > 100) {
                return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
              }
            }
          }
          return null;
        });
        if (scrollBox) {
          await this.page.mouse.click(scrollBox.x + scrollBox.width / 2, scrollBox.y + scrollBox.height / 2);
          await this.page.waitForTimeout(500);
        }
        log.info("PostReactions", `reactions dialog opened`, { scrollBox: !!scrollBox });
      } else {
        log.info("PostReactions", `attempt ${attempt + 1}: no dialog`);
      }
    }

    return { dialogOpened, scrollBox };
  }
}
