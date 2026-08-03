import { BaseExtractor, parseGroupId, parseFollowersCount, extractUsersFromLinks, detectAuthState, authStateToMessage, authStateToErrorCode } from "./base.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import { supabaseService } from "../services/supabase.js";
import type { AuthState, ExtractedMember } from "../types.js";

const log = logger;

type GroupStopReason = "session_rate_limited" | "no_secondary_session" | "source_exhausted" | "max_results_reached";

const AUTO_GEN = /^(Adventurous|Playful|Shiny|Brave|Clever|Happy|Jolly|Mysterious|Silly|Friendly)\w+\d+/i;
function validName(name: string): boolean {
  if (!name || name.length < 3) return false;
  if (AUTO_GEN.test(name)) return false;
  if (/^User\d{3,}$/i.test(name)) return false;
  return true;
}

export class GroupMembersExtractor extends BaseExtractor {
  private totalMembersCount: number | null = null;
  private totalMembersSource: string = "unknown";
  private lastStopReason: GroupStopReason | null = null;
  private lastProgressTs = 0;
  private lastCancelCheckTs = 0;
  private cancelCheckIntervalMs = 5000;

  async extract(): Promise<{ extracted: number; nextCursor?: string; done: boolean; authState: AuthState }> {
    const gid = parseGroupId(this.ctx.sourceUrl);
    if (!gid) throw new ExtractionError(ErrorCodes.INVALID_INPUT, "Invalid group URL");

    let total = 0, done = false, consecutiveEmpty = 0;
    let authState: AuthState = "unknown";
    const seen = new Set<string>();
    let scrollAttempts = 0;

    const url = this.ctx.cursor || `https://www.facebook.com/groups/${gid}/members`;
    log.info("GroupMembers", `starting`, { jobId: this.ctx.jobId, url });
    await this.storeExtractionProgress(0, "navigating", 0);

    try {
      await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await this.page.waitForTimeout(2000);
      await this.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await this.page.waitForTimeout(1000);
    } catch (err) {
      throw new ExtractionError(ErrorCodes.NETWORK_ERROR, `Navigation error: ${String(err)}`);
    }

    const html = await this.page.content();
    authState = detectAuthState(html, this.page.url());
    if (authState !== "authenticated") throw new ExtractionError(authStateToErrorCode(authState), authStateToMessage(authState));

    const countResult = parseFollowersCount(html);
    this.totalMembersCount = countResult.count;
    this.totalMembersSource = countResult.source;
    log.info("GroupMembers", `total members: ${countResult.count ?? "unknown"} (source=${countResult.source})`);
    if (countResult.count !== null) {
      await this.persistMembersCount(countResult.count, countResult.source);
    }
    await this.storeExtractionProgress(0, "scrolling", 0);

    while (!done && !this.shouldStop && total < this.ctx.maxResults) {
      if (this.shouldCheckCancel()) {
        if (await this.checkCanceled()) return { extracted: total, done: true, authState };
      }

      const rawLinks = await this.page.evaluate(() => {
        const links = document.querySelectorAll('a[href]');
        return Array.from(links).map(link => ({
          href: link.getAttribute('href') || '',
          text: (link as HTMLElement).innerText?.trim() || '',
        }));
      });

      const users = extractUsersFromLinks(rawLinks);
      let newCount = 0;
      const batch: ExtractedMember[] = [];
      for (const u of users) {
        if (!seen.has(u.fb_id)) {
          seen.add(u.fb_id);
          if (validName(u.name)) {
            batch.push({ ...u, type: "member" });
            newCount++;
          }
        }
      }

      log.info("GroupMembers", `+[${newCount}] scroll#${scrollAttempts} total=${total} seen=${seen.size} raw=${rawLinks.length}`);

      if (batch.length > 0) {
        total += await this.processBatch(batch, "member");
        consecutiveEmpty = 0;
        this.backoffScrolls = 0;
        if (scrollAttempts > 0 && scrollAttempts % 15 === 0) await this.restDelay();
        if (scrollAttempts % 30 === 29) {
          await this.storeExtractionProgress(total, "scrolling", scrollAttempts + 1);
        }
      } else {
        consecutiveEmpty++;

        if (consecutiveEmpty === 5) {
          const switched = await this.switchToNextSession();
          if (switched) {
            log.info("GroupMembers", `switched session after 5 empty scrolls, reloading members page (session #${this.activeSessionIndex + 1}/${this.totalSessions})`);
            consecutiveEmpty = 0;
            scrollAttempts = 0;
            try {
              await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
              await this.page.waitForTimeout(2000);
              await this.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
              await this.page.waitForTimeout(1000);
            } catch (err) {
              throw new ExtractionError(ErrorCodes.NETWORK_ERROR, `Navigation error after session switch: ${String(err)}`);
            }
            await this.storeExtractionProgress(total, "scrolling", 0);
            continue;
          } else {
            this.lastStopReason = this.totalSessions > 1 ? "session_rate_limited" : "no_secondary_session";
          }
        }

        if (consecutiveEmpty >= 12) {
          if (this.lastStopReason === null) this.lastStopReason = "source_exhausted";
          done = true;
          break;
        }
      }

      scrollAttempts++;
      await this.scrollFeed(this.page);
    }

    this.finalizeStopReason(total);
    await this.storeExtractionProgress(total, "completed", 0, this.lastStopReason);
    log.info("GroupMembers", `extraction finished: total=${total}, coverage=${this.computeCoverage(total)}%, stopReason=${this.lastStopReason ?? "null"}`);

    if (total === 0) done = true;
    return { extracted: total, nextCursor: done ? undefined : url, done, authState };
  }

  private computeCoverage(discovered: number): number | null {
    if (this.totalMembersCount === null || this.totalMembersCount <= 0) return null;
    return Math.round((discovered / this.totalMembersCount) * 1000) / 10;
  }

  private shouldCheckCancel(): boolean {
    const now = Date.now();
    if (now - this.lastCancelCheckTs >= this.cancelCheckIntervalMs) {
      this.lastCancelCheckTs = now;
      return true;
    }
    return false;
  }

  protected async restDelay(): Promise<void> {
    return new Promise((r) => setTimeout(r, 8000));
  }

  private async persistMembersCount(count: number, source: string): Promise<void> {
    try {
      const job = await supabaseService.getJob(this.ctx.jobId);
      const existingConfig = (job.config || {}) as Record<string, unknown>;
      await supabaseService.updateJob(this.ctx.jobId, {
        config: { ...existingConfig, total_followers_count: count, total_followers_source: source },
      });
    } catch (err) {
      log.warn("GroupMembers", `persistMembersCount failed: ${String(err)}`);
    }
  }

  private async storeExtractionProgress(
    discovered: number,
    phase: "navigating" | "scrolling" | "completed",
    phaseCycle: number,
    stopReason?: GroupStopReason | null,
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
      log.debug("GroupMembers", `storeProgress failed: ${String(err)}`);
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