import { BaseExtractor, parsePageId, parseFollowersCount, detectAuthState } from "./base.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import { supabaseService } from "../services/supabase.js";
import { cleanMemberName, parseGroupUsersFromGraphQL } from "../services/group-members-core.js";
import { runGroupCascade, type GroupCascadeResult, type CascadeWorkerPage } from "../services/group-cascade-core.js";
import { multiSessionGroupMembers, type GroupMemberUser } from "../services/group-members-core.js";
import { extractEngagers, extractEngagersDeep } from "../services/engager-extractor-v2.js";
import { SourceStats, decideNextSource, type SourceStopReason } from "../services/orchestrator-core.js";
import { SessionHealthMonitor, type FailureInfo } from "../services/session-health.js";
import type { AuthState, ExtractedMember, OrchestratorCheckpoint } from "../types.js";
import type { Page } from "playwright";

const log = logger;

type PageStopReason = "session_rate_limited" | "no_secondary_session" | "source_exhausted" | "max_results_reached";
type PageSourceKey = "followers_list" | "posts_cascade" | "page_groups" | "followers_search";
const PAGE_SOURCE_ORDER: readonly PageSourceKey[] = ["followers_list", "posts_cascade"];

const AUTO_GEN = /^(Adventurous|Playful|Shiny|Brave|Clever|Happy|Jolly|Mysterious|Silly|Friendly)\w+\d+/i;
function validName(name: string): boolean {
  if (!name || name.length < 3) return false;
  if (AUTO_GEN.test(name)) return false;
  if (/^User\d{3,}$/i.test(name)) return false;
  return true;
}

/** Followers-list phase ceiling — mirrors MEMBERS_PHASE_MAX_MS reasoning:
 *  Facebook caps the /followers/ tab (~1-2K), but the cap binds scrolling,
 *  not the clock; idle/stall detectors handle a genuinely capped list. */
const FOLLOWERS_PHASE_MAX_MS = 20 * 60_000;

/** Page-extraction tuning: Facebook caps the inline followers tab at ~40 users
 *  (proven live: the list hard-stops, GraphQL pagination returns HTTP 500).
 *  To reach thousands we lean on the two surfaces that DO paginate deeply:
 *    (3) the page's own post feed (posts_cascade) — reaches thousands, bound
 *        only by GROUP_CASCADE_MAX_POSTS + time budget, and
 *    (1) groups the page is linked to (page_groups) — same deep-pagination as
 *        group members. Both are merged into a single follower-style export.
 *  A single-letter search pass is added as a best-effort followers top-up. */
const PAGE_CASCADE_MAX_POSTS = 8000;            // raised hard for pages: real limit is time + page's post count, not FB block
const PAGE_GROUP_MEMBERS_TARGET = 100_000;     // deep-paginate linked groups
const PAGE_FOLLOWERS_SEARCH_MIN = 60;           // if followers tab yields fewer, run search pass
// How deeply we harvest reactors/commenters from each post's reaction dialog.
// Raised from 8s → 20s so every post yields far more follower-style rows.
const PAGE_CASCADE_REACTOR_SCROLL_S = 20;
const PAGE_CASCADE_MAX_REACTIONS = 2000;
const PAGE_CASCADE_MAX_COMMENTERS = 1500;
const FOLLOWERS_SEARCH_TERMS = [
  "ا", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ر", "س", "ش", "ص", "ض", "ط", "ع", "غ", "ف", "ق", "ك", "ل", "م", "ن", "ه", "و", "ي",
  "a", "b", "c", "d", "e", "m", "s", "o",
];

/** Discover groups linked to a page (about/groups tabs). Returns numeric ids. */
async function discoverPageGroups(page: import("playwright").Page, pageUrl: string): Promise<string[]> {
  const candidates = [`${pageUrl}/groups`, `${pageUrl}?sk=groups`, `${pageUrl}/about`];
  const ids = new Set<string>();
  for (const url of candidates) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000);
    } catch { /* keep going */ }
    const found: string[] = await page.evaluate(() => {
      const out: string[] = [];
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const m = (a.getAttribute("href") ?? "").match(/facebook\.com\/groups\/(\d{8,})/);
        if (m) out.push(m[1]);
      }
      return out;
    });
    for (const g of found) ids.add(g);
  }
  return [...ids];
}

