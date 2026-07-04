// Pure helper for counting active group members from the messages we have
// loaded for a conversation. Used by the inbox header. Kept in its own module
// so the logic can be unit-tested without pulling in the whole route.

export interface GroupMemberMessage {
  direction: "in" | "out" | string;
  sender_phone?: string | null;
  sender_name?: string | null;
}

/**
 * Count unique group participants observed in the loaded messages.
 *
 * Rules:
 * - Only counts when `jid` is a group JID (ends with `@g.us`); returns 0 otherwise.
 * - Every outgoing (`direction === "out"`) message means the account owner
 *   participated, so the owner is counted once even if there are no other outs.
 * - Incoming messages are de-duplicated by `sender_phone` (preferred) or
 *   `sender_name` (fallback) so a chatty member isn't counted twice.
 * - Blank/whitespace sender identifiers are ignored — they can't be dedup'd
 *   reliably and would inflate the count.
 */
export function computeGroupMemberCount(
  messages: readonly GroupMemberMessage[],
  jid: string | null | undefined,
): number {
  if (!jid || !jid.endsWith("@g.us")) return 0;
  const seen = new Set<string>();
  let sawSelf = false;
  for (const m of messages) {
    if (m.direction === "out") {
      sawSelf = true;
      continue;
    }
    const key =
      (m.sender_phone && m.sender_phone.trim()) ||
      (m.sender_name && m.sender_name.trim());
    if (key) seen.add(key);
  }
  return seen.size + (sawSelf ? 1 : 0);
}
