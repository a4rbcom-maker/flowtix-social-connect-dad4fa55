import { BaseExtractor, parseGroupId, parseFollowersCount, detectAuthState, authStateToMessage, authStateToErrorCode } from "./base.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import { supabaseService } from "../services/supabase.js";
import { multiSessionGroupMembers, membersPhaseBudgetMs, searchShardGroupMembers, type GroupMemberUser, type MultiSessionGroupResult, type SearchShardResult } from "../services/group-members-core.js";
import { runGroupCascade, type GroupCascadeResult, type CascadeWorkerPage } from "../services/group-cascade-core.js";
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
    await supabaseService
      .storeProgress(this.ctx.jobId, {
        discovered: 0,
        processed: 0,
        phase: "navigating",
        source: "members_list",
        next_phase: "feed_cascade",
        rate_per_min: 0,
        active_sessions: this.totalSessions,
        coverage_rate: null,
        last_update: new Date().toISOString(),
      })
      .catch((err) => log.debug("GroupMembers", `storeProgress failed: ${String(err)}`));

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

    const allPages: CascadeWorkerPage[] = [
      { sessionId: this.ctx.sessionId, page: this.page },
      ...this.secondarySessionPages,
    ];

    const seen = new Set<string>();
    const shared: GroupMemberUser[] = [];
    let total = 0;
    let errorsCount = 0;

    const progress = {
      rateWindowStart: Date.now(),
      rateWindowStartTotal: 0,
      lastStoreTs: 0,
    };

    const storeRich = (extra: {
      discovered: number;
      phase: "navigating" | "scrolling" | "completed";
      source: "members_list" | "feed_cascade" | "members_search";
      phaseCycle?: number;
      nextPhase?: string;
      activeSessions?: number;
      postsDone?: number;
      postsKnown?: number;
      stopReason?: GroupStopReason | null;
      immediate?: boolean;
    }): Promise<void> => {
      const now = Date.now();
      if (!extra.immediate && extra.phase !== "navigating" && extra.phase !== "completed" && now - progress.lastStoreTs < 5_000) {
        return Promise.resolve();
      }
      progress.lastStoreTs = now;

      const elapsed = now - progress.rateWindowStart;
      if (elapsed >= 60_000) {
        progress.rateWindowStart = now;
        progress.rateWindowStartTotal = extra.discovered;
      }
      const ratePerMin = elapsed > 5_000 ? Math.round(((extra.discovered - progress.rateWindowStartTotal) / elapsed) * 60_000) : 0;

      const p: Record<string, unknown> = {
        discovered: extra.discovered,
        processed: extra.discovered,
        phase: extra.phase,
        source: extra.source,
        rate_per_min: ratePerMin,
        active_sessions: extra.activeSessions ?? allPages.length,
        next_phase: extra.nextPhase ?? "none",
        errors_count: errorsCount,
        coverage_rate: this.computeCoverage(extra.discovered),
        last_update: new Date().toISOString(),
      };
      if (extra.phaseCycle !== undefined) p.phase_cycle = extra.phaseCycle;
      if (extra.postsDone !== undefined) p.posts_done = extra.postsDone;
      if (extra.postsKnown !== undefined) p.posts_total = extra.postsKnown;
      if (extra.stopReason !== undefined) p.stop_reason = extra.stopReason;

      return supabaseService
        .storeProgress(this.ctx.jobId, p)
        .catch((err) => log.debug("GroupMembers", `storeProgress failed: ${String(err)}`));
    };

    const persistUsers = async (users: GroupMemberUser[]): Promise<number> => {
      const batch: ExtractedMember[] = [];
      for (const u of users) {
        if (validName(u.name)) batch.push({ ...u, type: "member" });
      }
      if (batch.length === 0) return 0;
      const persisted = await this.processBatch(batch, "member");
      total += persisted;
      return persisted;
    };

    const coverageTarget = this.totalMembersCount
      ? Math.max(1, Math.round(this.totalMembersCount * 0.85))
      : this.ctx.maxResults;
    const targetCount = Math.min(this.ctx.maxResults, coverageTarget);
    const budgetMs = membersPhaseBudgetMs(this.timeRemainingMs);

    log.info("GroupMembers", `target=${targetCount}, members budget=${Math.round(budgetMs / 1000)}s (hard cap), cascade=${config.groupCascadeEnabled ? "on" : "off"}`);

    const membersOpts = {
      targetCount,
      maxDurationMs: budgetMs,
      onNewUsers: async (users: GroupMemberUser[]): Promise<void> => {
        await persistUsers(users);
      },
      onProgress: (totalSeen: number) => {
        void storeRich({ discovered: total, phase: "scrolling", source: "members_list", phaseCycle: totalSeen, nextPhase: "feed_cascade" });
      },
      shouldStop: () => this.throttledCanceled(),
    };

    let membersResult: MultiSessionGroupResult | null = null;
    let cascade: GroupCascadeResult | null = null;
    let shards: SearchShardResult | null = null;

    const runShardPhase = async (): Promise<SearchShardResult | null> => {
      if (total >= targetCount || this.timeRemainingSec < 150) return null;
      log.info("GroupMembers", `members list capped at ${total}/${targetCount} — starting letter-shard search phase`);
      await storeRich({ discovered: total, phase: "scrolling", source: "members_search", nextPhase: "feed_cascade", activeSessions: allPages.length });
      return searchShardGroupMembers(allPages[0].page, gid, shared, seen, {
        maxDurationMs: Math.min(15 * 60_000, Math.max(60_000, this.timeRemainingMs - 90_000)),
        onNewUsers: async (users) => {
          await persistUsers(users);
        },
        onProgress: (shard, done, totalSeen) => {
          void storeRich({ discovered: total, phase: "scrolling", source: "members_search", phaseCycle: done, nextPhase: "none" });
        },
        shouldStop: () => this.throttledCanceled(),
      });
    };

    const overlap =
      config.groupCascadeEnabled &&
      allPages.length >= 2 &&
      this.timeRemainingSec > 180;

    if (overlap) {
      // PHASE OVERLAP: session 0 keeps working the (Facebook-capped) members
      // list while every other session starts the feed cascade IMMEDIATELY —
      // no dead window between phases, and the members page joins the
      // cascade worker pool the moment its phase ends.
      log.info("GroupMembers", `overlap mode: 1 session on members list, ${allPages.length - 1} session(s) on feed cascade immediately`);

      let resolveMembersPage: (pages: CascadeWorkerPage[]) => void = () => {};
      const latePages = new Promise<CascadeWorkerPage[]>((res) => {
        resolveMembersPage = res;
      });

      const membersPromise = (async () => {
        const modern = await multiSessionGroupMembers([allPages[0]], membersUrl, shared, seen, membersOpts);
        shards = await runShardPhase();
        resolveMembersPage([allPages[0]]);
        return modern;
      })().catch((err) => {
          errorsCount++;
          log.warn("GroupMembers", `members phase failed (cascade continues): ${String(err).substring(0, 120)}`);
          resolveMembersPage([allPages[0]]);
          return null;
        });

      cascade = await runGroupCascade({
        feedUrl: `https://www.facebook.com/groups/${gid}`,
        discoveryPage: allPages[1],
        pages: allPages.slice(2),
        latePages,
        seenIds: seen,
        targetCount: Math.max(50, targetCount - total),
        maxDurationMs: Math.max(60_000, this.timeRemainingMs - 45_000),
        maxPosts: config.groupCascadeMaxPosts,
        maxDiscoveryMs: allPages.length >= 3 ? 300_000 : 120_000,
        extractEngagers: (page, permalink) =>
          extractEngagers(page, permalink, {
            maxReactions: 1000,
            maxCommenters: 500,
            scrollDialogSeconds: 8,
          }),
        onNewUsers: persistUsers,
        onProgress: (info) => {
          void storeRich({
            discovered: total,
            phase: "scrolling",
            source: "feed_cascade",
            postsDone: info.postsDone,
            postsKnown: info.postsKnown,
            activeSessions: info.activeWorkers,
            nextPhase: "none",
          });
        },
        shouldStop: () => this.throttledCanceled(),
      });

      membersResult = await membersPromise;
    } else {
      // Sequential fallback: single session, cascade disabled, or too little
      // time left to overlap. All pages work the members list in parallel,
      // then all of them move to the cascade (workers start immediately).
      log.info("GroupMembers", `sequential mode: ${allPages.length} session(s) on members list first`);
      membersResult = await multiSessionGroupMembers(allPages, membersUrl, shared, seen, membersOpts);

      if (membersResult.stoppedReason !== "canceled" && total < targetCount && this.timeRemainingSec > 150) {
        shards = await runShardPhase();
      }

      if (
        config.groupCascadeEnabled &&
        membersResult.stoppedReason !== "canceled" &&
        total < targetCount &&
        this.timeRemainingSec > 120
      ) {
        log.info("GroupMembers", `members list done at ${total}/${targetCount} (${membersResult.stoppedReason}) — starting feed cascade phase`);
        cascade = await runGroupCascade({
          feedUrl: `https://www.facebook.com/groups/${gid}`,
          discoveryPage: allPages[0],
          pages: allPages.slice(1),
          seenIds: seen,
          targetCount: Math.max(50, targetCount - total),
          maxDurationMs: Math.max(60_000, this.timeRemainingMs - 45_000),
          maxPosts: config.groupCascadeMaxPosts,
          maxDiscoveryMs: allPages.length >= 2 ? 300_000 : 120_000,
          extractEngagers: (page, permalink) =>
            extractEngagers(page, permalink, {
              maxReactions: 1000,
              maxCommenters: 500,
              scrollDialogSeconds: 8,
            }),
          onNewUsers: persistUsers,
          onProgress: (info) => {
            void storeRich({
              discovered: total,
              phase: "scrolling",
              source: "feed_cascade",
              postsDone: info.postsDone,
              postsKnown: info.postsKnown,
              activeSessions: info.activeWorkers,
              nextPhase: "none",
            });
          },
          shouldStop: () => this.throttledCanceled(),
        });
      }
    }

    const coreReason = cascade?.stoppedReason ?? membersResult?.stoppedReason ?? "";
    this.lastStopReason = this.mapStopReason(coreReason, total);
    await storeRich({ discovered: total, phase: "completed", source: cascade ? "feed_cascade" : "members_list", stopReason: this.lastStopReason, immediate: true });
    log.info("GroupMembers", `extraction finished: total=${total}, coverage=${this.computeCoverage(total)}%, stopReason=${this.lastStopReason ?? "null"}${cascade ? `, cascadePosts=${cascade.postsProcessed}/${cascade.postsDiscovered} (+${cascade.extracted})` : ""}${shards ? `, shards=${shards.extracted}/${shards.shardsDone} (${shards.stoppedReason})` : ""}${membersResult ? `, membersReason=${membersResult.stoppedReason}` : ""}`);

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
    if (coreReason === "max_duration") return "session_rate_limited";
    // stagnated / low_yield / all_idle / saturated / posts_exhausted:
    // Facebook capped the browsable source — accurate reason regardless of
    // session count.
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
}
