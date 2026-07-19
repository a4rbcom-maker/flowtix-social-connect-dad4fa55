// Adaptive polling with backoff.
//
// - starts fast (so quick jobs feel instant)
// - slows down exponentially while the status doesn't change
// - resets to fast when progress is observed (status change / progress bump)
// - larger delay on transient errors, capped
// - hard timeout terminates with `timeout` outcome
// - respects an AbortSignal
//
// Designed for job-status polling (test_proxy, token extraction, etc.).

export type PollDecision<T> =
  | { done: true; value: T }
  | { done: false; progressed?: boolean };

export interface AdaptivePollOptions {
  /** First delay before the first tick (ms). Default 250. */
  initialDelayMs?: number;
  /** Minimum delay after a "progress" signal (ms). Default 300. */
  minDelayMs?: number;
  /** Maximum delay cap (ms). Default 2500. */
  maxDelayMs?: number;
  /** Multiplier applied when nothing changed. Default 1.6. */
  backoffFactor?: number;
  /** Extra multiplier on transient errors. Default 2. */
  errorBackoffFactor?: number;
  /** Overall budget (ms). Default 20_000. */
  timeoutMs?: number;
  /** Optional abort. */
  signal?: AbortSignal;
  /** Debug hook — receives lifecycle events. */
  onTick?: (info: { attempt: number; delay: number; error?: unknown }) => void;
}

export type AdaptivePollResult<T> =
  | { status: "done"; value: T; attempts: number; elapsedMs: number }
  | { status: "timeout"; attempts: number; elapsedMs: number }
  | { status: "aborted"; attempts: number; elapsedMs: number };

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

export async function adaptivePoll<T>(
  probe: () => Promise<PollDecision<T>>,
  opts: AdaptivePollOptions = {},
): Promise<AdaptivePollResult<T>> {
  const initial = opts.initialDelayMs ?? 250;
  const minDelay = opts.minDelayMs ?? 300;
  const maxDelay = opts.maxDelayMs ?? 2500;
  const factor = opts.backoffFactor ?? 1.6;
  const errFactor = opts.errorBackoffFactor ?? 2;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const signal = opts.signal;

  const startedAt = Date.now();
  let attempts = 0;
  let delay = initial;

  try {
    await sleep(delay, signal);
    while (true) {
      if (signal?.aborted) {
        return { status: "aborted", attempts, elapsedMs: Date.now() - startedAt };
      }
      attempts++;
      opts.onTick?.({ attempt: attempts, delay });
      try {
        const decision = await probe();
        if (decision.done) {
          return {
            status: "done",
            value: decision.value,
            attempts,
            elapsedMs: Date.now() - startedAt,
          };
        }
        // Not done — adapt delay.
        delay = decision.progressed
          ? Math.max(minDelay, Math.floor(delay / factor))
          : Math.min(maxDelay, Math.ceil(delay * factor));
      } catch (err) {
        opts.onTick?.({ attempt: attempts, delay, error: err });
        delay = Math.min(maxDelay, Math.ceil(delay * errFactor));
      }
      const remaining = timeoutMs - (Date.now() - startedAt);
      if (remaining <= 0) {
        return { status: "timeout", attempts, elapsedMs: Date.now() - startedAt };
      }
      await sleep(Math.min(delay, remaining), signal);
    }
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      return { status: "aborted", attempts, elapsedMs: Date.now() - startedAt };
    }
    throw err;
  }
}

/**
 * Compute a dynamic refetch interval for TanStack Query polling of a job.
 * - Fast at start (elapsed < 3s): 400ms
 * - Medium (3–10s): 900ms
 * - Slow tail (>10s): 2000ms
 * Callers may still cap by their own hard timeout.
 */
export function jobPollInterval(startedAt: number | null): number {
  if (!startedAt) return 500;
  const elapsed = Date.now() - startedAt;
  if (elapsed < 3_000) return 400;
  if (elapsed < 10_000) return 900;
  if (elapsed < 30_000) return 1500;
  return 2500;
}
