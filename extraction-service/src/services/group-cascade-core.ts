import type { Page, Response } from "playwright";
import { logger } from "../logger.js";
import { config } from "../config.js";
import { parseGroupUsersFromGraphQL } from "./group-members-core.js";
import { LeasedTaskQueue } from "./task-queue.js";
import { SessionHealthMonitor, classifyFailure } from "./session-health.js";

const log = logger;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

export interface CascadeUser {
  fb_id: string;
  name: string;
  profile_url: string;
}

export interface CascadeEngagersResult {
  reactors: Array<{ id: string; name: string; url: string }>;
  commenters: Array<{ id: string; name: string; url: string }>;
}

export type ExtractEngagersFn = (page: Page, permalink: string) => Promise<CascadeEngagersResult>;

export interface CascadeWorkerPage {
  sessionId: string;
  page: Page;
}

export interface GroupCascadeOptions {
  feedUrl: string;
  /** Dedicated page scrolling the group feed for post permalinks. Kept
   *  separate from worker pages so the workers start consuming the post
   *  queue IMMEDIATELY instead of idling through the discovery phase. */
  discoveryPage: CascadeWorkerPage;
  /** Worker pages that start consuming the post queue right away. */
  pages: CascadeWorkerPage[];
  /** Pages that join the worker pool later (e.g. the members-list page once
   *  its phase ends). Resolving to [] simply adds nothing. */
  latePages?: Promise<CascadeWorkerPage[]>;
  targetCount: number;
  maxDurationMs: number;
  maxPosts?: number;
  /** Hard cap on the INITIAL feed-discovery phase (the discovery page joins
   *  the worker pool as soon as discovery finishes). */
  maxDiscoveryMs?: number;
  /** Stop EVERYTHING when no new user has been extracted for this long —
   *  the group's active core is saturated and further posts are pure waste
   *  (measured jobs spent their final 15+ minutes extracting 0 new users). */
  saturationMs?: number;
  /** Users already discovered by earlier phases (members list) — the cascade
   *  starts fully saturated against them: no reprocessing, and the
   *  saturation signal stays honest across phases. */
  seenIds?: Set<string>;
  extractEngagers: ExtractEngagersFn;
  onNewUsers: (users: CascadeUser[]) => Promise<number>;
  onProgress?: (info: {
    extracted: number;
    postsDone: number;
    postsKnown: number;
    activeWorkers: number;
    ratePerMin: number;
    queuePending?: number;
    deadLettered?: number;
    sessionHealth?: Array<{ session_id: string; state: string; failures: number; last_failure_kind?: string }>;
  }) => void;
  shouldStop?: () => Promise<boolean>;
}

export interface GroupCascadeResult {
  extracted: number;
  postsDiscovered: number;
  postsProcessed: number;
  stoppedReason: "target_reached" | "posts_exhausted" | "max_duration" | "canceled" | "saturated";
}

/** Scroll session limits for feed discovery. Facebook's feed lazy-loads
 *  slowly (even more with resource blocking), so a "no new links" streak
 *  must be tolerated for a long while before the feed is considered
 *  genuinely bottomed out — one-shot discovery with a short fuse was
 *  capping real groups at 30-60 posts out of the allowed maxPosts. */
const DISCOVERY_STAGNANT_ROUNDS = 25;
/** Cooldown between rediscovery sessions so a fully exhausted feed does not
 *  get re-navigated in a hot loop. */
const REDISCOVER_COOLDOWN_MS = 30_000;

/**
 * Group feed cascade: after the members list is exhausted (Facebook caps it),
 * everyone who posted / commented / reacted in the group is still a member —
 * and reachable. A dedicated discovery page scrolls the group feed collecting
 * post permalinks (DOM links + post ids parsed straight from the streamed
 * GroupFeed GraphQL responses) while every other session processes the shared
 * post queue in parallel from the very first permalink. When the queue drains
 * and time/budget remain, a worker re-scrolls the feed (rediscovery) — post
 * production is continuous, never one-shot. Extra pages (e.g. the
 * members-list session) join the worker pool dynamically via `latePages`.
 */
