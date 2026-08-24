/** ig_profile_info: one detailed row per profile — counters (posts/followers/
 *  following via the dual-shape header selectors), full name, bio, external
 *  link, verification. Single result, no pagination. */
import type { Page } from "playwright";
import { IgBaseExtractor } from "./ig-base.js";
import { IgExtractionEngine } from "../services/ig-engine.js";
import { config } from "../config.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import type { AuthState, ExtractedMember } from "../types.js";

const log = logger;

function parseIgUsername(sourceUrl: string): string {
  const trimmed = sourceUrl.trim().replace(/\/+$/, "");
  const m = trimmed.match(/instagram\.com\/([a-zA-Z0-9._]+)/i);
  if (m) return m[1];
  const bare = trimmed.replace(/^https?:\/\//, "");
  if (/^[a-zA-Z0-9._]{1,30}$/.test(bare)) return bare;
  throw new ExtractionError(ErrorCodes.INVALID_INPUT, "رابط حساب إنستجرام غير صالح.");
}

interface ProfileHeader {
  posts: number | null;
  followers: number | null;
  following: number | null;
  fullName: string;
  bio: string;
  externalUrl: string;
  verified: boolean;
  isPrivate: boolean;
}

/** Parse "4,958" / "1.2K" / "3.4M" from og:description matches. */
function parseMetaNum(raw: string): number | null {
  const m = raw.replace(/,/g, "").trim().match(/^([\d.]+)([KkMm])?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (isNaN(n)) return null;
  const s = (m[2] || "").toLowerCase();
  if (s === "k") return Math.round(n * 1000);
  if (s === "m") return Math.round(n * 1_000_000);
  return Math.round(n);
}

export class IgProfileInfoExtractor extends IgBaseExtractor {
  async extract(): Promise<{ extracted: number; nextCursor?: string; done: boolean; authState: AuthState }> {
    const username = parseIgUsername(this.ctx.sourceUrl);
    const sessionIds = [this.ctx.sessionId];
    const engine = new IgExtractionEngine(
      { jobId: this.ctx.jobId, userId: this.ctx.userId, sessionIds, maxResults: this.ctx.maxResults },
      { sourceKey: "profile_info", label: `@${username}`, loadCheckpoint: () => null, saveCheckpoint: async () => {} },
    );
    this.engine = engine;
    engine.setPhase("extracting");

    await this.navigateToPage(`${config.igBaseUrl}/${username}/`);
    const html = await this.page.content().catch(() => "");
    if (this.detectIgBlocked(html, this.page.url())) {
      throw new ExtractionError(ErrorCodes.AUTH_FAILED, "تم حظر الجلسة أثناء فتح الحساب.");
    }

    const header = await this.readProfileHeader();
    if (!header.fullName && !header.followers) {
      throw new ExtractionError(ErrorCodes.EXTRACTION_FAILED, "تعذر قراءة بيانات الحساب. تأكد أن الحساب موجود وعام.");
    }
    engine.setTotal(1);
    log.info("IgProfileInfo", `@${username}: followers=${header.followers} posts=${header.posts} verified=${header.verified}`);

    const member: ExtractedMember = {
      fb_id: username,
      username,
      name: header.fullName || username,
      full_name: header.fullName || username,
      profile_url: `${config.igBaseUrl}/${username}/`,
      type: this.ctx.type,
      comment_text: [
        header.posts !== null ? `posts:${header.posts}` : null,
        header.following !== null ? `following:${header.following}` : null,
        header.isPrivate ? "private" : "public",
        header.verified ? "verified" : null,
        header.externalUrl ? `link:${header.externalUrl}` : null,
      ].filter(Boolean).join(" | "),
      bio_email: (header.bio.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [])[0] ?? undefined,
    };

    try {
      await this.processBatch([member], this.ctx.type, "instagram");
      engine.addResults(1);
    } catch (err) {
      log.warn("IgProfileInfo", `store err: ${String(err).slice(0, 100)}`);
    }
    engine.recordSessionSuccess(this.ctx.sessionId);
    engine.setPhase("completed");
    await engine.heartbeat(true);
    await this.updateIgProgress({ phase: "completed", extracted: 1, total: 1, coverage_rate: 100, username });
    return { extracted: 1, done: true, authState: "authenticated" };
  }

  /** Dual-source header reader:
   *  1) og:description — "4,958 Followers, 5 Following, 21 Posts - See
   *     Instagram photos…" (stable, server-rendered, language-tolerant via
   *     the numeric+label pattern),
   *  2) rendered counters ("21 posts" anchors/buttons) as fallback. */
  private async readProfileHeader(): Promise<ProfileHeader> {
    const dom = await this.page
      .evaluate(() => {
        const parseNum = (t: string): number | null => {
          const c = t.replace(/[,\s\u00a0]/g, "");
          const m = c.match(/([\d.]+)([KkMm])?/);
          if (!m) return null;
          const n = parseFloat(m[1]);
          if (isNaN(n)) return null;
          const s = (m[2] || "").toLowerCase();
          if (s === "k") return Math.round(n * 1000);
          if (s === "m") return Math.round(n * 1_000_000);
          return Math.round(n);
        };
        let followers: number | null = null;
        let following: number | null = null;
        let posts: number | null = null;
        for (const el of Array.from(document.querySelectorAll("header a, main a, header button, header span"))) {
          const t = (el.textContent || "").trim();
          if (!t || t.length > 40 || !/\d/.test(t)) continue;
          const lower = t.toLowerCase();
          if (followers === null && /followers|متابع/.test(lower) && !/following/.test(lower)) followers = parseNum(t);
          else if (following === null && /following|يتابع|متابَع/.test(lower)) following = parseNum(t);
          else if (posts === null && /posts?|منشور/.test(lower)) posts = parseNum(t);
        }
        return {
          posts,
          followers,
          following,
          fullName: document.querySelector("header h1, header h2")?.textContent?.trim() ?? "",
          bio: "",
          externalUrl:
            document.querySelector('header a[target="_blank"][rel*="noopener"]:not([href*="instagram.com"])')?.getAttribute("href")
            ?? document.querySelector('a[href^="https://l.instagram.com"]')?.getAttribute("href")
            ?? "",
          verified: !!document.querySelector('header svg[aria-label*="Verified"], header svg[aria-label*="مُتحقق"]'),
          isPrivate: /private|خاص/i.test(document.body.innerText.slice(0, 3000)),
        };
      })
      .catch(() => null);

    // Server-rendered meta is the most stable source — overrides DOM values.
    const meta = await this.page
      .evaluate(() => ({
        title: document.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? "",
        desc: document.querySelector('meta[property="og:description"]')?.getAttribute("content") ?? "",
      }))
      .catch(() => ({ title: "", desc: "" }));

    let posts = dom?.posts ?? null;
    let followers = dom?.followers ?? null;
    let following = dom?.following ?? null;

    const dm = meta.desc.match(/([\d,.]+)\s*(?:K|M)?\s*Followers/i);
    const df = meta.desc.match(/([\d,.]+)\s*(?:K|M)?\s*Following/i);
    const dp = meta.desc.match(/([\d,.]+)\s*(?:K|M)?\s*Posts/i);
    if (dm) followers = parseMetaNum(dm[1]);
    if (df) following = parseMetaNum(df[1]);
    if (dp) posts = parseMetaNum(dp[1]);

    // Full name from og:title "Name (@user) • Instagram …"
    let fullName = dom?.fullName ?? "";
    if (!fullName) {
      const tm = meta.title.match(/^(.*?)\s*\(@/);
      if (tm) fullName = tm[1];
    }

    return {
      posts,
      followers,
      following,
      fullName,
      bio: dom?.bio ?? "",
      externalUrl: dom?.externalUrl ?? "",
      verified: dom?.verified ?? false,
      isPrivate: dom?.isPrivate ?? false,
    };
  }

  private async navigateToPage(url: string): Promise<void> {
    try {
      await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: config.igNavTimeoutMs });
      await this.page.waitForTimeout(3000);
    } catch (err) {
      throw new ExtractionError(ErrorCodes.NETWORK_ERROR, `فشل فتح الصفحة: ${String(err).substring(0, 120)}`);
    }
  }

  private engine: IgExtractionEngine | null = null;
}
