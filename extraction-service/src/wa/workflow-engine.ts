import { supabaseClient } from "../services/supabase.js";
import { waManager } from "./wa-manager.js";
import { logger } from "../logger.js";
import type { IncomingWaMessage } from "./types.js";

const log = logger;

interface WorkflowStep { id: string; step_type: string; config: any; sort_order: number; }

function triggerMatches(wf: any, m: IncomingWaMessage): boolean {
  const t = wf.trigger || {};
  if (!t.type) return false;
  if (t.type === "keyword") return !!(m.text && t.value && m.text.toLowerCase().includes(String(t.value).toLowerCase()));
  if (t.type === "new_conversation") return true;
  return false;
}

export const workflowEngine = {
  async tryTrigger(m: IncomingWaMessage): Promise<boolean> {
    if (!m.workspaceId) return false;
    try {
      const { data: wfs } = await supabaseClient.from("wa_workflows").select("*")
        .eq("workspace_id", m.workspaceId).eq("status", "active")
        .or(`wa_session_id.is.null,wa_session_id.eq.${m.sessionId}`);
      for (const wf of wfs ?? []) {
        if (triggerMatches(wf, m)) {
          await this.startForContact(wf.id, m);
          return true;
        }
      }
    } catch {}
    return false;
  },

  async startForContact(workflowId: string, m: IncomingWaMessage): Promise<void> {
    try {
      const { data: contact } = await supabaseClient.from("wa_contacts").select("id").eq("jid", m.remoteJid).eq("workspace_id", m.workspaceId).maybeSingle();
      if (!contact) return;
      const { data: existing } = await supabaseClient.from("wa_workflow_states").select("id, status").eq("workflow_id", workflowId).eq("contact_id", contact.id).maybeSingle();
      if (existing?.status === "running") return;

      const { data: firstStep } = await supabaseClient.from("wa_workflow_steps").select("*").eq("workflow_id", workflowId).order("sort_order").limit(1).maybeSingle();
      if (!firstStep) return;

      await supabaseClient.from("wa_workflow_states").upsert({
        workspace_id: m.workspaceId, workflow_id: workflowId, contact_id: contact.id,
        current_step_id: firstStep.id, status: "running", context: {},
      } as never, { onConflict: "workflow_id,contact_id" });

      await this.runStep(firstStep, m, contact.id, workflowId);
    } catch (e) { log.error("Workflow", `start error: ${String(e)}`); }
  },

  // Called from handleMessage on incoming reply for contacts in awaiting_reply state
  async continueFromReply(m: IncomingWaMessage): Promise<boolean> {
    if (!m.workspaceId) return false;
    try {
      const { data: contact } = await supabaseClient.from("wa_contacts").select("id").eq("jid", m.remoteJid).eq("workspace_id", m.workspaceId).maybeSingle();
      if (!contact) return false;
      const { data: state } = await supabaseClient.from("wa_workflow_states").select("*, steps:wa_workflow_steps!inner(*)").eq("contact_id", contact.id).eq("status", "running").maybeSingle();
      if (!state?.context?.awaiting_reply) return false;
      // Found awaiting_reply state — continue from current step to next
      const step = state.steps;
      const { data: next } = await supabaseClient.from("wa_workflow_steps").select("*").eq("workflow_id", state.workflow_id).gt("sort_order", step.sort_order).order("sort_order").limit(1).maybeSingle();
      if (next) {
        await supabaseClient.from("wa_workflow_states").update({ current_step_id: next.id, context: {} as never }).eq("id", state.id);
        await this.runStep(next, m, contact.id, state.workflow_id);
      } else {
        await supabaseClient.from("wa_workflow_states").update({ status: "completed", current_step_id: null }).eq("id", state.id);
      }
      return true;
    } catch {}
    return false;
  },

  async runStep(step: WorkflowStep, m: IncomingWaMessage, contactId: string, workflowId: string): Promise<void> {
    const cfg = step.config || {};
    switch (step.step_type) {
      case "send_message":
        if (cfg.text) { try { await waManager.send(m.sessionId, m.remoteJid, { type: "text", text: cfg.text } as any); } catch {} }
        break;
      case "delay":
        if (cfg.delay_sec) await new Promise((r) => setTimeout(r, (cfg.delay_sec as number) * 1000));
        break;
      case "ask_question":
        if (cfg.text) { try { await waManager.send(m.sessionId, m.remoteJid, { type: "text", text: cfg.text } as any); } catch {} }
        await supabaseClient.from("wa_workflow_states").update({ context: { awaiting_reply: true } as never }).eq("current_step_id", step.id);
        return;
      case "buttons":
        try { await waManager.send(m.sessionId, m.remoteJid, { type: "buttons", text: cfg.text || "", buttons: cfg.buttons ?? [] } as any); } catch {}
        break;
      case "api":
        if (cfg.url) { try { await fetch(cfg.url, { method: cfg.method || "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg.body ?? {}) }); } catch {} }
        break;
      case "ai": case "end":
        if (step.step_type === "end") await supabaseClient.from("wa_workflow_states").update({ status: "completed", current_step_id: null }).eq("current_step_id", step.id);
        return;
    }

    const { data: next } = await supabaseClient.from("wa_workflow_steps").select("*").eq("workflow_id", workflowId).gt("sort_order", step.sort_order).order("sort_order").limit(1).maybeSingle();
    if (next) {
      await supabaseClient.from("wa_workflow_states").update({ current_step_id: next.id }).eq("current_step_id", step.id);
      await this.runStep(next, m, contactId, workflowId);
    } else {
      await supabaseClient.from("wa_workflow_states").update({ status: "completed", current_step_id: null }).eq("current_step_id", step.id);
    }
  },
};
