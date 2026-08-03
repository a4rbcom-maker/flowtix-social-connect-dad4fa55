import { supabaseClient } from "../services/supabase.js";
import { waManager } from "./wa-manager.js";
import { logger } from "../logger.js";

const log = logger;
const workers = new Map<string, boolean>();

export function startCampaignWorker(campaignId: string) {
  if (workers.has(campaignId)) return;
  workers.set(campaignId, true);
  runCampaign(campaignId).catch((e: unknown) => log.error("WaCampaign", `worker error ${campaignId}: ${String(e)}`))
    .finally(() => workers.delete(campaignId));
}

export function stopCampaignWorker(campaignId: string) {
  workers.set(campaignId, false);
  workers.delete(campaignId);
}

async function runCampaign(campaignId: string) {
  const { data: campaign } = await supabaseClient.from("wa_campaigns").select("*").eq("id", campaignId).single();
  if (!campaign) { log.error("WaCampaign", `campaign ${campaignId} not found`); return; }

  const { count } = await supabaseClient.from("wa_campaign_recipients").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId);
  if ((count ?? 0) === 0) {
    const { data: n } = await supabaseClient.rpc("materialize_wa_campaign_audience", { p_campaign_id: campaignId } as never);
    log.info("WaCampaign", `materialized ${n} recipients`);
  }

  await supabaseClient.from("wa_campaigns").update({ status: "running", started_at: new Date().toISOString() } as never).eq("id", campaignId);

  const cfg = campaign.config || {};
  const delayMin: number = Math.max(cfg.delay_min ?? 30, 30);
  const delayMax: number = Math.max(cfg.delay_max ?? 120, 30);
  const ratePerHour: number = Math.min(cfg.rate_per_hour ?? 50, 50);
  const retryMax: number = cfg.retry_max ?? 3;
  const content = campaign.content || {};

  const sentWindow: number[] = [];

  while (workers.get(campaignId)) {
    const { data: batch } = await supabaseClient.from("wa_campaign_recipients")
      .select("id, contact_id, phone, jid, attempts")
      .eq("campaign_id", campaignId)
      .in("status", ["pending", "failed"])
      .lt("attempts", retryMax)
      .order("created_at").limit(1);

    if (!batch || batch.length === 0) break;

    const r = batch[0];
    const hourAgo = Date.now() - 3600000;
    while (sentWindow.length && sentWindow[0] < hourAgo) sentWindow.shift();
    if (sentWindow.length >= ratePerHour) {
      const waitMs = 3600000 - (Date.now() - sentWindow[0]);
      log.info("WaCampaign", `rate limit — waiting ${Math.round(waitMs / 1000)}s`);
      await sleep(Math.min(waitMs, 300000));
      continue;
    }

    let mediaUrl: string | undefined;
    if (content.media_storage_key) {
      try {
        const { data: signed } = await supabaseClient.storage.from("wa-media").createSignedUrl(content.media_storage_key as string, 600);
        mediaUrl = signed?.signedUrl;
      } catch {}
    }

    try {
      const payload: any = { type: campaign.type || "text" };
      if (content.template_id) {
        const { data: tpl } = await supabaseClient.from("wa_templates").select("*").eq("id", content.template_id as string).single();
        if (tpl) {
          let text = tpl.body || "";
          const jid = r.jid || `${r.phone}@s.whatsapp.net`;
          text = text.replace(/{{jid}}/g, jid).replace(/{{phone}}/g, r.phone);
          payload.text = text;
        }
      } else {
        payload.text = content.body;
        if (mediaUrl) { payload.mediaUrl = mediaUrl; payload.caption = content.caption; }
        if (content.buttons) payload.buttons = content.buttons;
      }

      const { messageId } = await waManager.send(campaign.wa_session_id, r.jid || `${r.phone}@s.whatsapp.net`, payload);
      sentWindow.push(Date.now());
      await supabaseClient.rpc("update_wa_campaign_progress", { p_campaign_id: campaignId, p_recipient_id: r.id, p_status: "sent", p_wa_message_id: messageId } as never);
      log.info("WaCampaign", `sent to ${r.phone}`);
    } catch (e: any) {
      await supabaseClient.rpc("update_wa_campaign_progress", { p_campaign_id: campaignId, p_recipient_id: r.id, p_status: "failed", p_error: String(e?.message ?? e) } as never);
      log.warn("WaCampaign", `failed ${r.phone}: ${String(e)}`);
    }

    const delayMs = (delayMin + Math.random() * (delayMax - delayMin)) * 1000;
    await sleep(delayMs);
  }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
