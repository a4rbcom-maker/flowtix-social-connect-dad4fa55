// Keyword auto-reply matcher. Runs before AI handler in the webhook so a
// matched keyword short-circuits the AI flow entirely.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendTextWithReconnect } from "./wa-bridge.server";
import { deriveWebhookUrl } from "./wa-helpers.server";

interface KeywordRuleRow {
  id: string;
  label: string;
  keywords: string[];
  match_mode: "exact" | "contains";
  reply_text: string;
  enabled: boolean;
  priority: number;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[\u064B-\u065F\u0670]/g, "") // Arabic diacritics
    .replace(/\s+/g, " ");
}

function ruleMatches(rule: KeywordRuleRow, text: string): boolean {
  const norm = normalize(text);
  for (const raw of rule.keywords ?? []) {
    const kw = normalize(raw);
    if (!kw) continue;
    if (rule.match_mode === "exact") {
      if (norm === kw) return true;
    } else {
      if (norm.includes(kw)) return true;
    }
  }
  return false;
}

/**
 * Try to match an inbound message against the user's keyword rules.
 * Returns true if a rule was matched and the reply was dispatched (caller
 * should then SKIP the AI handler).
 */
export async function tryKeywordAutoReply(opts: {
  userId: string;
  sessionId: string;
  remoteJid: string;
  fromPhone: string | null;
  inboundText: string;
}): Promise<boolean> {
  const { userId, sessionId, remoteJid, fromPhone, inboundText } = opts;
  const text = inboundText?.trim();
  if (!text) return false;

  try {
    const { data: rules } = await supabaseAdmin
      .from("wa_keyword_rules")
      .select("id, label, keywords, match_mode, reply_text, enabled, priority")
      .eq("user_id", userId)
      .eq("enabled", true)
      .order("priority", { ascending: false })
      .returns<KeywordRuleRow[]>();

    const matched = (rules ?? []).find((r) => ruleMatches(r, text));
    if (!matched) return false;

    const phone = fromPhone || remoteJid.replace(/[^0-9]/g, "");
    const to = remoteJid.endsWith("@g.us")
      ? remoteJid
      : remoteJid.includes("@")
        ? remoteJid
        : `${phone}@s.whatsapp.net`;

    try {
      const webhookUrl = await deriveWebhookUrl();
      await sendTextWithReconnect(sessionId, to, matched.reply_text, {
        webhookUrl: webhookUrl ?? undefined,
        tenantId: userId,
        recipientPhone: phone,
      });
    } catch (err) {
      console.error("[wa-keyword] bridge send failed:", err);
      return false;
    }

    await supabaseAdmin.from("wa_messages").insert({
      user_id: userId,
      session_id: sessionId,
      direction: "out",
      remote_jid: remoteJid,
      to_phone: phone,
      msg_type: "text",
      text_body: matched.reply_text,
      raw: { keywordRuleId: matched.id, keywordRuleLabel: matched.label } as never,
    });

    const currentCount = await currentHits(matched.id);
    await supabaseAdmin
      .from("wa_keyword_rules")
      .update({ hit_count: currentCount + 1, last_hit_at: new Date().toISOString() })
      .eq("id", matched.id);

    return true;
  } catch (err) {
    console.error("[wa-keyword] crashed:", err);
    return false;
  }
}

async function currentHits(id: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from("wa_keyword_rules")
    .select("hit_count")
    .eq("id", id)
    .maybeSingle();
  return data?.hit_count ?? 0;
}
