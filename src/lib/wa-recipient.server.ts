import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { asRecord, digits, normalizeWhatsappPhone, pickString } from "./wa-chat-helpers.server";

function isUsableJid(value: string | null): value is string {
  if (!value) return false;
  const jid = value.trim();
  return jid.includes("@") && !jid.endsWith("@broadcast") && jid !== "status@broadcast";
}

function toJid(value: string | null, kind: "phone" | "lid" | "unknown" = "unknown"): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (isUsableJid(trimmed)) return trimmed;
  const d = normalizeWhatsappPhone(trimmed);
  if (!d) return null;
  if (kind === "lid") return `${d}@lid`;
  return `${d}@s.whatsapp.net`;
}

function looksLikeLidAlias(value: string | null | undefined): boolean {
  const local = String(value ?? "").split("@")[0] ?? "";
  return /^\d{14,}$/.test(local.replace(/[^0-9]/g, ""));
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
  if (fromDigits && looksLikeLidAlias(fromDigits)) return `${fromDigits}@lid`;

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
  const fallbackPhoneDigits = normalizeWhatsappPhone(params.fallbackPhoneOrJid) || normalizeWhatsappPhone(params.remoteJid);
  if (params.remoteJid.endsWith("@g.us")) {
    return { jid: params.remoteJid, phoneDigits: fallbackPhoneDigits, usedLid: false };
  }

  const loadRows = async (mode: "remote_jid" | "from_phone", value: string) => {
    let query = supabaseAdmin
      .from("wa_messages")
      .select("raw, from_phone, remote_jid, created_at, wa_timestamp")
      .eq("user_id", params.userId)
      .eq(mode, value)
      .eq("direction", "in")
      .not("raw", "is", null);
    if (params.sessionId) query = query.eq("session_id", params.sessionId);
    const { data } = await query.order("created_at", { ascending: false }).limit(20);
    return data ?? [];
  };

  const rows = await loadRows("remote_jid", params.remoteJid);
  const phoneMatchedRows = fallbackPhoneDigits ? await loadRows("from_phone", fallbackPhoneDigits) : [];
  const data = [...rows, ...phoneMatchedRows].filter((row, index, all) => {
    const key = `${row.remote_jid}|${row.from_phone}|${JSON.stringify(row.raw).slice(0, 160)}`;
    return all.findIndex((candidate) => `${candidate.remote_jid}|${candidate.from_phone}|${JSON.stringify(candidate.raw).slice(0, 160)}` === key) === index;
  }).sort((a, b) => {
    const at = new Date((a.wa_timestamp || a.created_at || 0) as string | number).getTime() || 0;
    const bt = new Date((b.wa_timestamp || b.created_at || 0) as string | number).getTime() || 0;
    return bt - at;
  });

  let bestPhone = fallbackPhoneDigits;
  for (const row of data) {
    const raw = asRecord(row.raw);
    bestPhone = bestPhone || normalizeWhatsappPhone(row.from_phone) || normalizeWhatsappPhone(pickString(raw, "senderPn", "participantPn", "phoneNumber", "phone"));
    const rowJid = toJid(row.remote_jid);
    if (rowJid?.endsWith("@s.whatsapp.net") && bestPhone && rowJid.split("@")[0] === bestPhone) {
      return { jid: rowJid, phoneDigits: bestPhone, usedLid: false };
    }
    if (rowJid?.endsWith("@lid")) return { jid: rowJid, phoneDigits: bestPhone, usedLid: true };
    if (rowJid?.endsWith("@s.whatsapp.net") && looksLikeLidAlias(rowJid) && (!bestPhone || bestPhone === rowJid.split("@")[0])) {
      return { jid: `${rowJid.split("@")[0]}@lid`, phoneDigits: bestPhone, usedLid: true };
    }
    const jid = pickNestedJid(raw, bestPhone);
    if (jid?.endsWith("@lid")) return { jid, phoneDigits: bestPhone, usedLid: true };
  }

  const fallbackJid = toJid(params.fallbackPhoneOrJid) || toJid(params.remoteJid) || params.remoteJid;
  if (fallbackJid.endsWith("@s.whatsapp.net") && looksLikeLidAlias(fallbackJid) && (!bestPhone || bestPhone === fallbackJid.split("@")[0])) {
    return { jid: `${fallbackJid.split("@")[0]}@lid`, phoneDigits: bestPhone, usedLid: true };
  }
  return { jid: fallbackJid, phoneDigits: bestPhone, usedLid: fallbackJid.endsWith("@lid") };
}