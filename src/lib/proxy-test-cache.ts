// In-memory cache for proxy test results — avoids re-running the 18s test
// for the same account within the same browser session.
//
// TTL is short (default 2 minutes) so users still get fresh results after
// making changes, but repeated clicks return instantly.

export interface ProxyTestSnapshot {
  accountId: string;
  accountName: string;
  jobId: string | null;
  status: "completed" | "failed";
  ip: string | null;
  proxyEnabled: boolean;
  elapsedMs: number | null;
  error: string | null;
  reasonCode: string | null;
  reasonAr: string | null;
  reasonEn: string | null;
  rawError: string | null;
}

interface Entry {
  snapshot: ProxyTestSnapshot;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 2 * 60_000;
const cache = new Map<string, Entry>();

export function getCachedProxyTest(accountId: string, now: number = Date.now()): ProxyTestSnapshot | null {
  const entry = cache.get(accountId);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    cache.delete(accountId);
    return null;
  }
  return entry.snapshot;
}

export function setCachedProxyTest(
  accountId: string,
  snapshot: ProxyTestSnapshot,
  ttlMs: number = DEFAULT_TTL_MS,
): void {
  cache.set(accountId, { snapshot, expiresAt: Date.now() + ttlMs });
}

export function invalidateProxyTest(accountId: string): void {
  cache.delete(accountId);
}

export function getProxyTestTtlMs(): number {
  return DEFAULT_TTL_MS;
}

export function describeCacheAge(ms: number, lang: "ar" | "en" = "ar"): string {
  const sec = Math.max(1, Math.round(ms / 1000));
  if (lang === "ar") {
    if (sec < 60) return `منذ ${sec} ثانية`;
    return `منذ ${Math.round(sec / 60)} دقيقة`;
  }
  if (sec < 60) return `${sec}s ago`;
  return `${Math.round(sec / 60)}m ago`;
}
