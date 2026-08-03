export interface WaAutoReplySettings { is_enabled: boolean; welcome_message: string; away_message: string; offline_message: string; use_business_hours: boolean; }
export type OutsideHoursAction = "auto_reply" | "queue" | "ignore";
export interface WaBusinessHourDay { day: number; enabled: boolean; from: string; to: string; }
export interface WaBusinessHours { id: string; workspace_id: string; is_enabled: boolean; timezone: string; schedule: WaBusinessHourDay[]; outside_hours_action: OutsideHoursAction; outside_hours_message: string | null; }
export const DEFAULT_BUSINESS_HOURS: WaBusinessHourDay[] = [
  { day: 0, enabled: false, from: "09:00", to: "17:00" }, { day: 1, enabled: true, from: "09:00", to: "17:00" },
  { day: 2, enabled: true, from: "09:00", to: "17:00" }, { day: 3, enabled: true, from: "09:00", to: "17:00" },
  { day: 4, enabled: true, from: "09:00", to: "17:00" }, { day: 5, enabled: true, from: "09:00", to: "17:00" },
  { day: 6, enabled: false, from: "09:00", to: "17:00" },
];
export const DAY_NAMES = [
  { en: "Sunday", ar: "الأحد" }, { en: "Monday", ar: "الإثنين" }, { en: "Tuesday", ar: "الثلاثاء" },
  { en: "Wednesday", ar: "الأربعاء" }, { en: "Thursday", ar: "الخميس" }, { en: "Friday", ar: "الجمعة" }, { en: "Saturday", ar: "السبت" },
];
export const TIMEZONE_OPTIONS = ["UTC","Africa/Cairo","Asia/Riyadh","Asia/Dubai","Asia/Kuwait","Asia/Qatar","Europe/London","Europe/Paris","America/New_York","America/Los_Angeles","Asia/Tokyo"];
export const OUTSIDE_HOURS_OPTIONS: Array<{ value: OutsideHoursAction; label: { en: string; ar: string } }> = [
  { value: "auto_reply", label: { en: "Send auto-reply", ar: "إرسال رد تلقائي" } },
  { value: "queue", label: { en: "Queue for later", ar: "تأجيل للعمل لاحقاً" } },
  { value: "ignore", label: { en: "Ignore", ar: "تجاهل" } },
];
export type QuickReplyCategory = "general" | "greeting" | "support" | "sales" | "billing";
export interface WaQuickReply { id: string; shortcut: string; title: string; body: string; category: QuickReplyCategory; created_at: string; updated_at: string; }
export interface WaQuickReplyInput { shortcut: string; title: string; body: string; category?: QuickReplyCategory; }
export const QUICK_REPLY_CATEGORIES: Array<{ value: QuickReplyCategory; label: { en: string; ar: string } }> = [
  { value: "general", label: { en: "General", ar: "عام" } }, { value: "greeting", label: { en: "Greeting", ar: "ترحيب" } },
  { value: "support", label: { en: "Support", ar: "دعم" } }, { value: "sales", label: { en: "Sales", ar: "مبيعات" } },
  { value: "billing", label: { en: "Billing", ar: "فوترة" } },
];

