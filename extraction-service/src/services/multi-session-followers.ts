import type { Page } from "playwright";
import { logger } from "../logger.js";
import { humanScrollFollowers } from "./human-scroll-followers.js";

const log = logger;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export interface MultiSessionOptions {
  maxDurationMs?: number;
  targetCount?: number;
  onProgress?: (totalSeen: number, activeSessions: number) => void;
  shouldStop?: () => Promise<boolean>;
}

export interface MultiSessionResult {
  totalSeen: number;
  perSession: Array<{
    sessionId: string;
    extracted: number;
    rounds: number;
    stoppedReason: string;
  }>;
  totalDurationMs: number;
  stoppedReason: "target_reached" | "all_idle" | "max_duration" | "canceled";
}

/**
 * Multi-Session Parallel Followers Extractor
 *
 * Runs N sessions in PARALLEL on the same /followers/ page.
 * Each session sees a different randomized pagination path → more unique users.
 *
 * Key insight: Facebook rate-limits per ACCOUNT, not per IP.
 * 5 sessions × 300 each = ~1,500 unique (with dedup, ~1,200)
 *
 * Workflow:
 *  1. Open /followers/ in each session's page (parallel)
 *  2. Run humanScrollFollowers() on each page simultaneously
 *  3. Intercept GraphQL from ALL pages → single shared Set for dedup
 *  4. Continue until ALL sessions idle OR target reached
 */
export async function multiSessionScrollFollowers(
  pages: Array<{ sessionId: string; page: Page }>,
  sharedInterceptedUsers: { fb_id: string; name: string; profile_url: string }[],
  opts: MultiSessionOptions = {}
): Promise<MultiSessionResult> {
  const maxDurationMs = opts.maxDurationMs ?? 60 * 60 * 1000; // 1 hour default
  const targetCount = opts.targetCount ?? 50000;
  const startTime = Date.now();

  log.info("MultiSession", `========================================`);
  log.info("MultiSession", `PARALLEL MULTI-SESSION EXTRACTION`);
  log.info("MultiSession", `sessions=${pages.length} target=${targetCount} maxDuration=${Math.round(maxDurationMs / 60000)}min`);
  log.info("MultiSession", `========================================`);

  // Setup GraphQL interception on EACH page
  for (const { sessionId, page } of pages) {
    setupPageInterception(page, sharedInterceptedUsers, sessionId);
  }

  // Initial navigation on all pages (parallel) to load followers page
  log.info("MultiSession", `loading /followers/ on all ${pages.length} sessions in parallel...`);
  await Promise.all(pages.map(async ({ sessionId, page }) => {
    try {
      const followersUrl = await getFollowersUrl(page);
      await page.goto(followersUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000 + Math.random() * 2000);
      log.info("MultiSession", `session ${sessionId.slice(0, 8)}: navigated to ${followersUrl}`);
    } catch (err) {
      log.warn("MultiSession", `session ${sessionId.slice(0, 8)}: nav failed — ${String(err).substring(0, 80)}`);
    }
  }));

  // Run human scroll on each page IN PARALLEL
  const perSessionPromises = pages.map(async ({ sessionId, page }) => {
    const sessionStartCount = sharedInterceptedUsers.length;

    const result = await humanScrollFollowers(page, {
      maxRounds: 800,
      maxIdleRounds: 30,
      targetCount,
      onInterceptedCount: () => sharedInterceptedUsers.length,
      onProgress: (seen, round) => {
        const my = sharedInterceptedUsers.length - sessionStartCount;
        log.info("MultiSession", `session ${sessionId.slice(0, 8)} round ${round}: +${my} from me, ${seen} total`);
      },
      shouldStop: async () => {
        if (opts.shouldStop && await opts.shouldStop()) return true;
        if (Date.now() - startTime > maxDurationMs) return true;
        if (sharedInterceptedUsers.length >= targetCount) return true;
        return false;
      },
    });

    const myCount = sharedInterceptedUsers.length - sessionStartCount;
    log.info("MultiSession", `session ${sessionId.slice(0, 8)} DONE: ${myCount} from this session (reason=${result.stoppedReason})`);

    return {
      sessionId,
      extracted: myCount,
      rounds: result.rounds,
      stoppedReason: result.stoppedReason,
    };
  });

  // Wait for all to finish (or stop early via target/cancel)
  const perSession = await Promise.all(perSessionPromises);

  const totalDurationMs = Date.now() - startTime;
  const finalCount = sharedInterceptedUsers.length;

  let stoppedReason: MultiSessionResult["stoppedReason"];
  if (opts.shouldStop && await opts.shouldStop()) {
    stoppedReason = "canceled";
  } else if (finalCount >= targetCount) {
    stoppedReason = "target_reached";
  } else if (Date.now() - startTime > maxDurationMs) {
    stoppedReason = "max_duration";
  } else {
    stoppedReason = "all_idle";
  }

  log.info("MultiSession", `========================================`);
  log.info("MultiSession", `PARALLEL EXTRACTION FINISHED`);
  log.info("MultiSession", `total unique = ${finalCount}`);
  log.info("MultiSession", `duration = ${Math.round(totalDurationMs / 1000)}s`);
  log.info("MultiSession", `reason = ${stoppedReason}`);
  for (const s of perSession) {
    log.info("MultiSession", `  session ${s.sessionId.slice(0, 8)}: ${s.extracted} users (${s.rounds} rounds, ${s.stoppedReason})`);
  }
  log.info("MultiSession", `========================================`);

  return {
    totalSeen: finalCount,
    perSession,
    totalDurationMs,
    stoppedReason,
  };
}

