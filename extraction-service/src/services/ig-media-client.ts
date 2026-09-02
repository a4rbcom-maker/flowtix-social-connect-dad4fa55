/** IG media extraction: comments + engagers from a post, posts from a hashtag.
 *
 *  Mechanism mirrors the proven followers fast-path (2026-08-24):
 *  open the live page, CAPTURE the media-carrying GraphQL responses the
 *  page itself issues, then keep paginating via the captured template's
 *  cursor ("after"). DOM parsing of the rendered page is the always-on
 *  fallback for the first batch.
 *
 *  Live-verified 2026-08-24:
 *   - Hashtag page fires POST /api/graphql with {"tag_name": …} on load and
 *     POST /api/graphql with {"after": "<cursor>", "first": N} on scroll.
 *   - Post likers dialog fires GET /graphql/query with comment_id/first=48
 *     style variables; comment authors render in ul ul a[href^="/"] links.
 *
 *  Platform limits honored: only what the logged-in web app itself exposes;
 *  blocked/degraded sessions rotate via IgExtractionEngine health. */
import type { Page } from "playwright";
import { logger } from "../logger.js";

const log = logger;

export interface IgMediaUser {
  username: string;
  fullName: string;
  avatar: string;
}

export interface IgCapturedPage {
  users: IgMediaUser[];
  afterCursor: string | null;
}

export interface ContinuousCapture {
  /** All users accumulated across every GraphQL response since arming. */
  users: Map<string, IgMediaUser>;
  /** Latest pagination cursor seen (null if none). */
  afterCursor: string | null;
  /** Stop listening and return the final snapshot. */
  stop: () => ContinuousSnapshot;
}

export interface ContinuousSnapshot {
  users: IgMediaUser[];
  afterCursor: string | null;
}

/** Extract usernames from any GraphQL payload section we care about:
 *  comment edges (owner), like edges (node.username), user edges. */
function usersFromGraphqlBody(body: unknown): { users: IgMediaUser[]; after: string | null } {
  const out: IgMediaUser[] = [];
  const seen = new Set<string>();
  let after: string | null = null;

  const walk = (node: unknown, depth = 0): void => {
    if (!node || typeof node !== "object" || depth > 12) return;
    const obj = node as Record<string, unknown>;

    // comment owner shape: {"owner":{"username",...}}
    const owner = obj.owner as Record<string, unknown> | undefined;
    if (owner && typeof owner.username === "string" && !seen.has(owner.username)) {
      seen.add(owner.username);
      out.push({ username: owner.username, fullName: String(owner.full_name ?? ""), avatar: "" });
    }
    // direct user edge shape: {"node":{"username",...}}
    const uname = obj.username;
    if (typeof uname === "string" && !seen.has(uname) && (obj.id || obj.pk)) {
      seen.add(uname);
      out.push({ username: uname, fullName: String(obj.full_name ?? ""), avatar: String(obj.profile_pic_url ?? "") });
    }
    // pagination cursor shapes: page_info.end_cursor / after
    const pageInfo = obj.page_info as Record<string, unknown> | undefined;
    if (pageInfo?.has_next_page === true && typeof pageInfo.end_cursor === "string") {
      after = pageInfo.end_cursor;
    }
    if (typeof obj.after === "string") after = obj.after;

    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") walk(v, depth + 1);
      else if (Array.isArray(v)) for (const item of v) walk(item, depth + 1);
    }
  };
  walk(body);
  return { users: out, after };
}

/** Parse commenter authors from the rendered post DOM. IG's modern layout
 *  does NOT nest comments in `ul ul`; the commenter <a> links live directly
 *  under the comment thread container. We scan every in-page profile link and
 *  drop navigation links (explore/reels/tags/popular/accounts), keeping only
 *  real @usernames. */
