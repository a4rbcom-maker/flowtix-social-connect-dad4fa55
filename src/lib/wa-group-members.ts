// Helpers for counting active group members observed in loaded messages.
// Used by the inbox header. The pure functions live here so the logic can be
// unit-tested without pulling in the whole route.
//
// Two APIs are exposed:
//  - `computeGroupMemberCount(messages, jid)` — stateless, single-shot count
//    from a snapshot of messages (fine when the whole thread is in memory).
//  - `accumulateGroupMembers(state, messages, jid)` / `countAccumulated(state)`
//    — stateful accumulator keyed per-JID so paginating older pages or
//    reloading the conversation only *adds* new unique senders. The set is
//    de-duplicated by normalized identifier, so seeing the same person again
//    (across pages, refetches, realtime replays) never inflates the count.

export interface GroupMemberMessage {
  direction: "in" | "out" | string;
  sender_phone?: string | null;
  sender_name?: string | null;
}

export interface GroupMemberState {
  members: Set<string>;
  sawSelf: boolean;
}

function normalizeKey(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  // Prefer digits-only for phone-like identifiers so "+20 100…" and "20100…"
  // collapse to the same key. Fall back to a lowercased name otherwise.
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (digits.length >= 6) return `p:${digits}`;
  return `n:${trimmed.toLowerCase()}`;
}

function senderKey(m: GroupMemberMessage): string | null {
  return normalizeKey(m.sender_phone) ?? normalizeKey(m.sender_name);
}

export function createGroupMemberState(): GroupMemberState {
  return { members: new Set<string>(), sawSelf: false };
}

/**
 * Fold a batch of messages into the accumulator for `jid`. Returns a NEW state
 * object when something changed (so React memo comparisons work), or the same
 * reference when nothing new was observed. Non-group JIDs are a no-op.
 */
export function accumulateGroupMembers(
  prev: GroupMemberState,
  messages: readonly GroupMemberMessage[],
  jid: string | null | undefined,
): GroupMemberState {
  if (!jid || !jid.endsWith("@g.us")) return prev;
  let members = prev.members;
  let sawSelf = prev.sawSelf;
  let mutated = false;
  for (const m of messages) {
    if (m.direction === "out") {
      if (!sawSelf) {
        sawSelf = true;
        mutated = true;
      }
      continue;
    }
    const key = senderKey(m);
    if (!key || members.has(key)) continue;
    if (!mutated) {
      members = new Set(members);
      mutated = true;
    }
    members.add(key);
  }
  return mutated ? { members, sawSelf } : prev;
}

export function countAccumulated(state: GroupMemberState): number {
  return state.members.size + (state.sawSelf ? 1 : 0);
}

/**
 * Stateless snapshot counter — kept for callers/tests that only need a
 * single-shot count from the currently loaded messages.
 */
export function computeGroupMemberCount(
  messages: readonly GroupMemberMessage[],
  jid: string | null | undefined,
): number {
  return countAccumulated(
    accumulateGroupMembers(createGroupMemberState(), messages, jid),
  );
}
