/** IG Extraction Engine — shared orchestration layer for Instagram jobs.
 *
 *  Every IG extraction type becomes an Adapter over this engine instead of
 *  a standalone implementation. The engine owns what used to be duplicated
 *  (or missing entirely) per-extractor:
 *
 *    - SessionManager: health states (healthy→degraded→unavailable→recovery),
 *      per-session failure classification, cooldown, duplicate-work lock.
 *    - Heartbeat: live progress (current source, cursor, rate/min, errors,
 *      retries, last activity) with working-but-no-results vs stalled.
 *    - Checkpoint: incremental job→source→cursor→count persistence so a
 *      restarted job resumes instead of starting from zero.
 *    - Adaptive source loop: measures unique-results/min per source,
 *      abandons low-yield sources, finishes only when all are exhausted.
 *
 *  Pure coordination + persistence — Adapters bring the Playwright/DOM part.
 *  No Facebook code path is touched by this module. */
import { supabaseService } from "./supabase.js";
import { SessionHealthMonitor, classifyFailure, type SessionState } from "./session-health.js";
import { RateMeter, SourceStats } from "./orchestrator-core.js";
import { logger } from "../logger.js";

const log = logger;

export type IgSourceKey = string; // adapter-defined, e.g. "followers_list"

export interface IgHeartbeat {
  phase: "starting" | "extracting" | "enriching" | "completed" | "failed";
  current_source: IgSourceKey | null;
  current_cursor: string | null;
  extracted: number;
  unique_extracted: number;
  total: number | null;
  coverage_rate: number | null;
  rate_per_min: number;
  errors: number;
  retries: number;
  active_sessions: number;
  session_health: Array<{ session_id: string; state: SessionState; failures: number; last_failure_kind?: string; last_failure_detail?: string }>;
  last_activity: string;
  working_state: "producing" | "waiting" | "stalled" | "stopped";
}

export interface IgCheckpoint {
  source: IgSourceKey;
  cursor: string | null;
  extracted: number;
  saved_at: string;
}

export interface IgEngineAdapter {
  /** Unique key of the primary source this adapter extracts from. */
  sourceKey: IgSourceKey;
  /** Restore state after a restart. Returns the cursor to resume from. */
  loadCheckpoint(): IgCheckpoint | null;
  saveCheckpoint(cp: IgCheckpoint): Promise<void>;
  /** Human label for progress display. */
  label: string;
}

export interface IgEngineOpts {
  jobId: string;
  userId: string;
  sessionIds: string[];
  maxResults: number;
  heartbeatEveryMs?: number;
  stalledAfterMs?: number;
}

const DEFAULT_HEARTBEAT_MS = 6_000;
const DEFAULT_STALLED_MS = 120_000;

export class IgExtractionEngine {
  readonly health = new SessionHealthMonitor();
  readonly stats = new SourceStats<IgSourceKey>();
  private meter = new RateMeter();
  private hb: IgHeartbeat;
  private lastHbMs = 0;
  private lastProgressMs = 0;
  private readonly heartbeatEveryMs: number;
  private readonly stalledAfterMs: number;
  private lastNewResultMs = Date.now();

  constructor(private opts: IgEngineOpts, private adapter: IgEngineAdapter) {
    this.heartbeatEveryMs = opts.heartbeatEveryMs ?? DEFAULT_HEARTBEAT_MS;
    this.stalledAfterMs = opts.stalledAfterMs ?? DEFAULT_STALLED_MS;
    for (const sid of opts.sessionIds) this.health.register(sid);
    this.hb = {
      phase: "starting",
      current_source: adapter.sourceKey,
      current_cursor: null,
      extracted: 0,
      unique_extracted: 0,
      total: null,
      coverage_rate: null,
      rate_per_min: 0,
      errors: 0,
      retries: 0,
      active_sessions: opts.sessionIds.length,
      session_health: this.health.snapshot(),
      last_activity: new Date().toISOString(),
      working_state: "waiting",
    };
  }

