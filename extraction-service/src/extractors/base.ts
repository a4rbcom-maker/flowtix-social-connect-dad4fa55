import type { Page } from "playwright";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { ExtractionError, ErrorCodes, type ErrorCode } from "../errors.js";
import { supabaseService } from "../services/supabase.js";
import type { AuthState, ExtractedMember, JobContext } from "../types.js";

const log = logger;

export function detectAuthState(html: string, finalUrl?: string): AuthState {
  const lower = html.toLowerCase();

  if (lower.includes("something went wrong")) return "unknown";

  if (finalUrl) {
    const urlLower = finalUrl.toLowerCase();
    if (urlLower.includes("/checkpoint/") || urlLower.includes("/recover/")) return "restricted";
    if (urlLower.includes("/login") || urlLower.includes("login.php")) return "needs_login";
    if (lower.includes('name="email"') && lower.includes('name="pass"')) return "needs_login";
    if (lower.includes('id="loginform"') || lower.includes("login_form")) return "needs_login";
    if (urlLower.includes("www.facebook.com") && !urlLower.includes("/login")) {
      if (lower.includes("feed") || lower.includes("home") || lower.includes("stories") || lower.includes("news")) return "authenticated";
      if (lower.includes('data-pagelet="page"') || lower.includes('role="navigation"') || lower.includes('role="banner"')) return "authenticated";
    }
  }

  const titleMatch = lower.match(/<title[^>]*>(.*?)(?:<\/title>|$)/);
  if (titleMatch) {
    const title = titleMatch[1];
    if (title.includes("log in") || title.includes("sign up") || title.includes("تسجيل الدخول") || title.includes("اشتراك")) return "needs_login";
    if (title.includes("facebook") && !title.includes("log in") && !title.includes("تسجيل")) return "authenticated";
  }

  const loginMarkers = ['id="login_form"', "login/device-based", 'name="email"', "loginform", "log in to facebook", "you must log in first", "log into facebook", "تسجيل الدخول", "اشتراك", "دخول", "تسجيل الدخول إلى فيسبوك"];
  let loginHits = 0;
  for (const m of loginMarkers) if (lower.includes(m)) loginHits++;
  if (loginHits >= 1 && (lower.includes('name="pass"') || lower.includes('type="password"') || lower.includes("login_form") || lower.includes("login.php"))) return "needs_login";

  if (lower.includes("confirm your identity") || lower.includes("account is temporarily locked") || lower.includes("your account has been locked") || lower.includes("security check required")) return "restricted";

  const authMarkers = ["logout", 'role="navigation"', "news feed", "account_settings", "notifications", "stories", 'data-pagelet', "الصفحة الرئيسية", "الخروج", "حسابي", "موقعي", 'aria-label="home"'];
  let authHits = 0;
  for (const m of authMarkers) if (lower.includes(m)) authHits++;
  if (authHits >= 2) return "authenticated";

  if (finalUrl && finalUrl.includes("www.facebook.com") && !finalUrl.includes("/login") && !lower.includes('name="pass"') && !lower.includes('name="email"')) {
    return "authenticated";
  }

  return "unknown";
}

export function authStateToMessage(state: AuthState): string {
  switch (state) {
    case "needs_login": return "انتهت صلاحية الجلسة أو لم يتم تسجيل الدخول. يرجى إعادة استيراد ملفات تعريف الارتباط (cookies).";
    case "restricted": return "حساب فيسبوك مقيد أو يتطلب التحقق الأمني. يرجى حل المشكلة في المتصفح أولاً.";
    case "unknown": return "تعذر تأكيد مصادقة الجلسة ضد فيسبوك. قد تكون ملفات تعريف الارتباط منتهية الصلاحية.";
    default: return "فشلت المصادقة. تحقق من صحة ملفات تعريف الارتباط.";
  }
}

