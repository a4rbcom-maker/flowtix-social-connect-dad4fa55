import type { Page, Response } from "playwright";
import { logger } from "../logger.js";
import { ShardQueue } from "./orchestrator-core.js";

const log = logger;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

export interface GroupMemberUser {
  fb_id: string;
  name: string;
  profile_url: string;
}

export interface MultiSessionGroupOptions {
  maxDurationMs?: number;
  targetCount?: number;
  scrollDelayMs?: number;
  maxIdleRounds?: number;
  maxWakeUpAttempts?: number;
  /** Global stall detection: stop ALL sessions when the shared deduplicated
   *  list grows by less than stallMinGrowth users within stallWindowMs.
   *  Facebook caps the browsable members list (~1-2K in large groups); once
   *  capped, per-session idle detection is too lenient (sessions keep stealing
   *  first-discovery from each other) and scrolling only wastes time that the
   *  feed-cascade phase needs. */
  stallWindowMs?: number;
  stallMinGrowth?: number;
  /** Low-yield cutoff: when the shared list grows by less than
   *  lowYieldMinGrowth users within lowYieldWindowMs, the members list is a
   *  waste of session time (the feed cascade yields far more per minute) —
   *  stop the phase early instead of scrolling at a trickle for the full
   *  budget. */
  lowYieldWindowMs?: number;
  lowYieldMinGrowth?: number;
  onNewUsers?: (users: GroupMemberUser[]) => Promise<void> | void;
  onProgress?: (totalSeen: number, activeSessions: number, round: number) => void;
  shouldStop?: () => Promise<boolean>;
  /** Optional health signal hook — lets the caller's SessionHealthMonitor
   *  learn about session-level failures inside the members-list phase. */
  onSessionEvent?: (sessionId: string, event: "nav_failed" | "auth_failed" | "idle_exhausted") => void;
}

export interface MultiSessionGroupResult {
  totalSeen: number;
  perSession: Array<{ sessionId: string; extracted: number; rounds: number; stoppedReason: string }>;
  totalDurationMs: number;
  stoppedReason: "target_reached" | "all_idle" | "max_duration" | "canceled" | "stagnated" | "low_yield";
}

/** Hard ceiling for the members-list phase: the browsable list tops out
 *  within the first couple of minutes even in huge groups (Facebook cap), so
 *  giving it more than a few minutes just starves the feed cascade — the
 *  only source that scales past the cap. */
export const MEMBERS_PHASE_MAX_MS = 8 * 60_000;

/** Members-list phase budget: capped so the feed-cascade phase (the only way
 *  past Facebook's members-list cap) is guaranteed the lion's share of the
 *  job budget. Reserves ~65% of the remaining time (min 60s) for cascade. */
export function membersPhaseBudgetMs(remainingMs: number): number {
  const usable = Math.max(60_000, remainingMs - 60_000);
  const cascadeReserve = Math.max(60_000, Math.round(remainingMs * 0.65));
  const capped = Math.min(usable, Math.max(60_000, remainingMs - cascadeReserve), MEMBERS_PHASE_MAX_MS);
  return Math.max(60_000, capped);
}

interface SessionState {
  sessionId: string;
  page: Page;
  ownCount: number;
  pending: GroupMemberUser[];
  rounds: number;
  idleCount: number;
  wakeUpAttempts: number;
  done: boolean;
  stoppedReason: string;
  lastLongBreakRound: number;
  nextLongBreakAt: number;
  detach: (() => void) | null;
}

/**
 * Parallel multi-session group members extractor.
 * Every session scrolls /groups/{gid}/members simultaneously; GraphQL responses
 * are intercepted on each page and merged into one deduplicated shared list,
 * so N sessions discover N different pagination paths (multiplied coverage).
 */
