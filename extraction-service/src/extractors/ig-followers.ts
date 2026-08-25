import type { Page } from "playwright";
import { IgBaseExtractor } from "./ig-base.js";
import { IgExtractionEngine, type IgCheckpoint } from "../services/ig-engine.js";
import { IgFriendshipsClient } from "../services/ig-friendships-client.js";
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

/** Cursor for the scroll dialog: the last username seen + how many rows the
 *  dialog already held when we stopped. On resume we scroll until the last
 *  checkpointed username reappears, then continue collecting NEW rows only. */
interface FollowersCursor {
  lastUsername: string | null;
  rowsInDialog: number;
}

export class IgFollowersExtractor extends IgBaseExtractor {
  private readonly tab: "followers" | "following";
  private totalCount: number | null = null;
  private flushedCount = 0;
  private engine: IgExtractionEngine | null = null;

  constructor(page: Page, ctx: JobContext, secondaryPages?: Array<{ sessionId: string; page: Page }>) {
    super(page, ctx, secondaryPages);
    this.tab = ctx.type === "ig_following" ? "following" : "followers";
  }

  async extract(): Promise<{ extracted: number; nextCursor?: string; done: boolean; authState: AuthState }> {
    const username = parseIgUsername(this.ctx.sourceUrl);
    const profileUrl = `${config.igBaseUrl}/${username}/`;

    // Engine wiring: heartbeat + checkpoint + session health for this job.
    const sessionIds = [this.ctx.sessionId, ...this.secondarySessionPages.map((s) => s.sessionId)];
    const engine = new IgExtractionEngine(
      {
        jobId: this.ctx.jobId,
        userId: this.ctx.userId,
        sessionIds,
        maxResults: this.ctx.maxResults,
      },
      {
        sourceKey: this.tab === "followers" ? "followers_list" : "following_list",
        label: this.tab,
        loadCheckpoint: () => this.loadCursor(),
        saveCheckpoint: async (cp) => this.saveCursor(cp),
      },
    );
    this.engine = engine;
    engine.setPhase("extracting");

    // Resume: a previous run may have checkpointed mid-scroll.
    const resumed = this.loadCursor();
    const collected = new Map<string, ExtractedMember>();
    let resumeFromUser: string | null = null;
    let resumeSkipBudget = 0;
    if (resumed?.cursor) {
      try {
        const parsed = JSON.parse(resumed.cursor) as FollowersCursor;
        resumeFromUser = parsed.lastUsername ?? null;
        resumeSkipBudget = (parsed.rowsInDialog ?? 0) + 60; // safety margin
        this.flushedCount = 0; // rows before the checkpoint are already stored
        log.info("IgFollowers", `resuming from checkpoint: last=${resumeFromUser}, skip budget=${resumeSkipBudget}`);
      } catch { /* fresh start */ }
    }

    log.info("IgFollowers", `starting: @${username} tab=${this.tab} sessions=${sessionIds.length}${resumeFromUser ? " (resume)" : ""}`);

    await this.navigateToProfile(profileUrl);

    if (await this.isPrivateAccount()) {
      throw new ExtractionError(
        ErrorCodes.INVALID_INPUT,
        "الحساب خاص — لا يمكن استخراج متابعيه. لا يمكن استخراج متابعي الحسابات الخاصة."
      );
    }

    this.totalCount = await this.readTotalCount();
    engine.setTotal(this.totalCount);
    log.info("IgFollowers", `total ${this.tab} count: ${this.totalCount ?? "unknown"}`);

    // FAST PATH — friendships API pagination (live-verified: 25/page,
    // next_max_id honored, ~984 users/min). Falls back to DOM scrolling
    // automatically on any failure (resolve, block, parse).
    const apiDone = await this.tryApiExtraction(engine, username, collected, resumeFromUser);
    if (apiDone !== null) {
      await this.scrapeBios(collected);
      await this.flushRemaining(collected);
      const totalUnique = this.previouslyStored() + collected.size;
      const coverage = this.computeCoverage(totalUnique, this.totalCount);
      log.info("IgFollowers", `api path done: ${totalUnique} unique (coverage ${coverage ?? "N/A"}%)`);
      engine.setPhase("completed");
      await engine.heartbeat(true);
      await this.updateIgProgress({
        phase: "completed",
        extracted: totalUnique,
        total: this.totalCount,
        coverage_rate: coverage,
        tab: this.tab,
      });
      return { extracted: totalUnique, done: true, authState: "authenticated" };
    }
    log.warn("IgFollowers", `api path unavailable — falling back to DOM scrolling`);
    engine.snapshot();

    let emptyScrolls = 0;
    const MAX_EMPTY_SCROLLS = 6;
    let scrollCount = 0;

    if (!(await this.openDialog())) {
      throw new ExtractionError(ErrorCodes.EXTRACTION_FAILED, `تعذر فتح قائمة ${this.tab === "followers" ? "المتابعين" : "المتابَعين"}. تأكد من أن الحساب عام وأن الجلسة صالحة.`);
    }

    while (collected.size + this.previouslyStored() < this.ctx.maxResults && !this.shouldStop) {
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
      let lastUsername: string | null = null;
      for (const row of rows) {
        lastUsername = row.username;
        // Resume: skip everything up to and including the checkpointed user.
        if (resumeFromUser) {
          if (row.username === resumeFromUser) resumeFromUser = null; // caught up
          else continue;
        }
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
      // Empty-scroll exhaustion only counts in NEW territory. While catching
      // up to the checkpoint (resumeFromUser set), the dialog reopens from
      // the top and we scroll through already-seen rows — naturally +0.
      const inCatchUp = resumeFromUser !== null;
      if (inCatchUp) {
        resumeSkipBudget -= rows.length;
        if (resumeSkipBudget <= 0) {
          // Checkpointed user no longer exists (renamed/removed) — give up
          // catching up and continue from the current dialog position.
          log.warn("IgFollowers", `checkpoint user not found after budget — continuing from current position`);
          resumeFromUser = null;
        }
      }
      emptyScrolls = newCount === 0 && !inCatchUp ? emptyScrolls + 1 : 0;
      engine.addResults(newCount);
      engine.setCursor(JSON.stringify({ lastUsername, rowsInDialog: rows.length } satisfies FollowersCursor));
      if (!inCatchUp || newCount > 0) {
        log.info("IgFollowers", `scroll #${scrollCount}: +${newCount} → ${this.previouslyStored() + collected.size} unique${inCatchUp ? " (catching up)" : ""}`);
      }

      // Block check every 3rd scroll: page.content() serializes the entire
      // DOM (~100ms+ each call). URL checks are cheap and run every scroll.
      const cheapBlockSignal = this.page.url().includes("/challenge/") || this.page.url().includes("/accounts/login");
      if (cheapBlockSignal || scrollCount % 3 === 0) {
        const html = cheapBlockSignal ? "" : await this.page.content().catch(() => "");
        if (cheapBlockSignal || this.detectIgBlocked(html, this.page.url())) {
          log.warn("IgFollowers", `block detected on session ${this.ctx.sessionId.slice(0, 8)} — rotating`);
          const usable = engine.recordSessionFailure(this.ctx.sessionId, new ExtractionError(ErrorCodes.AUTH_FAILED, "IG block/checkpoint detected"));
          const switched = usable ? await this.switchToNextSession() : false;
          if (!switched) {
            await this.handleIgBlocked();
            break;
          }
          engine.recordSessionSuccess(this.ctx.sessionId);
          await this.navigateToProfile(profileUrl);
          if (!(await this.openDialog())) {
            log.warn("IgFollowers", `could not reopen dialog on session ${this.ctx.sessionId.slice(0, 8)} — continuing`);
          }
          emptyScrolls = 0;
          continue;
        }
        engine.recordSessionSuccess(this.ctx.sessionId);
      }

      await this.flushIfNeeded(collected);
      await engine.heartbeat();

      if (emptyScrolls >= MAX_EMPTY_SCROLLS) {
        log.info("IgFollowers", `no new rows for ${MAX_EMPTY_SCROLLS} scrolls — dialog exhausted`);
        break;
      }
    }

    await this.scrapeBios(collected);
    await this.flushRemaining(collected);
    const totalUnique = this.previouslyStored() + collected.size;
    const coverage = this.computeCoverage(totalUnique, this.totalCount);
    log.info("IgFollowers", `done: ${totalUnique} unique (coverage ${coverage ?? "N/A"}%)`);
    engine.setPhase("completed");
    await engine.heartbeat(true);
    await this.updateIgProgress({
      phase: "completed",
      extracted: totalUnique,
      total: this.totalCount,
      coverage_rate: coverage,
      tab: this.tab,
    });

    return { extracted: totalUnique, done: true, authState: "authenticated" };
  }

  /** Rows stored by a previous (checkpointed) run of the same job. */
  private previouslyStored(): number {
    return this.resumeStoredCount;
  }
  private resumeStoredCount = 0;

  private cursorKey(): string {
    return `ig_${this.ctx.jobId}_cursor`;
  }
  private loadCursor(): IgCheckpoint | null {
    const raw = this.resumeCursorRaw;
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { cursor?: string; extracted?: number };
      this.resumeStoredCount = parsed.extracted ?? 0;
      return { source: this.tab, cursor: parsed.cursor ?? null, extracted: parsed.extracted ?? 0, saved_at: "" };
    } catch {
      return null;
    }
  }
  private resumeCursorRaw: string | null = null;

