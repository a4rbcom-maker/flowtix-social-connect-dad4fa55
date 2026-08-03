import { supabaseClient } from "../services/supabase.js";
import { waManager } from "./wa-manager.js";
import { logger } from "../logger.js";
import type { IncomingWaMessage } from "./types.js";

const log = logger;

interface KeywordRule {
  id: string; workspace_id: string; wa_session_id: string | null;
  name: string; match_type: "equals" | "contains" | "regex" | "starts_with" | "ends_with";
  keywords: string[]; case_sensitive: boolean; action: string;
  reply_text: string | null; reply_template_id: string | null; workflow_id: string | null;
}

function matches(text: string, rule: KeywordRule): boolean {
  const hay = rule.case_sensitive ? text : text.toLowerCase();
  for (const kw of rule.keywords) {
    const needle = rule.case_sensitive ? kw : kw.toLowerCase();
    switch (rule.match_type) {
      case "equals": if (hay.trim() === needle) return true; break;
      case "contains": if (hay.includes(needle)) return true; break;
      case "starts_with": if (hay.trim().startsWith(needle)) return true; break;
      case "ends_with": if (hay.trim().endsWith(needle)) return true; break;
      case "regex": try { if (new RegExp(kw, rule.case_sensitive ? "" : "i").test(text)) return true; } catch {} break;
    }
  }
  return false;
}

export const keywordEngine = {
  async tryMatch(m: IncomingWaMessage): Promise<{ rule: KeywordRule | null; stopChain: boolean }> {
    if (!m.text || !m.workspaceId) return { rule: null, stopChain: false };
    try {
      const { data, error } = await supabaseClient.rpc("get_active_keyword_rules", { p_workspace_id: m.workspaceId, p_session_id: m.sessionId } as never);
      if (error || !data) return { rule: null, stopChain: false };
      for (const rule of data as KeywordRule[]) {
        if (matches(m.text, rule)) {
          log.info("KeywordBot", `match: "${rule.name}" on "${m.text}"`);
          return { rule, stopChain: true };
        }
      }
    } catch (e) { log.error("KeywordBot", `tryMatch error: ${String(e)}`); }
    return { rule: null, stopChain: false };
  },

  async execute(rule: KeywordRule, m: IncomingWaMessage): Promise<void> {
    await supabaseClient.from("wa_automation_logs").insert({
      workspace_id: m.workspaceId, contact_id: null, source: "keyword_rule", source_id: rule.id,
      message: `Rule "${rule.name}" matched`, metadata: { text: m.text } as never,
    } as never);
    if (rule.action === "reply") {
      const text = rule.reply_template_id ? ((await supabaseClient.from("wa_templates").select("body").eq("id", rule.reply_template_id).maybeSingle()).data?.body || rule.reply_text) : rule.reply_text;
      if (text) { try { await waManager.send(m.sessionId, m.remoteJid, { type: "text", text } as any); } catch {} }
    } else if (rule.action === "trigger_workflow" && rule.workflow_id) {
      try {
        const { workflowEngine } = await import("./workflow-engine.js");
        await workflowEngine.startForContact(rule.workflow_id, m);
      } catch {}
    }
  },
};
