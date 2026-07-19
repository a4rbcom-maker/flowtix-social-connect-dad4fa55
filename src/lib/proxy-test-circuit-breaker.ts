// Circuit Breaker for proxy tests.
//
// After N consecutive failures for the same account, the circuit "opens"
// and blocks further attempts for a cooldown window — the UI shows a clear
// message instead of hanging on another 18s poll.
//
// State transitions:
//   closed   → normal, attempts run
//   open     → attempts are short-circuited until `openedUntil`
//   half-open → next attempt is allowed; success closes the circuit,
//               failure re-opens it with a longer cooldown.

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitStatus {
  state: CircuitState;
  failures: number;
  openedUntil: number | null;
  lastReason: string | null;
}

export interface CircuitDecision {
  allow: boolean;
  status: CircuitStatus;
  retryAfterMs: number;
}

const FAILURE_THRESHOLD = 3;
const BASE_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 5 * 60_000;

interface InternalState {
  failures: number;
  openedUntil: number | null;
  cooldownMs: number;
  lastReason: string | null;
}

const registry = new Map<string, InternalState>();

function ensure(key: string): InternalState {
  let s = registry.get(key);
  if (!s) {
    s = { failures: 0, openedUntil: null, cooldownMs: BASE_COOLDOWN_MS, lastReason: null };
    registry.set(key, s);
  }
  return s;
}

function snapshot(s: InternalState, now: number): CircuitStatus {
  let state: CircuitState = "closed";
  if (s.openedUntil && s.openedUntil > now) state = "open";
  else if (s.failures >= FAILURE_THRESHOLD) state = "half-open";
  return {
    state,
    failures: s.failures,
    openedUntil: s.openedUntil,
    lastReason: s.lastReason,
  };
}

export function canAttempt(key: string, now: number = Date.now()): CircuitDecision {
  const s = ensure(key);
  const status = snapshot(s, now);
  const retryAfterMs = status.openedUntil ? Math.max(0, status.openedUntil - now) : 0;
  return { allow: status.state !== "open", status, retryAfterMs };
}

export function recordSuccess(key: string): CircuitStatus {
  const s = ensure(key);
  s.failures = 0;
  s.openedUntil = null;
  s.cooldownMs = BASE_COOLDOWN_MS;
  s.lastReason = null;
  return snapshot(s, Date.now());
}

export function recordFailure(key: string, reason?: string | null): CircuitStatus {
  const s = ensure(key);
  s.failures += 1;
  s.lastReason = reason ?? s.lastReason;
  if (s.failures >= FAILURE_THRESHOLD) {
    s.openedUntil = Date.now() + s.cooldownMs;
    s.cooldownMs = Math.min(MAX_COOLDOWN_MS, s.cooldownMs * 2);
  }
  return snapshot(s, Date.now());
}

export function resetCircuit(key: string): void {
  registry.delete(key);
}

export function describeCooldown(ms: number, lang: "ar" | "en" = "ar"): string {
  const sec = Math.ceil(ms / 1000);
  if (lang === "ar") {
    if (sec < 60) return `${sec} ثانية`;
    const m = Math.ceil(sec / 60);
    return `${m} دقيقة`;
  }
  if (sec < 60) return `${sec}s`;
  return `${Math.ceil(sec / 60)}m`;
}