export function authStateToErrorCode(state: AuthState): ErrorCode {
  switch (state) {
    case "needs_login": return ErrorCodes.SESSION_EXPIRED;
    case "restricted": return ErrorCodes.AUTH_FAILED;
    default: return ErrorCodes.AUTH_FAILED;
  }
}

export function extractProfilesFromHTML(html: string): ExtractedMember[] {
  const members: ExtractedMember[] = [];
  const seen = new Set<string>();

  const allHrefs = Array.from(html.matchAll(/href="([^"]*\/profile\.php\?id=\d+[^"]*)"[^>]*>((?:(?!<a\b)[\s\S])*?)<\/a>/gi)).slice(0, 10);
  if (allHrefs.length > 0) {
    logger.debug("Base", `${allHrefs.length} profile links found`, {
      sample: allHrefs.slice(0, 3).map((m) => m[1].substring(0, 80)),
    });
  } else {
    const allLinks = Array.from(html.matchAll(/<a\s+[^>]*href="([^"]+)"[^>]*>/gi)).slice(0, 20);
    logger.debug("Base", `no profile links; total links: ${allLinks.length}`, {
      sample: allLinks.slice(0, 10).map((m) => m[1].substring(0, 80)),
    });
  }

  const profileById = /href="(?:https?:\/\/(?:www\.|m\.|mbasic\.)?(?:facebook|fb)\.com\/)?profile\.php\?id=(\d+)(?:&?[^"]*)?"[^>]*>((?:(?!<a\b)[\s\S])*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = profileById.exec(html)) !== null) {
    const id = m[1];
    const name = m[2].replace(/<[^>]+>/g, "").trim();
    if (id && name && !seen.has(id)) {
      seen.add(id);
      members.push({ fb_id: id, name, profile_url: `https://www.facebook.com/profile.php?id=${id}`, type: "member" });
    }
  }

  const navKw = new Set([
    "home", "login", "signup", "help", "about", "privacy", "terms",
    "settings", "messages", "notifications", "search", "groups",
    "marketplace", "watch", "memories", "saved", "events", "gaming",
    "menu", "more", "find", "friends", "feed", "bookmarks", "photos",
    "videos", "notes", "places", "games", "sports", "weather", "crisis",
    "fundraisers", "ads", "services", "jobs", "occasions", "movies",
    "restaurants", "blood", "community", "offers", "promotions",
    "mbasic", "mobile", "lite", "facebook", "welcome",
  ]);

  const profileByUsername = /href="(?:https?:\/\/(?:www\.|m\.|mbasic\.)?(?:facebook|fb)\.com\/)?([a-zA-Z0-9.]{5,50})(?:\?[^"]*)?"[^>]*>((?:(?!<a\b)[\s\S])*?)<\/a>/gi;
  while ((m = profileByUsername.exec(html)) !== null) {
    const uname = m[1];
    const name = m[2].replace(/<[^>]+>/g, "").trim();
    if (!uname || !name) continue;
    if (navKw.has(uname.toLowerCase())) continue;
    if (uname === "profile.php" || uname.startsWith("?") || uname.startsWith("#")) continue;
    if (seen.has(uname)) continue;

    seen.add(uname);
    members.push({ fb_id: uname, name, profile_url: `https://www.facebook.com/${uname}`, type: "member" });
  }

  if (members.length === 0) {
    logger.debug("Base", `no members extracted, dumping first 1500 chars of HTML`);
    logger.debug("Base", html.substring(0, 1500));
    const fallbackPattern = /<a\b[^>]*href="([^"]*\/profile\.php\?id=(\d+)[^"]*)"[^>]*>((?:(?!<a\b)[\s\S])*?)<\/a>/gi;
    while ((m = fallbackPattern.exec(html)) !== null) {
      const id = m[2];
      const name = m[3].replace(/<[^>]+>/g, "").trim();
      if (id && name && !seen.has(id)) {
        seen.add(id);
        members.push({ fb_id: id, name, profile_url: `https://www.facebook.com/profile.php?id=${id}`, type: "member" });
      }
    }
  }

  return members;
}

