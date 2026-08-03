import type { Page } from "playwright";
import { logger } from "../logger.js";

const log = logger;

export interface SessionInfo {
  sessionId: string;
  page: Page;
  isActive: boolean;
  lastUsed: number;
  requestCount: number;
  blockedCount: number;
}

export interface SessionPoolOptions {
  maxRequestsPerSession?: number;
  cooldownMs?: number;
  jitterMinMs?: number;
  jitterMaxMs?: number;
}

const DEFAULT_OPTS: Required<SessionPoolOptions> = {
  maxRequestsPerSession: 100,
  cooldownMs: 2000,
  jitterMinMs: 2000,
  jitterMaxMs: 8000,
};

/**
 * Manages a pool of browser sessions (pages) for round-robin distribution.
 * Tracks health per session, rotates on rate limits, applies jittered delays.
 */
export class SessionPool {
  private sessions: SessionInfo[] = [];
  private currentIndex = 0;
  private opts: Required<SessionPoolOptions>;

  constructor(options: SessionPoolOptions = {}) {
    this.opts = { ...DEFAULT_OPTS, ...options };
  }

  addSession(sessionId: string, page: Page): void {
    this.sessions.push({
      sessionId,
      page,
      isActive: true,
      lastUsed: 0,
      requestCount: 0,
      blockedCount: 0,
    });
    log.info("SessionPool", `added session ${sessionId.slice(0, 8)} (total: ${this.sessions.length})`);
  }

  size(): number {
    return this.sessions.length;
  }

  activeCount(): number {
    return this.sessions.filter(s => s.isActive).length;
  }

  /**
   * Get the next available session (round-robin).
   * Skips inactive/cooldown sessions.
   */
  acquire(): SessionInfo | null {
    const active = this.sessions.filter(s => s.isActive);
    if (active.length === 0) return null;

    // Find next active session via round-robin
    for (let i = 0; i < this.sessions.length; i++) {
      const idx = (this.currentIndex + i) % this.sessions.length;
      const session = this.sessions[idx];
      if (!session.isActive) continue;

      // Check request limit
      if (session.requestCount >= this.opts.maxRequestsPerSession) {
        session.isActive = false;
        session.requestCount = 0;
        log.warn("SessionPool", `session ${session.sessionId.slice(0, 8)} reached max requests, cooling down`);
        continue;
      }

      this.currentIndex = (idx + 1) % this.sessions.length;
      return session;
    }

    // All sessions exhausted — reactivate them
    log.warn("SessionPool", `all sessions exhausted, reactivating`);
    for (const s of this.sessions) {
      s.isActive = true;
      s.requestCount = 0;
    }
    return this.sessions[0] || null;
  }

  /** Mark a session as having been used successfully */
  reportSuccess(session: SessionInfo): void {
    session.requestCount++;
    session.lastUsed = Date.now();
  }

  /** Mark a session as having hit a rate limit / checkpoint */
  reportBlocked(session: SessionInfo): void {
    session.blockedCount++;
    session.isActive = false;
    log.warn("SessionPool", `session ${session.sessionId.slice(0, 8)} blocked (${session.blockedCount} times)`);
  }

  /** Apply a randomized human-like delay */
  async jitter(): Promise<void> {
    const delay = this.opts.jitterMinMs + Math.random() * (this.opts.jitterMaxMs - this.opts.jitterMinMs);
    await new Promise(r => setTimeout(r, delay));
  }

  /** Get stats for observability */
  getStats(): Array<{ sessionId: string; requests: number; blocked: number; active: boolean }> {
    return this.sessions.map(s => ({
      sessionId: s.sessionId.slice(0, 8),
      requests: s.requestCount,
      blocked: s.blockedCount,
      active: s.isActive,
    }));
  }
}