/** Follows the same reserve policy as membersPhaseBudgetMs(). */
function followersPhaseBudgetMs(remainingMs: number): number {
  const usable = Math.max(60_000, remainingMs - 60_000);
  const cascadeReserve = Math.max(60_000, Math.round(remainingMs * 0.65));
  const capped = Math.min(usable, Math.max(60_000, remainingMs - cascadeReserve), FOLLOWERS_PHASE_MAX_MS);
  return Math.max(60_000, capped);
}

export class PageFollowersExtractor extends BaseExtractor {
  private totalFollowersCount: number | null = null;
  private lastStopReason: PageStopReason | null = null;
  private canceledCached = false;
  private lastCancelCheckTs = 0;

  async extract(): Promise<{ extracted: number; nextCursor?: string; done: boolean; authState: AuthState }> {
    const pid = parsePageId(this.ctx.sourceUrl);
    if (!pid) throw new ExtractionError(
      ErrorCodes.INVALID_INPUT,
      `رابط الصفحة غير صالح: [${this.ctx.sourceUrl}]. الصيغة المتوقعة: https://www.facebook.com/اسم-الصفحة أو https://www.facebook.com/profile.php?id=123456789 — إذا كان الرابط جروباً فاستخدم نوع "استخراج أعضاء الجروب" بدلاً منه.`,
    );

    const pageUrl = `https://www.facebook.com/${pid}`;
    log.info("PageFollowers", `starting`, { jobId: this.ctx.jobId, url: pageUrl, sessions: this.totalSessions });
    await supabaseService
      .storeProgress(this.ctx.jobId, {
        discovered: 0,
        processed: 0,
        phase: "navigating",
        source: "followers_list",
        next_phase: "posts_cascade",
        rate_per_min: 0,
        active_sessions: this.totalSessions,
        coverage_rate: null,
        last_update: new Date().toISOString(),
      })
      .catch((err) => log.debug("PageFollowers", `storeProgress failed: ${String(err)}`));

    try {
      await this.page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await this.page.waitForTimeout(2000);
      await this.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await this.page.waitForTimeout(1000);
    } catch (err) {
      throw new ExtractionError(ErrorCodes.NETWORK_ERROR, `Navigation error: ${String(err)}`);
    }

    const html = await this.page.content();
    const authState = detectAuthState(html, this.page.url());
    if (authState !== "authenticated") throw new ExtractionError(ErrorCodes.AUTH_FAILED, `Auth: ${authState}`);

    const countResult = parseFollowersCount(html);
    this.totalFollowersCount = countResult.count;
    log.info("PageFollowers", `total followers: ${countResult.count ?? "unknown"} (source=${countResult.source})`);
    if (countResult.count !== null) {
      await this.persistFollowersCount(countResult.count, countResult.source);
    }

    const allPages: CascadeWorkerPage[] = [
      { sessionId: this.ctx.sessionId, page: this.page },
      ...this.secondarySessionPages,
    ];

    // Adaptive orchestrator state — identical shape to the groups flow.
    const stats = new SourceStats<PageSourceKey>();
    const health = new SessionHealthMonitor();
    const shardJoinHook: { fn: ((wp: CascadeWorkerPage) => void) | null } = { fn: null };
    for (const p of allPages) health.register(p.sessionId);
    const recordSessionFailure = (sessionId: string, info: FailureInfo): void => {
      health.recordFailure(sessionId, info);
    };

    const checkpoint = await this.loadCheckpoint();
    const doneSources = new Set<PageSourceKey>((checkpoint?.sources_done ?? []) as PageSourceKey[]);

    const seen = new Set<string>();
    const shared: Array<{ fb_id: string; name: string; profile_url: string }> = [];
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
      source: "followers_list" | "posts_cascade";
      phaseCycle?: number;
      nextPhase?: string;
      activeSessions?: number;
      postsDone?: number;
      postsKnown?: number;
      stopReason?: PageStopReason | null;
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
        .catch((err) => log.debug("PageFollowers", `storeProgress failed: ${String(err)}`));
    };

