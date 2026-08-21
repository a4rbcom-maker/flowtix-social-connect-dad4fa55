import { BaseExtractor, parseGroupId, parseFollowersCount, detectAuthState, authStateToMessage, authStateToErrorCode } from "./base.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import { supabaseService } from "../services/supabase.js";
import { multiSessionGroupMembers, type GroupMemberUser } from "../services/group-members-core.js";
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
  private canceledCached = false;
  private lastCancelCheckTs = 0;

  async extract(): Promise<{ extracted: number; nextCursor?: string; done: boolean; authState: AuthState }> {
    const gid = parseGroupId(this.ctx.sourceUrl);
    if (!gid) throw new ExtractionError(ErrorCodes.INVALID_INPUT, "Invalid group URL");

    const membersUrl = this.ctx.cursor || `https://www.facebook.com/groups/${gid}/members`;
    log.info("GroupMembers", `starting`, { jobId: this.ctx.jobId, url: membersUrl, sessions: this.totalSessions });
    await this.storeExtractionProgress(0, "navigating", 0);

    try {
      await this.page.goto(membersUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await this.page.waitForTimeout(2000);
      await this.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await this.page.waitForTimeout(1000);
    } catch (err) {
      throw new ExtractionError(ErrorCodes.NETWORK_ERROR, `Navigation error: ${String(err)}`);
    }

    const html = await this.page.content();
    const authState = detectAuthState(html, this.page.url());
    if (authState !== "authenticated") throw new ExtractionError(authStateToErrorCode(authState), authStateToMessage(authState));

    const countResult = parseFollowersCount(html);
    this.totalMembersCount = countResult.count;
    this.totalMembersSource = countResult.source;
    log.info("GroupMembers", `total members: ${countResult.count ?? "unknown"} (source=${countResult.source})`);
    if (countResult.count !== null) {
      await this.persistMembersCount(countResult.count, countResult.source);
    }
    await this.storeExtractionProgress(0, "scrolling", 0);

    const allPages = [
      { sessionId: this.ctx.sessionId, page: this.page },
      ...this.secondarySessionPages,
    ];

    const seen = new Set<string>();
    const shared: GroupMemberUser[] = [];
    let total = 0;

    const coverageTarget = this.totalMembersCount
      ? Math.max(1, Math.round(this.totalMembersCount * 0.85))
      : this.ctx.maxResults;
    const targetCount = Math.min(this.ctx.maxResults, coverageTarget);
    const budgetMs = Math.max(60_000, this.timeRemainingMs - 60_000);

    log.info("GroupMembers", `parallel extraction: ${allPages.length} session(s), target=${targetCount} (coverage 85% cap: ${this.ctx.maxResults})`);

    const result = await multiSessionGroupMembers(allPages, membersUrl, shared, seen, {
      targetCount,
      maxDurationMs: budgetMs,
      onNewUsers: async (users) => {
        const batch: ExtractedMember[] = [];
        for (const u of users) {
          if (validName(u.name)) batch.push({ ...u, type: "member" });
        }
        if (batch.length > 0) {
          total += await this.processBatch(batch, "member");
        }
      },
      onProgress: (totalSeen) => {
        void this.storeExtractionProgress(total, "scrolling", totalSeen);
      },
      shouldStop: () => this.throttledCanceled(),
    });

    this.lastStopReason = this.mapStopReason(result.stoppedReason, total);
    await this.storeExtractionProgress(total, "completed", 0, this.lastStopReason);
    log.info("GroupMembers", `extraction finished: total=${total}, coverage=${this.computeCoverage(total)}%, stopReason=${this.lastStopReason ?? "null"}`);

    return { extracted: total, done: true, authState };
  }

  private computeCoverage(discovered: number): number | null {
    if (this.totalMembersCount === null || this.totalMembersCount <= 0) return null;
    return Math.round((discovered / this.totalMembersCount) * 1000) / 10;
  }

  private async throttledCanceled(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastCancelCheckTs >= 5000) {
      this.lastCancelCheckTs = now;
      this.canceledCached = await this.checkCanceled();
    }
    return this.canceledCached;
  }

  private mapStopReason(coreReason: string, total: number): GroupStopReason | null {
    if (coreReason === "canceled") return null;
    if (coreReason === "target_reached" || total >= this.ctx.maxResults) return "max_results_reached";
    if (this.totalSessions > 1) return "session_rate_limited";
    return "source_exhausted";
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
}