export async function multiSessionGroupMembers(
  pages: Array<{ sessionId: string; page: Page }>,
  membersUrl: string,
  sharedUsers: GroupMemberUser[],
  seenIds: Set<string>,
  opts: MultiSessionGroupOptions = {},
): Promise<MultiSessionGroupResult> {
  const maxDurationMs = opts.maxDurationMs ?? 25 * 60 * 1000;
  const targetCount = opts.targetCount ?? 50000;
  const scrollDelayMs = opts.scrollDelayMs ?? 600;
  const maxIdleRounds = opts.maxIdleRounds ?? 15;
  const maxWakeUpAttempts = opts.maxWakeUpAttempts ?? 3;
  const stallWindowMs = opts.stallWindowMs ?? 60_000;
  const stallMinGrowth = opts.stallMinGrowth ?? 15;
  const lowYieldWindowMs = opts.lowYieldWindowMs ?? 120_000;
  const lowYieldMinGrowth = opts.lowYieldMinGrowth ?? 40;
  const startTime = Date.now();

  log.info("GroupCore", "=== parallel multi-session group members ===");
  log.info("GroupCore", `sessions=${pages.length} target=${targetCount} maxDuration=${Math.round(maxDurationMs / 60000)}min stallWindow=${Math.round(stallWindowMs / 1000)}s/${stallMinGrowth} lowYield=${Math.round(lowYieldWindowMs / 1000)}s/${lowYieldMinGrowth}`);

  let stallWindowStart = startTime;
  let stallWindowStartCount = sharedUsers.length;
  let stagnated = false;
  let lowYieldStart = startTime;
  let lowYieldStartCount = sharedUsers.length;
  let lowYield = false;

  const stalled = (): boolean => {
    if (stagnated) return true;
    if (Date.now() - stallWindowStart < stallWindowMs) return false;
    const growth = sharedUsers.length - stallWindowStartCount;
    stallWindowStart = Date.now();
    stallWindowStartCount = sharedUsers.length;
    if (growth >= stallMinGrowth) return false;
    stagnated = true;
    log.info("GroupCore", `global stall: +${growth} users in ${Math.round(stallWindowMs / 1000)}s across ${states.length} sessions — members list exhausted (Facebook browsable cap)`);
    return true;
  };

  const hitLowYield = (): boolean => {
    if (lowYield) return true;
    if (Date.now() - lowYieldStart < lowYieldWindowMs) return false;
    const growth = sharedUsers.length - lowYieldStartCount;
    lowYieldStart = Date.now();
    lowYieldStartCount = sharedUsers.length;
    if (growth >= lowYieldMinGrowth) return false;
    lowYield = true;
    log.info("GroupCore", `low-yield cutoff: +${growth} users in ${Math.round(lowYieldWindowMs / 1000)}s — switching remaining budget to the feed cascade`);
    return true;
  };

  const states: SessionState[] = pages.map((p) => ({
    sessionId: p.sessionId,
    page: p.page,
    ownCount: 0,
    pending: [],
    rounds: 0,
    idleCount: 0,
    wakeUpAttempts: 0,
    done: false,
    stoppedReason: "",
    lastLongBreakRound: 0,
    nextLongBreakAt: rand(25, 40),
    detach: null,
  }));

  const addShared = (s: SessionState, user: GroupMemberUser): void => {
    if (seenIds.has(user.fb_id)) return;
    seenIds.add(user.fb_id);
    sharedUsers.push(user);
    s.ownCount++;
    s.pending.push(user);
  };

  const flushPending = async (s: SessionState): Promise<void> => {
    if (s.pending.length === 0) return;
    const batch = s.pending;
    s.pending = [];
    if (!opts.onNewUsers) return;
    try {
      await opts.onNewUsers(batch);
    } catch (err) {
      log.warn("GroupCore", `session ${s.sessionId.slice(0, 8)}: onNewUsers failed: ${String(err).substring(0, 100)}`);
    }
  };

  for (const s of states) attachInterception(s, addShared);

  await Promise.all(
    states.map(async (s) => {
      try {
        await s.page.goto(membersUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await s.page.waitForTimeout(1500 + rand(0, 1500));
        if (s.page.url().includes("login")) {
          s.done = true;
          s.stoppedReason = "auth_failed";
          opts.onSessionEvent?.(s.sessionId, "auth_failed");
          return;
        }
        await collectDomUsers(s, addShared);
        await flushPending(s);
      } catch (err) {
        log.warn("GroupCore", `session ${s.sessionId.slice(0, 8)}: nav failed — ${String(err).substring(0, 80)}`);
        opts.onSessionEvent?.(s.sessionId, "nav_failed");
      }
    }),
  );

  const sessionLoop = async (s: SessionState): Promise<void> => {
    while (!s.done) {
      if (s.done) break;
      if (opts.shouldStop && (await opts.shouldStop())) {
        s.stoppedReason = "canceled";
        break;
      }
      if (Date.now() - startTime > maxDurationMs) {
        s.stoppedReason = "max_duration";
        break;
      }
      if (sharedUsers.length >= targetCount) {
        s.stoppedReason = "target_reached";
        break;
      }
      if (stalled()) {
        s.stoppedReason = "stagnated";
        break;
      }
      if (hitLowYield()) {
        s.stoppedReason = "low_yield";
        break;
      }

      s.rounds++;

      if (s.rounds - s.lastLongBreakRound >= s.nextLongBreakAt) {
        const breakMs = rand(8000, 20000);
        log.info("GroupCore", `session ${s.sessionId.slice(0, 8)} round ${s.rounds}: long break ${Math.round(breakMs / 1000)}s`);
        await sleep(breakMs);
        s.lastLongBreakRound = s.rounds;
        s.nextLongBreakAt = rand(25, 40);
      }

      const beforeOwn = s.ownCount;
      await scrollOnce(s.page);
      await sleep(scrollDelayMs + rand(0, Math.round(scrollDelayMs * 0.5)));
      await collectDomUsers(s, addShared);
      await flushPending(s);

      const activeCount = states.filter((x) => !x.done && x.stoppedReason === "").length + 1;
      opts.onProgress?.(sharedUsers.length, activeCount, s.rounds);

      if (s.ownCount > beforeOwn) {
        s.idleCount = 0;
        s.wakeUpAttempts = 0;
        if (s.rounds % 15 === 0) {
          log.info("GroupCore", `session ${s.sessionId.slice(0, 8)} round ${s.rounds}: total unique=${sharedUsers.length} (mine=${s.ownCount})`);
        }
      } else {
        s.idleCount++;
        if (s.idleCount >= maxIdleRounds) {
          s.wakeUpAttempts++;
          if (s.wakeUpAttempts > maxWakeUpAttempts) {
            s.stoppedReason = "idle_exhausted";
            opts.onSessionEvent?.(s.sessionId, "idle_exhausted");
            break;
          }
          log.info("GroupCore", `session ${s.sessionId.slice(0, 8)} round ${s.rounds}: idle ${s.idleCount} — wake-up attempt ${s.wakeUpAttempts}/${maxWakeUpAttempts}`);
          await wakeUp(s.page);
          await sleep(2000 + rand(0, 2000));
          await collectDomUsers(s, addShared);
          await flushPending(s);
          s.idleCount = Math.floor(maxIdleRounds / 2);
        }
      }
    }
    s.done = true;
    await flushPending(s);
  };

  await Promise.all(states.map(sessionLoop));

  for (const s of states) s.detach?.();

  const totalDurationMs = Date.now() - startTime;
  const finalCount = sharedUsers.length;

  let stoppedReason: MultiSessionGroupResult["stoppedReason"];
  if (opts.shouldStop && (await opts.shouldStop())) stoppedReason = "canceled";
  else if (finalCount >= targetCount) stoppedReason = "target_reached";
  else if (stagnated) stoppedReason = "stagnated";
  else if (lowYield) stoppedReason = "low_yield";
  else if (Date.now() - startTime > maxDurationMs) stoppedReason = "max_duration";
  else stoppedReason = "all_idle";

  log.info("GroupCore", "=== finished ===");
  log.info("GroupCore", `total unique=${finalCount} duration=${Math.round(totalDurationMs / 1000)}s reason=${stoppedReason}`);
  for (const s of states) {
    log.info("GroupCore", `  session ${s.sessionId.slice(0, 8)}: ${s.ownCount} users (${s.rounds} rounds, ${s.stoppedReason})`);
  }

  return {
    totalSeen: finalCount,
    perSession: states.map((s) => ({
      sessionId: s.sessionId,
      extracted: s.ownCount,
      rounds: s.rounds,
      stoppedReason: s.stoppedReason,
    })),
    totalDurationMs,
    stoppedReason,
  };
}

// ---------------------------------------------------------------------------
// Members-search sharding: the members-page search box accepts a name prefix
// and each prefix gets its OWN pagination window — sharding the roster by
// letter multiplies coverage far past the single-list Facebook cap.
// ---------------------------------------------------------------------------

const LATIN_SHARDS = "abcdefghijklmnopqrstuvwxyz".split("");
const ARABIC_SHARDS = ["ا", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ذ", "ر", "ز", "س", "ش", "ص", "ض", "ط", "ظ", "ع", "غ", "ف", "ق", "ك", "ل", "م", "ن", "ه", "و", "ي"];
/** Two-letter prefixes: each prefix gets its own pagination window, so
 *  "مح" and "محمد" stop competing for the same window. Multiplies shard
 *  count far past the single-letter cap while staying inside Facebook's
 *  search-box behavior. */
const ARABIC_TWO_LETTER_SHARDS = (() => {
  const out: string[] = [];
  for (const a of ARABIC_SHARDS) {
    for (const b of ARABIC_SHARDS) out.push(a + b);
  }
  return out;
})();
const LATIN_TWO_LETTER_SHARDS = (() => {
  const out: string[] = [];
  for (const a of LATIN_SHARDS) {
    for (const b of LATIN_SHARDS) out.push(a + b);
  }
  return out;
})();

export function buildSearchShards(): string[] {
  return [...ARABIC_SHARDS, ...LATIN_SHARDS];
}

/** Deep shard set: two-letter prefixes in frequency-balanced order (Arabic
 *  first — Egyptian groups are Arabic-heavy), used when coverage is still
 *  far from target after the single-letter pass. */
export function buildDeepSearchShards(): string[] {
  // Skip single-letter shards already claimed in pass 1; two-letter prefixes
  // only. Order: Arabic pairs first (Egyptian groups are Arabic-heavy).
  return [...ARABIC_TWO_LETTER_SHARDS, ...LATIN_TWO_LETTER_SHARDS];
}

export interface SearchShardOptions {
  maxDurationMs?: number;
  perShardRounds?: number;
  shards?: string[];
  onNewUsers?: (users: GroupMemberUser[]) => Promise<void> | void;
  onProgress?: (shard: string, shardsDone: number, totalSeen: number) => void;
  shouldStop?: () => Promise<boolean>;
  /** Out-param: the orchestrator reads this AFTER calling and invokes
   *  joinHook.fn({sessionId, page}) whenever another session's phase ends
   *  early (e.g. feed cascade saturated) — the session then claims shards
   *  from the same queue without duplication. */
  joinHook?: { fn: ((wp: { sessionId: string; page: Page }) => void) | null };
}

export interface SearchShardResult {
  extracted: number;
  shardsDone: number;
  stoppedReason: "done" | "max_duration" | "canceled";
}

export async function searchShardGroupMembers(
  pages: Array<{ sessionId: string; page: Page }>,
  gid: string,
  sharedUsers: GroupMemberUser[],
  seenIds: Set<string>,
  opts: SearchShardOptions = {},
): Promise<SearchShardResult> {
  const maxDurationMs = opts.maxDurationMs ?? 15 * 60_000;
  const perShardRounds = opts.perShardRounds ?? 25;
  const shards = opts.shards ?? buildSearchShards();
  const queue = new ShardQueue(shards);
  const startTime = Date.now();
  const baseCount = sharedUsers.length;
  let canceledFlag = false;
  const consecutiveFailures = new Map<string, number>();
  const searchBoxWorked = new Map<string, boolean>();

  const states: SessionState[] = pages.map((p) => ({
    sessionId: p.sessionId,
    page: p.page,
    ownCount: 0,
    pending: [],
    rounds: 0,
    idleCount: 0,
    wakeUpAttempts: 0,
    done: false,
    stoppedReason: "",
    lastLongBreakRound: 0,
    nextLongBreakAt: rand(25, 40),
    detach: null,
  }));

  const addShared = (s: SessionState, user: GroupMemberUser): void => {
    if (seenIds.has(user.fb_id)) return;
    seenIds.add(user.fb_id);
    sharedUsers.push(user);
    s.ownCount++;
    s.pending.push(user);
  };

  const flushPending = async (s?: SessionState): Promise<void> => {
    const targets = s ? [s] : states;
    for (const t of targets) {
      if (t.pending.length === 0) continue;
      const batch = t.pending;
      t.pending = [];
      if (!opts.onNewUsers) continue;
      try {
        await opts.onNewUsers(batch);
      } catch (err) {
        log.warn("GroupCore", `search shard: onNewUsers failed: ${String(err).substring(0, 100)}`);
      }
    }
  };

  for (const st of states) attachInterception(st, addShared);

  /** Late-joining sessions (e.g. a feed-cascade worker freed by saturation)
   *  are appended here and start claiming shards immediately. */
  const joinSession = (wp: { sessionId: string; page: Page }): SessionState => {
    const existing = states.find((st) => st.sessionId === wp.sessionId);
    if (existing) return existing;
    const st: SessionState = {
      sessionId: wp.sessionId,
      page: wp.page,
      ownCount: 0,
      pending: [],
      rounds: 0,
      idleCount: 0,
      wakeUpAttempts: 0,
      done: false,
      stoppedReason: "",
      lastLongBreakRound: 0,
      nextLongBreakAt: rand(25, 40),
      detach: null,
    };
    attachInterception(st, addShared);
    states.push(st);
    void shardLoop(st);
    return st;
  };

  const runShardOnPage = async (state: SessionState, shard: string): Promise<number> => {
    const before = seenIds.size;

    // The ?q= URL param does NOT filter results (proven by diagnosis) — the
    // shard must be typed into the members search box. The box uses React,
    // so the NATIVE value setter is required (plain .value= is ignored).
    const TYPE_JS = "(q) => { const inputs = Array.from(document.querySelectorAll('input[type=\"text\"], input[type=\"search\"]')); const isGlobal = (i) => (i.getAttribute(\"aria-label\") || \"\").trim().toLowerCase() === \"search facebook\"; const looks = (t) => /search group member|find a member|member.*search|بحث.*عض|عضو|أعضاء/i.test(t); const box = inputs.find((i) => !isGlobal(i) && looks((i.getAttribute(\"aria-label\") || \"\") + \" \" + (i.placeholder || \"\"))) || inputs.find((i) => !isGlobal(i) && (i.getAttribute(\"aria-label\") || \"\").toLowerCase().includes(\"search\")) || inputs.find((i) => !isGlobal(i) && (i.placeholder || \"\").toLowerCase().includes(\"search\")) || inputs.find((i) => (i.getAttribute(\"aria-label\") || \"\").includes(\"بحث\") || (i.placeholder || \"\").includes(\"بحث\")); if (!box) return false; box.focus(); if (box.select) box.select(); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, \"value\").set; setter.call(box, q); box.dispatchEvent(new Event(\"input\", { bubbles: true })); return true; }";

    // Load /members fresh only when the SPA is not yet up (first shard, or the
    // box was lost). Re-goto per shard breaks typing: React hydration races
    // the assignment and the filter silently never applies.
    const ensureMembersPage = async (): Promise<void> => {
      try {
        await state.page.goto(`https://www.facebook.com/groups/${gid}/members`, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        await state.page.waitForTimeout(2000 + rand(0, 1000));
      } catch {
        /* handled by typed check below */
      }
    };

    if (!searchBoxWorked.get(state.sessionId)) await ensureMembersPage();
    // Poll for the box: React renders it asynchronously, so a fixed wait
    // races hydration. NOTE: evaluate() treats a plain string as an
    // EXPRESSION — the function must be INVOKED inline with the shard
    // embedded (a second arg would be silently ignored).
    let typed = false;
    for (let attempt = 0; attempt < 8 && !typed; attempt++) {
      if (attempt === 4 && !searchBoxWorked.get(state.sessionId)) await ensureMembersPage();
      typed = Boolean(await state.page.evaluate(`(${TYPE_JS})(${JSON.stringify(shard)})`).catch(() => false));
      if (!typed) await state.page.waitForTimeout(1500);
    }
    if (!typed) {
      const dump = await state.page
        .evaluate("(() => ({ url: location.href, inputs: Array.from(document.querySelectorAll('input')).map((i) => (i.getAttribute(\"aria-label\") || i.placeholder || i.type || \"?\").substring(0, 40)), bodyStart: (document.body?.innerText || \"\").substring(0, 150) }))()")
        .catch(() => null);
      log.warn("GroupCore", `search shard '${shard}': members search box not found — skipping`, dump);
      return 0;
    }
    await state.page.keyboard.press("Enter").catch(() => {});
    await state.page.waitForTimeout(3500 + rand(0, 1500));
    searchBoxWorked.set(state.sessionId, true);

    for (let r = 0; r < perShardRounds; r++) {
      if (Date.now() - startTime > maxDurationMs) break;
      if (canceledFlag) break;
      await scrollOnce(state.page);
      await sleep(500 + rand(0, 400));
      await collectDomUsers(state, addShared);
      await flushPending(state);
      const gained = seenIds.size - before;
      if (r >= 6 && gained === 0) break;
      if (gained > 0 && r === perShardRounds - 1) break;
    }

    const gained = seenIds.size - before;
    return gained;
  };

  const shardLoop = async (s: SessionState): Promise<void> => {
    while (!s.done) {
      if (opts.shouldStop && (await opts.shouldStop())) {
        canceledFlag = true;
        s.stoppedReason = "canceled";
        break;
      }
      if (Date.now() - startTime > maxDurationMs) {
        s.stoppedReason = "max_duration";
        break;
      }
      const shard = queue.take();
      if (shard === null) {
        s.stoppedReason = "done";
        break;
      }
      s.rounds++;
      const gained = await runShardOnPage(s, shard).catch(() => -1);
      if (gained < 0) {
        // Page-level failure: give the session one more shard before retiring
        // it — avoids burning the whole queue on a dead browser context.
        const streak = (consecutiveFailures.get(s.sessionId) ?? 0) + 1;
        consecutiveFailures.set(s.sessionId, streak);
        if (streak >= 2) {
          s.stoppedReason = `error:${s.sessionId.slice(0, 8)}`;
          break;
        }
      } else {
        consecutiveFailures.set(s.sessionId, 0);
      }
      if (queue.claimed % 8 === 0 && gained !== 0) {
        log.info("GroupCore", `search shards: ${queue.claimed}/${queue.size} claimed, unique=${sharedUsers.length}`);
        await sleep(3000 + rand(0, 3000));
      }
      opts.onProgress?.(shard, queue.claimed, sharedUsers.length);
    }
    s.done = true;
    await flushPending(s);
  };

  // Expose the late-join hook: after this function returns, the orchestrator
  // can call joinHook.fn({sessionId, page}) to put a freed session (its
  // previous phase ended early, e.g. cascade saturation) straight onto the
  // shard queue — no duplicated shards, no idle session.
  if (opts.joinHook) opts.joinHook.fn = (wp) => void joinSession(wp);

  log.info("GroupCore", `=== members search sharding: ${queue.size} shards across ${states.length} session(s), budget=${Math.round(maxDurationMs / 60000)}min ===`);

  await Promise.all(states.map(shardLoop));

  await flushPending();
  for (const st of states) st.detach?.();

  const stoppedReason: SearchShardResult["stoppedReason"] = canceledFlag
    ? "canceled"
    : Date.now() - startTime > maxDurationMs
      ? "max_duration"
      : "done";
  log.info(
    "GroupCore",
    `search sharding finished: +${sharedUsers.length - baseCount} users from ${queue.claimed}/${queue.size} shards across ${states.length} session(s) in ${Math.round((Date.now() - startTime) / 1000)}s (${stoppedReason})`,
  );

  return { extracted: sharedUsers.length - baseCount, shardsDone: queue.claimed, stoppedReason };
}

function attachInterception(
  s: SessionState,
  addShared: (s: SessionState, user: GroupMemberUser) => void,
): void {
  const handler = async (resp: Response): Promise<void> => {
    const url = resp.url();
    if (!url.includes("graphql") || resp.status() !== 200) return;
    try {
      const text = await resp.text();
      for (const u of parseGroupUsersFromGraphQL(text)) addShared(s, u);
    } catch {
      /* response body unavailable */
    }
  };
  s.page.on("response", handler);
  s.detach = () => s.page.off("response", handler);
}

async function collectDomUsers(
  s: SessionState,
  addShared: (s: SessionState, user: GroupMemberUser) => void,
): Promise<void> {
  try {
    const links = await s.page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]')).map((a) => ({
        href: a.getAttribute("href") || "",
        text: ((a as HTMLElement).innerText || "").trim(),
      })),
    );
    for (const link of links) {
      if (link.text.length < 2) continue;
      const m =
        link.href.match(/\/groups\/\d+\/(?:user|members)\/(\d{5,25})\b/) ||
        link.href.match(/profile\.php\?id=(\d{5,25})/) ||
        link.href.match(/\/user\/(\d{5,25})\b/);
      if (!m) continue;
      addShared(s, {
        fb_id: m[1],
        name: link.text.substring(0, 200),
        profile_url: `https://www.facebook.com/profile.php?id=${m[1]}`,
      });
    }
  } catch {
    /* page closed */
  }
}