    const persistUsers = async (users: Array<{ fb_id: string; name: string; profile_url: string }>): Promise<number> => {
      const batch: ExtractedMember[] = [];
      for (const u of users) {
        if (validName(u.name) && cleanMemberName(u.name)) batch.push({ fb_id: u.fb_id, name: cleanMemberName(u.name) as string, profile_url: u.profile_url, type: "follower" });
      }
      if (batch.length === 0) return 0;
      duplicatesSkipped += users.length - batch.length;
      const persisted = await this.processBatch(batch, "follower");
      total += persisted;
      return persisted;
    };

    const coverageTarget = this.totalFollowersCount
      ? Math.max(1, Math.round(this.totalFollowersCount * 0.85))
      : this.ctx.maxResults;
    const targetCount = Math.min(this.ctx.maxResults, coverageTarget);
    const budgetMs = followersPhaseBudgetMs(this.timeRemainingMs);

    log.info("PageFollowers", `target=${targetCount}, followers budget=${Math.round(budgetMs / 1000)}s (hard cap), cascade=${config.groupCascadeEnabled ? "on" : "off"}`);

    const toSourceStopReason = (reason: string): SourceStopReason => {
      switch (reason) {
        case "target_reached": return "target_reached";
        case "max_duration": return "max_duration";
        case "canceled": return "canceled";
        case "low_yield": return "low_yield";
        case "saturated": return "saturated";
        case "posts_exhausted": return "posts_exhausted";
        default: return "stagnated";
      }
    };

    const persistCheckpointAfterPhase = async (source: PageSourceKey): Promise<void> => {
      doneSources.add(source);
      const snap = stats.get(source);
      await this.persistCheckpoint({
        sources_done: [...doneSources],
        seen_count: seen.size,
        posts_done: cascade?.postsProcessed,
        saved_at: new Date().toISOString(),
      }).catch((err) => log.debug("PageFollowers", `checkpoint persist failed: ${String(err)}`));
      const next = decideNextSource(stats, { order: PAGE_SOURCE_ORDER,
        minRatePerMin: config.orchMinRatePerMin,
        evalWindowMs: config.orchEvalWindowMs,
        minPhaseMs: config.orchMinPhaseMs,
      });
      nextStrategy = next ?? "none";
      log.info("PageFollowers", `phase ${source} done (${snap?.stopReason ?? "?"}, users=${snap?.users ?? 0}) — next strategy: ${nextStrategy}`);
    };

    let followersResult: { persisted: number; stoppedReason: string } | null = null;
    let cascade: GroupCascadeResult | null = null;

    const runFollowersListPhase = async (pages: CascadeWorkerPage[]): Promise<{ persisted: number; stoppedReason: string } | null> => {
      if (doneSources.has("followers_list")) {
        log.info("PageFollowers", `resume: followers_list already done — skipping`);
        return null;
      }
      stats.start("followers_list");
      try {
        const result = await this.runFollowersList(pages, pageUrl, shared, seen, {
          maxDurationMs: budgetMs,
          targetCount,
          onNewUsers: async (users) => {
            stats.addUsers("followers_list", users.length);
            await persistUsers(users);
          },
          onProgress: (totalSeen) => {
            void storeRich({ discovered: total, phase: "scrolling", source: "followers_list", phaseCycle: totalSeen, nextPhase: "posts_cascade" });
          },
          onSessionEvent: (sessionId: string, event: "nav_failed" | "auth_failed") => {
            if (event === "auth_failed") {
              recordSessionFailure(sessionId, { kind: "auth", detail: "followers-list phase: login redirect" });
            } else if (event === "nav_failed") {
              recordSessionFailure(sessionId, { kind: "network", detail: "followers-list phase: navigation failed" });
            }
          },
          shouldStop: () => this.throttledCanceled(),
        });
        stats.finish("followers_list", toSourceStopReason(result.stoppedReason));
        await persistCheckpointAfterPhase("followers_list");
        return result;
      } catch (err) {
        errorsCount++;
        stats.finish("followers_list", "stagnated");
        await persistCheckpointAfterPhase("followers_list");
        throw err;
      }
    };

