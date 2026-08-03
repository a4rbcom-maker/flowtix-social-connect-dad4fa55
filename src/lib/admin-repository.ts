import { supabase } from "@/lib/supabase";
import type { AdminUserListItem, AdminUserFilters, AdminUserDetail, AdminInviteUserInput, AdminPlanListItem, AdminPlanInput, AdminPlanUpdateInput, AdminSettingItem, AdminSettingInput, AdminFeatureFlag, AdminFeatureFlagInput, AdminFeatureFlagUpdateInput, AdminAuditLog, AdminAuditLogFilters, AdminAuditStats, AdminAuditTrendItem } from "@/types/admin.types";

function handleRpcError(error: any, fn: string): never {
  const msg = error?.message ?? String(error);
  if (msg.includes("insufficient_privileges")) throw new Error("insufficient_privileges");
  if (msg.includes("cannot_modify_self")) throw new Error("cannot_modify_self");
  if (msg.includes("user_not_found")) throw new Error("user_not_found");
  if (msg.includes("user_already_exists")) throw new Error("user_already_exists");
  if (msg.includes("plan_not_found")) throw new Error("plan_not_found");
  if (msg.includes("setting_not_found")) throw new Error("setting_not_found");
  if (msg.includes("flag_not_found")) throw new Error("flag_not_found");
  if (msg.includes("log_not_found")) throw new Error("log_not_found");
  if (msg.includes("invalid_category")) throw new Error("invalid_category");
  if (msg.includes("cannot_deactivate_plan_with_active_subs")) throw new Error("cannot_deactivate_plan_with_active_subs");
  if (msg.includes("cannot_void_paid_invoice")) throw new Error("cannot_void_paid_invoice");
  throw new Error(`admin ${fn} failed: ${msg}`);
}