export function extractNextPageURL(html: string): string | null {
  const patterns = [
    /<a\s+href="([^"]*)"[^>]*>(?:See More|عرض المزيد|Show more|Next|التالي)<\/a>/i,
    /<a\s+href="([^"]*)"[^>]*id="m_more_[^"]*"/i,
    /<a\s+href="([^"]*after=\d+[^"]*)"[^>]*>/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return m[1].replace(/&/g, "&");
  }
  return null;
}

export function parseGroupId(url: string): string | null {
  const m = url.match(/facebook\.com\/groups\/([^/?]+)/i);
  return m ? m[1] : null;
}

export function parsePageId(url: string): string | null {
  const m = url.match(/facebook\.com\/(?:pages\/[^/]+\/)?([a-zA-Z0-9.]{3,})(?:\/|$|\?)/i);
  return m ? m[1] : null;
}

export function parsePostId(url: string): string | null {
  const patterns = [
    /facebook\.com\/share\/(?:p|v)\/([a-zA-Z0-9_-]+)/i,
    /facebook\.com\/reel\/(\d+)/i,
    /fb\.watch\/([a-zA-Z0-9_-]+)/i,
    /facebook\.com\/[^/]+\/posts\/(pfbid[a-zA-Z0-9_-]+)/i,
    /facebook\.com\/[^/]+\/posts\/(\d+)/i,
    /facebook\.com\/permalink\.php\?story_fbid=(pfbid[a-zA-Z0-9_-]+)/i,
    /facebook\.com\/permalink\.php\?story_fbid=(\d+)/i,
    /facebook\.com\/groups\/[^/]+\/posts\/(pfbid[a-zA-Z0-9_-]+)/i,
    /facebook\.com\/groups\/[^/]+\/posts\/(\d+)/i,
    /facebook\.com\/photo\/?\?fbid=(\d+)/i,
    /facebook\.com\/photo\.php\?fbid=(\d+)/i,
    /fb\.com\/[^/]+\/posts\/(pfbid[a-zA-Z0-9_-]+)/i,
    /fb\.com\/[^/]+\/posts\/(\d+)/i,
    /facebook\.com\/watch\/?\?v=(\d+)/i,
    /facebook\.com\/[^/]+\/videos\/(\d+)/i,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  // Fallback: extract any long alphanumeric ID from the URL
  const fb = url.match(/story_fbid[=\/]([a-zA-Z0-9_-]+)/i);
  if (fb) return fb[1];
  const last = url.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop();
  if (last && /^[a-zA-Z0-9_-]{10,}$/.test(last) && !['posts','videos','reel','photo'].includes(last.toLowerCase())) {
    return last;
  }
  return null;
}

const NON_USER_KEYWORDS = [
  "photos", "photo.php", "videos", "video.php", "watch", "events", "pages",
  "hashtag", "notes", "marketplace", "jobs", "offers", "fundraisers",
  "permalink", "story", "plugins", "dialog", "sharer", "share", "ajax",
  "rsrc", "ufi", "reaction", "browse", "directory", "policies", "legal",
  "help", "settings", "privacy", "terms", "about", "community", "safety",
  "careers", "ad_campaign", "ads", "members", "following", "followers",
  "posts", "channels", "reviews", "stories", "reels", "live", "media",
  "files", "contributors", "mentions", "contributions",
];

const NAV_KEYWORDS = new Set([
  "home", "login", "signup", "help", "about", "privacy", "terms", "settings",
  "messages", "notifications", "search", "groups", "marketplace", "watch",
  "memories", "saved", "events", "gaming", "menu", "more", "find", "friends",
  "feed", "bookmarks", "photos", "videos", "notes", "places", "games",
  "mbasic", "mobile", "lite", "facebook", "welcome", "followers", "following",
  "posts", "community", "channels", "reviews", "members", "ads", "stories",
  "reels", "live", "permalink", "share", "photo", "stream", "tr", "www",
  "media", "files", "contributors", "mentions", "contributions", "l.php",
]);

export function extractUsersFromLinks(links: { href: string; text: string }[], opts?: { relaxed?: boolean }): ExtractedMember[] {
  const members: ExtractedMember[] = [];
  const seen = new Set<string>();
  const lowerKeywords = NON_USER_KEYWORDS.map(k => k.toLowerCase());

  for (const link of links) {
    const href = link.href || '';
    const name = (link.text || '').trim();
    if (!name || name.length < 2 || name.length > 100) continue;
    const lowerHref = href.toLowerCase();

    let id = '';
    let profileUrl = '';

    const groupUserMatch = href.match(/\/groups\/\d+\/user\/(\d+)\b/);
    if (groupUserMatch) {
      id = groupUserMatch[1];
      profileUrl = `https://www.facebook.com/profile.php?id=${id}`;
    }

    if (!id) {
      const profMatch = href.match(/profile\.php\?id=(\d+)/);
      if (profMatch) {
        id = profMatch[1];
        profileUrl = `https://www.facebook.com/profile.php?id=${id}`;
      }
    }

    if (!id) {
      const userMatch = href.match(/\/user\/(\d+)\b/);
      if (userMatch) {
        id = userMatch[1];
        profileUrl = `https://www.facebook.com/profile.php?id=${id}`;
      }
    }

    if (!id && opts?.relaxed) {
      const vanityMatch = href.match(/(?:facebook\.com|fb\.com)\/([a-zA-Z0-9.]{5,50})(?:[/?]|$)/i);
      if (vanityMatch) {
        const username = vanityMatch[1];
        if (NAV_KEYWORDS.has(username.toLowerCase())) continue;
        if (lowerKeywords.some(kw => lowerHref.includes(kw))) continue;
        if (/^\d+$/.test(username)) continue;
        id = username;
        profileUrl = `https://www.facebook.com/${username}`;
      }
    }

    if (!id) continue;

    // Filter out non-user IDs: real FB user IDs are 5-16 digits
    // Group IDs, post IDs, comment IDs have different formats (17+ digits)
    if (/^\d+$/.test(id) && (id.length < 5 || id.length > 16)) continue;

    if (lowerKeywords.some(kw => lowerHref.includes(kw))) continue;

    if (!seen.has(id)) {
      seen.add(id);
      members.push({ fb_id: id, name, profile_url: profileUrl, type: "member" });
    }
  }

  return members;
}

export function findNextPageURL(html: string, currentUrl: string): string | null {
  const patterns = [
    /<a\s+href="([^"]*)"[^>]*>(?:See More|Next|التالي|عرض المزيد|Show more)<\/a>/i,
    /<a\s+href="([^"]*)"[^>]*id="m_more_[^"]*"/i,
    /<a\s+href="([^"]*after=\d+[^"]*)"[^>]*>/i,
    /<a\s+href="([^"]*)"[^>]*>المزيد<\/a>/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) {
      const href = m[1].replace(/&amp;/g, "&");
      if (href.startsWith("http")) return href;
      if (href.startsWith("/")) return `https://mbasic.facebook.com${href}`;
      return `https://mbasic.facebook.com/${href}`;
    }
  }
  return null;
}

