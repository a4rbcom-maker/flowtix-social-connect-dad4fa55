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

    // 4) Engagers: fetch likers via direct GraphQL API (not DOM dialog).
    //    This is the critical path — the "N likes" button is often hidden
    //    or unclickable in modern IG, so the old openLikersAndCollect()
    //    returned 0. The API path returns every liker with pagination.
    if (this.wantLikers && !this.shouldStop) {
      const likers = await this.fetchLikersViaApi(shortcode);
      let lk = 0;
      for (const u of likers) if (add(u)) { lk++; engine.addResults(1); }
      log.info("IgPostUsers", `likers API: +${lk} → ${collected.size} unique`);
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

  /** Fetch likers directly via IG's GraphQL API, using the same logged-in
   *  session. IG's web UI issues a /graphql/query with the post's shortcode
   *  to paginate edge_liked_by. We replay the same query in-page.
   *  This replaces the unreliable DOM-dialog-click path (openLikersAndCollect)
   *  which often returns 0 because the "N likes" button is hidden or
   *  structurally changed by IG. */
  private async fetchLikersViaApi(
    shortcode: string,
  ): Promise<{ username: string; fullName: string; avatar: string }[]> {
    const all: { username: string; fullName: string; avatar: string }[] = [];
    const seen = new Set<string>();
    let after: string | null = null;
    const MAX_PAGES = 100;
    let pageIdx: number;

    for (pageIdx = 0; pageIdx < MAX_PAGES; pageIdx++) {
      const result: {
        error?: boolean;
        status?: number;
        users?: { username: string; fullName: string; avatar: string }[];
        endCursor?: string | null;
        hasNext?: boolean;
        total?: number | null;
        message?: string;
      } = await this.page
        .evaluate(
          async ({ shortcode, after }: { shortcode: string; after: string | null }) => {
            const variables = {
              shortcode,
              child_comment_count: 3,
              fetch_comment_count: 40,
              parent_comment_count: 24,
              has_threaded_comments: true,
              after,
            };
            const params = new URLSearchParams({
              doc_id: "8604818727118937",
              variables: JSON.stringify(variables),
              fb_api_req_friendly_name: "PolarisPostCommentsPageQuery",
            });
            try {
              const res = await fetch(`https://www.instagram.com/graphql/query/?${params.toString()}`, {
                credentials: "include",
                headers: { "x-ig-app-id": "936619743392459", accept: "*/*" },
              });
              if (!res.ok) return { status: res.status, error: true };
              const text = await res.text();
              let body: unknown;
              try {
                body = JSON.parse(text);
              } catch {
                return { error: true, status: 0 };
              }
              const media = (body as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
              const xdt = media?.xdt_shortcode_media as Record<string, unknown> | undefined;
              if (!xdt) return { error: true, status: 0 };

              const likeEdges = (xdt.edge_liked_by as Record<string, unknown> | undefined)?.edges
                ?? (xdt.edge_media_preview_like as Record<string, unknown> | undefined)?.edges
                ?? [];

              const users: { username: string; fullName: string; avatar: string }[] = [];
              for (const e of likeEdges as Array<Record<string, unknown>>) {
                const n = e?.node as Record<string, unknown> | undefined;
                if (n?.username && typeof n.username === "string") {
                  users.push({
                    username: n.username,
                    fullName: String(n.full_name ?? ""),
                    avatar: String(n.profile_pic_url ?? ""),
                  });
                }
              }

              const pageInfo = ((xdt.edge_liked_by ?? xdt.edge_media_preview_like) as Record<string, unknown> | undefined)
                ?.page_info as Record<string, unknown> | undefined;
              return {
                users,
                endCursor: (pageInfo?.end_cursor as string | null) ?? null,
                hasNext: !!pageInfo?.has_next_page,
                total: ((xdt.edge_liked_by ?? xdt.edge_media_preview_like) as Record<string, unknown> | undefined)
                  ?.count as number | null,
              };
            } catch (e) {
              return { error: true, status: 0, message: String(e).slice(0, 100) };
            }
          },
          { shortcode, after },
        )
        .then(
          (r: {
            error?: boolean;
            status?: number;
            users?: { username: string; fullName: string; avatar: string }[];
            endCursor?: string | null;
            hasNext?: boolean;
            total?: number | null;
            message?: string;
          }) => r,
        )
        .catch(() => ({ error: true, status: 0 } as const));

      if (result.error || !result.users?.length) {
        if (result.status === 429) log.warn("IgPostUsers", `likers API rate-limited (page ${pageIdx})`);
        break;
      }
      let added = 0;
      for (const u of result.users) {
        if (!seen.has(u.username)) {
          seen.add(u.username);
          all.push(u);
          added++;
        }
      }
      if (!result.hasNext) break;
      after = result.endCursor ?? null;
      await this.page.waitForTimeout(1200);
    }
    log.info("IgPostUsers", `fetchLikersViaApi: got ${all.length} from ${seen.size} unique (API pages: ${Math.min(pageIdx + 1, MAX_PAGES)})`);
    return all;
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
