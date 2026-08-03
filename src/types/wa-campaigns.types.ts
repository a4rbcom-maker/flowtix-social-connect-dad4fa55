import type { Database } from "./database.types";

export type WaCampaign = Database["public"]["Tables"]["wa_campaigns"]["Row"];
export type WaCampaignStatus = Database["public"]["Enums"]["wa_campaign_status"];
export type WaTemplate = Database["public"]["Tables"]["wa_templates"]["Row"];
export type WaTemplateInsert = Database["public"]["Tables"]["wa_templates"]["Insert"];

export interface CampaignContent {
  body?: string; media_storage_key?: string; caption?: string;
  buttons?: { id: string; title: string }[]; template_id?: string;
}
export interface CampaignConfig {
  delay_min?: number; delay_max?: number; rate_per_hour?: number; retry_max?: number;
}
export interface CampaignStats {
  total: number; sent: number; delivered: number; read: number; failed: number; skipped: number;
}
