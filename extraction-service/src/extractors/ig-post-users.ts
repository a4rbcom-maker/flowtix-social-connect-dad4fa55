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

/** IG shortcodes are the media pk in base-64 numeric form.
 *  Live-proven 2026-08-30: "DcqY-5Hu8Wm" → 3975099496164738470, exactly the
 *  media id the app used for /api/v1/media/{id}/likers/ on that post. */
function deriveMediaPk(shortcode: string): string | null {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let pk = 0n;
  for (const ch of shortcode) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    pk = pk * 64n + BigInt(idx);
  }
  return pk > 0n ? pk.toString() : null;
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

    // 1b) Record the comment/media ids the app uses for THIS post during its
    //     own page-load graphql traffic. Suggested posts in the sidebar use
    //     different ids — this set is how we reject templates for the wrong
    //     media when several comment_id-shaped queries share the click window.
    //     Also read this post's real like count from its embedded JSON.
    this.observedCommentIds.clear();
    this.armCommentIdObserver();
    const likeTotal = await this.page
      .evaluate(`(() => {
        const m = document.documentElement.innerHTML.match(/"edge_media_preview_like":\\{"count":(\\d+)/);
        return m ? Number(m[1]) : null;
      })()`)
      .then((r) => r as number | null)
      .catch(() => null);
    if (likeTotal && likeTotal > 0) {
      this.knownLikeTotal = likeTotal;
      this.engine?.setTotal(likeTotal);
      log.info("IgPostUsers", `post like count (from embedded JSON): ${likeTotal}`);
    }

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

    // 1) Capture IG's own liked-by query template by opening THIS post's
    //    liked_by page (deterministic — no click-target guessing).
    const tpl = await this.captureLikersTemplate(shortcode);

    // 2) Replay the captured template with real pagination.
    if (tpl) {
      const MAX_PAGES = 400;
      const MAX_PAGE_RETRIES = 3; // transient 429/5xx: retry the SAME cursor before giving up
      let after: string | null = null;
      let pages = 0;
      for (let pageIdx = 0; pageIdx < MAX_PAGES; pageIdx++) {
        let result: LikersReplayPage | null = null;
        let attempt = 0;
        for (;;) {
          result = await this.page
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
          // A successful-but-empty page is a genuine end; an errored page may be transient.
          if (result && !result.error) break;
          attempt++;
          if (attempt > MAX_PAGE_RETRIES) break;
          const backoff = 3000 * attempt;
          log.warn("IgPostUsers", `likers page ${pageIdx} failed (status ${result?.status ?? "network"}) — retry ${attempt}/${MAX_PAGE_RETRIES} in ${backoff}ms`);
          await this.page.waitForTimeout(backoff);
        }

        if (!result || result.error || !result.users?.length) {
          if (result?.status === 429) log.warn("IgPostUsers", `likers template rate-limited (page ${pageIdx}) — stopping`);
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
    //    ⚠️ 2026-09-01: This is now the primary fallback for non-owned posts,
    //    as IG caps GraphQL liked-by queries at ~100 users for non-owners.
    if (all.length === 0 || all.length < 100) {
      const users = await this.fetchLikersViaMediaEndpoint();
      let added = 0;
      for (const u of users) {
        if (!seen.has(u.username)) { seen.add(u.username); all.push(u); added++; }
      }
      if (added > 0) log.info("IgPostUsers", `fetchLikersViaApi: media-endpoint fallback got ${added} (total ${all.length})`);
    }

    return all;
  }

  /** Click THIS post's likes counter (deterministically: the
   *  a[href="/p/<shortcode>/liked_by/"] anchor — NOT a text scan, which on
   *  the server landed on a suggested post's "202 likes" tile) and intercept
   *  the liked-by GraphQL request the app fires for it. Candidates whose
   *  comment_id matches ids the app used for this post are preferred;
   *  every candidate is then validated by a one-shot replay (a real liked-by
   *  response is dense username+avatar nodes with no "text" field). */
  private async captureLikersTemplate(shortcode: string): Promise<LikersTemplate | null> {
    const cands = new Map<string, LikersTemplate>();
    const parseInto = (rawUrl: string, body: string | null): void => {
      try {
        const u = new URL(rawUrl);
        if (!u.pathname.includes("/graphql/query")) return;
        // doc_id/variables arrive as URL params (GET) OR as POST form fields.
        const sp = u.searchParams;
        const form = new URLSearchParams(body || "");
        const docId = sp.get("doc_id") || form.get("doc_id");
        const varsRaw = sp.get("variables") || form.get("variables");
        if (!docId || !varsRaw) return;
        const variables = JSON.parse(varsRaw) as Record<string, unknown>;
        if (!("comment_id" in variables)) return; // liked-by / thread query shape
        if (cands.has(docId)) return;
        const headers: Record<string, string> = {};
        for (const k of ["x-ig-app-id", "x-csrftoken", "x-web-session-id", "x-asbd-id", "x-ig-www-claim", "x-requested-with", "referer", "accept", "accept-language"]) {
          const v = reqHeadersCache.get(k) ?? "";
          if (v) headers[k] = v;
        }
        cands.set(docId, { url: `${u.origin}${u.pathname}`, docId, variables, headers });
      } catch { /* never throw */ }
    };
    // URL-param headers must be read on the request itself; stash per request.
    let reqHeadersCache = new Map<string, string>();
    const handler = (req: import("playwright").Request): void => {
      try {
        reqHeadersCache = new Map(Object.entries(req.headers()));
        parseInto(req.url(), req.method() === "POST" ? req.postData() : null);
      } catch { /* never throw */ }
    };
    // Arm capture FIRST, then navigate — the liked-by request fires on load.
    this.page.on("request", handler);
    const diag: Record<string, unknown> = { anchor: null, candidates: 0, scores: [] };
    try {
      // Deterministic: open THIS post's liked_by view. Its own page-load
      // issues the liked-by graphql for this exact media (live-proven);
      // no click-target guessing, so suggested-post tiles can't leak in.
      await this.page
        .goto(`${config.igBaseUrl}/p/${shortcode}/liked_by/`, { waitUntil: "domcontentloaded", timeout: 30_000 })
        .catch(() => {});
      diag.anchor = "direct-nav";
      for (let i = 0; i < 16 && cands.size === 0; i++) await this.page.waitForTimeout(500);
      if (cands.size > 0) await this.page.waitForTimeout(1500); // let late candidates land

      const all = [...cands.values()];
      const matching = all.filter((c) => this.observedCommentIds.has(String(c.variables.comment_id)));
      const pool = matching.length > 0 ? matching : all;
      diag.candidates = cands.size;
      log.info("IgPostUsers", `liked_by view opened (direct-nav) — ${cands.size} candidate(s), ${pool.length} preferred for this post`);

      // Validate candidates by one-shot replay; a real liked-by response is
      // dense username+avatar nodes and contains NO comment "text" fields —
      // comment-thread queries always carry text, so they score negative.
      let best: { tpl: LikersTemplate; score: number } | null = null;
      for (const tpl of pool) {
        const score = await this.validateLikersTemplate(tpl).catch(() => 0);
        (diag.scores as Array<unknown>).push({ doc_id: tpl.docId, comment_id: tpl.variables.comment_id, score });
        log.info("IgPostUsers", `template doc_id=${tpl.docId} vars=${JSON.stringify(tpl.variables).slice(0, 80)} → likerScore=${score}`);
        if (!best || score > best.score) best = { tpl, score };
        if (best.score >= 20) break; // decisively the liked-by query
      }
      if (best && best.score >= 10) {
        log.info("IgPostUsers", `likers template VALIDATED: doc_id=${best.tpl.docId} (likerScore=${best.score})`);
        return best.tpl;
      }
      log.warn("IgPostUsers", "no candidate validated as a liked-by query");
      return null;
    } finally {
      this.page.off("request", handler);
      void this.updateIgProgress({ likers_diag: diag }).catch(() => {});
    }
  }

  /** Replay a candidate once and score how liked-by-like the response is:
   *  +1 per DIRECT user node (username + pk/id, not nested under an
   *  `owner` key, no comment `text` on the node). Liked-by pages carry
   *  direct user nodes; comment-thread pages nest every user inside
   *  owner — so thread queries score ~0 even with many users present. */
  private async validateLikersTemplate(tpl: LikersTemplate): Promise<number> {
    const r = await this.page
      .evaluate(
        `(async () => {
          const tpl = ${JSON.stringify({ url: tpl.url, docId: tpl.docId, variables: tpl.variables, headers: tpl.headers })};
          const params = new URLSearchParams({
            doc_id: tpl.docId,
            variables: JSON.stringify(tpl.variables),
            fb_api_req_friendly_name: "PolarisPostLikedByListQuery",
          });
          try {
            const res = await fetch(tpl.url + "?" + params.toString(), { credentials: "include", headers: tpl.headers });
            if (!res.ok) return { status: res.status, score: 0 };
            const body = await res.json();
            let score = 0;
            const walk = (o, inOwner) => {
              if (!o || typeof o !== "object") return;
              if (typeof o.username === "string" && (o.id || o.pk) && !inOwner && !("text" in o)) score++;
              if (o.owner && typeof o.owner === "object") walk(o.owner, true);
              for (const v of Object.values(o)) {
                if (v && typeof v === "object") walk(v, inOwner);
                else if (Array.isArray(v)) for (const it of v) walk(it, inOwner);
              }
            };
            walk(body, false);
            return { status: 200, score };
          } catch (e) {
            return { status: 0, score: 0 };
          }
        })()`,
      )
      .then((r) => r as { status: number; score: number })
      .catch(() => ({ status: 0, score: 0 }));
    return r.status === 200 ? r.score : 0;
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
  /** comment_id values the app itself used for THIS post's media (page-load traffic). */
  private readonly observedCommentIds = new Set<string>();
  private commentIdObserver: ((req: import("playwright").Request) => void) | null = null;

  /** Watch page-load graphql requests and remember every comment_id the app
   *  sends for this post (used to reject wrong-media templates later). */
  private armCommentIdObserver(): void {
    if (this.commentIdObserver) this.page.off("request", this.commentIdObserver);
    this.commentIdObserver = (req: import("playwright").Request): void => {
      try {
        if (!req.url().includes("/graphql/query")) return;
        const u = new URL(req.url());
        const varsRaw = u.searchParams.get("variables");
        if (!varsRaw) return;
        const vars = JSON.parse(varsRaw) as Record<string, unknown>;
        if (typeof vars.comment_id === "string") this.observedCommentIds.add(vars.comment_id);
      } catch { /* never throw */ }
    };
    this.page.on("request", this.commentIdObserver);
  }

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