export async function resolvePostId(page: Page, sourceUrl: string): Promise<string> {
  const pid = parsePostId(sourceUrl);
  if (!pid) throw new ExtractionError(ErrorCodes.INVALID_INPUT, "تعذر تحليل الرابط. تأكد من استخدام رابط منشور فيسبوك صالح.");

  if (!sourceUrl.includes('/share/')) return pid;

  log.info("Extractor", `resolving share URL: ${sourceUrl}`);
  try {
    await page.goto(sourceUrl, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(2000);
  } catch (err) {
    throw new ExtractionError(ErrorCodes.NETWORK_ERROR, `فشل فتح الرابط: ${String(err)}`);
  }

  const finalUrl = page.url();
  log.info("Extractor", `resolved to: ${finalUrl}`);

  const resolved = parsePostId(finalUrl);
  if (resolved && resolved !== pid) {
    log.info("Extractor", `resolved post ID from URL: ${resolved}`);
    return resolved;
  }

  const html = await page.content();
  const patterns = [
    /"video_id":"(\d+)"/,
    /"videoID":"(\d+)"/,
    /video_id[=&#37;](\d+)/i,
    /story_fbid=(\d+)/i,
    /ft_ent_identifier[=&#37;](\d+)/i,
    /"post_id":"(\d+)"/,
    /permalink\.php\?story_fbid=(\d+)/i,
    /\/videos\/(\d{10,})/,
    /\/watch\/\?v=(\d+)/i,
    /"actor_id":"(\d+)"/,
    /"target_id":"(\d+)"/,
    /"page_id":"(\d+)"/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1] && m[1] !== pid) {
      log.info("Extractor", `resolved via pattern: ${m[1]}`);
      return m[1];
    }
  }

  throw new ExtractionError(
    ErrorCodes.INVALID_INPUT,
    "تعذر العثور على معرف المنشور من هذا الرابط. استخدم رابط المنشور المباشر بدلاً من رابط المشاركة.\n\n" +
    "الروابط المدعومة:\n" +
    "- facebook.com/username/posts/123456\n" +
    "- facebook.com/groups/name/posts/123456\n" +
    "- facebook.com/reel/123456\n" +
    "- facebook.com/watch/?v=123456\n" +
    "- facebook.com/photo/?fbid=123456"
  );
}

export function stripFacebookDomain(url: string): string {
  return url.replace(/^https?:\/\/(?:www\.|m\.|facebook|fb)\.com\//i, "");
}

/**
 * Parse compact number strings like "1.2K", "3.4M", "247", "12,345".
 * Handles English (K/M) and Arabic (ألف/مليون) suffixes.
 */
function parseCompactNumber(numStr: string, suffix?: string): number | null {
  const cleaned = numStr.replace(/[,\s]/g, "").replace(/\.(?=\d{3}\b)/, "");
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  if (suffix) {
    const s = suffix.toLowerCase();
    if (s === "k" || s === "ألف") return Math.round(num * 1000);
    if (s === "m" || s === "مليون") return Math.round(num * 1_000_000);
  }
  return Math.round(num);
}

/**
 * Extract total followers count from page HTML.
 * Tries English ("X followers") and Arabic ("X متابع" / "متابعون X") patterns.
 * Returns { count: null, source: "unknown" } if no match found.
 */
export function parseFollowersCount(html: string): { count: number | null; source: string } {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ");
  const num = "(\\d[\\d.,]*)\\s*(K|M|k|m|ألف|مليون)?";

  const patterns: RegExp[] = [
    new RegExp(num + "\\s*(?:people\\s+)?followers?\\b", "i"),
    new RegExp(num + "\\s*(?:people\\s+)?following\\b", "i"),
    new RegExp(num + "\\s*(?:people\\s+)?members\\b", "i"),
    new RegExp(num + "\\s*comments?\\b", "i"),
    new RegExp(num + "\\s*أعضاء", "i"),
    new RegExp(num + "\\s*عضو", "i"),
    new RegExp(num + "\\s*متابع", "i"),
    new RegExp(num + "\\s*تعليق", "i"),
    new RegExp(num + "\\s*تابع", "i"),
    new RegExp("متابعون\\s*[:\\s]*" + num, "i"),
  ];

  let best: number | null = null;
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const parsed = parseCompactNumber(m[1], m[2]);
      if (parsed !== null && parsed > 0) {
        if (best === null || parsed > best) best = parsed;
      }
    }
  }

  return best !== null ? { count: best, source: "page_ui" } : { count: null, source: "unknown" };
}

