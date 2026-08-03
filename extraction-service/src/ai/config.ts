import { supabaseClient } from "../services/supabase.js";
import { logger } from "../logger.js";

const log = logger;

export interface ProviderConfig {
  workspaceId: string;
  baseUrl: string;
  apiKey: string;
  models: { l1: string; l2: string; l3: string };
  settings: { l1_temperature: number; l2_temperature: number; l3_temperature: number; max_tokens: number; timeout_ms: number };
  costCaps: { daily_usd: number; per_conversation_usd: number };
}

export async function loadProviderConfig(workspaceId: string): Promise<ProviderConfig | null> {
  const { data, error } = await supabaseClient.from("ai_provider_configs")
    .select("*").eq("workspace_id", workspaceId).eq("is_active", true).maybeSingle();
  if (error || !data) return null;
  if (!data.api_key_enc) { log.warn("AIConfig", `no api_key for ws ${workspaceId}`); return null; }
  return {
    workspaceId, baseUrl: data.base_url, apiKey: data.api_key_enc,
    models: data.models as any, settings: data.settings as any, costCaps: data.cost_caps as any,
  };
}