export async function runGroupCascade(opts: GroupCascadeOptions): Promise<GroupCascadeResult> {
  const maxPosts = opts.maxPosts ?? 400;
  const saturationMs = opts.saturationMs ?? 240_000;
  const startTime = Date.now();
  const deadline = startTime + opts.maxDurationMs;
  const discoveryDeadline = startTime + Math.min(opts.maxDiscoveryMs ?? 300_000, opts.maxDurationMs);
  const gid = opts.feedUrl.match(/groups\/([^/?#]+)/)?.[1] ?? "";

  log.info("GroupCascade", "=== feed cascade starting ===");
  log.info(
    "GroupCascade",
    `discovery=1 immediateWorkers=${opts.pages.length}${opts.latePages ? " latePages=yes" : ""} target=+${opts.targetCount} maxPosts=${maxPosts} budget=${Math.round(opts.maxDurationMs / 60000)}min saturation=${Math.round(saturationMs / 1000)}s`,
  );

  const seenIds = opts.seenIds ?? new Set<string>();
  const postQueue = new LeasedTaskQueue<string>(config.taskLeaseMs, config.taskMaxRetries);
  const health = new SessionHealthMonitor();
  for (const wp of [opts.discoveryPage, ...opts.pages]) health.register(wp.sessionId);
  if (opts.latePages) {
    void opts.latePages.then((pages) => {
      for (const p of pages ?? []) health.register(p.sessionId);
    }).catch(() => {});
  }
  const queuedPosts = new Set<string>();
  let discoveryDone = false;
  let lateSettled = !opts.latePages;
  let canceled = false;
  let saturated = false;
  let postsDone = 0;
  let failures = 0;
  let extracted = 0;
  let lastCancelCheck = 0;
  let lastNewUserAt = Date.now();
  let rateWindowStart = Date.now();
  let rateWindowStartCount = 0;
  let finished = false;
  let rediscovering = false;
  let nextRediscoverAt = 0;

  const canceledNow = async (): Promise<boolean> => {
    if (!opts.shouldStop) return false;
    const now = Date.now();
    if (now - lastCancelCheck <= 5000) return canceled;
    lastCancelCheck = now;
    canceled = canceled || (await opts.shouldStop().catch(() => false));
    return canceled;
  };

  const checkSaturated = (): boolean => {
    if (saturated) return true;
    if (Date.now() - lastNewUserAt >= saturationMs) {
      saturated = true;
      log.info(
        "GroupCascade",
        `saturation breaker: 0 new users in ${Math.round((Date.now() - lastNewUserAt) / 1000)}s — group active core exhausted, stopping all workers`,
      );
    }
    return saturated;
  };

  const ratePerMin = (): number => {
    const now = Date.now();
    const elapsedMs = now - rateWindowStart;
    if (elapsedMs >= 60_000) {
      const rate = Math.round(((extracted - rateWindowStartCount) / elapsedMs) * 60_000);
      rateWindowStart = now;
      rateWindowStartCount = extracted;
      return rate;
    }
    return elapsedMs > 5_000 ? Math.round(((extracted - rateWindowStartCount) / elapsedMs) * 60_000) : 0;
  };

  const addUsers = (users: Array<{ id: string; name: string; url: string }>): CascadeUser[] => {
    const fresh: CascadeUser[] = [];
    for (const u of users) {
      if (!u || !u.id || seenIds.has(u.id)) continue;
      if (!u.name || u.name.trim().length < 2) continue;
      seenIds.add(u.id);
      fresh.push({
        fb_id: u.id,
        name: u.name.trim().substring(0, 200),
        profile_url: u.url && u.url.includes("facebook.com") ? u.url : `https://www.facebook.com/profile.php?id=${u.id}`,
      });
    }
    if (fresh.length > 0) lastNewUserAt = Date.now();
    return fresh;
  };

  const queuePost = (permalink: string): void => {
    if (queuedPosts.has(permalink) || queuedPosts.size >= maxPosts) return;
    queuedPosts.add(permalink);
    postQueue.enqueue([permalink]);
  };

  // ---- Feed harvest & scroll ----------------------------------------------
  // GroupFeed GraphQL responses streamed while scrolling carry post actors,
  // top commenters AND post ids far beyond the viewport — harvest users and
  // permalinks from them, not just from DOM links.
  const attachHarvest = (page: Page): { detach: () => void; flush: () => Promise<void> } => {
    const harvested: CascadeUser[] = [];

    const handler = async (resp: Response): Promise<void> => {
      const url = resp.url();
      if (!url.includes("graphql") || resp.status() !== 200) return;
      try {
        const text = await resp.text();
        for (const u of parseGroupUsersFromGraphQL(text)) {
          const fresh = addUsers([{ id: u.fb_id, name: u.name, url: u.profile_url }]);
          if (fresh.length > 0) harvested.push(...fresh);
        }
        if (gid && text.includes(gid)) {
          for (const m of text.matchAll(/pfbid([A-Za-z0-9_-]{8,})/g)) {
            queuePost(`https://www.facebook.com/groups/${gid}/posts/pfbid${m[1]}`);
          }
          for (const m of text.matchAll(/"post_id":"(\d{10,})"/g)) {
            queuePost(`https://www.facebook.com/groups/${gid}/posts/${m[1]}`);
          }
        }
      } catch {
        /* response body unavailable */
      }
    };

    const flush = async (): Promise<void> => {
      if (harvested.length === 0) return;
      const batch = harvested.splice(0, harvested.length);
      try {
        const persisted = await opts.onNewUsers(batch);
        extracted += persisted;
      } catch (err) {
        log.debug("GroupCascade", `harvest persist failed: ${String(err).substring(0, 80)}`);
      }
    };

    page.on("response", handler);
    return { detach: () => page.off("response", handler), flush };
  };

  /** Scroll a feed page collecting permalinks + harvested users. Stops on
   *  cancel/saturation/deadline/maxPosts, a long stagnant streak, or once
   *  the workers have a meaningful backlog (producer backpressure). */
  const scrollRounds = async (
    page: Page,
    label: "discovery" | "rediscovery",
    flush: () => Promise<void>,
  ): Promise<void> => {
    let stagnantRounds = 0;
    let lastCount = -1;

    for (let round = 0; round < 400; round++) {
      if (await canceledNow()) return;
      if (checkSaturated()) return;
      if (queuedPosts.size >= maxPosts || Date.now() >= deadline) return;
      if (label === "discovery" && Date.now() >= discoveryDeadline) return;
      if (postQueue.pending() >= 10) return;

      try {
        const links = await page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href*="/posts/"], a[href*="permalink"], a[href*="story_fbid"]')).map(
            (a) => a.getAttribute("href") || "",
          ),
        );
        let added = 0;
        for (const href of links) {
          const permalink = normalizePermalink(href, opts.feedUrl);
          if (permalink) {
            const before = queuedPosts.size;
            queuePost(permalink);
            if (queuedPosts.size > before) added++;
          }
        }
        if (added === 0 && queuedPosts.size === lastCount) stagnantRounds++;
        else stagnantRounds = 0;
        lastCount = queuedPosts.size;

        await flush();
        opts.onProgress?.({
          extracted,
          postsDone,
          postsKnown: queuedPosts.size,
          activeWorkers: activeWorkerSessions.size,
          ratePerMin: ratePerMin(),
        });

        await page.evaluate(() => window.scrollBy(0, 1500));
        if (round % 6 === 5) await page.keyboard?.press("End").catch(() => {});
        await sleep(900 + rand(0, 600));
        if (stagnantRounds >= DISCOVERY_STAGNANT_ROUNDS) return;
      } catch {
        return;
      }
    }
  };

  const canRediscover = (): boolean =>
    queuedPosts.size < maxPosts &&
    extracted < opts.targetCount &&
    Date.now() < deadline - 30_000 &&
    !saturated &&
    !canceled;

  /** Re-scroll the group feed on the claiming worker's own page when the
   *  post queue drains but time/budget remain — post production is
   *  continuous, never one-shot. Each pass rotates to a different feed
   *  surface (ranked → chronological) so re-scrolls actually surface NEW
   *  posts instead of re-reading the same ranked set. */
  const FEED_VARIANTS = ["", "?sorting_setting=CHRONOLOGICAL"];
  let rediscoverVariant = 0;
  const runRediscovery = async (page: Page): Promise<void> => {
    const variant = FEED_VARIANTS[rediscoverVariant % FEED_VARIANTS.length];
    rediscoverVariant++;
    log.info("GroupCascade", `post queue drained — re-scrolling group feed${variant ? " (chronological)" : ""} for more posts (have ${queuedPosts.size}/${maxPosts})`);
    const { detach, flush } = attachHarvest(page);
    try {
      await page.goto(opts.feedUrl + variant, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000 + rand(0, 1000));
      await scrollRounds(page, "rediscovery", flush);
      await flush();
    } finally {
      detach();
    }
  };

  // ---- Dynamic worker pool -------------------------------------------------
  const activeWorkerSessions = new Set<string>();
  let pendingWorkers = 0;
  let resolveWorkersIdle: () => void = () => {};
  const workersIdle = new Promise<void>((res) => {
    resolveWorkersIdle = res;
  });

  const spawnWorker = (wp: CascadeWorkerPage): void => {
    if (finished || canceled || activeWorkerSessions.has(wp.sessionId)) return;
    activeWorkerSessions.add(wp.sessionId);
    pendingWorkers++;
    void worker(wp).finally(() => {
      pendingWorkers--;
      if (pendingWorkers === 0) resolveWorkersIdle();
    });
  };

  const worker = async (wp: CascadeWorkerPage): Promise<void> => {
    let consecutiveErrors = 0;
    let workerCancelCheck = 0;

    while (true) {
      if (extracted >= opts.targetCount) return;
      if (Date.now() >= deadline) return;
      if (checkSaturated()) return;
      if (canceled) return;

      const now = Date.now();
      if (now - workerCancelCheck > 5000) {
        workerCancelCheck = now;
        if (await canceledNow()) return;
      }

      const leased = postQueue.claim(wp.sessionId);
      if (!leased) {
        if (discoveryDone && lateSettled) {
          if (!canRediscover()) return;
          if (!rediscovering && Date.now() >= nextRediscoverAt) {
            rediscovering = true;
            try {
              await runRediscovery(wp.page);
            } finally {
              rediscovering = false;
              nextRediscoverAt = Date.now() + REDISCOVER_COOLDOWN_MS;
            }
            continue;
          }
        }
        await sleep(600);
        continue;
      }

      const permalink = leased.task;
      try {
        const res = await opts.extractEngagers(wp.page, permalink);
        postQueue.complete(leased.id);
        health.recordSuccess(wp.sessionId);
        consecutiveErrors = 0;
        const fresh = [...addUsers(res.reactors), ...addUsers(res.commenters)];
        if (fresh.length > 0) {
          const persisted = await opts.onNewUsers(fresh);
          extracted += persisted;
        }
      } catch (err) {
        failures++;
        consecutiveErrors++;
        const info = classifyFailure(err);
        health.recordFailure(wp.sessionId, info);
        postQueue.fail(leased.id);
        log.warn("GroupCascade", `worker ${wp.sessionId.slice(0, 8)} post failed (${info.kind}): ${info.detail.substring(0, 100)}`);
        if (!health.available(wp.sessionId)) {
          log.warn("GroupCascade", `worker ${wp.sessionId.slice(0, 8)} UNAVAILABLE (${health.lastFailure(wp.sessionId)?.kind}) — removing from pool after ${consecutiveErrors} consecutive errors`);
          return;
        }
        if (consecutiveErrors >= 8) {
          log.warn("GroupCascade", `worker ${wp.sessionId.slice(0, 8)} stopping after 8 consecutive errors`);
          return;
        }
        await sleep(health.backoffMs(wp.sessionId, consecutiveErrors));
      }

      postsDone++;
      opts.onProgress?.({
        extracted,
        postsDone,
        postsKnown: queuedPosts.size,
        activeWorkers: activeWorkerSessions.size,
        ratePerMin: ratePerMin(),
        queuePending: postQueue.pending(),
        deadLettered: postQueue.deadLetters().length,
        sessionHealth: health.snapshot(),
      });
      if (postsDone % 15 === 0) {
        log.info("GroupCascade", `posts ${postsDone}/${queuedPosts.size} → +${extracted} users so far (${failures} failed, ${activeWorkerSessions.size} workers)`);
        // Human-like rest: bursts of ~15 posts then a 15-30s pause — the old
        // 5s-every-20-posts cadence tripped Facebook's automation heuristics
        // and got accounts force-logged-out.
        await sleep(15000 + rand(0, 15000));
      }
      await sleep(1200 + rand(0, 1800));
    }
  };

  // ---- Discovery producer --------------------------------------------------
  const discovery = (async () => {
    const page = opts.discoveryPage.page;
    const { detach, flush } = attachHarvest(page);
    try {
      await page.goto(opts.feedUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000 + rand(0, 1500));
    } catch (err) {
      log.warn("GroupCascade", `feed nav failed — ${String(err).substring(0, 100)}`);
      detach();
      discoveryDone = true;
      return;
    }
    await scrollRounds(page, "discovery", flush);
    await flush();
    detach();
    discoveryDone = true;
    const reason = queuedPosts.size < maxPosts && Date.now() >= discoveryDeadline ? "discovery_cap" : "done";
    log.info("GroupCascade", `initial discovery done: ${queuedPosts.size} posts, +${extracted} users harvested from feed (reason=${reason})`);
  })();

  // Start the immediate workers right away — the post queue fills as
  // discovery scrolls; no idle waiting for the discovery phase to finish.
  for (const p of opts.pages) spawnWorker(p);

  // When discovery finishes, its page becomes one more worker.
  void discovery.then(() => spawnWorker(opts.discoveryPage));

  // Late pages (members-list session) join the pool as soon as they resolve.
  if (opts.latePages) {
    void opts.latePages.then(
      (pages) => {
        lateSettled = true;
        for (const p of pages ?? []) spawnWorker(p);
      },
      () => {
        lateSettled = true;
      },
    );
  }

  await discovery;
  if (opts.latePages) {
    // Never wait past the deadline for a late page that never arrives.
    const waitMs = Math.max(0, deadline - Date.now() + 2_000);
    await Promise.race([
      opts.latePages.catch(() => undefined),
      new Promise<void>((res) => {
        const t = setTimeout(res, waitMs);
        t.unref?.();
      }),
    ]);
  }

  if (pendingWorkers === 0) resolveWorkersIdle();
  await workersIdle;
  finished = true;

  let stoppedReason: GroupCascadeResult["stoppedReason"];
  if (canceled) stoppedReason = "canceled";
  else if (extracted >= opts.targetCount) stoppedReason = "target_reached";
  else if (saturated) stoppedReason = "saturated";
  else if (Date.now() >= deadline) stoppedReason = "max_duration";
  else stoppedReason = "posts_exhausted";

  log.info("GroupCascade", `=== cascade finished: +${extracted} users from ${postsDone}/${queuedPosts.size} posts (${failures} failed, avg ${postsDone > 0 ? Math.round((Date.now() - startTime) / postsDone / 1000) : 0}s/post) reason=${stoppedReason} ===`);

  return {
    extracted,
    postsDiscovered: queuedPosts.size,
    postsProcessed: postsDone,
    stoppedReason,
  };
}

