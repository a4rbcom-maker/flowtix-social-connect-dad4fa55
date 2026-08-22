import type { Page, Response } from "playwright";
import { logger } from "../logger.js";

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
  onNewUsers?: (users: GroupMemberUser[]) => Promise<void> | void;
  onProgress?: (totalSeen: number, activeSessions: number, round: number) => void;
  shouldStop?: () => Promise<boolean>;
}

export interface MultiSessionGroupResult {
  totalSeen: number;
  perSession: Array<{ sessionId: string; extracted: number; rounds: number; stoppedReason: string }>;
  totalDurationMs: number;
  stoppedReason: "target_reached" | "all_idle" | "max_duration" | "canceled" | "stagnated";
}

/** Members-list phase budget: capped so the feed-cascade phase (the only way
 *  past Facebook's members-list cap) is guaranteed a meaningful share of the
 *  job budget. Reserves ~45% of the remaining time (min 60s) for cascade. */
export function membersPhaseBudgetMs(remainingMs: number): number {
  const usable = Math.max(60_000, remainingMs - 60_000);
  const cascadeReserve = Math.max(60_000, Math.round(remainingMs * 0.45));
  return Math.min(usable, Math.max(60_000, remainingMs - cascadeReserve));
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
  const startTime = Date.now();

  log.info("GroupCore", "=== parallel multi-session group members ===");
  log.info("GroupCore", `sessions=${pages.length} target=${targetCount} maxDuration=${Math.round(maxDurationMs / 60000)}min stallWindow=${Math.round(stallWindowMs / 1000)}s/${stallMinGrowth}`);

  let stallWindowStart = startTime;
  let stallWindowStartCount = sharedUsers.length;
  let stagnated = false;

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
          return;
        }
        await collectDomUsers(s, addShared);
        await flushPending(s);
      } catch (err) {
        log.warn("GroupCore", `session ${s.sessionId.slice(0, 8)}: nav failed — ${String(err).substring(0, 80)}`);
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
