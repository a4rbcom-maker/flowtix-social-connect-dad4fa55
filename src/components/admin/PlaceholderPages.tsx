import { createFileRoute } from "@tanstack/react-router";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useI18n } from "@/lib/i18n";
import { Construction } from "lucide-react";

function makePlaceholder(arTitle: string, enTitle: string, arDesc: string, enDesc: string) {
  return function PlaceholderPage() {
    const { lang } = useI18n();
    return (
      <AdminLayout title={lang === "ar" ? arTitle : enTitle}>
        <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-xl p-12 text-center">
          <Construction className="h-12 w-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">{lang === "ar" ? arTitle : enTitle}</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {lang === "ar" ? arDesc : enDesc}
          </p>
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-semibold">
            {lang === "ar" ? "قريباً — المرحلة B" : "Coming Soon — Phase B"}
          </div>
        </div>
      </AdminLayout>
    );
  };
}

export const FacebookPage = makePlaceholder(
  "مراقبة فيسبوك", "Facebook Monitor",
  "كل حسابات الربط والحملات والمهام عبر النظام مع فلترة لكل مستخدم.",
  "All connections, campaigns and jobs across the platform with per-user filtering.",
);
export const WhatsappPage = makePlaceholder(
  "مراقبة واتساب", "WhatsApp Monitor",
  "جلسات الواتساب وحالاتها، QR، عدد المحادثات والرسائل لكل مستخدم.",
  "All WA sessions with status, QR, conversation and message counts per user.",
);
export const AiPage = makePlaceholder(
  "استهلاك الذكاء الاصطناعي", "AI Usage",
  "إحصائيات Kie AI: التوكنز، المتأخر، معدلات الفشل لكل نموذج وكل مستخدم.",
  "Kie AI statistics: tokens, latency, failure rate per model and user.",
);
export const JobsPage = makePlaceholder(
  "إدارة المهام", "Jobs",
  "عرض موحّد لمهام فيسبوك والإرسال الجماعي مع إعادة المحاولة والإلغاء.",
  "Unified view of FB and bulk-send jobs with retry and cancel controls.",
);
export const LogsPage = makePlaceholder(
  "سجلات النظام", "System Logs",
  "سجل الإرسال وسجل أنشطة الأدمن مع بحث متقدم.",
  "Send log + admin audit log with advanced search.",
);
export const NotificationsPage = makePlaceholder(
  "الإشعارات والإعلانات", "Announcements",
  "إرسال إعلانات نظامية لكل المستخدمين أو حسب الباقة أو لمستخدمين محددين.",
  "Broadcast platform-wide announcements to all, by plan, or to specific users.",
);
export const SettingsPage = makePlaceholder(
  "إعدادات النظام", "Platform Settings",
  "وضع الصيانة، تفعيل التسجيل، الباقة الافتراضية، نموذج AI الافتراضي.",
  "Maintenance mode, signup toggle, default plan, default AI model.",
);
export const SecurityPage = makePlaceholder(
  "الأمان", "Security",
  "محاولات الدخول، الجلسات النشطة، سجل تدقيق كامل لكل إجراءات الأدمن.",
  "Login attempts, active sessions, full audit log of admin actions.",
);