  /** Checkpoints live in job config (survives service restarts, visible in
   *  job row) — written via storeProgress-adjacent updateJob calls. */
  private async saveCursor(cp: IgCheckpoint): Promise<void> {
    // Throttled by engine.heartbeat; persisted into job config.cursor.
    this.pendingCursorValue = JSON.stringify({ cursor: cp.cursor, extracted: this.previouslyStored() + (this.engine?.snapshot().unique_extracted ?? 0) });
    this.lastCursorSaveMs = Date.now();
    if (this.lastCursorSaveMs - (this.lastCursorPersistMs ?? 0) < 15_000) return; // persist at most every 15s
    this.lastCursorPersistMs = this.lastCursorSaveMs;
    await this.supabaseUpdateCursor(this.pendingCursorValue);
  }
  private pendingCursorValue: string | null = null;
  private lastCursorSaveMs = 0;
  private lastCursorPersistMs: number | null = null;

  private async supabaseUpdateCursor(cursorJson: string): Promise<void> {
    const { supabaseService } = await import("../services/supabase.js");
    const job = await supabaseService.getJob(this.ctx.jobId).catch(() => null);
    const cfg = (job?.config || {}) as Record<string, unknown>;
    await supabaseService.updateJob(this.ctx.jobId, {
      config: { ...cfg, cursor: cursorJson },
    }).catch(() => {});
  }

