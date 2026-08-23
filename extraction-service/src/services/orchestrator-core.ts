/** Adaptive orchestrator core: measures real per-source productivity and
 *  decides when to abandon a source for the next one. Pure logic — no
 *  Playwright, no I/O — so it is fully unit-testable. */

export type SourceKey = "members_list" | "members_search" | "feed_cascade";

export type SourceStopReason =
  | "target_reached"
  | "stagnated"
  | "low_yield"
  | "source_exhausted"
  | "saturated"
  | "posts_exhausted"
  | "max_duration"
  | "canceled";

/** Reasons that mean "this source has nothing left" — switch immediately. */
const EXHAUSTED_REASONS = new Set<SourceStopReason>([
  "stagnated",
  "low_yield",
  "source_exhausted",
  "saturated",
  "posts_exhausted",
]);

const SOURCE_ORDER: SourceKey[] = ["members_list", "members_search", "feed_cascade"];

export class RateMeter {
  private buckets = new Map<number, number>();

  constructor(
    private windowMs = 90_000,
    private bucketSizeMs = 10_000,
  ) {}

  add(count: number, nowMs = Date.now()): void {
    if (count <= 0) return;
    const bucket = Math.floor(nowMs / this.bucketSizeMs) * this.bucketSizeMs;
    this.buckets.set(bucket, (this.buckets.get(bucket) ?? 0) + count);
    this.prune(nowMs);
  }

  ratePerMin(nowMs = Date.now()): number {
    this.prune(nowMs);
    const windowStart = nowMs - this.windowMs;
    let total = 0;
    let oldest: number | null = null;
    for (const [bucket, count] of this.buckets) {
      if (bucket < windowStart) continue;
      total += count;
      if (oldest === null || bucket < oldest) oldest = bucket;
    }
    if (total === 0) return 0;
    const elapsed = nowMs - (oldest ?? nowMs);
    if (elapsed < 5_000) return 0;
    return Math.round((total / elapsed) * 60_000);
  }

  private prune(nowMs: number): void {
    const windowStart = nowMs - this.windowMs - this.bucketSizeMs;
    for (const bucket of this.buckets.keys()) {
      if (bucket < windowStart) this.buckets.delete(bucket);
    }
  }
}

export interface SourceStat {
  key: string;
  users: number;
  startedMs: number;
  endedMs: number | null;
  errors: number;
  requests: number;
  stopReason: SourceStopReason | null;
  meter: RateMeter;
}

export class SourceStats<K extends string = SourceKey> {
  private stats = new Map<K, SourceStat>();

  start(key: K, nowMs = Date.now()): void {
    if (this.stats.has(key)) return;
    this.stats.set(key, {
      key,
      users: 0,
      startedMs: nowMs,
      endedMs: null,
      errors: 0,
      requests: 0,
      stopReason: null,
      meter: new RateMeter(),
    });
  }

  addUsers(key: K, count: number, nowMs = Date.now()): void {
    const s = this.stats.get(key);
    if (!s) return;
    s.users += count;
    s.meter.add(count, nowMs);
  }

  addError(key: K): void {
    const s = this.stats.get(key);
    if (s) s.errors++;
  }

  addRequest(key: K): void {
    const s = this.stats.get(key);
    if (s) s.requests++;
  }

  finish(key: K, reason: SourceStopReason, nowMs = Date.now()): void {
    const s = this.stats.get(key);
    if (!s || s.endedMs !== null) return;
    s.stopReason = reason;
    s.endedMs = nowMs;
  }

  get(key: K): SourceStat | undefined {
    return this.stats.get(key);
  }

  entries(): Array<[K, SourceStat]> {
    return [...this.stats.entries()];
  }

  snapshot(): Record<string, { users: number; rate_per_min: number; duration_ms: number; errors: number; requests: number; stop_reason: string | null }> {
    const out: Record<string, { users: number; rate_per_min: number; duration_ms: number; errors: number; requests: number; stop_reason: string | null }> = {};
    for (const [key, s] of this.stats) {
      out[key] = {
        users: s.users,
        rate_per_min: s.meter.ratePerMin(),
        duration_ms: (s.endedMs ?? Date.now()) - s.startedMs,
        errors: s.errors,
        requests: s.requests,
        stop_reason: s.stopReason,
      };
    }
    return out;
  }
}

export interface OrchestratorThresholds {
  minRatePerMin: number;
  evalWindowMs: number;
  minPhaseMs: number;
}

export const DEFAULT_THRESHOLDS: OrchestratorThresholds = {
  minRatePerMin: 5,
  evalWindowMs: 90_000,
  minPhaseMs: 120_000,
};

/**
 * Decide the next source to run, or null to keep going / stop.
 * - Latest finished source exhausted → next untried source.
 * - Active source unproductive (rate < minRatePerMin after minPhaseMs) → next untried source.
 * - Productive or everything tried → null.
 */
export function decideNextSource(
  stats: SourceStats,
  opts: { nowMs?: number } & Partial<OrchestratorThresholds>,
): SourceKey | null {
  const nowMs = opts.nowMs ?? Date.now();
  const th = { ...DEFAULT_THRESHOLDS, ...opts };

  const allEntries = stats.entries();
  const tried = new Set<string>(allEntries.map(([key]) => key));

  // Last finished source: exhausted → advance immediately.
  let lastFinished: { key: string; reason: string; startedMs: number } | null = null;
  for (const [, s] of allEntries) {
    if (s.stopReason === null) continue;
    if (!lastFinished || s.startedMs > lastFinished.startedMs) {
      lastFinished = { key: s.key, reason: s.stopReason, startedMs: s.startedMs };
    }
  }
  if (lastFinished && EXHAUSTED_REASONS.has(lastFinished.reason as SourceStopReason)) {
    return firstUntried(tried);
  }

  // Active (unfinished) source: low productivity after the minimum phase time?
  for (const [, s] of allEntries) {
    if (s.endedMs !== null) continue;
    const elapsed = nowMs - s.startedMs;
    if (elapsed < th.minPhaseMs || elapsed < th.evalWindowMs) continue;
    if (s.meter.ratePerMin(nowMs) < th.minRatePerMin) {
      return firstUntried(tried);
    }
  }

  return null;
}

function firstUntried(tried: Set<string>): SourceKey | null {
  for (const key of SOURCE_ORDER) {
    if (!tried.has(key)) return key;
  }
  return null;
}

/** One-shot completion signal: phases can await a verdict produced elsewhere
 *  (e.g. "feed cascade saturated") without polling. wait() resolves
 *  immediately once fired; never rejects. */
export class CompletionSignal {
  private firedFlag = false;
  private waiters: Array<() => void> = [];

  get signaled(): boolean {
    return this.firedFlag;
  }

  signal(): void {
    if (this.firedFlag) return;
    this.firedFlag = true;
    for (const w of this.waiters.splice(0)) w();
  }

  wait(): Promise<void> {
    if (this.firedFlag) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

/** Shared work queue for distributed shard processing: N sessions claim
 *  prefixes atomically (JS is single-threaded between awaits), so every
 *  letter shard is processed exactly once no matter how many workers join. */
export class ShardQueue {
  private cursor = 0;

  constructor(private shards: string[]) {}

  get size(): number {
    return this.shards.length;
  }

  get claimed(): number {
    return this.cursor;
  }

  get exhausted(): boolean {
    return this.cursor >= this.shards.length;
  }

  take(): string | null {
    return this.exhausted ? null : this.shards[this.cursor++];
  }

  add(more: string[]): void {
    this.shards.push(...more);
  }
}