export const adminRepository = {
  async listUsers(filters: AdminUserFilters = {}): Promise<AdminUserListItem[]> {
    const { data, error } = await (supabase as any).rpc("admin_list_users", {
      p_search: filters.search ?? null, p_status: filters.status || null,
      p_role: filters.role || null, p_limit: filters.limit ?? 20, p_offset: filters.offset ?? 0,
    });
    if (error) handleRpcError(error, "listUsers");
    return (data ?? []) as AdminUserListItem[];
  },
  async countUsers(filters: AdminUserFilters = {}): Promise<number> {
    const { data, error } = await (supabase as any).rpc("admin_count_users", {
      p_search: filters.search ?? null, p_status: filters.status || null, p_role: filters.role || null,
    });
    if (error) handleRpcError(error, "countUsers");
    return (data as number) ?? 0;
  },
  async getUser(userId: string): Promise<AdminUserDetail> {
    const { data, error } = await (supabase as any).rpc("admin_get_user", { p_user_id: userId });
    if (error) handleRpcError(error, "getUser");
    if (!data || data.length === 0) throw new Error("user_not_found");
    return data[0] as AdminUserDetail;
  },
  async updateUserStatus(userId: string, status: string, reason?: string): Promise<void> {
    const { error } = await (supabase as any).rpc("admin_update_user_status", {
      p_user_id: userId, p_status: status, p_reason: reason ?? null,
    });
    if (error) handleRpcError(error, "updateUserStatus");
  },
  async changeUserRole(userId: string, role: string, _workspaceId?: string): Promise<void> {
    const { error } = await (supabase as any).rpc("admin_change_user_role", {
      p_user_id: userId, p_role: role,
    });
    if (error) handleRpcError(error, "changeUserRole");
  },
  async setUserPassword(userId: string, password: string): Promise<void> {
    const { error } = await (supabase as any).rpc("admin_set_user_password", { target_user_id: userId, new_password: password });
    if (error) handleRpcError(error, "setUserPassword");
  },
  async inviteUser(input: AdminInviteUserInput): Promise<string> {
    const { data, error } = await (supabase as any).rpc("admin_invite_user", {
      p_email: input.email, p_full_name: input.full_name ?? null, p_role: input.role ?? "user",
    });
    if (error) handleRpcError(error, "inviteUser");
    return data as string;
  },

  // ─── Plans ───────────────────────────────────────────────
  async listPlans(): Promise<AdminPlanListItem[]> {
    const { data, error } = await (supabase as any).rpc("admin_list_plans");
    if (error) handleRpcError(error, "listPlans");
    return (data ?? []) as AdminPlanListItem[];
  },
  async getPlan(planId: string): Promise<AdminPlanListItem> {
    const { data, error } = await (supabase as any).rpc("admin_get_plan", { p_plan_id: planId });
    if (error) handleRpcError(error, "getPlan");
    if (!data || data.length === 0) throw new Error("plan_not_found");
    return data[0] as AdminPlanListItem;
  },
  async createPlan(input: AdminPlanInput): Promise<string> {
    const { data, error } = await (supabase as any).rpc("admin_create_plan", {
      p_name: input.name, p_key: input.key, p_description: input.description ?? null,
      p_price_cents: input.price_cents, p_currency: input.currency ?? "USD",
      p_interval: input.interval ?? "monthly", p_trial_days: input.trial_days ?? 0,
      p_limits: input.limits ?? null, p_sort_order: input.sort_order ?? 0,
      p_features: input.features ?? null, p_is_popular: input.is_popular ?? false,
    });
    if (error) handleRpcError(error, "createPlan");
    return data as string;
  },
  async updatePlan(planId: string, input: AdminPlanUpdateInput): Promise<void> {
    const { error } = await (supabase as any).rpc("admin_update_plan", {
      p_plan_id: planId, p_name: input.name ?? null, p_description: input.description ?? null,
      p_price_cents: input.price_cents ?? null, p_currency: input.currency ?? null,
      p_interval: input.interval ?? null, p_trial_days: input.trial_days ?? null,
      p_limits: input.limits ?? null, p_sort_order: input.sort_order ?? null,
      p_features: input.features ?? null, p_is_popular: input.is_popular ?? null,
    });
    if (error) handleRpcError(error, "updatePlan");
  },
  async togglePlan(planId: string, isActive: boolean): Promise<void> {
    const { error } = await (supabase as any).rpc("admin_toggle_plan", { p_plan_id: planId, p_is_active: isActive });
    if (error) handleRpcError(error, "togglePlan");
  },
  async deletePlan(planId: string): Promise<void> {
    const { error } = await (supabase as any).rpc("admin_delete_plan", { p_plan_id: planId });
    if (error) handleRpcError(error, "deletePlan");
  },
  async reorderPlans(orders: Array<{ id: string; sort_order: number }>): Promise<void> {
    const { error } = await (supabase as any).rpc("admin_reorder_plans", { p_orders: orders });
    if (error) handleRpcError(error, "reorderPlans");
  },

  // ─── Subscriptions ────────────────────────────────────────
  async createSubscription(input: { user_id: string; plan_id: string; status?: string }): Promise<string> {
    const { data, error } = await (supabase as any).rpc("admin_create_subscription", {
      p_user_id: input.user_id, p_plan_id: input.plan_id, p_status: input.status ?? "active",
    });
    if (error) handleRpcError(error, "createSubscription");
    return data as string;
  },

  // ─── System Settings ─────────────────────────────────────
  async listSettings(category?: string): Promise<AdminSettingItem[]> {
    const { data, error } = await (supabase as any).rpc("admin_list_settings", { p_category: category ?? null });
    if (error) handleRpcError(error, "listSettings");
    return (data ?? []) as AdminSettingItem[];
  },
  async getSetting(key: string): Promise<AdminSettingItem> {
    const { data, error } = await (supabase as any).rpc("admin_get_setting", { p_key: key });
    if (error) handleRpcError(error, "getSetting");
    if (!data || data.length === 0) throw new Error("setting_not_found");
    return data[0] as AdminSettingItem;
  },
  async upsertSetting(input: AdminSettingInput): Promise<void> {
    const { error } = await (supabase as any).rpc("admin_upsert_setting", {
      p_key: input.key, p_value: input.value,
      p_description: input.description ?? null, p_is_public: input.is_public ?? false,
    });
    if (error) handleRpcError(error, "upsertSetting");
  },
  async deleteSetting(key: string): Promise<void> {
    const { error } = await (supabase as any).rpc("admin_delete_setting", { p_key: key });
    if (error) handleRpcError(error, "deleteSetting");
  },
  async bulkUpsertSettings(settings: Array<AdminSettingInput>): Promise<void> {
    const payload = settings.map(s => ({
      key: s.key, value: s.value,
      description: s.description ?? null, is_public: s.is_public ?? false,
    }));
    const { error } = await (supabase as any).rpc("admin_bulk_upsert_settings", { p_settings: payload });
    if (error) handleRpcError(error, "bulkUpsertSettings");
  },

  // ─── Feature Flags ────────────────────────────────────────
  async listFlags(category?: string): Promise<AdminFeatureFlag[]> {
    const { data, error } = await (supabase as any).rpc("admin_list_flags", { p_category: category ?? null });
    if (error) handleRpcError(error, "listFlags");
    return (data ?? []) as AdminFeatureFlag[];
  },
  async getFlag(flagId: string): Promise<AdminFeatureFlag> {
    const { data, error } = await (supabase as any).rpc("admin_get_flag", { p_flag_id: flagId });
    if (error) handleRpcError(error, "getFlag");
    if (!data || data.length === 0) throw new Error("flag_not_found");
    return data[0] as AdminFeatureFlag;
  },
  async toggleFlag(flagId: string, enabled: boolean): Promise<void> {
    const { error } = await (supabase as any).rpc("admin_toggle_flag", { p_flag_id: flagId, p_enabled: enabled });
    if (error) handleRpcError(error, "toggleFlag");
  },
  async createFlag(input: AdminFeatureFlagInput): Promise<string> {
    const { data, error } = await (supabase as any).rpc("admin_create_flag", {
      p_key: input.key,
      p_name: input.name,
      p_description: input.description ?? { en: "", ar: "" },
      p_category: input.category ?? "general",
      p_is_enabled: input.is_enabled ?? false,
      p_plan_key: input.plan_key ?? null,
    });
    if (error) handleRpcError(error, "createFlag");
    return data as string;
  },
  async updateFlag(flagId: string, input: AdminFeatureFlagUpdateInput): Promise<void> {
    const { error } = await (supabase as any).rpc("admin_update_flag", {
      p_flag_id: flagId,
      p_name: input.name ?? null,
      p_description: input.description ?? null,
      p_category: input.category ?? null,
      p_plan_key: input.plan_key !== undefined ? input.plan_key : null,
      p_metadata: input.metadata ?? null,
    });
    if (error) handleRpcError(error, "updateFlag");
  },
  async deleteFlag(flagId: string): Promise<void> {
    const { error } = await (supabase as any).rpc("admin_delete_flag", { p_flag_id: flagId });
    if (error) handleRpcError(error, "deleteFlag");
  },

  // ─── Audit Logs ──────────────────────────────────────────
  async listAuditLogs(filters: AdminAuditLogFilters = {}): Promise<AdminAuditLog[]> {
    const { data, error } = await (supabase as any).rpc("admin_list_audit_logs", {
      p_search: filters.search ?? null,
      p_user_id: filters.user_id ?? null,
      p_action: filters.action ?? null,
      p_resource_type: filters.resource_type ?? null,
      p_workspace_id: filters.workspace_id ?? null,
      p_date_from: filters.date_from ?? null,
      p_date_to: filters.date_to ?? null,
      p_limit: filters.limit ?? 20,
      p_offset: filters.offset ?? 0,
    });
    if (error) handleRpcError(error, "listAuditLogs");
    return (data ?? []) as AdminAuditLog[];
  },
  async countAuditLogs(filters: AdminAuditLogFilters = {}): Promise<number> {
    const { data, error } = await (supabase as any).rpc("admin_count_audit_logs", {
      p_search: filters.search ?? null,
      p_user_id: filters.user_id ?? null,
      p_action: filters.action ?? null,
      p_resource_type: filters.resource_type ?? null,
      p_workspace_id: filters.workspace_id ?? null,
      p_date_from: filters.date_from ?? null,
      p_date_to: filters.date_to ?? null,
    });
    if (error) handleRpcError(error, "countAuditLogs");
    return (data as number) ?? 0;
  },
  async getAuditStats(): Promise<AdminAuditStats> {
    const { data, error } = await (supabase as any).rpc("admin_audit_stats");
    if (error) handleRpcError(error, "getAuditStats");
    return (data?.[0] ?? null) as AdminAuditStats;
  },
  async getAuditTrend(days = 30): Promise<AdminAuditTrendItem[]> {
    const { data, error } = await (supabase as any).rpc("admin_audit_trend", { p_days: days });
    if (error) handleRpcError(error, "getAuditTrend");
    return (data ?? []) as AdminAuditTrendItem[];
  },
  async getAuditLog(logId: string): Promise<AdminAuditLog> {
    const { data, error } = await (supabase as any).rpc("admin_get_audit_log", { p_log_id: logId });
    if (error) handleRpcError(error, "getAuditLog");
    if (!data || data.length === 0) throw new Error("log_not_found");
    return data[0] as AdminAuditLog;
  },
  async exportAuditLogs(filters: AdminAuditLogFilters = {}): Promise<AdminAuditLog[]> {
    const { data, error } = await (supabase as any).rpc("admin_export_audit_logs", {
      p_search: filters.search ?? null,
      p_user_id: filters.user_id ?? null,
      p_action: filters.action ?? null,
      p_resource_type: filters.resource_type ?? null,
      p_workspace_id: filters.workspace_id ?? null,
      p_date_from: filters.date_from ?? null,
      p_date_to: filters.date_to ?? null,
      p_limit: 10000,
    });
    if (error) handleRpcError(error, "exportAuditLogs");
    return (data ?? []) as AdminAuditLog[];
  },
  // ─── Security Overview ────────────────────────────────────
  async getSecurityOverview(): Promise<import("@/types/admin.types").AdminSecurityOverview> {
    const { data, error } = await (supabase as any).rpc("admin_security_overview");
    if (error) handleRpcError(error, "getSecurityOverview");
    return data;
  },
};
