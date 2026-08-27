import type { Page } from "playwright";
import { IgBaseExtractor } from "./ig-base.js";
import { IgExtractionEngine, type IgCheckpoint } from "../services/ig-engine.js";
import { IgFriendshipsClient } from "../services/ig-friendships-client.js";
import { evaluateCoverageGate, classifyDomExhaustion, type IgStopReason } from "../services/ig-stop-reason.js";
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

/** Saved cursor shapes (API fast-path vs DOM fallback). */
interface SavedCursorShape {
  api?: boolean;
  maxId?: string | null;
  lastUsername?: string | null;
  rows?: number;
  rowsInDialog?: number;
}

// --- tuning constants -------------------------------------------------------
/** Rounds of open-dialog + listen for the friendships response before giving
 *  up on the API path. Each round re-opens the dialog; a listener miss on one
 *  round no longer silently kills the fast path (the 51-row failure). */
const DIALOG_CAPTURE_ROUNDS = 3;
const CAPTURE_WAIT_MS = 8_000;
/** Probes issued when the captured first page carried no cursor, before any
 *  "exhausted" claim. IG soft-blocks look exactly like missing cursors. */
const CURSOR_PROBE_ATTEMPTS = 3;
const CURSOR_PROBE_GAP_MS = 5_000;
/** Below this many harvested users, a missing next_max_id is a BLOCK signal,
 *  not exhaustion — fall through to DOM instead of pausing at <1% coverage. */
const API_MIN_HARVEST_FOR_EXHAUSTED_CLAIM = 100;
/** DOM patience: two full empty-scroll cycles with recovery between them,
 *  replacing the old single 6-empty-scroll give-up that ended jobs in <60s. */
const EMPTY_SCROLLS_PER_CYCLE = 6;
const DOM_EXHAUSTION_CYCLES = 2;
const BETWEEN_CYCLE_REST_MS = 25_000;

