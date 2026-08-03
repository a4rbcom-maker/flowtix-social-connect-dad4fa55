import { supabase } from "@/lib/supabase";
import type { AiProviderConfig, AiInstructionItem, AiInvocation } from "@/types/wa-ai.types";

export const waAiRepository = {
  async getConfig(workspaceId: string): Promise<Omit<AiProviderConfig, "api_key_enc"> | null> {
    const { data, error } = await (supabase as any).from("ai_provider_configs")
      .select("id,workspace_id,provider,name,base_url,models,settings,cost_caps,is_active,system_instructions,created_at,updated_at")
      .eq("workspace_id", workspaceId).maybeSingle();
    if (error) throw error; return data as any;
  },
  async saveConfig(workspaceId: string, input: { baseUrl: string; apiKey?: string; models: { l1: string; l2: string; l3: string }; settings?: Record<string, unknown>; costCaps?: Record<string, number>; isActive?: boolean }): Promise<void> {
    const body: any = { base_url: input.baseUrl, models: input.models, settings: input.settings ?? {}, cost_caps: input.costCaps ?? {}, is_active: input.isActive ?? true };
    if (input.apiKey) body.api_key_enc = input.apiKey;
    const { data: existing } = await (supabase as any).from("ai_provider_configs").select("id").eq("workspace_id", workspaceId).maybeSingle();
    if (existing) await (supabase as any).from("ai_provider_configs").update(body).eq("id", existing.id);
    else await (supabase as any).from("ai_provider_configs").insert({ workspace_id: workspaceId, provider: "kie", name: "kie.ai", ...body });
  },
  async testConfig(workspaceId: string): Promise<{ success: boolean; message: string }> {
    const apiUrl = import.meta.env.VITE_EXTRACTION_API_URL || "http://localhost:3100";
    const apiKey = import.meta.env.VITE_EXTRACTION_API_KEY || "local-dev-key-change-in-production";
    const res = await fetch(`${apiUrl}/ai/test`, { method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": apiKey }, body: JSON.stringify({ workspace_id: workspaceId }) });
    const j = await res.json().catch(() => ({}));
    return { success: res.ok && j.success, message: j?.message ?? `HTTP ${res.status}` };
  },
  async listInstructions(workspaceId: string): Promise<AiInstructionItem[]> {
    const { data } = await (supabase as any).from("ai_instructions").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false });
    return data ?? [];
  },
  async saveInstructions(input: Partial<AiInstructionItem> & { workspaceId: string }): Promise<void> {
    const { workspaceId, ...rest } = input;
    if (rest.id) await (supabase as any).from("ai_instructions").update(rest).eq("id", rest.id);
    else await (supabase as any).from("ai_instructions").insert({ workspace_id: workspaceId, ...rest });
  },
  async deleteInstructions(id: string): Promise<void> { await (supabase as any).from("ai_instructions").delete().eq("id", id); },
  async listInvocations(workspaceId: string, limit = 100): Promise<AiInvocation[]> {
    const { data } = await (supabase as any).from("ai_invocations").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(limit);
    return data ?? [];
  },
};
