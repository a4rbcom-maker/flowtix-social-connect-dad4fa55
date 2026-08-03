// ─── User Management Types ────────────────────────────────
export type AdminUserRole = "super_admin" | "admin" | "user";
export type AdminUserStatus = "active" | "pending" | "suspended" | "expired" | "deleted";

export interface AdminUserListItem {
  user_id: string; email: string; full_name: string; avatar_url: string | null;
  locale: string; status: string; phone: string; role: string;
  workspace_name?: string; last_sign_in: string | null; created_at: string;
}
export interface AdminUserFilters {
  search?: string; status?: string; role?: string; limit?: number; offset?: number;
}
export interface AdminUserDetail extends AdminUserListItem {
  updated_at: string; wa_sessions_count: number; wa_messages_count: number;
  ai_cost_usd: number; recent_activities: Array<{ action: string; description: string | null; created_at: string }>;
}
export interface AdminInviteUserInput { email: string; full_name?: string; role?: AdminUserRole; }

// ─── Plans Management Types ───────────────────────────────
export interface AdminPlanListItem {
  id: string; name: string; key: string; description: string;
  price_cents: number; currency: string; interval: string; trial_days: number;
  limits: Record<string, number> | null; sort_order: number; is_active: boolean;
  created_at: string; updated_at: string;
  active_subscriptions: number; total_subscriptions: number;
  features: string[]; is_popular: boolean;
}
export interface AdminPlanInput {
  name: string; key: string; description?: string; price_cents: number;
  currency?: string; interval?: "monthly" | "yearly"; trial_days?: number;
  limits?: Record<string, number>; sort_order?: number;
  features?: string[]; is_popular?: boolean;
}
export interface AdminPlanUpdateInput {
  name?: string; description?: string; price_cents?: number;
  currency?: string; interval?: "monthly" | "yearly"; trial_days?: number;
  limits?: Record<string, number>; sort_order?: number;
  features?: string[]; is_popular?: boolean;
}
export const DEFAULT_PLAN_LIMITS = {
  max_wa_sessions: 1, max_fb_sessions: 1, max_contacts: 1000,
  max_messages_per_month: 10000, max_campaigns: 5,
  ai_daily_cost_usd: 5, ai_monthly_cost_usd: 100, team_members: 1,
} as const;

// ─── System Settings Types ──────────────────────────────────
export interface AdminSettingItem {
  key: string;
  value: unknown;
  description: string | null;
  is_public: boolean;
  updated_at: string;
  updated_by: string | null;
}

export interface AdminSettingInput {
  key: string;
  value: unknown;
  description?: string | null;
  is_public?: boolean;
}

export type SettingCategory = "general" | "whatsapp" | "facebook" | "email" | "security" | "payments" | "notifications";

export interface AdminSettingsGroup {
  category: SettingCategory;
  label: { en: string; ar: string };
  settings: AdminSettingItem[];
}

// ─── Feature Flags Types ───────────────────────────────────
export type FlagCategory = "general" | "whatsapp" | "facebook" | "ai" | "billing" | "security" | "experimental";

