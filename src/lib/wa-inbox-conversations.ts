// Pure helpers for conversation grouping, alias merging, and sorting in the
// WhatsApp inbox sidebar. Extracted from src/routes/dashboard.whatsapp.inbox.tsx
// so late-arriving realtime updates that touch last_message_at / preview text
// can be verified deterministically — see
// src/lib/__tests__/wa-inbox-conversations.test.ts.
//
// Sort contract (highest → lowest priority):
//   1) _sort_at   — أحدث رسالة فعلية من wa_messages (يعكس دفعات realtime).
//   2) last_message_at + وجود معاينة أو unread — نشاط حقيقي.
//   3) خانة صفر — كتالوجات فارغة تُدفع للأسفل.
// Tiebreaker deترministically stable by contact name / phone / jid.

import { cleanAliasPhone, jidLocal } from "@/lib/wa-inbox-query";
import type { ConversationRow } from "@/lib/wa-chat.functions";

export type RankedConversationRow = ConversationRow & {
  _sort_at?: string | null;
  _has_stored_message?: boolean;
};

export function conversationIdentities(
  conv: ConversationRow,
  lidLocals: Set<string>,
): string[] {
  const local = jidLocal(conv.remote_jid);
  const identities = new Set<string>([`jid:${conv.remote_jid}`]);
  if (local && (conv.remote_jid.endsWith("@lid") || lidLocals.has(local))) {
    identities.add(`lid:${local}`);
  }
  const phone = cleanAliasPhone(conv.contact_phone, conv.remote_jid);
  if (phone) identities.add(`phone:${phone}`);
  return Array.from(identities);
}

export function usefulContactName(
  name: string | null | undefined,
  phone: string | null | undefined,
  jid: string,
): string | null {
  const cleaned = name?.trim();
  if (!cleaned) return null;
  const compact = cleaned.replace(/\s+/g, "");
  if (/^\+?\d{6,}$/.test(compact)) return null;
  if (cleaned === jid || cleaned === phone) return null;
  return cleaned;
}

export function safeTimeMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const time = new Date(iso).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function hasConversationPreview(conv: ConversationRow): boolean {
  return Boolean(conv.last_message_text?.trim());
}

export function conversationSortMs(conv: ConversationRow): number {
  const ranked = conv as RankedConversationRow;
  if (ranked._sort_at) return safeTimeMs(ranked._sort_at);
  const hasRealActivity = hasConversationPreview(conv) || (conv.unread_count || 0) > 0;
  if (hasRealActivity) return safeTimeMs(conv.last_message_at);
  return 0;
}

export function compareConversationsByLastRealActivity(
  a: ConversationRow,
  b: ConversationRow,
): number {
  const byActivity = conversationSortMs(b) - conversationSortMs(a);
  if (byActivity !== 0) return byActivity;
  return (a.contact_name || a.contact_phone || a.remote_jid).localeCompare(
    b.contact_name || b.contact_phone || b.remote_jid,
  );
}

/**
 * Merge N conversation aliases (LID + @s.whatsapp.net + phone) into one row.
 * The "newest" alias (by compareConversationsByLastRealActivity) wins for
 * last_message_at / _text / _direction — so a late realtime update on any
 * alias promotes the whole group to the top.
 */
export function mergeConversationAliases(items: ConversationRow[]): RankedConversationRow {
  const sorted = [...items].sort(compareConversationsByLastRealActivity);
  const preferred = items.find((c) => c.remote_jid.endsWith("@lid")) ?? sorted[0];
  const newest = sorted[0];
  const phone = items
    .map((c) => cleanAliasPhone(c.contact_phone, preferred.remote_jid))
    .find(Boolean) ?? null;
  const name = items
    .map((c) => usefulContactName(c.contact_name, phone, c.remote_jid))
    .find(Boolean) ?? null;
  return {
    ...preferred,
    contact_name: name,
    contact_phone: phone,
    profile_pic_url: items.map((c) => c.profile_pic_url).find(Boolean) ?? null,
    last_message_text: newest.last_message_text,
    last_message_at: newest.last_message_at,
    last_direction: newest.last_direction,
    unread_count: items.reduce((sum, c) => sum + (c.unread_count || 0), 0),
    ai_enabled: items.some((c) => c.ai_enabled),
    _sort_at: (newest as RankedConversationRow)._sort_at ?? newest.last_message_at,
    _has_stored_message:
      (newest as RankedConversationRow)._has_stored_message ?? hasConversationPreview(newest),
  };
}

/**
 * Full pipeline used by the inbox sidebar: group aliases → merge each group →
 * sort deterministically. Same output as the route's useMemo pipeline.
 */
export function groupSortConversations(raw: ConversationRow[]): RankedConversationRow[] {
  const lidLocals = new Set(
    raw
      .filter((c) => c.remote_jid.endsWith("@lid"))
      .map((c) => c.remote_jid.split("@")[0])
      .filter(Boolean) as string[],
  );
  const groups = new Map<string, ConversationRow[]>();
  const identityToKey = new Map<string, string>();
  for (const c of raw) {
    const identities = conversationIdentities(c, lidLocals);
    const existingKeys = Array.from(
      new Set(identities.map((id) => identityToKey.get(id)).filter(Boolean) as string[]),
    );
    const key = existingKeys[0] ?? identities[0] ?? `jid:${c.remote_jid}`;
    const mergedItems = [...(groups.get(key) ?? []), c];
    for (const oldKey of existingKeys.slice(1)) {
      mergedItems.push(...(groups.get(oldKey) ?? []));
      groups.delete(oldKey);
    }
    groups.set(key, mergedItems);
    for (const id of identities) identityToKey.set(id, key);
  }
  return Array.from(groups.values())
    .map((items) => mergeConversationAliases(items))
    .sort(compareConversationsByLastRealActivity);
}
