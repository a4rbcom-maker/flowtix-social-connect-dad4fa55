import { supabase } from "@/lib/supabase";
import type {
  WaAutoReplySettings, WaBusinessHours, WaBusinessHourDay, OutsideHoursAction,
  WaQuickReply, WaQuickReplyInput, QuickReplyCategory,
} from "@/types/wa-settings.types";

function handleError(error: any, fn: string): never {
  const msg = error?.message ?? String(error);
  if (msg.includes("no_workspace")) throw new Error("no_workspace");
  if (msg.includes("invalid_url")) throw new Error("invalid_url");
  if (msg.includes("invalid_event")) throw new Error("invalid_event");
  if (msg.includes("invalid_category")) throw new Error("invalid_category");
  if (msg.includes("invalid_action")) throw new Error("invalid_action");
  if (msg.includes("no_events_selected")) throw new Error("no_events_selected");
  if (msg.includes("no_wa_session_config")) throw new Error("no_wa_session_config");
  if (msg.includes("reply_not_found")) throw new Error("reply_not_found");
  throw new Error(`wa-settings ${fn} failed: ${msg}`);
}

export const waSettingsRepository = {
  async getAutoReplySettings(): Promise<WaAutoReplySettings> {
    const { data, error } = await (supabase as any).rpc("wa_get_auto_reply_settings");
    if (error) handleError(error, "getAutoReplySettings");
    return (data?.[0] ?? null) as WaAutoReplySettings;
  },
  async updateAutoReplySettings(input: Partial<WaAutoReplySettings>): Promise<void> {
    const { error } = await (supabase as any).rpc("wa_update_auto_reply_settings", {
      p_is_enabled: input.is_enabled ?? null, p_welcome_message: input.welcome_message ?? null,
      p_away_message: input.away_message ?? null, p_offline_message: input.offline_message ?? null,
      p_use_business_hours: input.use_business_hours ?? null,
    });
    if (error) handleError(error, "updateAutoReplySettings");
  },
  async getBusinessHours(): Promise<WaBusinessHours | null> {
    const { data, error } = await (supabase as any).rpc("wa_get_business_hours");
    if (error) handleError(error, "getBusinessHours");
    return (data?.[0] ?? null) as WaBusinessHours | null;
  },
  async updateBusinessHours(input: { is_enabled?: boolean; timezone?: string; schedule?: WaBusinessHourDay[]; outside_hours_action?: OutsideHoursAction; outside_hours_message?: string | null }): Promise<void> {
    const { error } = await (supabase as any).rpc("wa_update_business_hours", {
      p_is_enabled: input.is_enabled ?? null, p_timezone: input.timezone ?? null,
      p_schedule: input.schedule ?? null, p_outside_hours_action: input.outside_hours_action ?? null,
      p_outside_hours_message: input.outside_hours_message ?? null,
    });
    if (error) handleError(error, "updateBusinessHours");
  },
  async listQuickReplies(category?: QuickReplyCategory): Promise<WaQuickReply[]> {
    const { data, error } = await (supabase as any).rpc("wa_list_quick_replies", { p_category: category ?? null });
    if (error) handleError(error, "listQuickReplies");
    return (data ?? []) as WaQuickReply[];
  },
  async createQuickReply(input: WaQuickReplyInput): Promise<string> {
    const { data, error } = await (supabase as any).rpc("wa_create_quick_reply", {
      p_shortcut: input.shortcut, p_title: input.title, p_body: input.body, p_category: input.category ?? "general",
    });
    if (error) handleError(error, "createQuickReply");
    return data as string;
  },
  async updateQuickReply(id: string, input: Partial<WaQuickReplyInput>): Promise<void> {
    const { error } = await (supabase as any).rpc("wa_update_quick_reply", {
      p_id: id, p_shortcut: input.shortcut ?? null, p_title: input.title ?? null,
      p_body: input.body ?? null, p_category: input.category ?? null,
    });
    if (error) handleError(error, "updateQuickReply");
  },
  async deleteQuickReply(id: string): Promise<void> {
    const { error } = await (supabase as any).rpc("wa_delete_quick_reply", { p_id: id });
    if (error) handleError(error, "deleteQuickReply");
  },
};