  /** Called by runExtractionJob wiring: seed resume state from job config. */
  seedResume(cursorRaw: string | null): void {
    this.resumeCursorRaw = cursorRaw ?? null;
  }

  /** FAST PATH: friendships API pagination. The followers dialog itself
   *  issues GET /api/v1/friendships/<id>/<tab>/ when it opens — we capture
   *  that exact response (id + first page + next_max_id), then paginate the
   *  API directly. Returns null to continue DOM scrolling on the SAME open
   *  dialog (no wasted work). */
  private async tryApiExtraction(
    engine: IgExtractionEngine,
    username: string,
    collected: Map<string, ExtractedMember>,
    resumeFromUser: string | null,
  ): Promise<boolean | null> {
    interface CapturedDialog {
      userId: string;
      users: { username: string; full_name?: string; profile_pic_url?: string; pk?: string }[];
      nextMaxId: string | null;
    }
    const box: { dialog: CapturedDialog | null } = { dialog: null };
    const responseHandler = async (resp: import("playwright").Response) => {
      try {
        const url = resp.url();
        const m = url.match(/\/api\/v1\/friendships\/(\d+)\/(followers|following)\//);
        if (!m || m[2] !== this.tab) return;
        if (resp.status() !== 200) return;
        const j = await resp.json().catch(() => null);
        if (!j || !Array.isArray(j.users)) return;
        box.dialog = { userId: m[1], users: j.users, nextMaxId: (j.next_max_id as string | null) ?? null };
      } catch { /* capture must never throw */ }
    };
    this.page.on("response", responseHandler);
    try {
      const opened = await this.openDialog();
      if (!opened) return null;
      await this.page.waitForTimeout(2500);
    } finally {
      this.page.off("response", responseHandler);
    }
    const captured = box.dialog;
    if (!captured) {
      log.warn("IgFollowers", `api path: dialog fired no friendships request — continuing DOM on open dialog`);
      return null;
    }
    const cap = captured;
    log.info("IgFollowers", `api path: captured dialog request (id ${cap.userId}, ${cap.users.length} rows, cursor=${cap.nextMaxId ? "yes" : "no"})`);

    const client = new IgFriendshipsClient();
    let maxId: string | null = cap.nextMaxId;
    let consecutiveFailures = 0;
    let pages = 0;

    // First page: users already captured from the dialog's own request.
    let newCount = 0;
    let lastUsername: string | null = null;
    for (const u of cap.users) {
      lastUsername = u.username;
      if (resumeFromUser) {
        if (u.username === resumeFromUser) resumeFromUser = null;
        else continue;
      }
      if (u.username && !collected.has(u.username)) {
        collected.set(u.username, {
          fb_id: u.username,
          username: u.username,
          name: u.full_name || u.username,
          full_name: u.full_name || u.username,
          profile_url: `https://www.instagram.com/${u.username}/`,
          avatar_url: u.profile_pic_url || undefined,
          type: this.ctx.type,
        });
        newCount++;
      }
    }
    engine.addResults(newCount);
    engine.setCursor(JSON.stringify({ api: true, maxId, lastUsername, rows: cap.users.length }));
    await this.flushIfNeeded(collected);
    await engine.heartbeat();
    if (!maxId) {
      // Instagram sometimes omits next_max_id on the dialog's very first
      // response even when more users exist. Probe one real API page before
      // declaring exhaustion — otherwise we stop at ~43 of potentially millions.
      log.info("IgFollowers", `api path: first dialog response had no cursor — probing one API page to confirm`);
      const probe = await client.fetchPage(this.page, cap.userId, this.tab, null);
      if (!probe || probe.users.length === 0) {
        log.info("IgFollowers", `api path: list genuinely exhausted on first page`);
        return true;
      }
      // Fold the probed page in and continue the normal pagination loop.
      for (const u of probe.users) {
        if (u.username && !collected.has(u.username)) {
          collected.set(u.username, {
            fb_id: u.username, username: u.username,
            name: u.fullName || u.username, full_name: u.fullName || u.username,
            profile_url: `https://www.instagram.com/${u.username}/`,
            avatar_url: u.avatar || undefined, type: this.ctx.type,
          });
        }
      }
      engine.addResults(probe.users.length);
      if (!probe.nextMaxId) {
        const total = this.previouslyStored() + collected.size;
        if (total < 100) {
          log.warn("IgFollowers", `api path: probed page had no cursor and only ${total} harvested (<100) — IG likely blocking API pagination, falling back to DOM scrolling`);
          return null;
        }
        log.info("IgFollowers", `api path: probed page had no cursor — list exhausted`);
        await this.flushIfNeeded(collected);
        return true;
      }
      maxId = probe.nextMaxId;
      log.info("IgFollowers", `api path: probe confirmed more users (cursor=${maxId ? "yes" : "no"}), continuing`);
    }

    while (this.previouslyStored() + collected.size < this.ctx.maxResults && !this.shouldStop) {
      if (await this.checkCanceled()) break;

      const page = await client.fetchPage(this.page, cap.userId, this.tab, maxId);
      if (!page) {
        consecutiveFailures++;
        engine.addError();
        if (consecutiveFailures >= 3) {
          log.warn("IgFollowers", `api path: 3 consecutive failures — finishing with what we have`);
          return true;
        }
        await new Promise((r) => setTimeout(r, 2000 * consecutiveFailures));
        continue;
      }
      consecutiveFailures = 0;
      pages++;

      newCount = 0;
      for (const u of page.users) {
        lastUsername = u.username;
        if (resumeFromUser) {
          if (u.username === resumeFromUser) resumeFromUser = null;
          else continue;
        }
        if (!collected.has(u.username)) {
          collected.set(u.username, {
            fb_id: u.username,
            username: u.username,
            name: u.fullName || u.username,
            full_name: u.fullName || u.username,
            profile_url: `https://www.instagram.com/${u.username}/`,
            avatar_url: u.avatar || undefined,
            type: this.ctx.type,
          });
          newCount++;
        }
      }
      engine.addResults(newCount);
      engine.setCursor(JSON.stringify({ api: true, maxId: page.nextMaxId, lastUsername, rows: page.users.length }));
      if (pages % 10 === 0 || !page.nextMaxId) {
        log.info("IgFollowers", `api page #${pages}: +${newCount} → ${this.previouslyStored() + collected.size} unique (cursor=${page.nextMaxId ? "yes" : "end"})`);
      }

      await this.flushIfNeeded(collected);
      await engine.heartbeat();

      if (!page.nextMaxId) {
        const total = this.previouslyStored() + collected.size;
        // If the API yielded only a tiny fraction of the account's followers,
        // Instagram is blocking pagination (no next_max_id despite more users).
        // Fall through to DOM scrolling instead of declaring success at ~40.
        if (total < 100) {
          log.warn("IgFollowers", `api path: no next_max_id but only ${total} harvested (<100) — IG likely blocking API pagination, falling back to DOM scrolling`);
          return null;
        }
        log.info("IgFollowers", `api path: no next_max_id — list exhausted`);
        return true;
      }
      maxId = page.nextMaxId;

      // Rest cycle every 40 pages (~1000 users) keeps the pattern browser-like.
      if (pages % 40 === 0) {
        log.info("IgFollowers", `api path: resting ${this.restDelayMs}ms after ${pages} pages`);
        await this.restDelay();
      }
    }
    return true;
  }

  private extractApiCursor(raw: string | undefined | null): string | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { api?: boolean; maxId?: string | null };
      return parsed.api && parsed.maxId ? parsed.maxId : null;
    } catch {
      return null;
    }
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

