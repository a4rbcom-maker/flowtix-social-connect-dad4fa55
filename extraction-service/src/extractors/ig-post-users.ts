/** ig_post_commenters + ig_post_engagers: extract users from a post's
 *  comments (comment authors) and likers. Both open the live post page,
 *  harvest the rendered DOM (comments load inline; likers via their dialog)
 *  and capture any GraphQL comment/like pages for cursor continuation.
 *
 *  Platform limits honored: private accounts' posts and restricted media
 *  simply render fewer/no sections — we take exactly what the page shows. */
import type { Page } from "playwright";
import { IgBaseExtractor } from "./ig-base.js";
import { IgExtractionEngine } from "../services/ig-engine.js";
import { IgMediaClient, usersFromPostDom } from "../services/ig-media-client.js";
import { config } from "../config.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import type { AuthState, ExtractedMember, JobContext } from "../types.js";

const log = logger;

function parsePostUrl(sourceUrl: string): string {
  const m = sourceUrl.match(/instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]+)/i);
  if (!m) throw new ExtractionError(ErrorCodes.INVALID_INPUT, "رابط منشور غير صالح. استخدم رابطاً مثل https://www.instagram.com/p/CODE/");
  return m[1];
}

export class IgPostUsersExtractor extends IgBaseExtractor {
  private readonly wantLikers: boolean;

  constructor(page: Page, ctx: JobContext, secondaryPages?: Array<{ sessionId: string; page: Page }>) {
    super(page, ctx, secondaryPages);
    this.wantLikers = ctx.type === "ig_post_engagers";
  }