async function usersFromPostDom(page: Page): Promise<IgMediaUser[]> {
  return page
    .evaluate(() => {
      const out: { username: string; fullName: string; avatar: string }[] = [];
      const seen = new Set<string>();
      const NAV = new Set(["p", "reel", "reels", "explore", "tags", "accounts", "popular", "directory", "about", "locations", "hashtag"]);
      // Scope to the post's own <article> container — the sidebar
      // suggestions, suggested posts, and "accounts you may know"
      // sections live OUTSIDE it. This prevents harvesting accounts
      // from other sections that have nothing to do with this post's
      // comments.
      const article = document.querySelector("article");
      const scope = article ?? document.documentElement;
      for (const a of scope.querySelectorAll('a[href^="/"]')) {
        const href = a.getAttribute("href") || "";
        const m = href.match(/^\/([a-zA-Z0-9._]{1,30})\/?$/);
        if (!m || NAV.has(m[1].toLowerCase())) continue;
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        const img = a.querySelector("img");
        let full = "";
        const parent = a.closest("li") || a.closest("div[role='button']") || a.parentElement;
        if (parent) {
          for (const s of Array.from(parent.querySelectorAll("span"))) {
            const t = (s.textContent || "").trim();
            if (t && t !== m[1] && t.length <= 100) { full = t; break; }
          }
        }
        out.push({ username: m[1], fullName: full, avatar: img?.getAttribute("src") ?? "" });
      }
      return out;
    })
    .catch(() => []);
}

/** Parse post links (shortcode + owner id when present) from hashtag DOM. */
async function postsFromHashtagDom(page: Page): Promise<{ shortcode: string; ownerId: string | null }[]> {
  return page
    .evaluate(() => {
      const out: { shortcode: string; ownerId: string | null }[] = [];
      const seen = new Set<string>();
      for (const a of document.querySelectorAll('a[href*="/p/"]')) {
        const href = a.getAttribute("href") || "";
        const m = href.match(/\/p\/([A-Za-z0-9_-]+)/);
        if (!m || seen.has(m[1])) continue;
        seen.add(m[1]);
        out.push({ shortcode: m[1], ownerId: null });
      }
      return out;
    })
    .catch(() => []);
}

export class IgMediaClient {
  private lastRequestMs = 0;
  private readonly minGapMs: number;

  constructor(minGapMs = 1100) {
    this.minGapMs = minGapMs;
  }

