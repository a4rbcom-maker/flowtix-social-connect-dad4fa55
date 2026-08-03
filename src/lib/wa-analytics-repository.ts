import { supabase } from "@/lib/supabase";
import type {
  WaAnalyticsOverview, WaMessageTrendItem, WaStatusDistribution,
  WaTypeDistribution, WaTopContact, WaCampaignAnalytics,
  WaAiUsageAnalytics, WaHourlyActivity,
} from "@/types/wa-analytics.types";

function handleError(error: any, fn: string): never {
  const msg = error?.message ?? String(error);
  if (msg.includes("no_workspace")) throw new Error("no_workspace");
  if (msg.includes("insufficient_privileges")) throw new Error("insufficient_privileges");
  throw new Error(`analytics ${fn} failed: ${msg}`);
}

export const waAnalyticsRepository = {
  async getOverview(days = 30): Promise<WaAnalyticsOverview> {
    const { data, error } = await (supabase as any).rpc("wa_analytics_overview", { p_days: days });
    if (error) handleError(error, "getOverview");
    return (data?.[0] ?? null) as WaAnalyticsOverview;
  },
  async getMessageTrend(days = 30): Promise<WaMessageTrendItem[]> {
    const { data, error } = await (supabase as any).rpc("wa_analytics_message_trend", { p_days: days });
    if (error) handleError(error, "getMessageTrend");
    return (data ?? []) as WaMessageTrendItem[];
  },
  async getStatusDistribution(days = 30): Promise<WaStatusDistribution[]> {
    const { data, error } = await (supabase as any).rpc("wa_analytics_status_distribution", { p_days: days });
    if (error) handleError(error, "getStatusDistribution");
    return (data ?? []) as WaStatusDistribution[];
  },
  async getTypeDistribution(days = 30): Promise<WaTypeDistribution[]> {
    const { data, error } = await (supabase as any).rpc("wa_analytics_type_distribution", { p_days: days });
    if (error) handleError(error, "getTypeDistribution");
    return (data ?? []) as WaTypeDistribution[];
  },
  async getTopContacts(limit = 10, days = 30): Promise<WaTopContact[]> {
    const { data, error } = await (supabase as any).rpc("wa_analytics_top_contacts", { p_limit: limit, p_days: days });
    if (error) handleError(error, "getTopContacts");
    return (data ?? []) as WaTopContact[];
  },
  async getCampaigns(limit = 10): Promise<WaCampaignAnalytics[]> {
    const { data, error } = await (supabase as any).rpc("wa_analytics_campaigns", { p_limit: limit });
    if (error) handleError(error, "getCampaigns");
    return (data ?? []) as WaCampaignAnalytics[];
  },
  async getAiUsage(days = 30): Promise<WaAiUsageAnalytics> {
    const { data, error } = await (supabase as any).rpc("wa_analytics_ai_usage", { p_days: days });
    if (error) handleError(error, "getAiUsage");
    return (data?.[0] ?? null) as WaAiUsageAnalytics;
  },
  async getHourlyActivity(days = 7): Promise<WaHourlyActivity[]> {
    const { data, error } = await (supabase as any).rpc("wa_analytics_hourly_activity", { p_days: days });
    if (error) handleError(error, "getHourlyActivity");
    return (data ?? []) as WaHourlyActivity[];
  },
};