async function scrollOnce(page: Page): Promise<void> {
  try {
    const target = await page.evaluate(() => {
      const sel = 'a[href*="/user/"], a[href*="profile.php?id="], a[href*="/members/"]';
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
        const rect = bestEl.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, found: true };
      }
      return { x: window.innerWidth / 2, y: window.innerHeight / 2, found: false };
    });
    await page.mouse.move(target.x, target.y);
    await page.mouse.wheel(0, rand(120, 320));
    if (!target.found) {
      await page.evaluate(() => window.scrollBy(0, 700)).catch(() => {});
    }
  } catch {
    /* page closed */
  }
}

async function wakeUp(page: Page): Promise<void> {
  try {
    for (let i = 0; i < 4; i++) {
      await page.mouse.move(rand(100, 1100), rand(100, 600), { steps: 6 });
      await sleep(rand(150, 400));
    }
    await page.evaluate(() => {
      window.scrollBy(0, -600);
      window.dispatchEvent(new Event("focus"));
    });
    await sleep(rand(500, 1000));
    await page.keyboard.press("End").catch(() => {});
    await sleep(rand(500, 1000));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  } catch {
    /* page closed */
  }
}

/** Parse a raw Facebook GraphQL response body (with optional `for (;;);`
 *  prefix) into a deduplicated user list. Shared by the members phase and the
 *  cascade feed harvester. */
