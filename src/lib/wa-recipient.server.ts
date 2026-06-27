import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { asRecord, digits, pickString } from "./wa-chat-helpers.server";

function isUsableJid(value: string | null): value is string {
  if (!value) return false;
  const jid = value.trim();
  return jid.includes("@") && !jid.endsWith("@broadcast") && jid !== "status@broadcast";
}

function toJid(value: string | null, kind: "phone" | "lid" | "unknown" = "unknown"): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (isUsableJid(trimmed)) return trimmed;
  const d = digits(trimmed);
  if (!d) return null;
  if (kind === "lid") return `${d}@lid`;
  return `${d}@s.whatsapp.net`;
}

function pickNestedJid(raw: Record<string, unknown>, phoneDigits: string | null): string | null {
  const key = asRecord(raw.key);
  const sender = asRecord(raw.sender);
  const from = asRecord(raw.from);

  const directCandidates = [
    pickString(key, "remoteJid", "participant"),
    pickString(raw, "remoteJid", "chatId", "jid", "senderJid", "participantJid", "remoteJidAlt", "participantAlt"),
    pickString(sender, "jid", "id", "remoteJid"),
    pickString(from, "jid", "id", "remoteJid"),
  ];
  for (const candidate of directCandidates) {
    const jid = toJid(candidate);
    if (jid?.endsWith("@lid")) return jid;
  }

  // Bot-Xtra v1.8.x / Baileys may send inbound customers as:
  //   from: "182239858000081"        ← WhatsApp LID chat address
  //   senderPn: "201273747262@s..."  ← public phone number
  // Sending back to the public PN can be accepted by the bridge queue but never
  // delivered. If the numeric `from` differs from senderPn, treat it as @lid.
  const rawFrom = pickString(raw, "from");
  const fromDigits = digits(rawFrom);
  if (fromDigits && phoneDigits && fromDigits !== phoneDigits) return `${fromDigits}@lid`;

  for (const candidate of directCandidates) {
    const jid = toJid(candidate);
    if (jid) return jid;
  }
  return null;
}

export async function resolveOutgoingWhatsappTarget(params: {
  userId: string;
  sessionId?: string | null;
  remoteJid: string;
  fallbackPhoneOrJid: string | null;
}): Promise<{ jid: string; phoneDigits: string | null; usedLid: boolean }> {
  const fallbackPhoneDigits = digits(params.fallbackPhoneOrJid) || digits(params.remoteJid);
  if (params.remoteJid.endsWith("@g.us")) {
    return { jid: params.remoteJid, phoneDigits: fallbackPhoneDigits, usedLid: false };
  }

  let query = supabaseAdmin
    .from("wa_messages")
    .select("raw, from_phone, remote_jid")
    .eq("user_id", params.userId)
    .eq("remote_jid", params.remoteJid)
    .eq("direction", "in")
    .not("raw", "is", null);
  if (params.sessionId) query = query.eq("session_id", params.sessionId);
  const { data } = await query.order("created_at", { ascending: false }).limit(20);

  let bestPhone = fallbackPhoneDigits;
  for (const row of data ?? []) {
    const raw = asRecord(row.raw);
    bestPhone = bestPhone || digits(row.from_phone) || digits(pickString(raw, "senderPn", "participantPn", "phoneNumber", "phone"));
    const jid = pickNestedJid(raw, bestPhone);
    if (jid?.endsWith("@lid")) return { jid, phoneDigits: bestPhone, usedLid: true };
  }

  const fallbackJid = toJid(params.fallbackPhoneOrJid) || toJid(params.remoteJid) || params.remoteJid;
  return { jid: fallbackJid, phoneDigits: bestPhone, usedLid: fallbackJid.endsWith("@lid") };
}