    const runCascadePhase = async (opts: {
      discoveryPage: CascadeWorkerPage;
      pages: CascadeWorkerPage[];
      latePages?: Promise<CascadeWorkerPage[]>;
      onEarlyGiveUp?: (wp: CascadeWorkerPage) => void;
    }): Promise<GroupCascadeResult | null> => {
      if (doneSources.has("posts_cascade")) {
        log.info("PageFollowers", `resume: posts_cascade already done — skipping`);
        return null;
      }
      if (!config.groupCascadeEnabled) return null;
      stats.start("posts_cascade");
      try {
        const result = await runGroupCascade({
          feedUrl: pageUrl,
          feedKind: "page",
          feedToken: pid,
          // Rotate feed surfaces across rediscovery passes: timeline → videos →
          // reels → chronological — page videos carry several× more reactors
          // than timeline posts, so each surface adds a fresh post pool.
          rediscoverVariants: ["", "/videos", "/reels", "?sorting_setting=CHRONOLOGICAL"],
          discoveryPage: opts.discoveryPage,
          pages: opts.pages,
          ...(opts.latePages ? { latePages: opts.latePages } : {}),
          seenIds: seen,
          targetCount: Math.max(50, targetCount - total),
          maxDurationMs: Math.max(60_000, this.timeRemainingMs - 45_000),
          maxPosts: PAGE_CASCADE_MAX_POSTS,
          maxDiscoveryMs: allPages.length >= (opts.latePages ? 3 : 2) ? 300_000 : 120_000,
          onSaturationHandoff: opts.onEarlyGiveUp,
          extractEngagers: (page, permalink) =>
            extractEngagersDeep(page, permalink, {
              maxReactions: PAGE_CASCADE_MAX_REACTIONS,
              maxCommenters: PAGE_CASCADE_MAX_COMMENTERS,
              scrollDialogSeconds: PAGE_CASCADE_REACTOR_SCROLL_S,
            }),
          onNewUsers: async (users) => {
            stats.addUsers("posts_cascade", users.length);
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
              source: "posts_cascade",
              postsDone: info.postsDone,
              postsKnown: info.postsKnown,
              activeSessions: info.activeWorkers,
              nextPhase: "none",
            });
          },
          shouldStop: () => this.throttledCanceled(),
        });
        cascade = result;
        stats.finish("posts_cascade", toSourceStopReason(result.stoppedReason));
        await persistCheckpointAfterPhase("posts_cascade");
        return result;
      } catch (err) {
        errorsCount++;
        stats.finish("posts_cascade", "stagnated");
        await persistCheckpointAfterPhase("posts_cascade");
        throw err;
      }
    };

    const overlap =
      config.groupCascadeEnabled &&
      allPages.length >= 2 &&
      this.timeRemainingSec > 180;

    if (overlap) {
      // PHASE OVERLAP — same as groups: session 0 works the followers list
      // while every other session starts the posts cascade IMMEDIATELY.
      log.info("PageFollowers", `overlap mode: 1 session on followers list, ${allPages.length - 1} session(s) on posts cascade immediately`);

      let resolveFollowersPage: (pages: CascadeWorkerPage[]) => void = () => {};
      const latePages = new Promise<CascadeWorkerPage[]>((res) => {
        resolveFollowersPage = res;
      });

      const followersPromise = (async (): Promise<{ persisted: number; stoppedReason: string } | null> => {
        const r = await runFollowersListPhase([allPages[0]]);
        resolveFollowersPage([allPages[0]]);
        return r;
      })().catch((err) => {
          errorsCount++;
          log.warn("PageFollowers", `followers phase failed (cascade continues): ${String(err).substring(0, 120)}`);
          resolveFollowersPage([allPages[0]]);
          return null;
        });

      cascade = await runCascadePhase({
        discoveryPage: allPages[1],
        pages: allPages.slice(2),
        latePages,
        onEarlyGiveUp: (wp) => shardJoinHook.fn?.(wp),
      });

      followersResult = await followersPromise;
    } else {
      // Sequential fallback: single session, cascade disabled, or too little
      // time left to overlap.
      log.info("PageFollowers", `sequential mode: ${allPages.length} session(s) on followers list first`);
      followersResult = await runFollowersListPhase(allPages).catch((err) => {
        errorsCount++;
        log.warn("PageFollowers", `followers phase failed: ${String(err).substring(0, 120)}`);
        return null;
      });

      if (
        !doneSources.has("posts_cascade") &&
        total < targetCount &&
        this.timeRemainingSec > 120 &&
        !(await this.throttledCanceled())
      ) {
        log.info("PageFollowers", `followers list done at ${total}/${targetCount} — starting posts cascade phase`);
        await runCascadePhase({
          discoveryPage: allPages[0],
          pages: allPages.slice(1),
          onEarlyGiveUp: (wp) => shardJoinHook.fn?.(wp),
        });
      }
    }

    // ── (1) Linked-page-groups deep pagination (conditional) ──────────────
    // Facebook caps the inline followers tab, but groups paginate deeply. If the
    // page is linked to any groups, harvest their members as follower-style
    // rows. Skipped silently when no groups are discoverable (e.g. manfaz.alnasr).
    const persistGroupUsers = (sourceKey: PageSourceKey) => async (users: GroupMemberUser[]): Promise<number> => {
      const batch: ExtractedMember[] = [];
      for (const u of users) {
        if (validName(u.name) && cleanMemberName(u.name)) batch.push({ fb_id: u.fb_id, name: cleanMemberName(u.name) as string, profile_url: u.profile_url, type: "follower" });
      }
      if (batch.length === 0) return 0;
      duplicatesSkipped += users.length - batch.length;
      stats.addUsers(sourceKey, batch.length);
      const persisted = await this.processBatch(batch, "follower");
      total += persisted;
      return persisted;
    };
    const persistPageGroups = persistGroupUsers("page_groups");
    const persistSearch = persistGroupUsers("followers_search");
    let pageGroupsResult: { persisted: number; stoppedReason: string } | null = null;
    if (
      !doneSources.has("page_groups") &&
      total < targetCount &&
      this.timeRemainingSec > 120 &&
      !(await this.throttledCanceled())
    ) {
      const probePage = allPages[0].page;
      log.info("PageFollowers", `discovering groups linked to page ${pid}…`);
      const groupIds = await discoverPageGroups(probePage, pageUrl).catch(() => [] as string[]);
      if (groupIds.length > 0) {
        log.info("PageFollowers", `found ${groupIds.length} linked group(s): ${groupIds.join(", ")} — harvesting members`);
        stats.start("page_groups");
        try {
          const sharedPageGroups: GroupMemberUser[] = [];
          for (const gid of groupIds) {
            if (await this.throttledCanceled()) break;
            await multiSessionGroupMembers(
              allPages,
              `https://www.facebook.com/groups/${gid}/members`,
              sharedPageGroups,
              seen,
            );
            await persistPageGroups(sharedPageGroups);
          }
          stats.finish("page_groups", "saturated");
          await persistCheckpointAfterPhase("page_groups");
          pageGroupsResult = { persisted: sharedPageGroups.length, stoppedReason: "saturated" };
        } catch (err) {
          errorsCount++;
          stats.finish("page_groups", "stagnated");
          await persistCheckpointAfterPhase("page_groups");
          log.warn("PageFollowers", `page-groups harvest failed: ${String(err).substring(0, 120)}`);
        }
      } else {
        log.info("PageFollowers", `no linked groups discovered — skipping page_groups phase`);
        doneSources.add("page_groups");
      }
    }

    // ── followers search top-up (best-effort) ─────────────────────────────
    // When the inline tab barely yielded (Facebook cap), a single-letter search
    // pass recovers a few dozen more follower ids. Never blocks the run.
    if (
      shared.length < PAGE_FOLLOWERS_SEARCH_MIN &&
      this.timeRemainingSec > 90 &&
      !(await this.throttledCanceled())
    ) {
      log.info("PageFollowers", `followers tab yielded ${shared.length} (<${PAGE_FOLLOWERS_SEARCH_MIN}) — running single-letter search top-up`);
      const searchUsers: GroupMemberUser[] = [];
      for (const term of FOLLOWERS_SEARCH_TERMS) {
        if (await this.throttledCanceled()) break;
        await multiSessionGroupMembers(
          allPages,
          `${pageUrl}/followers/?search=${encodeURIComponent(term)}`,
          searchUsers,
          seen,
        ).catch(() => null);
        if (searchUsers.length >= PAGE_FOLLOWERS_SEARCH_MIN * 3) break;
      }
      if (searchUsers.length > 0) {
        await persistSearch(searchUsers);
      }
      log.info("PageFollowers", `search top-up recovered ${searchUsers.length} additional follower ids`);
    }

    const coreReason = cascade?.stoppedReason ?? followersResult?.stoppedReason ?? pageGroupsResult?.stoppedReason ?? "";
    this.lastStopReason = this.mapStopReason(coreReason, total);
    await storeRich({ discovered: total, phase: "completed", source: cascade ? "posts_cascade" : "followers_list", stopReason: this.lastStopReason, immediate: true });
    log.info("PageFollowers", `extraction finished: total=${total}, coverage=${this.computeCoverage(total)}%, stopReason=${this.lastStopReason ?? "null"}${cascade ? `, cascadePosts=${cascade.postsProcessed}/${cascade.postsDiscovered} (+${cascade.extracted})` : ""}${followersResult ? `, followersReason=${followersResult.stoppedReason}` : ""}`);

    return { extracted: total, done: true, authState };
  }

  /**
   * Followers-list phase: scroll the /followers/ tab with the given sessions
   * in parallel (GraphQL interception + human-like scrolling + stall/low-yield
   * detection mirroring multiSessionGroupMembers).
   */
  private async runFollowersList(
    pages: CascadeWorkerPage[],
    pageUrl: string,
    shared: Array<{ fb_id: string; name: string; profile_url: string }>,
    seenIds: Set<string>,
    opts: {
      maxDurationMs: number;
      targetCount: number;
      onNewUsers: (users: Array<{ fb_id: string; name: string; profile_url: string }>) => Promise<void> | void;
      onProgress: (totalSeen: number) => void;
      onSessionEvent: (sessionId: string, event: "nav_failed" | "auth_failed") => void;
      shouldStop: () => Promise<boolean>;
    },
  ): Promise<{ persisted: number; stoppedReason: string }> {
    log.info("PageFollowers", `=== followers list phase === sessions=${pages.length} target=${opts.targetCount} budget=${Math.round(opts.maxDurationMs / 60000)}min`);

    // Navigate every session to the page first (followers URL derives from it).
    await Promise.all(pages.map(async ({ sessionId, page }) => {
      try {
        await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(1500 + Math.random() * 1500);
      } catch (err) {
        log.warn("PageFollowers", `session ${sessionId.slice(0, 8)}: nav failed — ${String(err).substring(0, 80)}`);
        opts.onSessionEvent(sessionId, "nav_failed");
      }
    }));

    // Shared dedup state
    let pending: Array<{ fb_id: string; name: string; profile_url: string }> = [];
    let persisted = 0;
    const addShared = (user: { fb_id: string; name: string; profile_url: string }): void => {
      if (seenIds.has(user.fb_id)) return;
      seenIds.add(user.fb_id);
      shared.push(user);
      pending.push(user);
    };

    const flushPending = async (): Promise<void> => {
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      try {
        const persistedCount = await opts.onNewUsers(batch);
        if (typeof persistedCount === "number") persisted += persistedCount;
      } catch (err) {
        log.warn("PageFollowers", `followers flush failed: ${String(err).substring(0, 100)}`);
      }
    };

    // GraphQL interception on every page (same walker as groups, with the
    // junk-name filter).
    const detachers: Array<() => void> = [];
    for (const { page } of pages) {
      detachers.push(this.attachFollowersInterception(page, addShared));
    }

    const startTime = Date.now();
    const stallWindowMs = 90_000;
    const stallMinGrowth = 5;
    const lowYieldWindowMs = 240_000;
    const lowYieldMinGrowth = 50;

    const stallHistory: Array<{ t: number; n: number }> = [];
    const stalled = (): boolean => {
      const now = Date.now();
      stallHistory.push({ t: now, n: shared.length });
      while (stallHistory.length > 0 && now - stallHistory[0].t > stallWindowMs) stallHistory.shift();
      return stallHistory.length >= 2 && shared.length - stallHistory[0].n < stallMinGrowth;
    };
    const lowYield = (): boolean => {
      const now = Date.now();
      if (now - startTime < lowYieldWindowMs) return false;
      return shared.length < lowYieldMinGrowth;
    };

    const runOne = async ({ sessionId, page }: CascadeWorkerPage): Promise<string> => {
      const followersUrl = `${pageUrl}/followers/`;
      try {
        await page.goto(followersUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(2500 + Math.random() * 1500);
        if (page.url().includes("login")) {
          opts.onSessionEvent(sessionId, "auth_failed");
          return "auth_failed";
        }
      } catch {
        opts.onSessionEvent(sessionId, "nav_failed");
        return "nav_failed";
      }

      const maxIdleRounds = 35;
      let idleCount = 0;
      let lastSeen = shared.length;
      let round = 0;
      let wakeUpAttempts = 0;
      const MAX_WAKEUP = 3;
      let lastLongBreakRound = 0;
      let nextLongBreakAt = 25 + Math.floor(Math.random() * 15);

      while (true) {
        if (await opts.shouldStop()) return "canceled";
        if (Date.now() - startTime > opts.maxDurationMs) return "max_duration";
        if (shared.length >= opts.targetCount) return "target_reached";
        if (stalled()) return "stagnated";
        if (lowYield()) return "low_yield";

        round++;

        if (round - lastLongBreakRound >= nextLongBreakAt) {
          const breakMs = 8000 + Math.random() * 12000;
          log.info("PageFollowers", `session ${sessionId.slice(0, 8)} round ${round}: long break ${Math.round(breakMs / 1000)}s`);
          await new Promise((r) => setTimeout(r, breakMs));
          lastLongBreakRound = round;
          nextLongBreakAt = 25 + Math.floor(Math.random() * 15);
        }

        // Human-like scroll of the followers dialog/list.
        await this.humanScrollStep(page);
        await new Promise((r) => setTimeout(r, 900 + Math.random() * 1100));

        // Occasional DOM sweep as a GraphQL fallback.
        if (round % 4 === 3) await this.collectDomFollowers(page, addShared);
        await flushPending();
        opts.onProgress(shared.length);

        if (shared.length === lastSeen) {
          idleCount++;
          if (idleCount >= maxIdleRounds) {
            if (wakeUpAttempts < MAX_WAKEUP) {
              wakeUpAttempts++;
              idleCount = Math.floor(maxIdleRounds / 2);
              log.info("PageFollowers", `session ${sessionId.slice(0, 8)}: idle ${maxIdleRounds} rounds — wake-up #${wakeUpAttempts}`);
              await this.wakeUp(page);
            } else {
              return "idle_exhausted";
            }
          }
        } else {
          idleCount = 0;
          wakeUpAttempts = 0;
          lastSeen = shared.length;
        }
      }
    };

    const reasons = await Promise.all(pages.map(runOne));
    await flushPending();
    for (const d of detachers) d();

    const stoppedReason =
      reasons.includes("canceled") ? "canceled"
      : shared.length >= opts.targetCount ? "target_reached"
      : Date.now() - startTime > opts.maxDurationMs ? "max_duration"
      : reasons.includes("stagnated") ? "stagnated"
      : reasons.includes("low_yield") ? "low_yield"
      : "all_idle";

    log.info("PageFollowers", `followers list finished: seen=${shared.length} persisted=${persisted} (reason=${stoppedReason})`);
    return { persisted: shared.length, stoppedReason };
  }

  private attachFollowersInterception(
    page: Page,
    addShared: (u: { fb_id: string; name: string; profile_url: string }) => void,
  ): () => void {
    const handler = async (resp: { url(): string; status(): number; text(): Promise<string> }): Promise<void> => {
      if (!resp.url().includes("graphql") || resp.status() !== 200) return;
      try {
        const text = await resp.text();
        for (const u of parseGroupUsersFromGraphQL(text)) {
          addShared({ fb_id: u.fb_id, name: u.name, profile_url: u.profile_url });
        }
      } catch {
        /* response body unavailable */
      }
    };
    page.on("response", handler as never);
    return () => page.off("response", handler as never);
  }

  private async humanScrollStep(page: Page): Promise<void> {
    try {
      await page.evaluate(() => {
        // Prefer the followers dialog's own scrollable when present.
        const sel = 'a[href*="/followers"], a[href*="profile.php?id="], div[role="dialog"]';
        let bestEl: HTMLElement | null = null;
        let bestLinks = 0;
        for (const el of Array.from(document.querySelectorAll("div"))) {
          const htmlEl = el as HTMLElement;
          const linkCount = htmlEl.querySelectorAll(sel).length;
          if (linkCount < 2 || linkCount < bestLinks) continue;
          const style = window.getComputedStyle(htmlEl);
          if ((style.overflowY === "auto" || style.overflowY === "scroll") && htmlEl.scrollHeight > htmlEl.clientHeight + 20) {
            const rect = htmlEl.getBoundingClientRect();
            if (rect.height > 150 && rect.width > 150) {
              bestEl = htmlEl;
              bestLinks = linkCount;
            }
          }
        }
        if (bestEl) {
          bestEl.scrollTop += Math.min(bestEl.clientHeight * 0.7, 600);
        } else {
          window.scrollBy(0, 700);
        }
      });
      await page.mouse.wheel(0, 120 + Math.floor(Math.random() * 200)).catch(() => {});
    } catch {
      /* page closed */
    }
  }

  private async collectDomFollowers(
    page: Page,
    addShared: (u: { fb_id: string; name: string; profile_url: string }) => void,
  ): Promise<void> {
    try {
      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href*="facebook.com"], a[href*="profile.php?id="]')).map((a) => ({
          href: a.getAttribute("href") || "",
          text: ((a as HTMLElement).innerText || "").trim(),
        })),
      );
      for (const link of links) {
        if (link.text.length < 2) continue;
        const m = link.href.match(/profile\.php\?id=(\d{10,25})/) || link.href.match(/facebook\.com\/(\d{10,25})(?:\/|\?|$)/);
        if (!m) continue;
        const name = cleanMemberName(link.text) ?? "";
        if (!name) continue;
        addShared({ fb_id: m[1], name, profile_url: `https://www.facebook.com/profile.php?id=${m[1]}` });
      }
    } catch {
      /* page closed */
    }
  }

  private async wakeUp(page: Page): Promise<void> {
    try {
      for (let i = 0; i < 4; i++) {
        await page.mouse.move(100 + Math.random() * 1000, 100 + Math.random() * 500, { steps: 6 });
        await new Promise((r) => setTimeout(r, 150 + Math.random() * 250));
      }
      await page.evaluate(() => {
        if (document.hidden) void document.body.focus();
      });
    } catch {
      /* page closed */
    }
  }

  private computeCoverage(discovered: number): number | null {
    if (this.totalFollowersCount === null || this.totalFollowersCount <= 0) return null;
    return Math.round((discovered / this.totalFollowersCount) * 1000) / 10;
  }

  private async throttledCanceled(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastCancelCheckTs >= 5000) {
      this.lastCancelCheckTs = now;
      this.canceledCached = await this.checkCanceled();
    }
    return this.canceledCached;
  }

  private mapStopReason(coreReason: string, total: number): PageStopReason | null {
    if (coreReason === "canceled") return null;
    if (coreReason === "target_reached" || total >= this.ctx.maxResults) return "max_results_reached";
    if (coreReason === "max_duration") return "session_rate_limited";
    return "source_exhausted";
  }

  private async persistFollowersCount(count: number, source: string): Promise<void> {
    try {
      const job = await supabaseService.getJob(this.ctx.jobId);
      const existingConfig = (job.config || {}) as Record<string, unknown>;
      await supabaseService.updateJob(this.ctx.jobId, {
        config: { ...existingConfig, total_followers_count: count, total_followers_source: source },
      });
    } catch (err) {
      log.warn("PageFollowers", `persistFollowersCount failed: ${String(err)}`);
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
