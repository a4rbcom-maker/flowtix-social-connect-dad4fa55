import { BaseExtractor, parseGroupId, parseFollowersCount, detectAuthState, authStateToMessage, authStateToErrorCode } from "./base.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import { supabaseService } from "../services/supabase.js";
import { multiSessionGroupMembers, membersPhaseBudgetMs, searchShardGroupMembers, type GroupMemberUser, type MultiSessionGroupResult, type SearchShardResult } from "../services/group-members-core.js";
import { runGroupCascade, type GroupCascadeResult, type CascadeWorkerPage } from "../services/group-cascade-core.js";
import { extractEngagers } from "../services/engager-extractor-v2.js";
import { SourceStats, decideNextSource, type SourceKey, type SourceStopReason } from "../services/orchestrator-core.js";
import { SessionHealthMonitor, type FailureInfo } from "../services/session-health.js";
import type { AuthState, ExtractedMember, OrchestratorCheckpoint } from "../types.js";

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

    // Adaptive orchestrator state: measured per-source productivity + session health.
    const stats = new SourceStats();
    const health = new SessionHealthMonitor();
    for (const p of allPages) health.register(p.sessionId);
    const recordSessionFailure = (sessionId: string, info: FailureInfo): void => {
      health.recordFailure(sessionId, info);
    };

    // Resume checkpoint: skip phases already finished in a previous run.
    const checkpoint = await this.loadCheckpoint();
    const doneSources = new Set<SourceKey>((checkpoint?.sources_done ?? []) as SourceKey[]);

    const seen = new Set<string>();
    const shared: GroupMemberUser[] = [];
    let total = 0;
    let errorsCount = 0;
    let duplicatesSkipped = 0;
    let requestsCount = 0;
    let nextStrategy = "none";

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
        active_sessions: extra.activeSessions ?? allPages.filter((wp) => health.available(wp.sessionId)).length,
        next_phase: extra.nextPhase ?? "none",
        errors_count: errorsCount,
        duplicates_skipped: duplicatesSkipped,
        requests_count: requestsCount,
        per_source: stats.snapshot(),
        session_health: health.snapshot(),
        next_strategy: nextStrategy,
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
      duplicatesSkipped += users.length - batch.length;
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
        stats.addUsers("members_list", users.length);
        await persistUsers(users);
      },
      onProgress: (totalSeen: number) => {
        void storeRich({ discovered: total, phase: "scrolling", source: "members_list", phaseCycle: totalSeen, nextPhase: "feed_cascade" });
      },
      onSessionEvent: (sessionId: string, event: "nav_failed" | "auth_failed" | "idle_exhausted") => {
        if (event === "auth_failed") {
          recordSessionFailure(sessionId, { kind: "auth", detail: "members-list phase: login redirect" });
        } else if (event === "nav_failed") {
          recordSessionFailure(sessionId, { kind: "network", detail: "members-list phase: navigation failed" });
        }
      },
      shouldStop: () => this.throttledCanceled(),
    };

    const toSourceStopReason = (reason: string): SourceStopReason => {
      switch (reason) {
        case "target_reached": return "target_reached";
        case "max_duration": return "max_duration";
        case "canceled": return "canceled";
        case "low_yield": return "low_yield";
        case "saturated": return "saturated";
        case "posts_exhausted": return "posts_exhausted";
        default: return "stagnated"; // stagnated / all_idle / idle_exhausted / auth_failed …
      }
    };

    const persistCheckpointAfterPhase = async (source: SourceKey): Promise<void> => {
      doneSources.add(source);
      const snap = stats.get(source);
      await this.persistCheckpoint({
        sources_done: [...doneSources],
        seen_count: seen.size,
        posts_done: cascade?.postsProcessed,
        saved_at: new Date().toISOString(),
      }).catch((err) => log.debug("GroupMembers", `checkpoint persist failed: ${String(err)}`));
      const next = decideNextSource(stats, {
        minRatePerMin: config.orchMinRatePerMin,
        evalWindowMs: config.orchEvalWindowMs,
        minPhaseMs: config.orchMinPhaseMs,
      });
      nextStrategy = next ?? "none";
      log.info("GroupMembers", `phase ${source} done (${snap?.stopReason ?? "?"}, users=${snap?.users ?? 0}) — next strategy: ${nextStrategy}`);
    };

    let membersResult: MultiSessionGroupResult | null = null;
    let cascade: GroupCascadeResult | null = null;
    let shards: SearchShardResult | null = null;

    const runMembersListPhase = async (pages: CascadeWorkerPage[]): Promise<MultiSessionGroupResult | null> => {
      if (doneSources.has("members_list")) {
        log.info("GroupMembers", `resume: members_list already done — skipping`);
        return null;
      }
      stats.start("members_list");
      try {
        const result = await multiSessionGroupMembers(pages, membersUrl, shared, seen, membersOpts);
        stats.finish("members_list", toSourceStopReason(result.stoppedReason));
        await persistCheckpointAfterPhase("members_list");
        return result;
      } catch (err) {
        errorsCount++;
        stats.finish("members_list", "stagnated");
        await persistCheckpointAfterPhase("members_list");
        throw err;
      }
    };

    const runShardPhase = async (): Promise<SearchShardResult | null> => {
      if (doneSources.has("members_search")) return null;
      if (total >= targetCount || this.timeRemainingSec < 150) return null;
      log.info("GroupMembers", `members list capped at ${total}/${targetCount} — starting letter-shard search phase`);
      await storeRich({ discovered: total, phase: "scrolling", source: "members_search", nextPhase: "feed_cascade", activeSessions: allPages.length });
      stats.start("members_search");
      try {
        const result = await searchShardGroupMembers(allPages[0].page, gid, shared, seen, {
          maxDurationMs: Math.min(15 * 60_000, Math.max(60_000, this.timeRemainingMs - 90_000)),
          onNewUsers: async (users) => {
            stats.addUsers("members_search", users.length);
            await persistUsers(users);
          },
          onProgress: (shard, done, totalSeen) => {
            requestsCount++;
            void storeRich({ discovered: total, phase: "scrolling", source: "members_search", phaseCycle: done, nextPhase: "none" });
          },
          shouldStop: () => this.throttledCanceled(),
        });
        shards = result;
        stats.finish("members_search", toSourceStopReason(result.stoppedReason));
        await persistCheckpointAfterPhase("members_search");
        return result;
      } catch (err) {
        errorsCount++;
        stats.finish("members_search", "stagnated");
        await persistCheckpointAfterPhase("members_search");
        log.warn("GroupMembers", `shard phase failed: ${String(err).substring(0, 120)}`);
        return null;
      }
    };

    const runCascadePhase = async (opts: {
      discoveryPage: CascadeWorkerPage;
      pages: CascadeWorkerPage[];
      latePages?: Promise<CascadeWorkerPage[]>;
    }): Promise<GroupCascadeResult | null> => {
      if (doneSources.has("feed_cascade")) {
        log.info("GroupMembers", `resume: feed_cascade already done — skipping`);
        return null;
      }
      if (!config.groupCascadeEnabled) return null;
      stats.start("feed_cascade");
      try {
        const result = await runGroupCascade({
          feedUrl: `https://www.facebook.com/groups/${gid}`,
          discoveryPage: opts.discoveryPage,
          pages: opts.pages,
          ...(opts.latePages ? { latePages: opts.latePages } : {}),
          seenIds: seen,
          targetCount: Math.max(50, targetCount - total),
          maxDurationMs: Math.max(60_000, this.timeRemainingMs - 45_000),
          maxPosts: config.groupCascadeMaxPosts,
          maxDiscoveryMs: allPages.length >= (opts.latePages ? 3 : 2) ? 300_000 : 120_000,
          extractEngagers: (page, permalink) =>
            extractEngagers(page, permalink, {
              maxReactions: 1000,
              maxCommenters: 500,
              scrollDialogSeconds: 8,
            }),
          onNewUsers: async (users) => {
            stats.addUsers("feed_cascade", users.length);
            return await persistUsers(users);
          },
          onProgress: (info) => {
            requestsCount++;
            if (info.sessionHealth) {
              for (const sh of info.sessionHealth) {
                if (sh.state === "unavailable") {
                  recordSessionFailure(sh.session_id, { kind: (sh.last_failure_kind as FailureInfo["kind"]) ?? "bug", detail: sh.last_failure_detail ?? "cascade worker unavailable" });
                }
              }
            }
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
        cascade = result;
        stats.finish("feed_cascade", toSourceStopReason(result.stoppedReason));
        await persistCheckpointAfterPhase("feed_cascade");
        return result;
      } catch (err) {
        errorsCount++;
        stats.finish("feed_cascade", "stagnated");
        await persistCheckpointAfterPhase("feed_cascade");
        throw err;
      }
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

      const membersPromise = (async (): Promise<MultiSessionGroupResult | null> => {
        const modern = await runMembersListPhase([allPages[0]]);
        shards = await runShardPhase();
        resolveMembersPage([allPages[0]]);
        return modern;
      })().catch((err) => {
          errorsCount++;
          log.warn("GroupMembers", `members phase failed (cascade continues): ${String(err).substring(0, 120)}`);
          resolveMembersPage([allPages[0]]);
          return null;
        });

      cascade = await runCascadePhase({
        discoveryPage: allPages[1],
        pages: allPages.slice(2),
        latePages,
      });

      membersResult = await membersPromise;
    } else {
      // Sequential fallback: single session, cascade disabled, or too little
      // time left to overlap. All pages work the members list in parallel,
      // then all of them move to the cascade (workers start immediately).
      log.info("GroupMembers", `sequential mode: ${allPages.length} session(s) on members list first`);
      membersResult = await runMembersListPhase(allPages).catch((err) => {
        errorsCount++;
        log.warn("GroupMembers", `members phase failed: ${String(err).substring(0, 120)}`);
        return null;
      });

      if (!doneSources.has("members_search") && total < targetCount && this.timeRemainingSec > 150 && !(await this.throttledCanceled())) {
        shards = await runShardPhase();
      }

      if (
        !doneSources.has("feed_cascade") &&
        total < targetCount &&
        this.timeRemainingSec > 120 &&
        !(await this.throttledCanceled())
      ) {
        log.info("GroupMembers", `members list done at ${total}/${targetCount} — starting feed cascade phase`);
        await runCascadePhase({
          discoveryPage: allPages[0],
          pages: allPages.slice(1),
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

  private async loadCheckpoint(): Promise<OrchestratorCheckpoint | null> {
    try {
      const job = await supabaseService.getJob(this.ctx.jobId);
      const state = (job.config || {}) as Record<string, unknown>;
      const cp = state.orchestrator_state as OrchestratorCheckpoint | undefined;
      if (!cp || !Array.isArray(cp.sources_done)) return null;
      return cp;
    } catch {
      return null;
    }
  }

  private async persistCheckpoint(cp: OrchestratorCheckpoint): Promise<void> {
    const job = await supabaseService.getJob(this.ctx.jobId);
    const existingConfig = (job.config || {}) as Record<string, unknown>;
    await supabaseService.updateJob(this.ctx.jobId, {
      config: { ...existingConfig, orchestrator_state: cp },
    });
  }
}
