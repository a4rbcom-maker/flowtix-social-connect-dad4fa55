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

/** The app's own liked-by list query, captured live (doc_id + variables + headers). */
interface LikersTemplate {
  url: string;
  docId: string;
  variables: Record<string, unknown>;
  headers: Record<string, string>;
}

/** One replayed liked-by page: parsed users + real pagination info. */
interface LikersReplayPage {
  error: boolean;
  status: number;
  users: { username: string; fullName: string; avatar: string }[];
  endCursor: string | null;
  hasNext: boolean;
}

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
    const add = (u: { username: string; fullName?: string; avatar?: string; commentText?: string; commentId?: string }): boolean => {
      if (!u.username || collected.has(u.username)) return false;
      collected.set(u.username, {
        fb_id: u.username,
        username: u.username,
        name: u.fullName || u.username,
        full_name: u.fullName || u.username,
        profile_url: `https://www.instagram.com/${u.username}/`,
        avatar_url: u.avatar || undefined,
        type: this.ctx.type,
        comment_text: u.commentText || undefined,
        comment_id: u.commentId || undefined,
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

    // 4a) Commenters: also fetch comments via GraphQL API (with full text).
    if (!this.wantLikers && !this.shouldStop) {
      const commenters = await this.fetchCommentsViaApi(shortcode);
      let cm = 0;
      for (const u of commenters) if (add(u)) { cm++; engine.addResults(1); }
      log.info("IgPostUsers", `comments API: +${cm} → ${collected.size} unique`);
      await flush();
    }

    // 4b) Engagers: fetch likers via direct GraphQL API (not DOM dialog).
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
    //    Engagers: skip entirely once the likers path already collected the
    //    full visible like list — scrolling the post only yields commenters.
    let stale = 0;
    while (
      collected.size < this.ctx.maxResults &&
      !(this.wantLikers && this.knownLikeTotal !== null && collected.size >= this.knownLikeTotal) &&
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
      total: this.knownLikeTotal,
      coverage_rate: this.computeCoverage(collected.size, this.knownLikeTotal),
      shortcode,
    });
    return { extracted: collected.size, done: true, authState: "authenticated" };
  }

  /** Fetch likers via IG's OWN liked-by GraphQL query, captured live from the
   *  web app: click the likes counter, intercept the app's request
   *  (GET /graphql/query?doc_id=…&variables={"comment_id":…,"first":48}),
   *  then replay it in-page with after=<end_cursor> until exhaustion.
   *  Live-proven 2026-08-30 (post DcqY-5Hu8Wm, 1,805 likes): 25 pages × 48
   *  unique users, has_next=true on every page.
   *  This replaces the old comments-doc_id path (8604818727118937) whose
   *  edge_liked_by / edge_media_preview_like fields are 3-12 item PREVIEWS
   *  with no real cursor — the reason engagers jobs returned 2-3 users. */
  private async fetchLikersViaApi(
    shortcode: string,
  ): Promise<{ username: string; fullName: string; avatar: string }[]> {
    void shortcode; // the captured template carries the post reference itself
    const all: { username: string; fullName: string; avatar: string }[] = [];
    const seen = new Set<string>();

    // 1) Capture the app's own liked-by query template by clicking the counter.
    const tpl = await this.captureLikersTemplate();

    // 2) Replay the captured template with real pagination.
    if (tpl) {
      const MAX_PAGES = 400;
      let after: string | null = null;
      let pages = 0;
      for (let pageIdx = 0; pageIdx < MAX_PAGES; pageIdx++) {
        const result: LikersReplayPage | null = await this.page
          .evaluate(
            `(async () => {
              const tpl = ${JSON.stringify({ url: tpl.url, docId: tpl.docId, variables: tpl.variables, headers: tpl.headers })};
              const vars = { ...tpl.variables, after: ${JSON.stringify(after)} };
              const params = new URLSearchParams({
                doc_id: tpl.docId,
                variables: JSON.stringify(vars),
                fb_api_req_friendly_name: "PolarisPostLikedByListQuery",
              });
              try {
                const res = await fetch(tpl.url + "?" + params.toString(), { credentials: "include", headers: tpl.headers });
                if (!res.ok) return { error: true, status: res.status, users: [], endCursor: null, hasNext: false };
                const body = await res.json();
                const users = [];
                let endCursor = null; let hasNext = false;
                const stack = [body];
                while (stack.length) {
                  const o = stack.pop();
                  if (!o || typeof o !== "object") continue;
                  if (typeof o.username === "string" && (o.id || o.pk) && !users.some((x) => x.username === o.username)) {
                    users.push({ username: o.username, fullName: String(o.full_name ?? ""), avatar: String(o.profile_pic_url ?? "") });
                  }
                  if (o.page_info && typeof o.page_info === "object") {
                    endCursor = o.page_info.end_cursor ?? null;
                    hasNext = !!o.page_info.has_next_page;
                  }
                  for (const v of Object.values(o)) {
                    if (v && typeof v === "object") stack.push(v);
                    else if (Array.isArray(v)) for (const it of v) stack.push(it);
                  }
                }
                return { error: false, status: 200, users, endCursor, hasNext };
              } catch (e) {
                return { error: true, status: 0, users: [], endCursor: null, hasNext: false };
              }
            })()`,
          )
          .then((r) => r as LikersReplayPage)
          .catch(() => null);

        if (!result || result.error || !result.users?.length) {
          if (result?.status === 429) log.warn("IgPostUsers", `likers template rate-limited (page ${pageIdx})`);
          else if (result?.status && result.status >= 400) log.warn("IgPostUsers", `likers template page failed (page ${pageIdx}, status ${result.status})`);
          break;
        }
        pages++;
        let added = 0;
        for (const u of result.users) {
          if (!seen.has(u.username)) { seen.add(u.username); all.push(u); added++; }
        }
        log.info("IgPostUsers", `likers page ${pageIdx}: +${added} → ${all.length} unique (hasNext=${result.hasNext})`);
        if (!result.hasNext || !result.endCursor) break;
        after = result.endCursor;
        if (this.ctx.maxResults > 0 && all.length >= this.ctx.maxResults) break;
        await this.page.waitForTimeout(1200);
      }
      log.info("IgPostUsers", `fetchLikersViaApi: ${all.length} unique from ${pages} liked-by template pages`);
    } else {
      log.warn("IgPostUsers", "liked-by template not captured — falling back to /media/{id}/likers/");
    }

    // 3) Fallback: bootstrap via the private media likers endpoint (first ~100).
    if (all.length === 0) {
      const users = await this.fetchLikersViaMediaEndpoint();
      for (const u of users) if (!seen.has(u.username)) { seen.add(u.username); all.push(u); }
      log.info("IgPostUsers", `fetchLikersViaApi: media-endpoint fallback got ${all.length}`);
    }

    return all;
  }

  /** Click the likes counter and intercept the app's own liked-by GraphQL
   *  request. Returns the template (url + doc_id + variables + the app's own
   *  headers incl. csrf/www-claim/asbd) to replay, or null when unavailable. */
  private async captureLikersTemplate(): Promise<LikersTemplate | null> {
    const box: { tpl: LikersTemplate | null } = { tpl: null };
    const handler = (req: import("playwright").Request): void => {
      try {
        if (box.tpl || !req.url().includes("/graphql/query")) return;
        const u = new URL(req.url());
        const docId = u.searchParams.get("doc_id");
        const varsRaw = u.searchParams.get("variables");
        if (!docId || !varsRaw) return;
        const variables = JSON.parse(varsRaw) as Record<string, unknown>;
        if (!("comment_id" in variables)) return; // liked-by list query shape
        const headers: Record<string, string> = {};
        for (const k of ["x-ig-app-id", "x-csrftoken", "x-web-session-id", "x-asbd-id", "x-ig-www-claim", "x-requested-with", "referer", "accept", "accept-language"]) {
          const v = req.headers()[k];
          if (v) headers[k] = v;
        }
        box.tpl = { url: `${u.origin}${u.pathname}`, docId, variables, headers };
      } catch { /* never throw */ }
    };
    this.page.on("request", handler);
    try {
      const clicked = await this.page
        .evaluate(`(() => {
          const cands = Array.from(document.querySelectorAll('a[href$="/liked_by/"], a[href*="/liked_by"], button, span, div[role="button"]'));
          for (const el of cands) {
            const t = (el.textContent || "").trim();
            if (!t || t.length >= 40 || /comment|تعليق/i.test(t)) continue;
            if (/(like|likes|إعجاب|إعجابات)/i.test(t) && /\\d/.test(t)) { el.click(); return t; }
          }
          return null;
        })()`)
        .catch(() => null);
      if (!clicked) {
        log.warn("IgPostUsers", "likes counter not found/clickable — no template capture");
        return null;
      }
      const total = this.parseIgCompactNumber(String(clicked));
      if (total && total > 0) {
        this.knownLikeTotal = total;
        this.engine?.setTotal(total);
      }
      for (let i = 0; i < 16 && !box.tpl; i++) await this.page.waitForTimeout(500);
      if (box.tpl) log.info("IgPostUsers", `likers template captured: doc_id=${box.tpl.docId} vars=${JSON.stringify(box.tpl.variables).slice(0, 90)}`);
      else log.warn("IgPostUsers", "likes counter clicked but no liked-by graphql request observed");
      return box.tpl;
    } finally {
      this.page.off("request", handler);
    }
  }

  /** Bootstrap fallback: the private media likers endpoint the liked-by view
   *  itself fires (live-verified: 200 + 100 users, NO pagination cursor).
   *  Needs the app's headers; csrf comes from the session cookie. */
  private async fetchLikersViaMediaEndpoint(): Promise<{ username: string; fullName: string; avatar: string }[]> {
    const box = await this.page
      .evaluate(`(() => {
        const m = document.documentElement.innerHTML.match(/"id":"(\\d+)_(\\d+)"/);
        const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || "";
        return m ? { mediaId: m[1], csrf } : null;
      })()`)
      .then((r) => r as { mediaId: string; csrf: string } | null)
      .catch(() => null);
    if (!box) return [];
    const result = await this.page
      .evaluate(`(async () => {
        try {
          const res = await fetch("https://www.instagram.com/api/v1/media/${box.mediaId}/likers/", {
            credentials: "include",
            headers: {
              "x-ig-app-id": "936619743392459",
              "x-csrftoken": "${box.csrf}",
              "x-requested-with": "XMLHttpRequest",
              accept: "*/*",
            },
          });
          if (!res.ok) return { error: true, status: res.status, users: [] };
          const j = await res.json();
          const raw = j.users || (j.likers && j.likers.users) || [];
          const users = raw
            .filter((u) => u && typeof u.username === "string")
            .map((u) => ({ username: u.username, fullName: String(u.full_name ?? ""), avatar: String(u.profile_pic_url ?? "") }));
          return { error: false, status: 200, users };
        } catch (e) {
          return { error: true, status: 0, users: [] };
        }
      })()`)
      .then((r) => r as { error: boolean; status: number; users: { username: string; fullName: string; avatar: string }[] })
      .catch(() => null);
    if (!result || result.error) {
      log.warn("IgPostUsers", `media likers endpoint failed (status ${result?.status ?? "?"})`);
      return [];
    }
    return result.users;
  }

  /** Fetch comments + their authors directly via IG's GraphQL API, paginated.
   *  Each row carries the commenter's @username + the comment text, so users
   *  who comment multiple times yield one row per unique username (and the
   *  first/most-recent comment text wins). For commenter-only extraction
   *  this replaces the DOM path with the same reliable API used for likers. */
  private async fetchCommentsViaApi(
    shortcode: string,
  ): Promise<{ username: string; fullName: string; avatar: string; commentText: string; commentId: string }[]> {
    const all: { username: string; fullName: string; avatar: string; commentText: string; commentId: string }[] = [];
    const seen = new Set<string>();
    let after: string | null = null;
    const MAX_PAGES = 200;

    let pageIdx: number;
    for (pageIdx = 0; pageIdx < MAX_PAGES; pageIdx++) {
      const result: {
        error?: boolean;
        status?: number;
        comments?: { id: string; text: string; username: string; fullName: string; avatar: string }[];
        endCursor?: string | null;
        hasNext?: boolean;
        total?: number | null;
        message?: string;
      } = await this.page
        .evaluate(
          async ({ shortcode, after }: { shortcode: string; after: string | null }) => {
            const variables = {
              shortcode,
              first: 50,
              after,
            };
            const params = new URLSearchParams({
              doc_id: "9361150124142511", // PolarisPostCommentsByShortcodeQuery — stable, returns comment edges with text
              variables: JSON.stringify(variables),
              fb_api_req_friendly_name: "PolarisPostCommentsByShortcodeQuery",
            });
            try {
              const res = await fetch(`https://www.instagram.com/graphql/query/?${params.toString()}`, {
                credentials: "include",
                headers: { "x-ig-app-id": "936619743392459", accept: "*/*" },
              });
              if (!res.ok) return { error: true, status: res.status };
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

              const conn = (xdt.edge_media_to_comment_thread_or_show_more_edge_or_toplined_comments
                ?? xdt.edge_media_to_parent_comment ?? xdt.edge_media_to_comment) as Record<string, unknown> | undefined;
              const edges = (conn?.edges as Array<Record<string, unknown>> | undefined) ?? [];
              const comments: { id: string; text: string; username: string; fullName: string; avatar: string }[] = [];
              for (const e of edges) {
                const n = e?.node as Record<string, unknown> | undefined;
                if (!n) continue;
                // skip the "Show more comments" placeholder
                if (n.__typename === "GraphTombstone" || n.text === "...") continue;
                const owner = n.owner as Record<string, unknown> | undefined;
                if (!owner?.username) continue;
                comments.push({
                  id: String(n.id ?? ""),
                  text: String(n.text ?? ""),
                  username: String(owner.username),
                  fullName: String(owner.full_name ?? ""),
                  avatar: String((owner.profile_pic_url as string) ?? ""),
                });
              }
              const pageInfo = conn?.page_info as Record<string, unknown> | undefined;
              return {
                comments,
                endCursor: (pageInfo?.end_cursor as string | null) ?? null,
                hasNext: !!pageInfo?.has_next_page,
                total: (conn?.count as number | null) ?? null,
              };
            } catch (e) {
              return { error: true, status: 0, message: String(e).slice(0, 100) };
            }
          },
          { shortcode, after },
        )
        .catch(() => ({ error: true, status: 0 } as const));

      if (result.error || !result.comments?.length) {
        if (result.status === 429) log.warn("IgPostUsers", `comments API rate-limited (page ${pageIdx})`);
        break;
      }
      for (const c of result.comments) {
        if (!seen.has(c.username)) {
          seen.add(c.username);
          all.push({ username: c.username, fullName: c.fullName, avatar: c.avatar, commentText: c.text, commentId: c.id });
        }
      }
      if (!result.hasNext) break;
      after = result.endCursor ?? null;
      await this.page.waitForTimeout(1200);
    }
    log.info("IgPostUsers", `fetchCommentsViaApi: got ${all.length} from ${seen.size} unique (API pages: ${Math.min(pageIdx + 1, MAX_PAGES)})`);
    return all;
  }

  private flushedCount = 0;
  private engine: IgExtractionEngine | null = null;
  private knownLikeTotal: number | null = null;

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
