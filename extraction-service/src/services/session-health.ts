/** Session health: a per-session state machine (healthy → degraded →
 *  unavailable → recovery) with failure classification and bounded retry
 *  backoff. Distinguishes WHY a session fails instead of blindly retrying. */
import { ExtractionError, ErrorCodes } from "../errors.js";

export type FailureKind = "network" | "auth" | "restriction" | "data_unavailable" | "bug";

export interface FailureInfo {
  kind: FailureKind;
  detail: string;
  atMs?: number;
}

export type SessionState = "healthy" | "degraded" | "unavailable" | "recovery";

const KIND_BY_CODE: Record<string, FailureKind> = {
  [ErrorCodes.NETWORK_ERROR]: "network",
  [ErrorCodes.TIMEOUT]: "network",
  [ErrorCodes.BROWSER_CRASH]: "network",
  [ErrorCodes.SESSION_EXPIRED]: "auth",
  [ErrorCodes.AUTH_FAILED]: "auth",
  [ErrorCodes.SESSION_NOT_CONNECTED]: "auth",
  [ErrorCodes.NO_COOKIES]: "auth",
};

/** Map any thrown value to a failure kind — never guess "it's the code". */
export function classifyFailure(err: unknown): FailureInfo {
  if (err instanceof ExtractionError) {
    const kind = KIND_BY_CODE[err.code] ?? "bug";
    return { kind, detail: err.message };
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/checkpoint|locked|security check|confirm your identity/i.test(msg)) {
    return { kind: "restriction", detail: msg };
  }
  if (/login|password form|تسجيل الدخول/i.test(msg)) {
    return { kind: "auth", detail: msg };
  }
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|net::|navigation timeout|ERR_/i.test(msg)) {
    return { kind: "network", detail: msg };
  }
  if (/not found|no longer available|deleted|removed/i.test(msg)) {
    return { kind: "data_unavailable", detail: msg };
  }
  return { kind: "bug", detail: msg };
}

interface HealthOpts {
  degradeAfter: number;
  unavailableAfter: number;
  baseMs: number;
  maxMs: number;
}

const DEFAULT_OPTS: HealthOpts = {
  degradeAfter: 1,
  unavailableAfter: 3,
  baseMs: 2000,
  maxMs: 30_000,
};

interface SessionHealth {
  state: SessionState;
  failures: number;
  successes: number;
  lastFailure: FailureInfo | null;
}

export class SessionHealthMonitor {
  private sessions = new Map<string, SessionHealth>();

  constructor(private opts: Partial<HealthOpts> = {}) {
    this.opts = { ...DEFAULT_OPTS, ...opts };
  }

  register(sessionId: string): void {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, { state: "healthy", failures: 0, successes: 0, lastFailure: null });
    }
  }

  recordSuccess(sessionId: string): void {
    const s = this.ensure(sessionId);
    s.successes++;
    if (s.state === "unavailable") {
      // Quarantine needs a proven recovery: first success moves to recovery,
      // second consecutive success restores healthy.
      s.state = "recovery";
      return;
    }
    if (s.state === "degraded" || s.state === "recovery") {
      s.state = "healthy";
      s.failures = 0;
    }
  }

  recordFailure(sessionId: string, info: FailureInfo): void {
    const s = this.ensure(sessionId);
    s.failures++;
    s.lastFailure = { ...info, atMs: info.atMs ?? Date.now() };
    // Auth means the session identity is gone — never keep using it.
    if (info.kind === "auth" || info.kind === "restriction") {
      s.state = "unavailable";
      return;
    }
    if (s.failures >= this.opts.unavailableAfter) {
      s.state = "unavailable";
    } else if (s.failures >= this.opts.degradeAfter) {
      s.state = "degraded";
    }
  }

  available(sessionId: string): boolean {
    return this.state(sessionId) !== "unavailable";
  }

  state(sessionId: string): SessionState {
    return this.sessions.get(sessionId)?.state ?? "healthy";
  }

  lastFailure(sessionId: string): FailureInfo | undefined {
    return this.sessions.get(sessionId)?.lastFailure ?? undefined;
  }

  /** Exponential backoff capped at maxMs. */
  backoffMs(sessionId: string, attempt: number): number {
    const n = Math.max(1, attempt);
    const ms = this.opts.baseMs * Math.pow(2, n - 1);
    return Math.min(ms, this.opts.maxMs);
  }

  snapshot(): Array<{ session_id: string; state: SessionState; failures: number; last_failure_kind?: string; last_failure_detail?: string }> {
    return [...this.sessions.entries()].map(([session_id, s]) => ({
      session_id,
      state: s.state,
      failures: s.failures,
      ...(s.lastFailure
        ? { last_failure_kind: s.lastFailure.kind, last_failure_detail: s.lastFailure.detail.substring(0, 200) }
        : {}),
    }));
  }

  private ensure(sessionId: string): SessionHealth {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = { state: "healthy", failures: 0, successes: 0, lastFailure: null };
      this.sessions.set(sessionId, s);
    }
    return s;
  }
}
