/** ig_user_search: search Instagram accounts by name/keyword via the web
 *  search UI (top-accounts section). DOM-based: the search page renders
 *  result rows with profile links — we harvest them across scroll rounds. */
import type { Page } from "playwright";
import { IgBaseExtractor } from "./ig-base.js";
import { IgExtractionEngine } from "../services/ig-engine.js";
import { config } from "../config.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import type { AuthState, ExtractedMember } from "../types.js";

const log = logger;

function parseSearchQuery(sourceUrl: string): string {
  const m = sourceUrl.match(/[?&]q=([^&]+)/);
  if (m) return decodeURIComponent(m[1]).replace(/\+/g, " ");
  const bare = sourceUrl.replace(/^https?:\/\/\S+/, "").trim();
  if (bare) return bare;
  throw new ExtractionError(ErrorCodes.INVALID_INPUT, "اكتب كلمة البحث.");
}

export class IgUserSearchExtractor extends IgBaseExtractor {
  async extract(): Promise<{ extracted: number; nextCursor?: string; done: boolean; authState: AuthState }> {
    const query = parseSearchQuery(this.ctx.sourceUrl);
    const sessionIds = [this.ctx.sessionId];
    const engine = new IgExtractionEngine(
      { jobId: this.ctx.jobId, userId: this.ctx.userId, sessionIds, maxResults: this.ctx.maxResults },
      { sourceKey: "user_search", label: `search "${query}"`, loadCheckpoint: () => null, saveCheckpoint: async () => {} },
    );
    this.engine = engine;
    engine.setPhase("extracting");
    log.info("IgSearch", `starting: "${query}"`);

    // Land on any instagram.com page (session context), then call the
    // topsearch API in-page — the API needs the session, not a specific page.
    await this.navigateToPage(`${config.igBaseUrl}/`);

    let results = await this.readTopsearchJson(query);
    if (results.length === 0) {
      await this.navigateToPage(`${config.igBaseUrl}/explore/search/keyword/?q=${encodeURIComponent(query)}`);
      results = await this.readTopsearchJson(query);
    }
    for (let round = 0; round < 5 && results.length < Math.min(this.ctx.maxResults, 100); round++) {
      const batch = await this.harvestRows();
      const before: number = results.length;
      for (const r of batch) if (!results.some((x) => x.username === r.username)) results.push(r);
      if (results.length === before) break;
      engine.addResults(results.length - before);
      await engine.heartbeat();
    }

    const collected = new Map<string, ExtractedMember>();
    for (const r of results.slice(0, this.ctx.maxResults)) {
      collected.set(r.username, {
        fb_id: r.username,
        username: r.username,
        name: r.fullName || r.username,
        full_name: r.fullName || r.username,
        profile_url: `${config.igBaseUrl}/${r.username}/`,
        avatar_url: r.avatar || undefined,
        type: this.ctx.type,
      });
    }
    try {
      await this.processBatch(Array.from(collected.values()), this.ctx.type, "instagram");
      engine.addResults(collected.size);
    } catch (err) {
      log.warn("IgSearch", `store err: ${String(err).slice(0, 100)}`);
    }
    log.info("IgSearch", `done: ${collected.size} unique`);
    engine.recordSessionSuccess(this.ctx.sessionId);
    engine.setPhase("completed");
    await engine.heartbeat(true);
    await this.updateIgProgress({ phase: "completed", extracted: collected.size, query });
    return { extracted: collected.size, done: true, authState: "authenticated" };
  }

  /** Direct in-page API: /api/v1/web/search/topsearch/ returns
   *  users:[{position, user:{username, full_name, profile_pic_url}}…].
   *  Navigation links (reels/explore) are filtered by requiring a user
   *  object with pk — nav rows have none. */
  private async readTopsearchJson(query: string): Promise<{ username: string; fullName: string; avatar: string }[]> {
    return this.page
      .evaluate(async (q: string) => {
        try {
          const res = await fetch(`https://www.instagram.com/api/v1/web/search/topsearch/?query=${encodeURIComponent(q)}`, {
            credentials: "include",
            headers: { "x-ig-app-id": "936619743392459", accept: "*/*" },
          });
          if (res.status !== 200) return [];
          const j = await res.json();
          const out: { username: string; fullName: string; avatar: string }[] = [];
          for (const item of j?.users ?? []) {
            const u = item?.user;
            if (u?.username && u?.pk) {
              out.push({ username: String(u.username), fullName: String(u.full_name ?? ""), avatar: String(u.profile_pic_url ?? "") });
            }
          }
          return out;
        } catch {
          return [];
        }
      }, query)
      .catch(() => []);
  }

  private async harvestRows(): Promise<{ username: string; fullName: string; avatar: string }[]> {
    return this.page
      .evaluate(() => {
        const out: { username: string; fullName: string; avatar: string }[] = [];
        const seen = new Set<string>();
        for (const a of document.querySelectorAll('a[href^="/"]')) {
          const href = a.getAttribute("href") || "";
          const m = href.match(/^\/([a-zA-Z0-9._]{1,30})\/$/);
          if (!m || ["explore", "accounts", "p", "reel", "about"].includes(m[1])) continue;
          if (seen.has(m[1])) continue;
          seen.add(m[1]);
          const img = a.querySelector("img");
          let full = "";
          const parent = a.parentElement;
          if (parent) {
            for (const s of Array.from(parent.querySelectorAll("span"))) {
              const t = (s.textContent || "").trim();
              if (t && t !== m[1] && t.length <= 80) { full = t; break; }
            }
          }
          out.push({ username: m[1], fullName: full, avatar: img?.getAttribute("src") ?? "" });
        }
        return out;
      })
      .catch(() => []);
  }

  private async navigateToPage(url: string): Promise<void> {
    try {
      await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: config.igNavTimeoutMs });
      await this.page.waitForTimeout(3000);
    } catch (err) {
      throw new ExtractionError(ErrorCodes.NETWORK_ERROR, `فشل فتح صفحة البحث: ${String(err).substring(0, 120)}`);
    }
  }

  private engine: IgExtractionEngine | null = null;
}
