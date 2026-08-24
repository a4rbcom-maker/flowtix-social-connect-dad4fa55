/** ig_hashtag_posts: extract post authors + commenters from a hashtag feed.
 *  Fast path: capture the page's own GraphQL media responses, continue via
 *  cursor replay; DOM grid links are the always-on first batch. */
import type { Page } from "playwright";
import { IgBaseExtractor } from "./ig-base.js";
import { IgExtractionEngine } from "../services/ig-engine.js";
import { IgMediaClient, postsFromHashtagDom } from "../services/ig-media-client.js";
import { config } from "../config.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import type { AuthState, ExtractedMember } from "../types.js";

const log = logger;

function parseHashtag(sourceUrl: string): string {
  const m = sourceUrl.match(/instagram\.com\/explore\/tags\/([^/?#]+)/i) || sourceUrl.match(/^#?([\p{L}\p{N}_]+)$/u);
  if (!m) throw new ExtractionError(ErrorCodes.INVALID_INPUT, "رابط هاشتاج غير صالح. استخدم رابطاً مثل https://www.instagram.com/explore/tags/مصر/ أو اسم الوسم فقط.");
  return decodeURIComponent(m[1]);
}

export class IgHashtagPostsExtractor extends IgBaseExtractor {
  async extract(): Promise<{ extracted: number; nextCursor?: string; done: boolean; authState: AuthState }> {
    const tag = parseHashtag(this.ctx.sourceUrl);
    const sessionIds = [this.ctx.sessionId, ...this.secondarySessionPages.map((s) => s.sessionId)];
    const engine = new IgExtractionEngine(
      { jobId: this.ctx.jobId, userId: this.ctx.userId, sessionIds, maxResults: this.ctx.maxResults },
      {
        sourceKey: "hashtag_media",
        label: `#${tag}`,
        loadCheckpoint: () => null,
        saveCheckpoint: async () => {},
      },
    );
    this.engine = engine;
    engine.setPhase("extracting");
    log.info("IgHashtag", `starting: #${tag} sessions=${sessionIds.length}`);

    const client = new IgMediaClient();
    const collected = new Map<string, ExtractedMember>();
    let after: string | null = this.ctx.cursor ?? null;
    let pages = 0;

    const addPostAuthor = (u: { username: string; fullName?: string; avatar?: string }): boolean => {
      if (!u.username || collected.has(u.username)) return false;
      collected.set(u.username, {
        fb_id: u.username,
        username: u.username,
        name: u.fullName || u.username,
        full_name: u.fullName || u.username,
        profile_url: `https://www.instagram.com/${u.username}/`,
        avatar_url: u.avatar || undefined,
        type: this.ctx.type,
      });
      return true;
    };

    // Arm the pagination capture, then navigate+scroll: the page fires the
    // feed template itself; once captured we replay it cursor-by-cursor at
    // API speed (verified: 12 media/page, fresh end_cursor each call).
    await client.armHashtagCapture(this.page);
    const feed = await client.captureFeedUsers(this.page, `${config.igBaseUrl}/explore/tags/${encodeURIComponent(tag)}/`, {
      scrollRounds: 6,
      maxUsers: this.ctx.maxResults,
    });
    if (feed) {
      for (const u of feed.users) if (addPostAuthor(u)) engine.addResults(1);
      after = feed.afterCursor;
    }
    client.disarmHashtagCapture(this.page);
    await this.flushRemainingHashtag(collected);

    // Fast loop: replay captured template until no next page / budget.
    let failures = 0;
    while (
      after &&
      collected.size < this.ctx.maxResults &&
      !this.shouldStop &&
      !(await this.checkCanceled())
    ) {
      const next = await client.fetchNextHashtagPage(this.page, after);
      if (!next || next.users.length === 0) {
        failures++;
        if (failures >= 3) break;
        await new Promise((r) => setTimeout(r, 2000 * failures));
        continue;
      }
      failures = 0;
      for (const u of next.users) if (addPostAuthor(u)) engine.addResults(1);
      after = next.afterCursor;
      engine.setCursor(JSON.stringify({ api: true, after }));
      log.info("IgHashtag", `api page: ${collected.size} unique so far`);
      await this.flushRemainingHashtag(collected);
      await engine.heartbeat();
      if (pages % 40 === 39) await this.restDelay();
      pages++;
    }

    log.info("IgHashtag", `done: ${collected.size} unique`);
    engine.setPhase("completed");
    await engine.heartbeat(true);
    await this.updateIgProgress({
      phase: "completed",
      extracted: collected.size,
      total: null,
      coverage_rate: null,
      tag,
    });
    return { extracted: collected.size, done: true, authState: "authenticated" };
  }

  private flushedCount = 0;
  private engine: IgExtractionEngine | null = null;

  private async flushRemainingHashtag(collected: Map<string, ExtractedMember>): Promise<void> {
    const all = Array.from(collected.values());
    const fresh = all.slice(this.flushedCount);
    if (fresh.length === 0) return;
    try {
      const n = await this.processBatch(fresh, this.ctx.type, "instagram");
      this.flushedCount += fresh.length;
      if (n > 0) log.info("IgHashtag", `flushed remaining ${n}`);
    } catch (err) {
      log.warn("IgHashtag", `final flush err: ${String(err).slice(0, 100)}`);
    }
  }
}

/** Scroll and collect AUTHOR usernames from grid cells only. A grid cell is
 *  an <a href="/p/<code>/"> whose sibling/child link points at /username/.
 *  Nav links (reels/explore) live OUTSIDE the grid — excluded by requiring
 *  a post-link ancestor cell. */
async function page_scroll_and_collect(
  page: Page,
  engine: IgExtractionEngine,
  add: (u: { username: string }) => boolean,
): Promise<void> {
  await page.mouse.wheel(0, 1100);
  await page.waitForTimeout(1700);
  const users = await page
    .evaluate(() => {
      const out: { username: string }[] = [];
      const seen = new Set<string>();
      // Every post anchor defines a grid cell; look for author links inside
      // the same cell container, or use the post's hover-overlay username.
      for (const pa of document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')) {
        let cell: Element | null = pa.closest("div");
        for (let hop = 0; hop < 4 && cell; hop++) {
          const authorLink = cell.querySelector('a[href^="/"]:not([href*="/p/"]):not([href*="/reel/"])');
          if (authorLink) {
            const m = (authorLink.getAttribute("href") || "").match(/^\/([a-zA-Z0-9._]{1,30})\/$/);
            if (m && !["explore", "accounts", "p", "reel"].includes(m[1]) && !seen.has(m[1])) {
              seen.add(m[1]);
              out.push({ username: m[1] });
            }
            break;
          }
          cell = cell.parentElement;
        }
      }
      return out;
    })
    .catch(() => []);
  for (const u of users) if (add(u)) engine.addResults(1);
}