/**
 * Extracts the page identifier from current URL and returns /followers/ URL.
 */
async function getFollowersUrl(page: Page): Promise<string> {
  const url = page.url();
  // strip query params and trailing slash
  const clean = url.split("?")[0].replace(/\/$/, "");
  if (clean.includes("/followers")) return clean;
  return `${clean}/followers/`;
}

/**
 * Setup GraphQL response interception on a page → pushes to shared array (dedup).
 */
function setupPageInterception(
  page: Page,
  sharedUsers: { fb_id: string; name: string; profile_url: string }[],
  _sessionId: string
): void {
  page.on("response", async (resp) => {
    if (!resp.url().includes("graphql") || resp.status() !== 200) return;
    try {
      const text = await resp.text();
      const parsed = parseUsersFromGraphQL(text);
      for (const u of parsed) {
        if (!sharedUsers.some(su => su.fb_id === u.fb_id)) {
          sharedUsers.push(u);
        }
      }
    } catch {
      /* skip */
    }
  });
}

function parseUsersFromGraphQL(text: string): Array<{ fb_id: string; name: string; profile_url: string }> {
  const users: Array<{ fb_id: string; name: string; profile_url: string }> = [];
  let jsonText = text;
  const forIdx = text.indexOf("for (;;);");
  if (forIdx >= 0) jsonText = text.substring(forIdx + 9).trim();

  try {
    const data = JSON.parse(jsonText);
    walkForUsers(data, users, 8);
  } catch {
    /* not JSON */
  }

  // dedup within this response
  const seen = new Set<string>();
  return users.filter(u => {
    if (seen.has(u.fb_id)) return false;
    seen.add(u.fb_id);
    return true;
  });
}

function walkForUsers(obj: any, users: Array<{ fb_id: string; name: string; profile_url: string }>, depth: number): void {
  if (!obj || depth < 0) return;
  if (Array.isArray(obj)) {
    for (const item of obj) walkForUsers(item, users, depth - 1);
    return;
  }
  if (typeof obj !== "object") return;

  // candidate node: has profile_owner OR has ID + name + url
  let fbId = "";
  let name = "";
  let profileUrl = "";

  const profileOwner = obj?.actions_renderer?.profile_actions?.[0]?.profile_owner;
  if (profileOwner?.id && /^\d{10,25}$/.test(String(profileOwner.id))) {
    fbId = String(profileOwner.id);
    if (profileOwner.name) name = String(profileOwner.name);
  }

  if (!fbId && obj?.id && /^\d{10,25}$/.test(String(obj.id))) fbId = String(obj.id);
  if (!name && obj?.name && typeof obj.name === "string") name = obj.name;
  if (!name && obj?.title?.text && typeof obj.title.text === "string") name = obj.title.text;
  if (!fbId && obj?.url && typeof obj.url === "string") {
    const m = obj.url.match(/profile\.php\?id=(\d{10,25})/);
    if (m) fbId = m[1];
  }

  // deep search fallback (limited)
  if (!fbId) fbId = deepFindId(obj, 2) || "";
  if (!name) name = deepFindName(obj, 2) || "";

  if (obj?.url && typeof obj.url === "string" && obj.url.includes("facebook.com")) {
    profileUrl = obj.url.startsWith("http") ? obj.url : `https://www.facebook.com${obj.url}`;
  }
  if (!profileUrl && fbId) profileUrl = `https://www.facebook.com/profile.php?id=${fbId}`;

  if (fbId && name && /^\d{10,25}$/.test(fbId) && name.trim().length >= 2) {
    users.push({ fb_id: fbId, name: name.trim().substring(0, 200), profile_url: profileUrl });
    return; // don't recurse further on identified user node
  }

  // recurse into edges/nodes
  for (const key of Object.keys(obj)) {
    if (key === "edges" || key === "nodes" || key === "users" || key === "profiles") {
      walkForUsers(obj[key], users, depth - 1);
    } else if (typeof obj[key] === "object") {
      walkForUsers(obj[key], users, depth - 1);
    }
  }
}

function deepFindId(obj: any, depth: number): string | null {
  if (!obj || depth < 0) return null;
  if (typeof obj === "string") return /^\d{10,25}$/.test(obj) ? obj : null;
  if (typeof obj !== "object") return null;
  for (const f of ["id", "uid", "user_id", "profile_id", "pk", "account_id"]) {
    const v = obj[f];
    if (v && typeof v === "string" && /^\d{10,25}$/.test(v)) return v;
    if (v && typeof v === "number" && /^\d{10,25}$/.test(String(v))) return String(v);
  }
  for (const key of Object.keys(obj)) {
    const found = deepFindId(obj[key], depth - 1);
    if (found) return found;
  }
  return null;
}

function deepFindName(obj: any, depth: number): string | null {
  if (!obj || depth < 0) return null;
  if (typeof obj !== "object") return null;
  for (const f of ["name", "full_name", "display_name", "text"]) {
    const v = obj[f];
    if (v && typeof v === "string" && v.trim().length >= 2 && v.trim().length <= 100) return v.trim();
  }
  for (const key of Object.keys(obj)) {
    const found = deepFindName(obj[key], depth - 1);
    if (found) return found;
  }
  return null;
}