function normalizePermalink(href: string, feedUrl: string): string | null {
  let url = href;
  if (!url) return null;
  if (url.startsWith("/")) url = `https://www.facebook.com${url}`;
  if (!url.includes("facebook.com")) return null;

  const m =
    url.match(/\/groups\/([^/?#]+)\/posts\/(pfbid[a-zA-Z0-9_-]+|\d{5,25})/) ||
    url.match(/\/groups\/([^/?#]+)\/permalink\/(\d{5,25})/) ||
    url.match(/story_fbid=(pfbid[a-zA-Z0-9_-]+|\d{5,25})/) ||
    url.match(/\/(share\/[pv]\/[a-zA-Z0-9_-]+)/) ||
    url.match(/\/posts\/(pfbid[a-zA-Z0-9_-]+|\d{5,25})/) ||
    url.match(/\/(reel\/\d{5,25})/) ||
    url.match(/\/(videos\/\d{5,25})/);

  if (!m) return null;

  if (m[0].includes("/groups/")) {
    return `https://www.facebook.com/groups/${m[1]}/posts/${m[2]}`;
  }
  if (m[0].includes("story_fbid")) {
    const groupMatch = url.match(/id=(\d{5,25})/);
    if (groupMatch) return `https://www.facebook.com/permalink.php?story_fbid=${m[1]}&id=${groupMatch[1]}`;
    return null;
  }
  return `https://www.facebook.com/${m[1]}`;
}