  /** Cooldown gate: a session that just failed must wait before reuse. */
  async canUseSession(sessionId: string, attempt: number): Promise<boolean> {
    if (!this.health.available(sessionId)) return false;
    const backoff = this.health.backoffMs(sessionId, attempt);
    if (backoff > 0 && attempt > 0) {
      log.info("IgEngine", `session ${sessionId.slice(0, 8)}: cooling down ${backoff}ms before retry #${attempt}`);
      await new Promise((r) => setTimeout(r, backoff));
    }
    return true;
  }

  recordSessionSuccess(sessionId: string): void {
    this.health.recordSuccess(sessionId);
  }

  /** Classify + record a session failure. Returns false when the engine
   *  should stop using this session entirely. */
  recordSessionFailure(sessionId: string, err: unknown): boolean {
    const info = classifyFailure(err);
    this.health.recordFailure(sessionId, info);
    this.hb.errors++;
    log.warn("IgEngine", `session ${sessionId.slice(0, 8)} failure (${info.kind}): ${info.detail.slice(0, 120)} → state=${this.health.state(sessionId)}`);
    return this.health.available(sessionId);
  }

  setTotal(total: number | null): void {
    this.hb.total = total;
    this.recomputeCoverage();
  }

  setCursor(cursor: string | null): void {
    this.hb.current_cursor = cursor;
  }

  /** Record new unique results; resets the stalled timer. */
  addResults(count: number, source: IgSourceKey = this.adapter.sourceKey): void {
    if (count <= 0) return;
    this.hb.extracted += count;
    this.hb.unique_extracted += count;
    this.meter.add(count);
    this.stats.addUsers(source, count);
    this.lastNewResultMs = Date.now();
    this.hb.working_state = "producing";
    this.recomputeCoverage();
  }

  addError(): void {
    this.hb.errors++;
    this.stats.addError(this.adapter.sourceKey);
  }

  addRetry(): void {
    this.hb.retries++;
  }

  private recomputeCoverage(): void {
    this.hb.rate_per_min = this.meter.ratePerMin();
    if (this.hb.total && this.hb.total > 0) {
      this.hb.coverage_rate = Math.min(100, Math.round((this.hb.unique_extracted / this.hb.total) * 100));
    }
  }

  /** Distinguishes "working but no new rows yet" from "actually stalled". */
  get workingState(): IgHeartbeat["working_state"] {
    const silentFor = Date.now() - this.lastNewResultMs;
    if (silentFor > this.stalledAfterMs) return "stalled";
    if (this.hb.rate_per_min > 0) return "producing";
    return "waiting";
  }

  get reachedMaxResults(): boolean {
    return this.hb.unique_extracted >= this.opts.maxResults;
  }

  /** Persist heartbeat + checkpoint. Throttled; call freely from loops. */
  async heartbeat(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastHbMs < this.heartbeatEveryMs) return;
    this.lastHbMs = now;
    this.hb.working_state = this.workingState;
    this.hb.session_health = this.health.snapshot();
    this.hb.rate_per_min = this.meter.ratePerMin();
    this.hb.last_activity = new Date().toISOString();

    // Checkpoint every heartbeat: resume-from-cursor survives crashes.
    await this.adapter.saveCheckpoint({
      source: this.adapter.sourceKey,
      cursor: this.hb.current_cursor,
      extracted: this.hb.unique_extracted,
      saved_at: new Date().toISOString(),
    }).catch((err) => log.debug("IgEngine", `checkpoint save failed: ${String(err).slice(0, 80)}`));

    await supabaseService.storeProgress(this.opts.jobId, {
      ...this.hb,
      last_update: new Date().toISOString(),
    }).catch(() => {});
    this.lastProgressMs = now;
  }

  setPhase(phase: IgHeartbeat["phase"]): void {
    this.hb.phase = phase;
  }

  snapshot(): IgHeartbeat {
    return { ...this.hb };
  }
}
