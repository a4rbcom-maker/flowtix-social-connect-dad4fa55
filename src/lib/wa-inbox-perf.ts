// Lightweight perf tracker for the WhatsApp inbox message query.
// fetchInboxMessages() reports each run here; the inbox UI subscribes via
// useInboxQueryPerf() to render a live badge (mode, duration, row count,
// fetching state) so query-optimization work is visible instead of invisible.

import { useEffect, useState, useSyncExternalStore } from "react";

export type InboxQueryMode = "group" | "private";

export interface InboxQueryStat {
  jid: string;
  mode: InboxQueryMode;
  durationMs: number;
  rowCount: number;
  ok: boolean;
  errorMessage?: string;
  at: number; // epoch ms when the query finished
  // Extra breakdown for the private path (alias-fetch + main query).
  aliasLookupMs?: number;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let latest: InboxQueryStat | null = null;
// Rolling window used to compute recent averages in the UI.
const recent: InboxQueryStat[] = [];
const MAX_RECENT = 20;

export function recordInboxQueryStat(stat: InboxQueryStat): void {
  latest = stat;
  recent.push(stat);
  if (recent.length > MAX_RECENT) recent.shift();
  for (const l of listeners) l();
}

export function getLatestInboxQueryStat(): InboxQueryStat | null {
  return latest;
}

export function getRecentInboxQueryStats(): readonly InboxQueryStat[] {
  return recent;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribe React components to the latest recorded query stat. */
export function useInboxQueryPerf(): {
  latest: InboxQueryStat | null;
  averageMs: number | null;
  sampleSize: number;
} {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => latest,
    () => latest,
  );
  // Recompute rolling average on each change without allocating on every render.
  const [avg, setAvg] = useState<{ averageMs: number | null; sampleSize: number }>({
    averageMs: null,
    sampleSize: 0,
  });
  useEffect(() => {
    if (recent.length === 0) {
      setAvg({ averageMs: null, sampleSize: 0 });
      return;
    }
    const total = recent.reduce((sum, s) => sum + s.durationMs, 0);
    setAvg({ averageMs: total / recent.length, sampleSize: recent.length });
  }, [snapshot]);
  return { latest: snapshot, averageMs: avg.averageMs, sampleSize: avg.sampleSize };
}

/** High-resolution timer that falls back to Date.now() outside browsers. */
export function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}