  async extract(): Promise<{ extracted: number; nextCursor?: string; done: boolean; authState: AuthState }> {
    const shortcode = parsePostUrl(this.ctx.sourceUrl);
    const sessionIds = [this.ctx.sessionId, ...this.secondarySessionPages.map((s) => s.sessionId)];
    const engine = new IgExtractionEngine(
      { jobId: this.ctx.jobId, userId: this.ctx.userId, sessionIds, maxResults: this.ctx.maxResults },
      {
        sourceKey: this.wantLikers ? "post_likers" : "post_comments",
        label: `post ${shortcode}`,
        loadCheckpoint: () => null,
        saveCheckpoint: async () => {},
      },
    );
    this.engine = engine;
    engine.setPhase("extracting");
    log.info("IgPostUsers", `starting: ${shortcode} likers=${this.wantLikers}`);

    const collected = new Map<string, ExtractedMember>();
    const add = (u: { username: string; fullName?: string; avatar?: string }): boolean => {
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

    const flush = async (): Promise<void> => {
      const all = Array.from(collected.values());
      const fresh = all.slice(this.flushedCount);
      if (fresh.length >= 50) {
        try {
          const n = await this.processBatch(fresh, this.ctx.type, "instagram");
          this.flushedCount += fresh.length;
          if (n > 0) log.info("IgPostUsers", `flushed ${n}`);
        } catch (err) {
          log.warn("IgPostUsers", `flush err: ${String(err).slice(0, 100)}`);
        }
      }
      await engine.heartbeat();
    };

    // 1) Load the post; keep GraphQL listener armed for the entire session.
        const client = new IgMediaClient();
        const capture = client.armContinuousCapture(this.page);
        await this.page.goto(`${config.igBaseUrl}/p/${shortcode}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await this.page.waitForTimeout(3000);

        // 2) Click "View all N comments" / "Load more comments" / "عرض" to
        //    trigger additional GraphQL comment loads before the DOM harvest.
        for (let attempt = 0; attempt < 5; attempt++) {
          const clicked = await this.page
            .evaluate(() => {
              const btns = Array.from(document.querySelectorAll('span, div[role="button"], button, a')) as HTMLElement[];
              for (const b of btns) {
                const t = (b.textContent || "").trim();
                if (/(view all|all \d+|comments|عرض|مزيد|تحميل|load more|MORE)/i.test(t) && t.length < 60) {
                  b.click();
                  return t;
                }
              }
              return null;
            })
            .catch(() => null);
          if (!clicked) break;
          await this.page.waitForTimeout(2000);
        }

        let got = 0;

        // 3) DOM harvest of rendered comments (always works when visible).
        for (const u of await usersFromPostDom(this.page)) if (add(u)) { got++; engine.addResults(1); }
        log.info("IgPostUsers", `first batch: +${got} → ${collected.size} unique`);
        await flush();

        // 4) Engagers: also open the likers dialog and read its rows.
        if (this.wantLikers && !this.shouldStop) {
      const likers = await this.openLikersAndCollect();
      let lk = 0;
      for (const u of likers) if (add(u)) { lk++; engine.addResults(1); }
      log.info("IgPostUsers", `likers batch: +${lk} → ${collected.size} unique`);
      await flush();
    }

    // 5) Keep scrolling for long comment threads (page self-paginates).
        let stale = 0;
        while (
          collected.size < this.ctx.maxResults &&
          !this.shouldStop &&
          !(await this.checkCanceled()) &&
          stale < 15
        ) {
          const before = collected.size;
          await this.page.mouse.wheel(0, 900);
          await this.page.waitForTimeout(1700);
          for (const u of await usersFromPostDom(this.page)) if (add(u)) engine.addResults(1);
          await flush();
          if (collected.size === before) stale++;
          else stale = 0;
        }

        // 6) Stop the continuous GraphQL listener and add any users it captured
        //    across the whole session (paginated comments, likers dialog loads).
        const graphqlSnapshot = capture.stop();
        let fromGraphQL = 0;
        for (const u of graphqlSnapshot.users) if (add(u)) { fromGraphQL++; engine.addResults(1); }
        log.info("IgPostUsers", `graphql total: +${fromGraphQL} → ${collected.size} unique`);

        await this.flushRemaining(collected);
        log.info("IgPostUsers", `done: ${collected.size} unique`);
    engine.setPhase("completed");
    await engine.heartbeat(true);
    await this.updateIgProgress({
      phase: "completed",
      extracted: collected.size,
      total: null,
      coverage_rate: null,
      shortcode,
    });
    return { extracted: collected.size, done: true, authState: "authenticated" };
  }

  /** Open the "N likes" dialog and return usernames from its rows. */
    private async openLikersAndCollect(): Promise<{ username: string; fullName?: string; avatar?: string }[]> {
      const clicked = await this.page
        .evaluate(() => {
          const cands = Array.from(document.querySelectorAll(
            'a[href*="/liked_by/"], section button, button, [role="button"], span'
          )) as HTMLElement[];
          for (const el of cands) {
            const txt = (el.textContent || "").trim();
            // Match "N likes", "N إعجاب", "N others", "and N others"
            if (/(\d[\d,.]*[KkMm]?)\s*(likes?|إعجاب|others|آخرون)/i.test(txt)) {
              el.click();
              return true;
            }
          }
          return false;
        })
        .catch(() => false);
      if (!clicked) {
        log.info("IgPostUsers", `likers dialog not available (hidden likes or 1-2 likes post)`);
        return [];
      }
      await this.page.waitForTimeout(3500);

      const out: { username: string; fullName?: string; avatar?: string }[] = [];
      const seen = new Set<string>();
      let staleLikers = 0;
      let prevSize = 0;
      // Scroll inside the dialog until no new rows appear (max 30 rounds —
      // 35+ likers need more than the old fixed 6 rounds to fully load).
      for (let round = 0; round < 30 && staleLikers < 6; round++) {
        const rows = await this.page
          .evaluate(() => {
            const res: { username: string; fullName: string; avatar: string }[] = [];
            const dialog = document.querySelector('div[role="dialog"]');
            if (!dialog) return res;
            const NAV = new Set(["p", "reel", "reels", "explore", "accounts", "tags", "popular", "directory", "about", "locations", "hashtag"]);
            for (const a of dialog.querySelectorAll('a[href^="/"]')) {
              const href = a.getAttribute("href") || "";
              const m = href.match(/^\/([a-zA-Z0-9._]{1,30})\/?$/);
              if (!m || NAV.has(m[1].toLowerCase())) continue;
              const parent = a.closest("div[role='button']") || a.parentElement;
              let full = "";
              if (parent) {
                for (const s of Array.from(parent.querySelectorAll("span"))) {
                  const t = (s.textContent || "").trim();
                  if (t && t !== m[1] && t.length <= 100) { full = t; break; }
                }
              }
              res.push({ username: m[1], fullName: full, avatar: "" });
            }
            return res;
          })
          .catch(() => [] as { username: string; fullName: string; avatar: string }[]);
        for (const r of rows) {
          if (!seen.has(r.username)) {
            seen.add(r.username);
            out.push(r);
          }
        }
        if (out.length === prevSize) staleLikers++;
        else { staleLikers = 0; prevSize = out.length; }
        await this.scrollDialogCenter();
      }
      return out;
    }

  private async scrollDialogCenter(): Promise<void> {
    const box = await this.page
      .evaluate(() => {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) return null;
        const r = dialog.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })
      .catch(() => null);
    if (box && box.width > 0) await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await this.page.mouse.wheel(0, 600);
    await this.page.waitForTimeout(1200);
  }

  private flushedCount = 0;
  private engine: IgExtractionEngine | null = null;

  private async flushRemaining(collected: Map<string, ExtractedMember>): Promise<void> {
    const all = Array.from(collected.values());
    const fresh = all.slice(this.flushedCount);
    if (fresh.length === 0) return;
    try {
      const n = await this.processBatch(fresh, this.ctx.type, "instagram");
      this.flushedCount += fresh.length;
      if (n > 0) log.info("IgPostUsers", `flushed remaining ${n}`);
    } catch (err) {
      log.warn("IgPostUsers", `final flush err: ${String(err).slice(0, 100)}`);
    }
  }
}