export class IgFollowersExtractor extends IgBaseExtractor {
  private readonly tab: "followers" | "following";
  private totalCount: number | null = null;
  private flushedCount = 0;
  private engine: IgExtractionEngine | null = null;
  /** Resume-safe positions tracked continuously so the coverage gate can emit
   *  a meaningful cursor whenever it decides the job must pause, not end. */
  private lastApiMaxId: string | null = null;
  private lastDomCursor: FollowersCursor = { lastUsername: null, rowsInDialog: 0 };

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
      const shape = this.savedShape();
      if (shape?.api && shape.maxId) {
        log.info("IgFollowers", `resuming from API cursor maxId=${String(shape.maxId).slice(0, 24)}…`);
      } else {
        try {
          const parsed = JSON.parse(resumed.cursor) as FollowersCursor;
          resumeFromUser = parsed.lastUsername ?? null;
          resumeSkipBudget = (parsed.rowsInDialog ?? 0) + 60; // safety margin
          this.flushedCount = 0; // rows before the checkpoint are already stored
          log.info("IgFollowers", `resuming from checkpoint: last=${resumeFromUser}, skip budget=${resumeSkipBudget}`);
        } catch { /* fresh start */ }
      }
    }

    log.info("IgFollowers", `starting: @${username} tab=${this.tab} sessions=${sessionIds.length}${resumeFromUser || this.savedShape()?.api ? " (resume)" : ""}`);

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

    // FAST PATH — friendships API pagination (live-verified: ~25/page,
    // next_max_id honored). Reliable capture: rounds of open+listen instead
    // of a single-shot listener. Falls back to DOM scrolling automatically.
    const apiStop = await this.tryApiExtraction(engine, username, collected, resumeFromUser);
    if (apiStop !== null) {
      return this.finish(engine, collected, apiStop);
    }
    log.warn("IgFollowers", `api path unavailable — falling back to DOM scrolling`);
    engine.snapshot();

    const domStop = await this.domScrollExtraction(engine, profileUrl, collected, resumeFromUser, resumeSkipBudget);
    return this.finish(engine, collected, domStop);
  }

  /** Shared completion: unified counters, internal stop_reason telemetry and
   *  the coverage gate — below-target results pause with a cursor instead of
   *  silently completing at ~0% (the reported production failure). */
  private async finish(
    engine: IgExtractionEngine,
    collected: Map<string, ExtractedMember>,
    stopReason: IgStopReason,
  ): Promise<{ extracted: number; nextCursor?: string; done: boolean; authState: AuthState }> {
    await this.scrapeBios(collected);
    await this.flushRemaining(collected);
    const totalUnique = this.previouslyStored() + collected.size;
    const gate = evaluateCoverageGate({ stored: totalUnique, total: this.totalCount });
    log.info("IgFollowers", `stop: reason=${stopReason} stored=${totalUnique}/${this.totalCount ?? "?"} coverage=${gate.coverage ?? "N/A"}% gate=${gate.reason}`);
    engine.setPhase("completed");
    await engine.heartbeat(true);
    await this.updateIgProgress({
      phase: "completed",
      extracted: totalUnique,
      total: this.totalCount,
      coverage_rate: gate.coverage,
      tab: this.tab,
      stop_reason: stopReason, // internal telemetry — never rendered to users
    });

    // Below target → pause with a resumable cursor instead of silently
    // completing at ~0% (the reported production failure). A user-requested
    // max_results ceiling or an explicit cancel is a legitimate complete.
    if (!gate.allowComplete && stopReason !== "canceled" && stopReason !== "max_results_reached") {
      const cursorPayload = JSON.stringify({ cursor: this.resumeSafeCursor(), extracted: totalUnique });
      return { extracted: totalUnique, done: false, nextCursor: cursorPayload, authState: "authenticated" };
    }
    return { extracted: totalUnique, done: true, authState: "authenticated" };
  }

  /** Best-known position to hand back to the queue when pausing below target. */
  private resumeSafeCursor(): string {
    if (this.lastApiMaxId) return JSON.stringify({ api: true, maxId: this.lastApiMaxId, rows: 0 });
    return JSON.stringify(this.lastDomCursor satisfies FollowersCursor);
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

  /** Parse the doubly-nested saved cursor into its inner shape (+count). */
  private savedShape(): (SavedCursorShape & { extracted?: number }) | null {
    if (!this.resumeCursorRaw) return null;
    try {
      const outer = JSON.parse(this.resumeCursorRaw) as { cursor?: string | null; extracted?: number };
      if (outer?.cursor) {
        const inner = JSON.parse(outer.cursor) as SavedCursorShape;
        return { ...inner, extracted: outer.extracted };
      }
    } catch { /* fall through */ }
    try {
      return JSON.parse(this.resumeCursorRaw) as SavedCursorShape & { extracted?: number };
    } catch {
      return null;
    }
  }

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

  /** Single ingestion point: adds only genuinely-new users, returns the NEW
   *  count. Fixes the old probed-page branch that added duplicates into the
   *  progress counters (users.length instead of the unique delta). */
  private ingestUsers(
    collected: Map<string, ExtractedMember>,
    users: Array<{ username: string; fullName?: string; name?: string; avatar?: string; profile_pic_url?: string }>,
  ): number {
    let newCount = 0;
    for (const u of users) {
      const uname = u.username;
      if (!uname || collected.has(uname)) continue;
      const fullName = u.fullName ?? u.name ?? "";
      const avatar = u.avatar ?? u.profile_pic_url ?? "";
      collected.set(uname, {
        fb_id: uname,
        username: uname,
        name: fullName || uname,
        full_name: fullName || uname,
        profile_url: `https://www.instagram.com/${uname}/`,
        avatar_url: avatar || undefined,
        type: this.ctx.type,
      });
      newCount++;
    }
    return newCount;
  }

  /** Rotate off a stagnating primary session onto a live secondary.
   *  Marks the session degraded (backoff-aware), verifies liveness via the
   *  shared switchToNextSession() (which checks page.isClosed()), then
   *  re-navigates to the target profile. Returns false when nothing viable. */
  private async rotateOffStagnantSession(engine: IgExtractionEngine, profileUrl: string): Promise<boolean> {
    if (this.secondarySessionPages.length === 0) return false;
    const usable = engine.recordSessionFailure(
      this.ctx.sessionId,
      new ExtractionError(ErrorCodes.EXTRACTION_FAILED, "session stagnant: repeated exhaustion cycles with zero growth"),
    );
    if (!usable) return false;
    const switched = await this.switchToNextSession();
    if (!switched) return false;
    engine.recordSessionSuccess(this.ctx.sessionId);
    this.stagnationRotations++;
    log.info("IgFollowers", `stagnation rotation #${this.stagnationRotations}: switched to another live session`);
    await this.navigateToProfile(profileUrl);
    return true;
  }
  private stagnationRotations = 0;

  /** Detect IG's explicit followers-list cap notice ("Only … can see all
   *  followers"). Returns true when the dialog renders the platform limit —
   *  a REAL data boundary, distinct from throttling/stagnation. */
  private async dialogShowsPlatformLimit(): Promise<boolean> {
    const txt = await this.page
      .evaluate(() => document.querySelector('div[role="dialog"]')?.textContent || "")
      .catch(() => "");
    return /can see all\s*(followers|following)/i.test(txt) || /لا يمكن عرض كافة المتابعين/.test(txt);
  }

  /** FAST PATH: friendships API pagination. We round-robin open+listen for
   *  the dialog's own GET /api/v1/friendships/<id>/<tab>/ (id + first page +
   *  cursor), then paginate directly. Returns an IgStopReason to finish, or
   *  null to continue DOM scrolling on the SAME open dialog (no wasted work). */
  private async tryApiExtraction(
    engine: IgExtractionEngine,
    username: string,
    collected: Map<string, ExtractedMember>,
    resumeFromUser: string | null,
  ): Promise<IgStopReason | null> {
    interface CapturedDialog {
      userId: string;
      users: { username: string; full_name?: string; profile_pic_url?: string; pk?: string }[];
      nextMaxId: string | null;
    }
    let captured: CapturedDialog | null = null;
    let openedOnce = false;

    for (let round = 1; round <= DIALOG_CAPTURE_ROUNDS && !captured; round++) {
      if (round > 1) await this.page.waitForTimeout(1500);
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
        openedOnce = (await this.openDialog()) || openedOnce;
        if (!openedOnce) continue;
        // Give the dialog's own request time to fire and be captured.
        for (let i = 0; i < CAPTURE_WAIT_MS / 500 && !box.dialog; i++) {
          await this.page.waitForTimeout(500);
        }
      } finally {
        this.page.off("response", responseHandler);
      }
      captured = box.dialog;
    }

    if (!captured) {
      log.warn("IgFollowers", `api path: no friendships request captured across ${DIALOG_CAPTURE_ROUNDS} dialog opens — continuing DOM`);
      return null;
    }
    const cap = captured;
    const saved = this.savedShape();
    const resumingApiCursor = !!(saved?.api && saved.maxId);

    log.info(
      "IgFollowers",
      `api path: captured dialog request (id ${cap.userId}, ${cap.users.length} rows, cursor=${cap.nextMaxId ? "yes" : "no"})${resumingApiCursor ? " [resuming from saved API cursor]" : ""}`,
    );

    const client = new IgFriendshipsClient();

    // First page: fold in the dialog-captured users UNLESS we are resuming
    // from a saved API cursor (those rows precede our position and are
    // already stored — ingesting them would only inflate local memory).
    if (!resumingApiCursor) {
      const relevant = resumeFromUser ? this.sliceUntilResumeUser(cap.users.map((u) => ({ username: u.username, fullName: u.full_name, avatar: u.profile_pic_url })), resumeFromUser) : cap.users;
      const newCount = this.ingestUsers(collected, relevant);
      engine.addResults(newCount);
      engine.setCursor(JSON.stringify({ api: true, maxId: cap.nextMaxId, lastUsername: relevant.at(-1)?.username ?? null, rows: relevant.length }));
      await this.flushIfNeeded(collected);
      await engine.heartbeat();
    }

    let maxId: string | null = resumingApiCursor ? String(saved!.maxId) : cap.nextMaxId;
    this.lastApiMaxId = maxId;
    let consecutiveFetchFailures = 0;
    let pageCount = 0;

    if (!maxId) {
      // Instagram sometimes omits next_max_id on the dialog's very first
      // response even when more users exist — and soft-blocks can LOOK the
      // same. Probe repeatedly (with gaps) before concluding anything.
      let probedUsers: Array<{ username: string; fullName?: string; avatar?: string }> = [];
      let probedNext: string | null = null;
      for (let attempt = 1; attempt <= CURSOR_PROBE_ATTEMPTS; attempt++) {
        if (attempt > 1) await this.page.waitForTimeout(CURSOR_PROBE_GAP_MS);
        log.info("IgFollowers", `api path: first response had no cursor — probe ${attempt}/${CURSOR_PROBE_ATTEMPTS}`);
        const probe = await client.fetchPage(this.page, cap.userId, this.tab, null);
        if (probe && probe.users.length > 0) {
          probedUsers = probe.users;
          probedNext = probe.nextMaxId;
          break;
        }
      }
      if (probedUsers.length === 0) {
        // Every real API probe came back empty/blocked. A few dozen rows from
        // the dialog are all IG will release right now — DOM fallback next.
        const harvested = this.previouslyStored() + collected.size;
        log.warn("IgFollowers", `api path: ${CURSOR_PROBE_ATTEMPTS} probes failed (harvested=${harvested}) — IG likely blocking API pagination, falling back to DOM scrolling`);
        return null;
      }
      // Fold the probed page in (unique delta only — never users.length).
      const newCount = this.ingestUsers(collected, probedUsers);
      engine.addResults(newCount);
      engine.setCursor(JSON.stringify({ api: true, maxId: probedNext, lastUsername: probedUsers.at(-1)?.username ?? null, rows: probedUsers.length }));
      await this.flushIfNeeded(collected);
      await engine.heartbeat();
      if (!probedNext) {
        // Tiny harvest + no cursor = API pagination BLOCKED, not exhausted
        // (the exact production failure signature). DOM scrolling gets more;
        // genuine single-page lists are tiny accounts where DOM also ends fast.
        const harvested = this.previouslyStored() + collected.size;
        if (harvested < API_MIN_HARVEST_FOR_EXHAUSTED_CLAIM) {
          log.warn("IgFollowers", `api path: probe rows but no cursor and only ${harvested} harvested (<${API_MIN_HARVEST_FOR_EXHAUSTED_CLAIM}) — falling back to DOM scrolling`);
          return null;
        }
        log.info("IgFollowers", `api path: probe produced rows but still no cursor — list exhausted (${harvested})`);
        return "api_list_exhausted";
      }
      maxId = probedNext;
      log.info("IgFollowers", `api path: probe confirmed more users, continuing pagination`);
    }
    this.lastApiMaxId = maxId;

    while (this.previouslyStored() + collected.size < this.ctx.maxResults && !this.shouldStop) {
      if (await this.checkCanceled()) return "canceled";

      const page = await client.fetchPage(this.page, cap.userId, this.tab, maxId);
      if (!page) {
        engine.addError();
        consecutiveFetchFailures++;
        if (consecutiveFetchFailures >= 3) {
          log.warn("IgFollowers", `api path: 3 consecutive failures — pausable stop at ${this.previouslyStored() + collected.size}`);
          return "all_sessions_stagnant";
        }
        await new Promise((r) => setTimeout(r, 2000 * consecutiveFetchFailures));
        continue;
      }
      consecutiveFetchFailures = 0;
      pageCount++;

      const relevant = resumeFromUser ? this.sliceUntilResumeUser(page.users.map((u) => ({ username: u.username, fullName: u.fullName, avatar: u.avatar })), resumeFromUser) : page.users;
      const newCount = this.ingestUsers(collected, relevant);
      engine.addResults(newCount);
      engine.setCursor(JSON.stringify({ api: true, maxId: page.nextMaxId, lastUsername: relevant.at(-1)?.username ?? null, rows: relevant.length }));
      this.lastApiMaxId = page.nextMaxId ?? maxId;
      if (pageCount % 10 === 0 || !page.nextMaxId) {
        log.info("IgFollowers", `api page #${pageCount}: +${newCount} → ${this.previouslyStored() + collected.size} unique (cursor=${page.nextMaxId ? "yes" : "end"})`);
      }

      await this.flushIfNeeded(collected);
      await engine.heartbeat();

      if (!page.nextMaxId) {
        const harvested = this.previouslyStored() + collected.size;
        if (harvested < API_MIN_HARVEST_FOR_EXHAUSTED_CLAIM) {
          // IG rate/ID-blocks the API mid-pagination: fetchPage returns ~25-50
          // users with next_max_id=null. Treat as "blocked", NOT exhausted —
          // fall through to DOM scrolling on the same session instead of
          // pausing the job at <1% coverage (the reported production failure).
          log.warn("IgFollowers", `api path: no next_max_id but only ${harvested} harvested (<${API_MIN_HARVEST_FOR_EXHAUSTED_CLAIM}) — IG likely blocking API pagination, falling back to DOM scrolling`);
          return null;
        }
        log.info("IgFollowers", `api path: no next_max_id — list exhausted (${harvested})`);
        this.lastApiMaxId = null; // exhausted lists have nothing to resume into
        return "api_list_exhausted";
      }
      maxId = page.nextMaxId;

      // Rest cycle every 40 pages (~1000 users) keeps the pattern browser-like.
      if (pageCount % 40 === 0) {
        log.info("IgFollowers", `api path: resting ${this.restDelayMs}ms after ${pageCount} pages`);
        await this.restDelay();
      }
    }
    if (await this.checkCanceled()) return "canceled";
    return "max_results_reached";
  }

  /** Return only the rows AFTER the resume user (checkpoint row itself is
   *  already stored). Empty when the checkpoint user is not on this page —
   *  the caller's outer budget handles that case. */
  private sliceUntilResumeUser<T extends { username: string }>(users: T[], resumeFromUser: string): T[] {
    const idx = users.findIndex((u) => u.username === resumeFromUser);
    if (idx >= 0) return users.slice(idx + 1);
    // Checkpoint user not in this page — keep nothing (outer catch-up logic
    // governs when we resume ingestion); conservative to avoid dupes.
    return [];
  }

  /** DOM fallback with real patience: TWO empty-scroll cycles separated by a
   *  long rest + recovery actions (rotation on stagnation, reopen). Records
   *  why it stopped instead of ending completed at 51. */
  private async domScrollExtraction(
    engine: IgExtractionEngine,
    profileUrl: string,
    collected: Map<string, ExtractedMember>,
    resumeFromUser: string | null,
    resumeSkipBudgetInitial: number,
  ): Promise<IgStopReason> {
    if (!(await this.openDialog())) {
      log.warn("IgFollowers", `DOM path: could not open dialog — stale snapshot signals kept alive for pause/resume`);
      return "all_sessions_stagnant";
    }

    let emptyScrolls = 0;
    let cyclesCompleted = 0;
    let scrollCount = 0;
    let skipBudget = resumeSkipBudgetInitial;
    let caughtUp = resumeFromUser === null;
    let rowsEverSeen = 0;
    // Growth tracking across cycles: the platform-limit notice ("Only X can
    // see all followers") also appears on THROTTLED dialogs that later
    // unload more rows (live-probed 2026-08-27: it coexists with a long,
    // still-growing list). The notice is only a REAL boundary when combined
    // with zero growth — so we gate the platform_limit verdict on both.
    let harvestBeforeCycle = collected.size + this.previouslyStored();
    let totalGrowthAllCycles = 0;

    while (collected.size + this.previouslyStored() < this.ctx.maxResults && !this.shouldStop) {
      if (await this.checkCanceled()) return "canceled";

      scrollCount++;
      if (scrollCount % this.batchSizeForRest === 0) {
        log.info("IgFollowers", `rest ${this.restDelayMs}ms after ${this.batchSizeForRest} scrolls`);
        await this.restDelay();
      }
      await this.igScrollDelay();
      await this.scrollDialog();

      const rows = await this.collectRowsFromDialog();
      rowsEverSeen += rows.length;
      this.lastDomCursor = { lastUsername: rows.at(-1)?.username ?? this.lastDomCursor.lastUsername, rowsInDialog: rows.length };
      let lastUsername: string | null = rows.at(-1)?.username ?? null;

      // Resume: skip everything up to and including the checkpointed user.
      let newCount = 0;
      if (!caughtUp) {
        for (const row of rows) {
          if (row.username === resumeFromUser) {
            caughtUp = true;
            break;
          }
        }
        skipBudget -= rows.length;
        if (skipBudget <= 0) {
          log.warn("IgFollowers", `checkpoint user not found after budget — continuing from current position`);
          caughtUp = true;
        }
      }
      if (caughtUp) {
        newCount = this.ingestUsers(collected, rows);
      }
      engine.addResults(newCount);
      engine.setCursor(JSON.stringify({ lastUsername, rowsInDialog: rows.length } satisfies FollowersCursor));
      if (!caughtUp || newCount > 0) {
        log.info("IgFollowers", `scroll #${scrollCount}: +${newCount} → ${this.previouslyStored() + collected.size} unique${caughtUp ? "" : " (catching up)"}`);
      }

      // Block check every 3rd scroll: URL checks cheap, HTML serialization pricey.
      const cheapBlockSignal = this.page.url().includes("/challenge/") || this.page.url().includes("/accounts/login");
      if (cheapBlockSignal || scrollCount % 3 === 0) {
        const html = cheapBlockSignal ? "" : await this.page.content().catch(() => "");
        if (cheapBlockSignal || this.detectIgBlocked(html, this.page.url())) {
          log.warn("IgFollowers", `block detected on session ${this.ctx.sessionId.slice(0, 8)} — rotating`);
          engine.recordSessionFailure(this.ctx.sessionId, new ExtractionError(ErrorCodes.AUTH_FAILED, "IG block/checkpoint detected"));
          const switched = await this.switchToNextSession();
          if (!switched) {
            await this.handleIgBlocked();
            return "all_sessions_stagnant";
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

      if (newCount === 0 && caughtUp) emptyScrolls++;

      if (emptyScrolls >= EMPTY_SCROLLS_PER_CYCLE) {
        cyclesCompleted++;
        const harvestedNow = collected.size + this.previouslyStored();
        const cycleGrowth = harvestedNow - harvestBeforeCycle;
        totalGrowthAllCycles += cycleGrowth;
        log.info("IgFollowers", `cycle ${cyclesCompleted}: growth=+${cycleGrowth} (total all cycles +${totalGrowthAllCycles}, dialog ${rowsEverSeen} rows ever)`);
        if (await this.dialogShowsPlatformLimit() && totalGrowthAllCycles === 0) {
          // Notice present AND the list never grew across any patience cycle —
          // a genuine IG data boundary (e.g. @instagram 686M → ~41 rows).
          log.warn("IgFollowers", `platform limit notice + zero growth across ${cyclesCompleted} cycle(s) — genuine IG boundary, stopping`);
          return "platform_limit";
        }
        if (cyclesCompleted >= DOM_EXHAUSTION_CYCLES) {
          // Two full patience cycles exhausted. If secondaries exist, rotate
          // once and RESET the patience window instead of giving up here.
          harvestBeforeCycle = harvestedNow; // rotation resets the growth baseline
          if (this.stagnationRotations < Math.min(2, this.secondarySessionPages.length)) {
            const rotated = await this.rotateOffStagnantSession(engine, profileUrl);
            if (rotated && (await this.openDialog())) {
              emptyScrolls = 0;
              cyclesCompleted = 0;
              continue;
            }
          }
          log.info("IgFollowers", `DOM dialog exhausted after ${cyclesCompleted} cycles (${rowsEverSeen} rows ever seen)`);
          return classifyDomExhaustion(rowsEverSeen);
        }
        // Between-cycle recovery: long human-ish rest, reopen dialog, one API
        // probe. Throttles frequently clear after this pause.
        log.info("IgFollowers", `cycle ${cyclesCompleted}/${DOM_EXHAUSTION_CYCLES}: no growth for ${EMPTY_SCROLLS_PER_CYCLE} scrolls — resting ${BETWEEN_CYCLE_REST_MS}ms then recovering`);
        await new Promise((r) => setTimeout(r, BETWEEN_CYCLE_REST_MS));
        if (!(await this.openDialog())) {
          log.warn("IgFollowers", `between-cycle reopen failed — treating as stagnation`);
        }
        emptyScrolls = 0;
      }
    }
    if (await this.checkCanceled()) return "canceled";
    return "max_results_reached";
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
   *  batches after extraction completes so it never slows the scroll loop. */
  private async scrapeBios(collected: Map<string, ExtractedMember>): Promise<void> {
    const all = Array.from(collected.values());
    if (all.length === 0) return;
    const BATCH = 5;
    let withContact = 0;
    log.info("IgFollowers", `scraping bios for ${all.length} users (batch=${BATCH} parallel)`);

    for (let i = 0; i < all.length; i += BATCH) {
      if (await this.checkCanceled()) break;
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
        if (r.bio_phone) { slice[k].bio_phone = r.bio_phone; withContact++; }
        if (r.bio_email) { slice[k].bio_email = r.bio_email; withContact++; }
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