export abstract class BaseExtractor {
  protected page: Page;
  protected ctx: JobContext;
  protected secondarySessionPages: Array<{ sessionId: string; page: Page }> = [];
  protected activeSessionIndex = 0;
  protected pagesFetched = 0;
  protected startTime: number;
  protected maxExecutionMs = 1_700_000;
  protected requestDelayMs = 600;
  protected batchSizeForRest = 8;
  protected restDelayMs = 10_000;
  protected maxConsecutiveEmpty = 15;
  protected backoffDelayMs = 2_000;
  protected backoffScrolls = 0;
  protected rateLimitHits = 0;
  protected maxRateLimitRetries = 3;

  protected async restDelay(): Promise<void> {
    return new Promise((r) => setTimeout(r, this.restDelayMs));
  }

  constructor(page: Page, ctx: JobContext, secondaryPages?: Array<{ sessionId: string; page: Page }>) {
    this.page = page;
    this.ctx = ctx;
    this.secondarySessionPages = secondaryPages || [];
    this.activeSessionIndex = 0;
    this.startTime = Date.now();
  }

  /** Switch to the next available session. Returns true if switched, false if no more sessions. */
  protected async switchToNextSession(): Promise<boolean> {
    if (this.secondarySessionPages.length === 0) return false;
    const nextIdx = this.activeSessionIndex + 1;
    if (nextIdx >= 1 + this.secondarySessionPages.length) return false;

    const nextSession = this.secondarySessionPages[nextIdx - 1];
    const prevSessionId = this.ctx.sessionId;

    this.page = nextSession.page;
    this.ctx.sessionId = nextSession.sessionId;
    this.activeSessionIndex = nextIdx;

    // Re-extract cachedDtsg for new session
    (this as any).cachedDtsg = undefined;

    log.info("BaseExtractor", `switched session: ${prevSessionId} -> ${nextSession.sessionId} (index ${this.activeSessionIndex})`);
    return true;
  }

