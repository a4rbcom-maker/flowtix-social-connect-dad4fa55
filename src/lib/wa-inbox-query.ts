// Pure helpers for building the WhatsApp inbox message query. Extracted from
// the inbox route so the branching (group vs private, alias fan-out, phone
// fallback, group-exclusion shield) can be unit-tested — any future edit that
// mixes @g.us rows into private chats or drops the group JID from the group
// query will fail the tests in src/lib/__tests__/wa-inbox-query.test.ts.

export function jidLocal(jid: string): string {
  return jid.split("@")[0] ?? "";
}

// WhatsApp's @lid identifiers are 14+ digit locals. Regular MSISDN-shaped
// @s.whatsapp.net JIDs whose local part is 14+ digits are also treated as LID
// (same rule the historical inbox code used).
export function isLidLocal(local: string): boolean {
  return /^\d{14,}$/.test(local);
}

export function isLidJid(jid: string): boolean {
  return jid.endsWith("@lid") || (jid.endsWith("@s.whatsapp.net") && isLidLocal(jidLocal(jid)));
}

function digitsOnly(value: string | null | undefined): string | null {
  const cleaned = value?.replace(/[^0-9]/g, "") ?? "";
  return cleaned || null;
}

/**
 * Normalize a stored contact_phone against the canonical JID. Returns null
 * when the "phone" is actually the LID local (a numeric identifier, not a
 * real MSISDN) so we don't OR-in a phone fallback that would match unrelated
 * rows.
 */
export function cleanAliasPhone(
  phone: string | null | undefined,
  canonicalJid: string,
): string | null {
  const local = jidLocal(canonicalJid);
  const normalized = digitsOnly(phone);
  if (!normalized) return null;
  return isLidLocal(local) && normalized === local ? null : normalized;
}

/**
 * Expand a private JID into the set of equivalent JIDs we should search on.
 * Groups return just themselves — the caller must never mix a group alias
 * into a private query. The returned list is filtered to exclude @g.us as
 * a defensive shield in case a caller passes a mixed set.
 */
export function inboxJidAliases(
  remoteJid: string,
  contactPhone?: string | null,
): string[] {
  const local = jidLocal(remoteJid);
  const aliases = new Set<string>([remoteJid]);
  if (remoteJid.endsWith("@lid")) {
    aliases.add(`${local}@s.whatsapp.net`);
  } else if (remoteJid.endsWith("@s.whatsapp.net") && isLidLocal(local)) {
    aliases.add(`${local}@lid`);
  }
  const phone = cleanAliasPhone(contactPhone, remoteJid);
  if (phone) aliases.add(`${phone}@s.whatsapp.net`);
  return Array.from(aliases).filter((jid) => !jid.endsWith("@g.us"));
}

export interface InboxMessageQueryPlan {
  /** "group" chats are strictly @g.us; "private" chats never include @g.us. */
  mode: "group" | "private";
  /** Exact JIDs the query should search — for private mode this excludes @g.us. */
  jids: string[];
  /** Normalized phone used as from_phone/to_phone fallback (private only). */
  phone: string | null;
  /**
   * PostgREST `.or(...)` clauses combined with AND on user_id. Empty when there
   * is nothing to search (caller should short-circuit and return []).
   */
  orClauses: string[];
  /**
   * Whether the query must apply `.not("remote_jid","like","%@g.us")` to
   * guarantee no group rows leak into a private conversation. Always true for
   * private mode; false for group mode (groups have their own strict eq).
   */
  excludeGroups: boolean;
}

function quoteJidForOr(jid: string): string {
  // PostgREST `.in.()` inside `.or()` needs double-quoted values so JIDs
  // containing dots/@ are not misparsed as filter separators.
  return `"${jid.replace(/"/g, '\\"')}"`;
}

/**
 * Build the query plan for `fetchInboxMessages`. This function contains ALL
 * the branching rules and is what the tests pin down — the route just wires
 * the plan into Supabase.
 */
export function buildInboxMessageQueryPlan(
  remoteJid: string,
  contactPhone: string | null | undefined,
): InboxMessageQueryPlan {
  if (remoteJid.endsWith("@g.us")) {
    return {
      mode: "group",
      jids: [remoteJid],
      phone: null,
      orClauses: [`remote_jid.eq.${remoteJid}`],
      excludeGroups: false,
    };
  }

  const jids = inboxJidAliases(remoteJid, contactPhone);
  const phone = cleanAliasPhone(contactPhone, remoteJid);
  const orClauses: string[] = [];
  if (jids.length > 0) {
    orClauses.push(`remote_jid.in.(${jids.map(quoteJidForOr).join(",")})`);
  }
  if (phone) {
    orClauses.push(`from_phone.eq.${phone}`);
    orClauses.push(`to_phone.eq.${phone}`);
  }
  return {
    mode: "private",
    jids,
    phone,
    orClauses,
    excludeGroups: true,
  };
}