export function parseGroupUsersFromGraphQL(text: string): GroupMemberUser[] {
  const users: GroupMemberUser[] = [];
  let jsonText = text;
  const forIdx = text.indexOf("for (;;);");
  if (forIdx >= 0) jsonText = text.substring(forIdx + 9).trim();
  try {
    walkForUsers(JSON.parse(jsonText), users, 8);
  } catch {
    /* not json */
  }
  const seen = new Set<string>();
  return users.filter((u) => {
    if (seen.has(u.fb_id)) return false;
    seen.add(u.fb_id);
    return true;
  });
}

function walkForUsers(obj: any, users: GroupMemberUser[], depth: number): void {
  if (!obj || depth < 0) return;
  if (Array.isArray(obj)) {
    for (const item of obj) walkForUsers(item, users, depth - 1);
    return;
  }
  if (typeof obj !== "object") return;

  let fbId = "";
  let name = "";
  let profileUrl = "";

  const profileOwner = obj?.actions_renderer?.profile_actions?.[0]?.profile_owner;
  if (profileOwner?.id && /^\d{5,25}$/.test(String(profileOwner.id))) {
    fbId = String(profileOwner.id);
    if (profileOwner.name) name = String(profileOwner.name);
  }

  if (!fbId && obj?.id && /^\d{5,25}$/.test(String(obj.id))) fbId = String(obj.id);
  if (!name && typeof obj?.name === "string") name = obj.name;
  if (!name && typeof obj?.title?.text === "string") name = obj.title.text;
  if (!fbId && typeof obj?.url === "string") {
    const m = obj.url.match(/\/groups\/\d+\/(?:user|members)\/(\d{5,25})/) || obj.url.match(/profile\.php\?id=(\d{5,25})/);
    if (m) fbId = m[1];
  }

  if (!fbId) fbId = deepFindId(obj, 2) || "";
  if (!name) name = deepFindName(obj, 2) || "";

  if (obj?.url && typeof obj.url === "string") {
    const url = obj.url as string;
    if (url.includes("facebook.com")) {
      profileUrl = url.startsWith("http") ? url : `https://www.facebook.com${url}`;
    }
  }
  if (!profileUrl && fbId) profileUrl = `https://www.facebook.com/profile.php?id=${fbId}`;

  if (fbId && name && name.trim().length >= 2) {
    users.push({ fb_id: fbId, name: name.trim().substring(0, 200), profile_url: profileUrl });
    return;
  }

  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === "object" && obj[key] !== null) {
      walkForUsers(obj[key], users, depth - 1);
    }
  }
}

function deepFindId(obj: any, depth: number): string | null {
  if (!obj || depth < 0) return null;
  if (typeof obj === "string") return /^\d{5,25}$/.test(obj) ? obj : null;
  if (typeof obj !== "object") return null;
  for (const f of ["id", "uid", "user_id", "profile_id", "pk", "account_id"]) {
    const v = obj[f];
    if (v && typeof v === "string" && /^\d{5,25}$/.test(v)) return v;
  }
  for (const key of Object.keys(obj)) {
    const found = deepFindId(obj[key], depth - 1);
    if (found) return found;
  }
  return null;
}

function deepFindName(obj: any, depth: number): string | null {
  if (!obj || depth < 0 || typeof obj !== "object") return null;
  for (const f of ["name", "full_name", "display_name", "text"]) {
    const v = obj[f];
    if (typeof v === "string" && v.trim().length >= 2 && v.trim().length <= 100) return v.trim();
  }
  for (const key of Object.keys(obj)) {
    const found = deepFindName(obj[key], depth - 1);
    if (found) return found;
  }
  return null;
}