  /** Navigate to the feed page and keep listening while the page's own
   *  scroll loads more GraphQL pages. Accumulates ALL users seen across
   *  every response (the page self-paginates on wheel events). */
  async captureFeedUsers(
    page: Page,
    url: string,
    opts: { scrollRounds?: number; maxUsers?: number } = {},
  ): Promise<IgCapturedPage | null> {
    const acc = new Map<string, IgMediaUser>();
    let after: string | null = null;
    const handler = async (resp: import("playwright").Response): Promise<void> => {
      try {
        const u = resp.url();
        if (!(u.includes("/graphql/query") || u.includes("/api/graphql") || u.includes("/api/v1/media"))) return;
        if (resp.status() !== 200) return;
        const ct = resp.headers()["content-type"] || "";
        if (!ct.includes("json")) return;
        const j = await resp.json().catch(() => null);
        if (!j) return;
        const parsed = usersFromGraphqlBody(j);
        log.info("IgMedia", `feed resp: +${parsed.users.length} users (acc=${acc.size}), after=${parsed.after ? "yes" : "no"}`);
        for (const usr of parsed.users) {
          if (!acc.has(usr.username)) acc.set(usr.username, usr);
        }
        if (parsed.after) after = parsed.after;
      } catch { /* capture must never throw */ }
    };
    page.on("response", handler);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const rounds = opts.scrollRounds ?? 10;
      const maxUsers = opts.maxUsers ?? Infinity;
      for (let i = 0; i < rounds && acc.size < maxUsers; i++) {
        await page.mouse.wheel(0, 1100);
        await page.waitForTimeout(1900);
      }
      await page.waitForTimeout(1500);
    } catch (err) {
      log.warn("IgMedia", `feed navigation failed: ${String(err).slice(0, 100)}`);
      return null;
    } finally {
      page.off("response", handler);
    }
    if (acc.size === 0) return null;
    return { users: Array.from(acc.values()), afterCursor: after };
  }

  /** Capture the first media GraphQL response the target page issues, by
   *  navigating and listening. Returns parsed users + continuation cursor. */
  async captureFirstPage(
    page: Page,
    url: string,
    opts: { scroll?: number; settleMs?: number } = {},
  ): Promise<IgCapturedPage | null> {
    const box: { body: unknown | null; after: string | null } = { body: null, after: null };
    const handler = async (resp: import("playwright").Response): Promise<void> => {
      try {
        const u = resp.url();
        if (!(u.includes("/graphql/query") || u.includes("/api/graphql") || u.includes("/api/v1/media"))) return;
        if (resp.status() !== 200) return;
        const ct = resp.headers()["content-type"] || "";
        if (!ct.includes("json")) return;
        const j = await resp.json().catch(() => null);
        if (!j) return;
        const parsed = usersFromGraphqlBody(j);
        log.info("IgMedia", `graphql resp: users=${parsed.users.length}, after=${parsed.after ? "yes" : "no"}`);
        if (parsed.users.length > 0) {
          box.body = j;
          if (parsed.after) box.after = parsed.after;
        }
      } catch { /* capture must never throw */ }
    };
    page.on("response", handler);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const scrolls = opts.scroll ?? 2;
      for (let i = 0; i < scrolls; i++) {
        await page.mouse.wheel(0, 900);
        await page.waitForTimeout(1600);
      }
      await page.waitForTimeout(opts.settleMs ?? 2000);
    } catch (err) {
      log.warn("IgMedia", `capture navigation failed: ${String(err).slice(0, 100)}`);
      return null;
    } finally {
      page.off("response", handler);
    }
    if (!box.body) return null;
    const parsed = usersFromGraphqlBody(box.body);
    return { users: parsed.users, afterCursor: parsed.after };
  }

  /** Start capturing ALL GraphQL responses on this page. Call stop() to finish.
   *  Unlike captureFirstPage (single-shot), this stays armed for the entire
   *  extraction session so every paginated comment/like response is collected.
   *  bodyFilter (optional): only accumulate responses whose JSON body passes
   *  the predicate — used to reject sidebar/suggestion traffic that shares
   *  the graphql endpoint but carries no post data. */
  armContinuousCapture(page: Page, bodyFilter?: (body: unknown) => boolean): ContinuousCapture {
    this.continuousAcc = new Map();
    this.continuousAfter = null;
    if (this.continuousHandler) page.off("response", this.continuousHandler);
    this.continuousHandler = (resp: import("playwright").Response): void => {
      try {
        const u = resp.url();
        if (!(u.includes("/graphql/query") || u.includes("/api/graphql") || u.includes("/api/v1/media"))) return;
        if (resp.status() !== 200) return;
        const ct = resp.headers()["content-type"] || "";
        if (!ct.includes("json")) return;
        void resp
          .json()
          .then((j: unknown) => {
            if (!j || !this.continuousAcc) return;
            if (bodyFilter && !bodyFilter(j)) {
              log.info("IgMedia", `continuous capture: rejected non-post graphql response`);
              return;
            }
            const parsed = usersFromGraphqlBody(j);
            if (parsed.users.length > 0) {
              let added = 0;
              for (const usr of parsed.users) {
                if (!this.continuousAcc.has(usr.username)) {
                  this.continuousAcc.set(usr.username, usr);
                  added++;
                }
              }
              if (parsed.after) this.continuousAfter = parsed.after;
              log.info("IgMedia", `continuous capture: +${added} users (total=${this.continuousAcc.size}), after=${parsed.after ? "yes" : "no"}`);
            }
          })
          .catch(() => { /* never throw */ });
      } catch { /* never throw */ }
    };
    page.on("response", this.continuousHandler);
    return {
      users: this.continuousAcc,
      afterCursor: null,
      stop: (): ContinuousSnapshot => {
        page.off("response", this.continuousHandler!);
        this.continuousHandler = null;
        const snapshot = {
          users: Array.from(this.continuousAcc?.values() ?? []),
          afterCursor: this.continuousAfter,
        };
        this.continuousAcc = null;
        this.continuousAfter = null;
        return snapshot;
      },
    };
  }

  /** Hashtag pagination via VERBATIM template capture + replay.
   *  1) listen for PolarisKeywordSearchExplorePageRelayPaginationQuery while
   *     the tag page loads/scrolls (the app's own feed request),
   *  2) store its full request (url+headers+body),
   *  3) fetchNextHashtagPage() re-issues it in-page with after=<cursor>.
   *  Live-verified: 200 OK, 12 media/page, fresh end_cursor each page. */
  async armHashtagCapture(page: Page): Promise<void> {
    this.tagTemplate = null;
    if (this.tagHandler) page.off("request", this.tagHandler);
    this.tagHandler = (req: import("playwright").Request): void => {
      try {
        const url = req.url();
        if (!(url.includes("/api/graphql") || url.includes("/graphql/query"))) return;
        const body = req.postData() || "";
        if (!body.includes("PolarisKeywordSearchExplorePageRelayPaginationQuery")) return;
        const headers: Record<string, string> = {};
        for (const h of ["x-ig-app-id", "x-fb-friendly-name", "x-asbd-id", "x-csrf-token", "content-type"]) {
          const v = req.headers()[h];
          if (v) headers[h] = v;
        }
        this.tagTemplate = { url, method: req.method(), headers, body };
      } catch { /* never throw */ }
    };
    page.on("request", this.tagHandler);
  }

  disarmHashtagCapture(page: Page): void {
    if (this.tagHandler) page.off("request", this.tagHandler);
    this.tagHandler = null;
  }

  /** Re-issue the captured hashtag feed template with a new after-cursor. */
  async fetchNextHashtagPage(page: Page, after: string | null): Promise<IgCapturedPage | null> {
    const tpl = this.tagTemplate;
    if (!tpl) return null;
    await this.pace();
    return page
      .evaluate(
        async ({ url, method, headers, body, after }) => {
          try {
            const params = new URLSearchParams(body || "");
            let vars: Record<string, unknown> = {};
            try { vars = JSON.parse(params.get("variables") || "{}"); } catch { /* keep {} */ }
            vars.after = after;
            params.set("variables", JSON.stringify(vars));
            const res = await fetch(url, {
              method,
              credentials: "include",
              headers: { ...headers, "content-type": headers["content-type"] ?? "application/x-www-form-urlencoded" },
              body: params.toString(),
            });
            if (res.status !== 200) return { error: true, status: res.status };
            const text = await res.text();
            const jsonText = text.startsWith("for (;;);") ? text.slice(9) : text;
            let j: Record<string, unknown> | null = null;
            try { j = JSON.parse(jsonText); } catch { /* html */ }
            if (!j) return { error: true, status: 0 };
            // collect usernames + media shortcodes + next cursor iteratively
            const users: { username: string; fullName: string; avatar: string }[] = [];
            const seenU = new Set<string>();
            const shortcodes = new Set<string>();
            let endCursor: string | null = null;
            let hasNext: boolean | null = null;
            const stack: unknown[] = [j];
            while (stack.length > 0) {
              const cur = stack.pop();
              if (!cur || typeof cur !== "object") continue;
              const o = cur as Record<string, unknown>;
              for (const k of Object.keys(o)) {
                const v = o[k];
                if (k === "username" && typeof v === "string" && !seenU.has(v) && o.pk) {
                  seenU.add(v);
                  users.push({ username: v, fullName: String(o.full_name ?? ""), avatar: String(o.profile_pic_url ?? "") });
                }
                if ((k === "shortcode" || k === "code") && typeof v === "string") shortcodes.add(v);
                if (k === "end_cursor" && typeof v === "string") endCursor = v;
                if (k === "has_next_page" && typeof v === "boolean") hasNext = v;
                if (v && typeof v === "object") stack.push(v);
              }
            }
            return { error: false, users, shortcodeCount: shortcodes.size, endCursor, hasNext };
          } catch (e) {
            return { error: true, status: 0, message: String(e).slice(0, 120) };
          }
        },
        { url: tpl.url, method: tpl.method, headers: tpl.headers, body: tpl.body, after },
      )
      .then((r: { error: boolean; status?: number; users?: IgMediaUser[]; shortcodeCount?: number; endCursor?: string | null; hasNext?: boolean | null; message?: string }) => {
        if (r.error) {
          log.warn("IgMedia", `tag page failed (${r.status ?? "?"}) ${r.message ?? ""}`);
          return null;
        }
        log.info("IgMedia", `tag page ok: shortcodes=${r.shortcodeCount}, authors=${r.users?.length ?? 0}, next=${r.hasNext}`);
        return { users: r.users ?? [], afterCursor: r.endCursor ?? null };
      });
  }

  private tagTemplate: { url: string; method: string; headers: Record<string, string>; body: string | null } | null = null;
    private tagHandler: ((req: import("playwright").Request) => void) | null = null;

    private continuousHandler: ((resp: import("playwright").Response) => void) | null = null;
    private continuousAcc: Map<string, IgMediaUser> | null = null;
    private continuousAfter: string | null = null;

  private async pace(): Promise<void> {
    const now = Date.now();
    const wait = this.lastRequestMs + this.minGapMs - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestMs = Date.now();
  }
}

export { usersFromPostDom, postsFromHashtagDom };
