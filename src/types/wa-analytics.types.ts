// ─── Analytics Types ───────────────────────────────────────
export interface WaAnalyticsOverview {
  total_messages: number;
  sent_messages: number;
  received_messages: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
  delivery_rate: number;
  read_rate: number;
  failure_rate: number;
  active_conversations: number;
  total_contacts: number;
  new_contacts_period: number;
  avg_response_time_minutes: number;
  ai_handled_count: number;
  ai_cost_usd: number;
  ai_escalation_rate: number;
}

export interface WaMessageTrendItem {
  date: string;
  sent: number;
  received: number;
  failed: number;
}

export interface WaStatusDistribution {
  status: string;
  count: number;
}

export interface WaTypeDistribution {
  type: string;
  count: number;
}

export interface WaTopContact {
  contact_id: string;
  contact_name: string;
  contact_phone: string;
  messages_count: number;
  inbound_count: number;
  outbound_count: number;
  last_message_at: string;
}

export interface WaCampaignAnalytics {
  campaign_id: string;
  campaign_name: string;
  status: string;
  type: string;
  total_recipients: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
  delivery_rate: number;
  read_rate: number;
  created_at: string;
}

export interface WaAiUsageAnalytics {
  total_invocations: number;
  successful: number;
  failed: number;
  escalated: number;
  total_cost: number;
  total_tokens: number;
  avg_latency_ms: number;
  by_level: Array<{ level: string; count: number }>;
  by_model: Array<{ model: string; count: number; cost: number }>;
}

export interface WaHourlyActivity {
  day_of_week: number;
  hour: number;
  count: number;
}

export const ANALYTICS_PERIOD_OPTIONS = [
  { value: 7, label: { en: "Last 7 days", ar: "آخر 7 أيام" } },
  { value: 30, label: { en: "Last 30 days", ar: "آخر 30 يوماً" } },
  { value: 90, label: { en: "Last 90 days", ar: "آخر 90 يوماً" } },
] as const;

export const MESSAGE_STATUS_LABELS: Record<string, { en: string; ar: string }> = {
  pending: { en: "Pending", ar: "معلّقة" },
  sent: { en: "Sent", ar: "مُرسلة" },
  delivered: { en: "Delivered", ar: "تم التسليم" },
  read: { en: "Read", ar: "مقروءة" },
  failed: { en: "Failed", ar: "فاشلة" },
};

export const MESSAGE_STATUS_COLORS: Record<string, string> = {
  pending: "#9ca3af",
  sent: "#3b82f6",
  delivered: "#10b981",
  read: "#6d5efc",
  failed: "#ef4444",
};

export const MESSAGE_TYPE_LABELS: Record<string, { en: string; ar: string }> = {
  text: { en: "Text", ar: "نص" },
  image: { en: "Image", ar: "صورة" },
  video: { en: "Video", ar: "فيديو" },
  audio: { en: "Audio", ar: "صوت" },
  document: { en: "Document", ar: "مستند" },
  location: { en: "Location", ar: "موقع" },
  contact: { en: "Contact", ar: "جهة" },
  buttons: { en: "Buttons", ar: "أزرار" },
  list: { en: "List", ar: "قائمة" },
  template: { en: "Template", ar: "قالب" },
};

export const DAY_NAMES = [
  { en: "Sun", ar: "الأحد" },
  { en: "Mon", ar: "الإثنين" },
  { en: "Tue", ar: "الثلاثاء" },
  { en: "Wed", ar: "الأربعاء" },
  { en: "Thu", ar: "الخميس" },
  { en: "Fri", ar: "الجمعة" },
  { en: "Sat", ar: "السبت" },
];