  /** قراءة العدد الإجمالي من عدّاد رأس الملف — يدعم الشكلين:
   *  القديم a[href*="/followers/"] والجديد a[href="#"] "686M followers" */
  private async readTotalCount(): Promise<number | null> {
    const text = await this.page
      .evaluate((tab: string) => {
        const wantFollowing = tab === "following";
        // Old DOM: counter links point at /followers/ or /following/
        const link = Array.from(document.querySelectorAll('header a[href*="/followers/"], header a[href*="/following/"]'))
          .find((a) => (a.getAttribute("href") || "").includes(`/${tab}/`));
        if (link) return (link.textContent || "").trim();
        // New DOM: plain anchors/buttons "686M followers"
        const cands = Array.from(document.querySelectorAll('header a, main a, header button, header [role="button"]'));
        for (const el of cands) {
          const txt = (el.textContent || "").trim();
          if (!txt || txt.length > 40 || !/\d/.test(txt)) continue;
          const lower = txt.toLowerCase();
          const isFollowers = /followers/.test(lower);
          const isFollowing = /following/.test(lower);
          if (wantFollowing ? isFollowing : isFollowers) return txt;
        }
        return "";
      }, this.tab)
      .catch(() => "");
    if (!text) return null;
    return this.parseIgCompactNumber(text.replace(/followers|following|متابع|يتابع/gi, ""));
  }

