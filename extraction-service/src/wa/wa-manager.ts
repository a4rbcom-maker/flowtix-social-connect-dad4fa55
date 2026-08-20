import { baileysProvider } from "./baileys-provider.js";
import { supabaseClient } from "../services/supabase.js";
import { logger } from "../logger.js";
import { keywordEngine } from "./keyword-engine.js";
import { workflowEngine } from "./workflow-engine.js";
import { aiRouter } from "../ai/router.js";
import type { IncomingWaMessage } from "./types.js";

const log = logger;
let booted = false;

async function handleMessage(m: IncomingWaMessage) {
  const phone = m.remoteJid.split("@")[0];
  try {
    const { error } = await supabaseClient.rpc("upsert_wa_inbound", {
      p_workspace_id: m.workspaceId || "00000000-0000-0000-0000-000000000000",
      p_wa_session_id: m.sessionId, p_phone: phone, p_jid: m.remoteJid,
      p_push_name: m.pushName ?? "", p_type: m.type, p_body: m.text ?? "",
      p_wa_message_id: m.messageId, p_has_media: m.hasMedia,
      p_media_mime: m.mediaMimeType ?? null, p_timestamp: m.timestamp,
    } as never);
    if (error) log.error("WAHandle", `persist failed: ${error.message}`);
  } catch (e) { log.error("WAHandle", `persist failed: ${String(e)}`); }

  // Check for workflow continuation (ask_question awaiting_reply)
  const continued = await workflowEngine.continueFromReply(m);
  if (continued) { log.info("WAHandle", `workflow continued for ${phone}`); return; }

  // Keyword bot — first in chain, stops before AI
  const { rule, stopChain } = await keywordEngine.tryMatch(m);
  if (stopChain && rule) {
    await keywordEngine.execute(rule, m);
    if (rule.action !== "ai") { log.info("WAHandle", `keyword matched: ${rule.name}`); return; }
  }

  // Workflow trigger
  const wfTriggered = await workflowEngine.tryTrigger(m);
  if (wfTriggered) { log.info("WAHandle", `workflow triggered for ${phone}`); return; }

  // AI Router — last in chain, escalates to human if needed
  const aiResult = await aiRouter.handleMessage(m);
  if (aiResult.handled) { log.info("WAHandle", `AI handled (${aiResult.level}): ${phone}`); return; }
  log.info("WAHandle", `inbound: ${phone} → "${(m.text ?? "[media]").substring(0, 60)}"`);
}

export const waManager = {
  async boot() {
    if (booted) return; booted = true;
    const { data } = await supabaseClient.from("wa_sessions")
      .select("id, workspace_id, name, provider_type").eq("status", "connected").is("deleted_at", null);
    for (const s of data ?? []) {
      if (s.provider_type === "baileys") {
        this.start(s.id, s.workspace_id).catch((e) => log.error("WAManager", `boot start failed ${s.id}: ${String(e)}`));
      }
    }
    log.info("WAManager", `booted — resumed ${(data ?? []).length} sessions`);
  },

  async start(sessionId: string, workspaceId: string) {
    await baileysProvider.start(sessionId,
      (_qr) => {},
      async ({ jid, pushName }) => { log.info("WAManager", `connected ${sessionId} → ${jid}`); },
      (m) => { m.workspaceId = workspaceId; handleMessage(m); },
      (reason) => log.warn("WAManager", `${sessionId} closed: ${reason}`),
    );
  },

  async requestQR(sessionId: string, workspaceId?: string) {
    if (!baileysProvider.isAuthenticated(sessionId)) {
      let resolvedWorkspaceId = workspaceId;
      if (!resolvedWorkspaceId) {
        const { data } = await supabaseClient
          .from("wa_sessions")
          .select("workspace_id")
          .eq("id", sessionId)
          .is("deleted_at", null)
          .single();
        resolvedWorkspaceId = data?.workspace_id ?? "";
      }
      await this.start(sessionId, resolvedWorkspaceId ?? "");
    }
  },

  getQR(sessionId: string) { return baileysProvider.getQR(sessionId); },

  isConnected(sessionId: string) { return baileysProvider.isAuthenticated(sessionId); },

  async send(sessionId: string, to: string, payload: any) { return baileysProvider.send(sessionId, to, payload); },

  async stop(sessionId: string) { return baileysProvider.stop(sessionId); },

  async shutdown() {
    const ids = Array.from((baileysProvider as any).sockets?.keys?.() ?? []);
    for (const id of ids as string[]) { await baileysProvider.stop(id).catch(() => {}); }
  },
};
