// Per-query-key stats for the WhatsApp inbox realtime path. The route calls
// recordScheduled() every time a realtime event asks for a refetch, and
// recordInvalidated() every time the debounced invalidator actually fires
// queryClient.invalidateQueries. The gap between "scheduled" and
// "invalidated" is the coalescing rate — proof that a burst of N events
// collapses into ≪N refetches.
//
// The inbox mounts <InboxQueryStatsPanel /> to render these numbers live.

import { useSyncExternalStore } from "react";

export interface QueryKeyStat {
  key: string;
  scheduled: number;      // realtime events that requested a refetch
  invalidated: number;    // actual invalidateQueries() calls fired
  lastScheduledAt: number | null;
  lastInvalidatedAt: number | null;
  windowMs: number;       // debounce window used for this key
}

const store = new Map<string, QueryKeyStat>();
const listeners = new Set<() => void>();
let snapshot: readonly QueryKeyStat[] = [];

function rebuild(): void {
  snapshot = Array.from(store.values()).sort((a, b) => a.key.localeCompare(b.key));
  for (const l of listeners) l();
}

function ensure(key: string, windowMs: number): QueryKeyStat {
  let s = store.get(key);
  if (!s) {
    s = {
      key,
      scheduled: 0,
      invalidated: 0,
      lastScheduledAt: null,
      lastInvalidatedAt: null,
      windowMs,
    };
    store.set(key, s);
  } else if (s.windowMs !== windowMs) {
    s.windowMs = windowMs;
  }
  return s;
}

export function recordQueryScheduled(key: string, windowMs: number): void {
  const s = ensure(key, windowMs);
  s.scheduled += 1;
  s.lastScheduledAt = Date.now();
  rebuild();
}

export function recordQueryInvalidated(key: string, windowMs: number): void {
  const s = ensure(key, windowMs);
  s.invalidated += 1;
  s.lastInvalidatedAt = Date.now();
  rebuild();
}

export function resetInboxQueryStats(): void {
  store.clear();
  rebuild();
}

export function getInboxQueryStatsSnapshot(): readonly QueryKeyStat[] {
  return snapshot;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useInboxQueryStats(): readonly QueryKeyStat[] {
  return useSyncExternalStore(subscribe, getInboxQueryStatsSnapshot, getInboxQueryStatsSnapshot);
}

/** Coalescing rate: 1 - invalidated/scheduled. Higher = more bursts collapsed. */
export function coalescingRate(s: QueryKeyStat): number {
  if (s.scheduled === 0) return 0;
  return Math.max(0, 1 - s.invalidated / s.scheduled);
}
