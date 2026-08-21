import { BaseExtractor, parseGroupId, parseFollowersCount, detectAuthState, authStateToMessage, authStateToErrorCode } from "./base.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import { supabaseService } from "../services/supabase.js";
import { multiSessionGroupMembers, membersPhaseBudgetMs, type GroupMemberUser } from "../services/group-members-core.js";
import { runGroupCascade } from "../services/group-cascade-core.js";
import { extractEngagers } from "../services/engager-extractor-v2.js";
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
    if (!gid) throw new ExtractionError(
      ErrorCodes.INVALID_INPUT,
      `رابط الجروب غير صالح: [${this.ctx.sourceUrl}]. الصيغة المتوقعة: https://www.facebook.com/groups/123456789 أو https://www.facebook.com/groups/اسم-الجروب — إذا كان الرابط صفحة أو بروفايل شخصي فاستخدم نوع "استخراج متابعي الصفحة" بدلاً منه.`,
    );

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
    // Split the budget: the members list is capped by Facebook (~1-2K in large
    // groups) — cap its phase too so the feed cascade (engagers/commenters,
    // the only way past the cap) is guaranteed a real share of the job time.
    const budgetMs = membersPhaseBudgetMs(this.timeRemainingMs);

    log.info("GroupMembers", `parallel extraction: ${allPages.length} session(s), target=${targetCount}, members budget=${Math.round(budgetMs / 1000)}s + cascade reserve (coverage 85% cap: ${this.ctx.maxResults})`);

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

    // Facebook caps the browsable members list (~1-2K in large groups) far
    // below real membership. Everyone who posted/commented/reacted in the
    // group is a member too — cascade the group feed for engagers when the
    // members list topped out below the coverage target.
    let cascade = null as Awaited<ReturnType<typeof runGroupCascade>> | null;
    if (
      config.groupCascadeEnabled &&
      result.stoppedReason !== "canceled" &&
      total < targetCount &&
      this.timeRemainingSec > 120
    ) {
      log.info("GroupMembers", `members list capped at ${total}/${targetCount} — starting feed cascade phase`);
      await this.storeExtractionProgress(total, "scrolling", shared.length);

      cascade = await runGroupCascade({
        feedUrl: `https://www.facebook.com/groups/${gid}`,
        pages: allPages,
        targetCount: targetCount - total,
        maxDurationMs: Math.max(60_000, this.timeRemainingMs - 45_000),
        maxPosts: config.groupCascadeMaxPosts,
        extractEngagers: (page, permalink) =>
          extractEngagers(page, permalink, {
            maxReactions: 1000,
            maxCommenters: 500,
            scrollDialogSeconds: 8,
          }),
        onNewUsers: async (users) => {
          const batch: ExtractedMember[] = [];
          for (const u of users) {
            if (validName(u.name)) batch.push({ ...u, type: "member" });
          }
          if (batch.length > 0) {
            const persisted = await this.processBatch(batch, "member");
            total += persisted;
            return persisted;
          }
          return 0;
        },
        onProgress: (info) => {
          void this.storeCascadeProgress(total, info.postsDone, info.postsKnown);
        },
        shouldStop: () => this.throttledCanceled(),
      });
    }

    this.lastStopReason = this.mapStopReason(cascade?.stoppedReason ?? result.stoppedReason, total);
    await this.storeExtractionProgress(total, "completed", 0, this.lastStopReason);
    log.info("GroupMembers", `extraction finished: total=${total}, coverage=${this.computeCoverage(total)}%, stopReason=${this.lastStopReason ?? "null"}${cascade ? `, cascadePosts=${cascade.postsProcessed}/${cascade.postsDiscovered} (+${cascade.extracted})` : ""}`);

    return { extracted: total, done: true, authState };
  }

  private async storeCascadeProgress(total: number, postsDone: number, postsKnown: number): Promise<void> {
    const now = Date.now();
    if (now - this.lastProgressTs < 10_000) return;
    this.lastProgressTs = now;

    const coverage = this.computeCoverage(total);
    const progress: Record<string, unknown> = {
      discovered: total,
      processed: total,
      phase: "scrolling",
      posts_done: postsDone,
      posts_total: postsKnown,
      coverage_rate: coverage,
      last_update: new Date().toISOString(),
    };
    try {
      await supabaseService.storeProgress(this.ctx.jobId, progress);
    } catch (err) {
      log.debug("GroupMembers", `storeProgress failed: ${String(err)}`);
    }
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
    if (coreReason === "max_duration") return "session_rate_limited";
    // stagnated / all_idle / posts_exhausted: Facebook capped the browsable
    // source — accurate reason regardless of session count.
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