  /** فتح dialog المتابعين/المتابَعين: نقر العدّاد بالنص (DOM الجديد)
   *  مع ال fallback على روابط /followers/ القديمة. يعيد المحاولة عدة مرات
   *  لأن IG يحمّل العدّاد أحياناً متأخراً أو يعرض spinner أولاً. */
  private async openDialog(): Promise<boolean> {
    const MAX_ATTEMPTS = 4;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await this.page.waitForTimeout(1500);
      const clicked = await this.page
        .evaluate((tab: string) => {
          const wantFollowing = tab === "following";
          // Old DOM first — explicit links are unambiguous
          const oldLink = Array.from(document.querySelectorAll('a[href*="/followers/"], a[href*="/following/"]'))
            .find((a) => (a.getAttribute("href") || "").includes(`/${tab}/`)) as HTMLElement | undefined;
          if (oldLink) { oldLink.click(); return true; }
          // New DOM: text counters on a[href="#"] / buttons / sections / lists
          // in the profile header. IG renders these in different containers
          // (header, main, section, ul) so we cast a wide net.
          const cands = Array.from(
            document.querySelectorAll('header a, main a, header button, main button, section a, section button, ul a, ul button, li a, [role="button"], [role="tab"]'),
          ) as HTMLElement[];
          for (const el of cands) {
            const txt = (el.textContent || "").trim();
            if (!txt || txt.length > 40 || !/\d/.test(txt)) continue;
            const lower = txt.toLowerCase();
            const isFollowers = /followers/.test(lower);
            const isFollowing = /following/.test(lower);
            if (wantFollowing ? isFollowing : isFollowers) { el.click(); return true; }
          }
          return false;
        }, this.tab)
        .catch(() => false);
      if (!clicked) continue;
      await this.page.waitForTimeout(2500);
      const opened = await this.page.evaluate(() => !!document.querySelector('div[role="dialog"]')).catch(() => false);
      if (opened) return true;
    }
    return false;
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
    await this.page.mouse.wheel(0, 600);
    await this.page.waitForTimeout(400);
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
      .catch(() => [] as IgUserRow[]);
  }

  /** Scrape public bio (phone/email) for each collected user by fetching the
   *  profile HTML through the logged-in session. Runs in bounded parallel
   *  batches after extraction completes so it never slows the scroll loop.
   *  The enrichment service then matches these contacts against the data DBs.
   *  Users without a phone/email in their bio are left untouched (no error). */
  private async scrapeBios(collected: Map<string, ExtractedMember>): Promise<void> {
    const all = Array.from(collected.values());
    if (all.length === 0) return;
    const BATCH = 5;
    let withContact = 0;
    log.info("IgFollowers", `scraping bios for ${all.length} users (batch=${BATCH} parallel)`);

    for (let i = 0; i < all.length; i += BATCH) {
      const slice = all.slice(i, i + BATCH);
      const results = await Promise.all(
        slice.map((m) =>
          this.page
            .evaluate(async (user: string | undefined) => {
              if (!user) return null;
              try {
                const r = await fetch(`https://www.instagram.com/${user}/`, { credentials: "include" });
                if (!r.ok) return null;
                return await r.text();
              } catch {
                return null;
              }
            }, m.username)
            .then((html: string | null) => {
              if (!html) return null;
              const bioMatch = html.match(/"biography":"([^"]*)"/);
              const bio = bioMatch ? bioMatch[1].replace(/\\u[\dA-Fa-f]{4}/g, (s) => {
                try { return JSON.parse('"' + s + '"'); } catch { return ""; }
              }) : "";
              const phone = bio.match(/(?:\+?\d[\d\s().-]{7,}\d)/);
              const email = bio.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
              // Some accounts expose a public contact field directly.
              const pubPhone = html.match(/"public_phone_number":"([^"]*)"/);
              const pubEmail = html.match(/"public_email":"([^"]*)"/);
              return {
                bio_phone: (phone?.[0] || pubPhone?.[1] || "").replace(/[\s().-]/g, "").slice(0, 20) || null,
                bio_email: (email?.[0] || pubEmail?.[1] || "").toLowerCase().slice(0, 120) || null,
              };
            })
            .catch(() => null),
        ),
      );
      for (let k = 0; k < slice.length; k++) {
        const r = results[k];
        if (!r) continue;
        if (r.bio_phone) { slice[k].bio_phone = r.bio_phone; done++; withContact++; }
        if (r.bio_email) { slice[k].bio_email = r.bio_email; done++; withContact++; }
      }
      // Gentle pacing between batches to avoid IG rate/ID blocks.
      await this.page.waitForTimeout(800);
    }
    log.info("IgFollowers", `bio scrape complete: ${withContact} users with contact info (out of ${all.length})`);
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
}
