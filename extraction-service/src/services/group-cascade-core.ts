import type { Page } from "playwright";
import { logger } from "../logger.js";

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

export interface GroupCascadeOptions {
  feedUrl: string;
  pages: Array<{ sessionId: string; page: Page }>;
  targetCount: number;
  maxDurationMs: number;
  maxPosts?: number;
  /** Hard cap on the feed-discovery phase. Worker 0 shares the discovery
   *  page and sits idle until it finishes — without a cap, deep feeds can
   *  monopolize it for many minutes while the other workers chew the queue. */
  maxDiscoveryMs?: number;
  extractEngagers: ExtractEngagersFn;
  onNewUsers: (users: CascadeUser[]) => Promise<number>;
  onProgress?: (info: { totalSeen: number; postsDone: number; postsKnown: number; activeWorkers: number }) => void;
  shouldStop?: () => Promise<boolean>;
}

export interface GroupCascadeResult {
  extracted: number;
  postsDiscovered: number;
  postsProcessed: number;
  stoppedReason: "target_reached" | "posts_exhausted" | "max_duration" | "canceled";
}

/**
 * Group feed cascade: after the members list is exhausted (Facebook caps it),
 * everyone who posted / commented / reacted in the group is still a member —
 * and reachable. Discovery scrolls the group feed collecting post permalinks
 * (DOM links + GraphQL post ids) while one worker per session extracts
 * reactors + commenters from each post, merged into one deduplicated set.
 */
export async function runGroupCascade(opts: GroupCascadeOptions): Promise<GroupCascadeResult> {
  const maxPosts = opts.maxPosts ?? 400;
  const startTime = Date.now();
  const deadline = startTime + opts.maxDurationMs;
  const discoveryDeadline = startTime + Math.min(opts.maxDiscoveryMs ?? 300_000, opts.maxDurationMs);

  log.info("GroupCascade", "=== feed cascade starting ===");
  log.info("GroupCascade", `sessions=${opts.pages.length} target=+${opts.targetCount} maxPosts=${maxPosts} budget=${Math.round(opts.maxDurationMs / 60000)}min discoveryCap=${Math.round((discoveryDeadline - startTime) / 1000)}s`);

  const seenIds = new Set<string>();
  const postQueue: string[] = [];
  const queuedPosts = new Set<string>();
  let discoveryDone = false;
  let postsDone = 0;
  let failures = 0;
  let extracted = 0;
  let nextIdx = 0;
  let lastCancelCheck = 0;

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
    return fresh;
  };

  const queuePost = (permalink: string): void => {
    if (queuedPosts.has(permalink) || queuedPosts.size >= maxPosts) return;
    queuedPosts.add(permalink);
    postQueue.push(permalink);
  };

  let discoveryStopped = "done";

  // Discovery producer: scroll the group feed collecting post permalinks.
  const discovery = (async () => {
    const page = opts.pages[0].page;
    try {
      await page.goto(opts.feedUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000 + rand(0, 1500));
    } catch (err) {
      log.warn("GroupCascade", `feed nav failed — ${String(err).substring(0, 100)}`);
      discoveryDone = true;
      return;
    }

    let lastCount = -1;
    let stagnantRounds = 0;

    while (
      queuedPosts.size < maxPosts &&
      stagnantRounds < 12 &&
      Date.now() < discoveryDeadline &&
      extracted < opts.targetCount
    ) {
      if (opts.shouldStop) {
        const now = Date.now();
        if (now - lastCancelCheck > 5000) {
          lastCancelCheck = now;
          if (await opts.shouldStop()) {
            discoveryStopped = "canceled";
            break;
          }
        }
      }

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

        await page.evaluate(() => window.scrollBy(0, 900));
        await sleep(900 + rand(0, 600));
      } catch {
        break;
      }
    }
    discoveryDone = true;
    if (queuedPosts.size < maxPosts && stagnantRounds < 12 && Date.now() >= discoveryDeadline) {
      discoveryStopped = "discovery_cap";
    }
    log.info("GroupCascade", `discovery done: ${queuedPosts.size} posts (reason=${discoveryStopped}, stagnant=${stagnantRounds})`);
  })();

  // Workers: one per session page, processing the shared post queue.
  const worker = async (workerPage: { sessionId: string; page: Page }, isFirst: boolean): Promise<void> => {
    if (isFirst) {
      // worker 0 shares the discovery page — wait until discovery finishes
      while (!discoveryDone) await sleep(500);
    }
    let consecutiveErrors = 0;

    while (true) {
      if (extracted >= opts.targetCount) return;
      if (Date.now() >= deadline) return;

      const idx = nextIdx;
      nextIdx++;
      if (idx >= postQueue.length) {
        if (discoveryDone) return;
        nextIdx = idx;
        await sleep(600);
        continue;
      }

      const permalink = postQueue[idx];
      try {
        const res = await opts.extractEngagers(workerPage.page, permalink);
        consecutiveErrors = 0;
        const fresh = [...addUsers(res.reactors), ...addUsers(res.commenters)];
        if (fresh.length > 0) {
          const persisted = await opts.onNewUsers(fresh);
          extracted += persisted;
        }
      } catch (err) {
        failures++;
        consecutiveErrors++;
        log.debug("GroupCascade", `post failed (${permalink.substring(0, 70)}): ${String(err).substring(0, 80)}`);
        if (consecutiveErrors >= 5) {
          log.warn("GroupCascade", `worker ${workerPage.sessionId.slice(0, 8)} stopping after 5 consecutive errors`);
          return;
        }
      }

      postsDone++;
      opts.onProgress?.({ totalSeen: extracted, postsDone, postsKnown: queuedPosts.size, activeWorkers: opts.pages.length });
      if (postsDone % 20 === 0) {
        log.info("GroupCascade", `posts ${postsDone}/${queuedPosts.size} → +${extracted} users so far`);
        await sleep(5000);
      }
      await sleep(300 + rand(0, 500));
    }
  };

  await Promise.all([discovery, ...opts.pages.map((p, i) => worker(p, i === 0))]);

  let stoppedReason: GroupCascadeResult["stoppedReason"];
  if (opts.shouldStop && (await opts.shouldStop().catch(() => false))) stoppedReason = "canceled";
  else if (extracted >= opts.targetCount) stoppedReason = "target_reached";
  else if (Date.now() >= deadline) stoppedReason = "max_duration";
  else stoppedReason = "posts_exhausted";

  log.info("GroupCascade", `=== cascade finished: +${extracted} users from ${postsDone}/${queuedPosts.size} posts (${failures} failed) reason=${stoppedReason} ===`);

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
