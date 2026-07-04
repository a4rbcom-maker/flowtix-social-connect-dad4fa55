// Strong dedupe for the inbox message list. Realtime + pagination + optimistic
// send can race and push the same row into the list from multiple paths:
//   1) msgsQuery.data (server fetch)                    ← authoritative
//   2) qc.setQueryData in loadOlderMessages (paging)    ← may overlap with (1)
//   3) optimisticMessages (client-side echo before ACK) ← may collide with (1)
//   4) realtime INSERT invalidation → refetch races (3) ← same DB id
//
// Rules:
//   - Primary key: row.id (DB uuid). Two entries with the same id collapse to
//     ONE row — never render duplicate bubbles.
//   - Merge policy on collision: prefer the "more real" row. A row whose
//     `queued_id` is set + status is "pending" is optimistic; the persisted
//     row (queued_id set, status != pending) wins. If both look real, prefer
//     the row with the later `created_at` (late-arriving update wins).
//   - Optimistic ↔ real pairing: an optimistic row (id starts with "optimistic-")
//     is dropped when a real row shares its `queued_id`. This survives the
//     window between the 1.2s optimistic timer and the next server refetch.
//   - Sort: primary by `created_at` ascending (late arrivals slot into place),
//     tiebreaker by id — deterministic to keep React keys stable.

import type { ChatMessageRow } from "@/lib/wa-chat.functions";

function isOptimistic(row: ChatMessageRow): boolean {
  return row.id.startsWith("optimistic-") || row.status === "pending";
}

function preferReal(a: ChatMessageRow, b: ChatMessageRow): ChatMessageRow {
  const aOpt = isOptimistic(a);
  const bOpt = isOptimistic(b);
  if (aOpt !== bOpt) return aOpt ? b : a;
  // Both real (or both optimistic): later created_at wins so a late server
  // UPDATE (delivery_state, status transition) overrides an earlier snapshot.
  const ta = Date.parse(a.created_at) || 0;
  const tb = Date.parse(b.created_at) || 0;
  if (ta !== tb) return ta > tb ? a : b;
  // Deterministic tiebreaker.
  return a.id <= b.id ? a : b;
}

export interface DedupeMessagesOptions {
  /** Ignore optimistic rows whose queued_id matches a real row here. */
  dropOptimisticByQueuedId?: boolean;
}

/**
 * Dedupe by id, pair optimistic ↔ real via queued_id, and stable-sort by
 * created_at. Input order does NOT matter — the function is idempotent.
 */
export function dedupeAndSortMessages(
  rows: readonly ChatMessageRow[],
  opts: DedupeMessagesOptions = { dropOptimisticByQueuedId: true },
): ChatMessageRow[] {
  // Step 1: index real rows by queued_id so we can drop optimistic twins.
  const realQueuedIds = new Set<string>();
  if (opts.dropOptimisticByQueuedId) {
    for (const r of rows) {
      if (!isOptimistic(r) && r.queued_id) realQueuedIds.add(r.queued_id);
    }
  }

  // Step 2: id-keyed merge, preferring real / later rows on collision.
  const byId = new Map<string, ChatMessageRow>();
  for (const r of rows) {
    if (
      opts.dropOptimisticByQueuedId &&
      isOptimistic(r) &&
      r.queued_id &&
      realQueuedIds.has(r.queued_id)
    ) {
      continue;
    }
    const prev = byId.get(r.id);
    byId.set(r.id, prev ? preferReal(prev, r) : r);
  }

  // Step 3: deterministic sort.
  const out = Array.from(byId.values());
  out.sort((a, b) => {
    const ta = Date.parse(a.created_at) || 0;
    const tb = Date.parse(b.created_at) || 0;
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}
