import type { Page } from "playwright";
import { IgBaseExtractor } from "./ig-base.js";
import { config } from "../config.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import type { AuthState, ExtractedMember, JobContext } from "../types.js";

const log = logger;

function parseIgUsername(sourceUrl: string): string {
  const trimmed = sourceUrl.trim().replace(/\/+$/, "");
  const m = trimmed.match(/instagram\.com\/([a-zA-Z0-9._]+)/i);
  if (m) return m[1];
  const bare = trimmed.replace(/^https?:\/\//, "");
  if (/^[a-zA-Z0-9._]{1,30}$/.test(bare)) return bare;
  throw new ExtractionError(ErrorCodes.INVALID_INPUT, "رابط حساب إنستجرام غير صالح. استخدم رابطاً مثل https://www.instagram.com/username/ أو اسم المستخدم فقط.");
}

interface IgUserRow {
  username: string;
  fullName: string;
  avatar: string;
}

export class IgFollowersExtractor extends IgBaseExtractor {
  private readonly tab: "followers" | "following";
  private totalCount: number | null = null;
  private flushedCount = 0;
  private lastProgressTs = 0;

  constructor(page: Page, ctx: JobContext, secondaryPages?: Array<{ sessionId: string; page: Page }>) {
    super(page, ctx, secondaryPages);
    this.tab = ctx.type === "ig_following" ? "following" : "followers";
  }

  async extract(): Promise<{ extracted: number; nextCursor?: string; done: boolean; authState: AuthState }> {
    const username = parseIgUsername(this.ctx.sourceUrl);
    const profileUrl = `${config.igBaseUrl}/${username}/`;

    log.info("IgFollowers", `starting: @${username} tab=${this.tab} sessions=${1 + this.secondarySessionPages.length}`);

    await this.navigateToProfile(profileUrl);

    if (await this.isPrivateAccount()) {
      throw new ExtractionError(
        ErrorCodes.INVALID_INPUT,
        "الحساب خاص — لا يمكن استخراج متابعيه. لا يمكن استخراج متابعي الحسابات الخاصة."
      );
    }

    this.totalCount = await this.readTotalCount();
    log.info("IgFollowers", `total ${this.tab} count: ${this.totalCount ?? "unknown"}`);

    const collected = new Map<string, ExtractedMember>();
    let emptyScrolls = 0;
    const MAX_EMPTY_SCROLLS = 6;
    let scrollCount = 0;

    if (!(await this.openDialog())) {
      throw new ExtractionError(ErrorCodes.EXTRACTION_FAILED, `تعذر فتح قائمة ${this.tab === "followers" ? "المتابعين" : "المتابَعين"}. تأكد من أن الحساب عام وأن الجلسة صالحة.`);
    }

    while (collected.size < this.ctx.maxResults && !this.shouldStop) {
      if (await this.checkCanceled()) break;

      scrollCount++;
      if (scrollCount % this.batchSizeForRest === 0) {
        log.info("IgFollowers", `rest ${this.restDelayMs}ms after ${this.batchSizeForRest} scrolls`);
        await this.restDelay();
      }
      await this.igScrollDelay();
      await this.scrollDialog();

      const rows = await this.collectRowsFromDialog();
      let newCount = 0;
      for (const row of rows) {
        if (!collected.has(row.username)) {
          collected.set(row.username, {
            fb_id: row.username,
            username: row.username,
            name: row.fullName || row.username,
            full_name: row.fullName || row.username,
            profile_url: `https://www.instagram.com/${row.username}/`,
            avatar_url: row.avatar || undefined,
            type: this.ctx.type,
          });
          newCount++;
        }
      }
      emptyScrolls = newCount === 0 ? emptyScrolls + 1 : 0;
      log.info("IgFollowers", `scroll #${scrollCount}: +${newCount} → ${collected.size} unique`);

      const html = await this.page.content().catch(() => "");
      if (this.detectIgBlocked(html, this.page.url())) {
        log.warn("IgFollowers", `block detected on session ${this.ctx.sessionId.slice(0, 8)} — rotating`);
        const switched = await this.handleIgBlocked();
        if (!switched) break;
        await this.navigateToProfile(profileUrl);
        if (!(await this.openDialog())) {
          log.warn("IgFollowers", `could not reopen dialog on session ${this.ctx.sessionId.slice(0, 8)} — continuing`);
        }
        emptyScrolls = 0;
        continue;
      }

      await this.flushIfNeeded(collected);
      await this.updateProgress(collected.size);

      if (emptyScrolls >= MAX_EMPTY_SCROLLS) {
        log.info("IgFollowers", `no new rows for ${MAX_EMPTY_SCROLLS} scrolls — dialog exhausted`);
        break;
      }
    }

    await this.flushRemaining(collected);
    const coverage = this.computeCoverage(collected.size, this.totalCount);
    log.info("IgFollowers", `done: ${collected.size} unique (coverage ${coverage ?? "N/A"}%)`);
    await this.updateIgProgress({
      phase: "completed",
      extracted: collected.size,
      total: this.totalCount,
      coverage_rate: coverage,
      tab: this.tab,
    });

    return { extracted: collected.size, done: true, authState: "authenticated" };
  }

  private async navigateToProfile(profileUrl: string): Promise<void> {
    try {
      await this.page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: config.igNavTimeoutMs });
      await this.page.waitForTimeout(2500);
    } catch (err) {
      throw new ExtractionError(ErrorCodes.NETWORK_ERROR, `فشل فتح صفحة الحساب: ${String(err).substring(0, 120)}`);
    }
  }

  private async isPrivateAccount(): Promise<boolean> {
    const html = await this.page.content().catch(() => "");
    const lower = html.toLowerCase();
    return (
      lower.includes("this account is private") ||
      lower.includes("account is private") ||
      lower.includes("هذا الحساب خاص") ||
      lower.includes("الحساب خاص")
    );
  }

  /** قراءة العدد الإجمالي من رابط العدّاد في رأس الملف */
  private async readTotalCount(): Promise<number | null> {
    const text = await this.page
      .evaluate((tab: string) => {
        const links = Array.from(document.querySelectorAll('header a[href*="/followers/"], header a[href*="/following/"]'));
        const target = links.find((a) => (a.getAttribute("href") || "").includes(`/${tab}/`));
        return target ? (target.textContent || "").trim() : "";
      }, this.tab)
      .catch(() => "");
    if (!text) return null;
    return this.parseIgCompactNumber(text);
  }

  /** فتح dialog المتابعين/المتابَعين بالنقر على العدّاد */
  private async openDialog(): Promise<boolean> {
    const clicked = await this.page
      .evaluate((tab: string) => {
        const links = Array.from(document.querySelectorAll('header a[href*="/followers/"], header a[href*="/following/"]'));
        const target = links.find((a) => (a.getAttribute("href") || "").includes(`/${tab}/`));
        if (target) {
          (target as HTMLElement).click();
          return true;
        }
        return false;
      }, this.tab)
      .catch(() => false);
    if (!clicked) return false;
    await this.page.waitForTimeout(2500);
    return this.page.evaluate(() => !!document.querySelector('div[role="dialog"]')).catch(() => false);
  }

  /** تمرير داخل dialog عبر عجلة الماوس فوق مركزه */
  private async scrollDialog(): Promise<void> {
    const box = await this.page
      .evaluate(() => {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) return null;
        const r = dialog.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })
      .catch(() => null);
    if (box && box.width > 0) {
      await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    }
    await this.page.mouse.wheel(0, 400);
    await this.page.waitForTimeout(600);
  }

  /** استخراج صفوف القائمة من DOM الـ dialog (username/full_name/avatar) */
  private async collectRowsFromDialog(): Promise<IgUserRow[]> {
    return this.page
      .evaluate(() => {
        const results: IgUserRow[] = [];
        const seen = new Set<string>();
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) return results;
        const links = dialog.querySelectorAll('a[href^="/"]');
        for (const a of links) {
          const href = a.getAttribute("href") || "";
          const m = href.match(/^\/([a-zA-Z0-9._]{1,30})\/?$/);
          if (!m) continue;
          const username = m[1];
          if (username === "accounts" || seen.has(username)) continue;
          seen.add(username);
          const parent = a.closest("div[role='button']") || a.parentElement;
          let fullName = "";
          if (parent) {
            const spans = parent.querySelectorAll("span");
            for (const s of spans) {
              const txt = (s.textContent || "").trim();
              if (txt && txt !== username && txt.length <= 100) {
                fullName = txt;
                break;
              }
            }
          }
          let avatar = "";
          const img = parent ? parent.querySelector("img") : null;
          if (img) {
            const src = img.getAttribute("src");
            if (src && src.startsWith("http")) avatar = src;
          }
          results.push({ username, fullName, avatar });
        }
        return results;
      })
      .catch(() => []);
  }

  private async flushIfNeeded(collected: Map<string, ExtractedMember>): Promise<void> {
    if (collected.size - this.flushedCount >= 50) {
      await this.flushNew(collected);
    }
  }

  private async flushRemaining(collected: Map<string, ExtractedMember>): Promise<void> {
    if (collected.size > this.flushedCount) {
      await this.flushNew(collected);
    }
  }

  private async flushNew(collected: Map<string, ExtractedMember>): Promise<void> {
    const all = Array.from(collected.values());
    const fresh = all.slice(this.flushedCount);
    if (fresh.length === 0) return;
    try {
      const n = await this.processBatch(fresh, this.ctx.type, "instagram");
      this.flushedCount += fresh.length;
      if (n > 0) log.info("IgFollowers", `flushed ${n}`);
    } catch (err) {
      log.warn("IgFollowers", `flush err: ${String(err).slice(0, 100)}`);
    }
  }

  private async updateProgress(extracted: number): Promise<void> {
    const now = Date.now();
    if (now - this.lastProgressTs < 6000) return;
    this.lastProgressTs = now;
    await this.updateIgProgress({
      phase: "scrolling",
      extracted,
      total: this.totalCount,
      coverage_rate: this.computeCoverage(extracted, this.totalCount),
      tab: this.tab,
    });
  }
}