  /** Current session count including primary */
  protected get totalSessions(): number {
    return 1 + this.secondarySessionPages.length;
  }

  get shouldStop(): boolean {
    return this.maxExecutionMs - (Date.now() - this.startTime) < 10_000;
  }

  delay(): Promise<void> {
    const ms = this.backoffScrolls > 0 ? this.backoffDelayMs : this.requestDelayMs;
    if (this.backoffScrolls > 0) {
      this.backoffScrolls--;
      if (this.backoffScrolls === 0) {
        log.info("Extractor", `backoff resolved, returning to ${this.requestDelayMs}ms delay`);
      }
    }
    return new Promise((r) => setTimeout(r, ms));
  }

  protected async detectRateLimit(newMemberCount: number): Promise<boolean> {
    if (newMemberCount === 0) {
      const html = await this.page.content().catch(() => "");
      if (html.includes("captcha") || html.includes("temporarily blocked") || html.includes("unusual activity")) {
        this.rateLimitHits++;
        this.backoffScrolls = 5;
        log.warn("Extractor", `rate-limit signal detected (captcha/block), hit #${this.rateLimitHits}, backing off ${this.backoffDelayMs}ms for 5 scrolls`);
        return this.rateLimitHits >= this.maxRateLimitRetries;
      }
    }
    return false;
  }

  abstract extract(): Promise<{ extracted: number; nextCursor?: string; done: boolean; authState: AuthState }>;

  protected get timeRemainingMs(): number {
    return this.maxExecutionMs - (Date.now() - this.startTime);
  }

  protected get timeRemainingSec(): number {
    return Math.floor(this.timeRemainingMs / 1000);
  }