export interface AdminFeatureFlag {
  id: string;
  key: string;
  name: { en: string; ar: string };
  description: { en: string; ar: string };
  category: FlagCategory;
  is_enabled: boolean;
  plan_key: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AdminFeatureFlagInput {
  key: string;
  name: { en: string; ar: string };
  description?: { en: string; ar: string };
  category?: FlagCategory;
  is_enabled?: boolean;
  plan_key?: string | null;
}

export interface AdminFeatureFlagUpdateInput {
  name?: { en: string; ar: string };
  description?: { en: string; ar: string };
  category?: FlagCategory;
  plan_key?: string | null;
  metadata?: Record<string, unknown>;
}

export const FLAG_CATEGORIES: Array<{ value: FlagCategory; label: { en: string; ar: string } }> = [
  { value: "general",      label: { en: "General",      ar: "عام" } },
  { value: "whatsapp",     label: { en: "WhatsApp",     ar: "واتساب" } },
  { value: "facebook",     label: { en: "Facebook",     ar: "فيسبوك" } },
  { value: "ai",           label: { en: "AI",           ar: "الذكاء الاصطناعي" } },
  { value: "billing",      label: { en: "Billing",      ar: "الفوترة" } },
  { value: "security",     label: { en: "Security",     ar: "الأمان" } },
  { value: "experimental", label: { en: "Experimental", ar: "تجريبي" } },
];

export const SETTING_CATEGORIES: Array<{ value: SettingCategory; label: { en: string; ar: string } }> = [
  { value: "general",       label: { en: "General",       ar: "عام" } },
  { value: "whatsapp",     label: { en: "WhatsApp",     ar: "واتساب" } },
  { value: "facebook",     label: { en: "Facebook",     ar: "فيسبوك" } },
  { value: "email",         label: { en: "Email",        ar: "البريد" } },
  { value: "security",      label: { en: "Security",     ar: "الأمان" } },
  { value: "payments",      label: { en: "Payments",      ar: "المدفوعات" } },
  { value: "notifications", label: { en: "Notifications", ar: "الإشعارات" } },
];

// ─── Audit Logs Types ──────────────────────────────────────
export type ActivityAction =
  | "login" | "logout" | "signup" | "password_change"
  | "subscription_change" | "subscription_cancel"
  | "facebook_connect" | "facebook_disconnect"
  | "extraction_created" | "extraction_completed" | "extraction_failed"
  | "export_created" | "export_completed"
  | "role_change" | "profile_update" | "workspace_update"
  | "admin_action" | "user_suspend" | "user_activate";

export interface AdminAuditLog {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  ip: unknown;
  user_agent: string | null;
  created_at: string;
}

export interface AdminAuditLogFilters {
  search?: string;
  user_id?: string;
  action?: string;
  resource_type?: string;
  workspace_id?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}

export interface AdminAuditStats {
  total_logs: number;
  today_count: number;
  week_count: number;
  month_count: number;
  unique_users_today: number;
  unique_workspaces_today: number;
  top_actions: Array<{ action: string; count: number }>;
  top_resource_types: Array<{ type: string; count: number }>;
}

export interface AdminAuditTrendItem {
  date: string;
  count: number;
}

export const AUDIT_ACTION_LABELS: Record<string, { en: string; ar: string }> = {
  login:                 { en: "Login",                 ar: "تسجيل الدخول" },
  logout:                { en: "Logout",                ar: "تسجيل الخروج" },
  signup:                { en: "Signup",                ar: "تسجيل حساب" },
  password_change:       { en: "Password Change",       ar: "تغيير كلمة المرور" },
  subscription_change:   { en: "Subscription Change",   ar: "تغيير الاشتراك" },
  subscription_cancel:   { en: "Subscription Cancel",   ar: "إلغاء الاشتراك" },
  facebook_connect:      { en: "Facebook Connect",      ar: "ربط فيسبوك" },
  facebook_disconnect:   { en: "Facebook Disconnect",   ar: "قطع فيسبوك" },
  extraction_created:    { en: "Extraction Created",    ar: "إنشاء استخراج" },
  extraction_completed:  { en: "Extraction Completed",  ar: "اكتمال استخراج" },
  extraction_failed:     { en: "Extraction Failed",     ar: "فشل استخراج" },
  export_created:        { en: "Export Created",        ar: "إنشاء تصدير" },
  export_completed:      { en: "Export Completed",      ar: "اكتمال تصدير" },
  role_change:           { en: "Role Change",           ar: "تغيير الدور" },
  profile_update:        { en: "Profile Update",        ar: "تحديث الملف" },
  workspace_update:      { en: "Workspace Update",      ar: "تحديث مساحة العمل" },
  admin_action:          { en: "Admin Action",          ar: "إجراء إداري" },
  user_suspend:          { en: "User Suspend",          ar: "تعليق مستخدم" },
  user_activate:         { en: "User Activate",         ar: "تفعيل مستخدم" },
};

export const ACTION_BADGE_VARIANT: Record<string, "default" | "primary" | "success" | "warning" | "error"> = {
  login: "success",
  logout: "default",
  signup: "primary",
  password_change: "warning",
  subscription_change: "primary",
  subscription_cancel: "error",
  facebook_connect: "success",
  facebook_disconnect: "warning",
  extraction_created: "primary",
  extraction_completed: "success",
  extraction_failed: "error",
  export_created: "primary",
  export_completed: "success",
  role_change: "warning",
  profile_update: "default",
  workspace_update: "default",
  admin_action: "primary",
  user_suspend: "error",
  user_activate: "success",
};
// ─── Security Overview Types ────────────────────────────────
export interface AdminSecurityOverview {
  rls: { total_tables: number; rls_enabled: number; coverage_pct: number; tables_without_rls: string[] };
  extensions: { in_public_schema: number; names: string[] };
  users: { total: number; suspended: number; admins: number };
  events_24h: { logins: number; suspensions: number; role_changes: number; password_changes: number; admin_actions: number; unique_ips: number };
}
