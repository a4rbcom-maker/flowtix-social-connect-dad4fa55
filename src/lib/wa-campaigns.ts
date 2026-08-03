import { supabase } from "@/lib/supabase";
import type { WaCampaign, WaCampaignStatus, WaTemplate, CampaignContent, CampaignConfig } from "@/types/wa-campaigns.types";

const apiUrl = import.meta.env.VITE_EXTRACTION_API_URL || "http://localhost:3100";
const apiKey = import.meta.env.VITE_EXTRACTION_API_KEY || "local-dev-key-change-in-production";

export const waCampaignsRepository = {
  async list(workspaceId: string, status?: WaCampaignStatus): Promise<WaCampaign[]> {
    let q = (supabase as any).from("wa_campaigns").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false });
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },
  async create(input: {
    workspaceId: string; userId: string; sessionId: string; name: string;
    type: string; content: CampaignContent; config: CampaignConfig;
    audienceFilter: Record<string, unknown>; scheduledAt?: string | null;
  }): Promise<WaCampaign> {
    const { data, error } = await (supabase as any).from("wa_campaigns").insert({
      workspace_id: input.workspaceId, user_id: input.userId, wa_session_id: input.sessionId,
      name: input.name, type: input.type, status: "draft",
      content: input.content, config: input.config,
      audience_filter: input.audienceFilter, scheduled_at: input.scheduledAt ?? null,
    }).select().single();
    if (error) throw error;
    return data;
  },
  async control(campaignId: string, action: "start" | "pause" | "resume" | "stop"): Promise<void> {
    const res = await fetch(`${apiUrl}/wa/campaigns/${campaignId}/${action}`, { method: "POST", headers: { "X-API-Key": apiKey } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error?.message ?? `HTTP ${res.status}`);
  },
  async listTemplates(workspaceId: string): Promise<WaTemplate[]> {
    const { data, error } = await (supabase as any).from("wa_templates").select("*").eq("workspace_id", workspaceId).order("name");
    if (error) throw error;
    return data ?? [];
  },
  async saveTemplate(input: any): Promise<void> {
    const { workspaceId, ...rest } = input;
    await (supabase as any).from("wa_templates").insert({ workspace_id: workspaceId, ...rest });
  },
  async deleteTemplate(id: string): Promise<void> { await (supabase as any).from("wa_templates").delete().eq("id", id); },
};