  protected get runtimeSec(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  protected async smartScroll(page: Page): Promise<{ scrolled: boolean; linkCount: number }> {
    return page.evaluate(() => {
      const beforeY = window.scrollY;
      const beforeCount = document.querySelectorAll('a[href]').length;
      window.scrollBy(0, 800);
      const afterY = window.scrollY;
      const afterCount = document.querySelectorAll('a[href]').length;
      return { scrolled: afterY !== beforeY, linkCount: Math.abs(afterCount - beforeCount) };
    });
  }

  protected async smartScrollDialog(page: Page, scrollBox: { x: number; y: number; width: number; height: number }): Promise<{ scrolled: boolean }> {
    const cx = scrollBox.x + scrollBox.width / 2;
    const cy = scrollBox.y + scrollBox.height / 2;
    const before = await page.evaluate(() => document.querySelectorAll('[role="dialog"] a[href]').length);
    await page.mouse.move(cx, cy);
    for (let s = 0; s < 3; s++) {
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(400);
    }
    const after = await page.evaluate(() => document.querySelectorAll('[role="dialog"] a[href]').length);
    return { scrolled: after !== before };
  }

  protected async scrollFeed(page: Page, linkSelector?: string): Promise<void> {
    const defaultSel = 'a[href*="profile.php?id="], a[href*="/user/"], a[href*="/groups/"][href*="/user/"], a[href*="facebook.com/"]';
    const target = await page.evaluate((sel: string) => {
      const userLinkSel = sel;

      const allDivs = document.querySelectorAll('div');
      for (let i = 0; i < allDivs.length; i++) {
        const el = allDivs[i] as HTMLElement;
        const linkCount = el.querySelectorAll(userLinkSel).length;
        if (linkCount < 2) continue;
        const style = window.getComputedStyle(el);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 20) {
          const rect = el.getBoundingClientRect();
          if (rect.height > 150 && rect.width > 150) {
            el.scrollTop += Math.min(el.clientHeight * 0.7, 600);
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, found: true };
          }
        }
      }
      return { x: window.innerWidth / 2, y: window.innerHeight / 2, found: false };
    }, linkSelector || defaultSel);

    if (!target.found) {
      await page.mouse.move(target.x, target.y);
      await page.mouse.wheel(0, 700);
    }
    await page.waitForTimeout(800);

    await page.mouse.move(target.x, target.y);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(400);

    if (!target.found) {
      await page.keyboard.press('End').catch(() => {});
    }
    await page.waitForTimeout(300);
  }

  protected async fetchPage(url: string): Promise<{ html: string; url: string }> {
    log.debug("Extractor", `navigating to ${url}`, { page: this.pagesFetched + 1 });
    try {
      await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: config.fbNavTimeoutMs });
      await this.page.waitForTimeout(1000);
      await this.page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {
        log.debug("Extractor", "networkidle timed out, continuing with loaded content");
      });
      await this.page.waitForTimeout(500);
      const html = await this.page.content();
      const finalUrl = this.page.url();
      this.pagesFetched++;
      return { html, url: finalUrl };
    } catch (err) {
      if (err instanceof Error && err.message.includes("Timeout")) {
        throw new ExtractionError(ErrorCodes.TIMEOUT, `Page navigation timeout: ${url}`);
      }
      throw new ExtractionError(ErrorCodes.NETWORK_ERROR, `Navigation error: ${String(err)}`);
    }
  }

  protected async checkCanceled(): Promise<boolean> {
    const status = await supabaseService.getJobStatus(this.ctx.jobId);
    return status === "canceled";
  }

  protected async processBatch(members: ExtractedMember[], typeOverride: string, platform: string = "facebook"): Promise<number> {
    let results = members.map((m) => ({ ...m, type: typeOverride }));
    if (this.ctx.skipDuplicates) {
      const existing = await supabaseService.getExistingIds(this.ctx.workspaceId, results.map((m) => m.fb_id));
      results = results.filter((m) => !existing.has(m.fb_id));
    }
    if (results.length === 0) return 0;
    try {
      await supabaseService.storeResults(this.ctx.jobId, this.ctx.workspaceId, results, platform);
      await supabaseService.incrementJobResultCount(this.ctx.jobId, results.length);
      return results.length;
    } catch (err) {
      log.error("Extractor", `processBatch failed: ${String(err)}`);
      return 0;
    }
  }

  protected buildMbasicUrl(path: string): string {
    const base = config.fbBaseUrl;
    return path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  }
}
