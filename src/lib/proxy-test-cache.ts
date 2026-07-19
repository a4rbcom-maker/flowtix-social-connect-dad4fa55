// In-memory cache for proxy test results — avoids re-running the 18s test
// for the same account within the same browser session.
//
// TTL is short (default 2 minutes) so users still get fresh results after
// making changes, but repeated clicks return instantly.

export type ProxyPhaseName = "dns" | "connect" | "ssl" | "response";
export type ProxyPhaseStatus = "ok" | "fail" | "skipped" | "running";

export interface ProxyPhase {
  name: ProxyPhaseName;
  status: ProxyPhaseStatus;
  ms: number | null;
  reasonAr?: string | null;
  reasonEn?: string | null;
}

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
  phases?: ProxyPhase[];
  logs?: string[];
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

// ---------------------------------------------------------------------------
// Phase helpers
// ---------------------------------------------------------------------------

const PHASE_ORDER: ProxyPhaseName[] = ["dns", "connect", "ssl", "response"];

export function phaseLabel(name: ProxyPhaseName, lang: "ar" | "en" = "ar"): string {
  if (lang === "ar") {
    return {
      dns: "استعلام DNS",
      connect: "اتصال TCP",
      ssl: "مصافحة SSL",
      response: "استجابة HTTP",
    }[name];
  }
  return {
    dns: "DNS lookup",
    connect: "TCP connect",
    ssl: "SSL handshake",
    response: "HTTP response",
  }[name];
}

/**
 * Normalize whatever the bot worker returned into a full 4-phase array.
 * Missing phases become `skipped`, so the UI always renders the same
 * ordered checklist (DNS → Connect → SSL → Response).
 *
 * When the worker doesn't report phases at all, we synthesize a coarse
 * fallback from `elapsedMs` + `reasonCode` so the user still sees where
 * the test stopped.
 */
export function normalizeProxyPhases(
  input: Partial<ProxyPhase>[] | null | undefined,
  fallback?: {
    ok: boolean;
    elapsedMs?: number | null;
    reasonCode?: string | null;
    reasonAr?: string | null;
    reasonEn?: string | null;
  },
): ProxyPhase[] {
  const byName = new Map<ProxyPhaseName, ProxyPhase>();
  for (const raw of input ?? []) {
    if (!raw?.name || !PHASE_ORDER.includes(raw.name)) continue;
    byName.set(raw.name, {
      name: raw.name,
      status: (raw.status ?? "skipped") as ProxyPhaseStatus,
      ms: typeof raw.ms === "number" ? raw.ms : null,
      reasonAr: raw.reasonAr ?? null,
      reasonEn: raw.reasonEn ?? null,
    });
  }
  if (byName.size === 0 && fallback) {
    // Derive a coarse walk from the reason code so the user sees where it broke.
    const stopAt = mapReasonToPhase(fallback.reasonCode ?? null);
    for (let i = 0; i < PHASE_ORDER.length; i += 1) {
      const name = PHASE_ORDER[i];
      const stopIdx = stopAt ? PHASE_ORDER.indexOf(stopAt) : PHASE_ORDER.length - 1;
      if (!fallback.ok && stopAt && i === stopIdx) {
        byName.set(name, {
          name,
          status: "fail",
          ms: null,
          reasonAr: fallback.reasonAr ?? null,
          reasonEn: fallback.reasonEn ?? null,
        });
      } else if (!fallback.ok && stopAt && i > stopIdx) {
        byName.set(name, { name, status: "skipped", ms: null });
      } else {
        // On success (or when we don't know), mark all as ok and put the
        // total elapsed on the final response step.
        byName.set(name, {
          name,
          status: "ok",
          ms: name === "response" ? fallback.elapsedMs ?? null : null,
        });
      }
    }
  }
  return PHASE_ORDER.map(
    (name) => byName.get(name) ?? { name, status: "skipped", ms: null },
  );
}

function mapReasonToPhase(code: string | null): ProxyPhaseName | null {
  if (!code) return null;
  const c = code.toLowerCase();
  if (c.includes("dns") || c.includes("enotfound") || c.includes("resolve")) return "dns";
  if (c.includes("timeout") && !c.includes("ssl")) return "connect";
  if (c.includes("econnrefused") || c.includes("econnreset") || c.includes("network")) return "connect";
  if (c.includes("ssl") || c.includes("tls") || c.includes("cert") || c.includes("handshake")) return "ssl";
  if (c.includes("auth") || c.includes("407") || c.includes("401") || c.includes("403")) return "response";
  if (c === "worker_unavailable") return null;
  return "response";
}
