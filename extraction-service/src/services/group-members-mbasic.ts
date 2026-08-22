import type { Page } from "playwright";
import { logger } from "../logger.js";

const log = logger;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

/** mbasic rejects modern desktop User-Agents with HTTP 400 — force a mobile
 *  UA on mbasic requests for this page only (route-scoped header override). */
const MBASIC_UA =
  "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";

export interface MbasicMemberUser {
  fb_id: string;
  name: string;
  profile_url: string;
}

export interface MbasicMembersResult {
  extracted: number;
  pagesFetched: number;
  stoppedReason: "end_of_list" | "max_pages" | "max_duration" | "canceled" | "nav_failed" | "auth_failed";
}

export interface MbasicMembersOptions {
  maxPages?: number;
  maxDurationMs?: number;
  onNewUsers: (users: MbasicMemberUser[]) => Promise<void> | void;
  onProgress?: (totalSeen: number, pagesDone: number) => void;
  shouldStop?: () => Promise<boolean>;
}

/** Parse member entries out of a mbasic group-members HTML page.
 *  Exported for testing with fixtures. */
export function parseMbasicMembers(html: string): MbasicMemberUser[] {
  const users: MbasicMemberUser[] = [];
  const seen = new Set<string>();
  const linkRe = /<a\s[^>]*href="([^"]*(?:profile\.php\?id=(\d{5,25})|\/groups\/\d+\/user\/(\d{5,25}))[^"]*)"[^>]*>([^<]{2,200})<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const id = m[2] || m[3];
    const name = m[4].replace(/<[^>]+>/g, "").trim();
    if (!id || !name || seen.has(id)) continue;
    if (/^(see more|المزيد|عرض المزيد|members|الأعضاء)$/i.test(name)) continue;
    seen.add(id);
    users.push({
      fb_id: id,
      name,
      profile_url: `https://www.facebook.com/profile.php?id=${id}`,
    });
  }
  return users;
}

/** Find the next-page URL on a mbasic members page ("See More" cursor). */
export function findMbasicNextPage(html: string): string | null {
  const anchorRe = /<a\s[^>]*(?:id="m_more_[^"]*"[^>]*)?\shref="([^"]+)"[^>]*>(?:[^<]*(?:see more|المزيد|عرض المزيد)[^<]*)?<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1].replace(/&amp;/g, "&");
    if (/start=|after=|cursor/i.test(href)) {
      return href.startsWith("http") ? href : `https://mbasic.facebook.com${href}`;
    }
  }
  const cursor = html.match(/href="([^"]*(?:start|after|cursor)=[^"]*)"/i);
  if (cursor) {
    const href = cursor[1].replace(/&amp;/g, "&");
    return href.startsWith("http") ? href : `https://mbasic.facebook.com${href}`;
  }
  return null;
}

/**
 * Deep group-member enumeration via mbasic classic pagination.
 *
 * The modern UI caps the browsable members list (~1-2K in large groups) and
 * the feed cascade dries after the visible post set — mbasic's server-rendered
 * "See More" cursor walks the full member roster page by page (30-60 members
 * per page, ~1s per page), reaching far deeper than any modern-UI surface.
 */
export async function runMbasicGroupMembers(
  page: Page,
  gid: string,
  seenIds: Set<string>,
  opts: MbasicMembersOptions,
): Promise<MbasicMembersResult> {
  const maxPages = opts.maxPages ?? 1200;
  const maxDurationMs = opts.maxDurationMs ?? 20 * 60_000;
  const startTime = Date.now();

  await page.route("**mbasic.facebook.com/**", (route) =>
    route.continue({ headers: { ...route.request().headers(), "user-agent": MBASIC_UA } }),
  );

  const finish = async (extracted: number, pagesFetched: number, stoppedReason: MbasicMembersResult["stoppedReason"]) => {
    await page.unroute("**mbasic.facebook.com/**").catch(() => {});
    log.info("MbasicMembers", `done: +${extracted} users over ${pagesFetched} pages in ${Math.round((Date.now() - startTime) / 1000)}s (${stoppedReason})`);
    return { extracted, pagesFetched, stoppedReason };
  };

  let url = `https://mbasic.facebook.com/groups/${gid}/members/`;
  let extracted = 0;
  let pagesFetched = 0;

  log.info("MbasicMembers", `starting deep mbasic pagination: ${url}`);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500 + rand(0, 1000));
  } catch (err) {
    log.warn("MbasicMembers", `nav failed — ${String(err).substring(0, 100)}`);
    return finish(0, 0, "nav_failed");
  }

  if (page.url().includes("login") || page.url().includes("checkpoint")) {
    log.warn("MbasicMembers", `landed on ${page.url().substring(0, 60)} — session not usable on mbasic`);
    return finish(0, 0, "auth_failed");
  }

  let lastEmptyPages = 0;
  while (pagesFetched < maxPages && Date.now() - startTime < maxDurationMs) {
    if (opts.shouldStop && (await opts.shouldStop())) return finish(extracted, pagesFetched, "canceled");

    let html = "";
    try {
      html = await page.content();
    } catch {
      return finish(extracted, pagesFetched, "nav_failed");
    }

    const fresh: MbasicMemberUser[] = [];
    for (const u of parseMbasicMembers(html)) {
      if (seenIds.has(u.fb_id)) continue;
      seenIds.add(u.fb_id);
      fresh.push(u);
    }
    if (fresh.length > 0) {
      extracted += fresh.length;
      lastEmptyPages = 0;
      try {
        await opts.onNewUsers(fresh);
      } catch (err) {
        log.warn("MbasicMembers", `onNewUsers failed: ${String(err).substring(0, 80)}`);
      }
    } else {
      lastEmptyPages++;
    }

    pagesFetched++;
    opts.onProgress?.(seenIds.size, pagesFetched);
    if (pagesFetched % 25 === 0) {
      log.info("MbasicMembers", `page ${pagesFetched}: +${extracted} unique so far (${Math.round(extracted / Math.max(1, pagesFetched))}/page)`);
      await sleep(4000 + rand(0, 4000));
    }

    const next = findMbasicNextPage(html);
    if (!next) {
      // An empty parse with no cursor means the roster genuinely ended; a
      // page with members but no cursor is Facebook withholding pagination.
      log.info("MbasicMembers", `no next page after ${pagesFetched} pages (emptyStreak=${lastEmptyPages})`);
      return finish(extracted, pagesFetched, "end_of_list");
    }

    url = next;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await sleep(900 + rand(0, 700));
    } catch {
      return finish(extracted, pagesFetched, "nav_failed");
    }
  }

  return finish(extracted, pagesFetched, pagesFetched >= maxPages ? "max_pages" : "max_duration");
}
