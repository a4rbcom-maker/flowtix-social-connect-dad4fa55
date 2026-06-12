import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Users,
  Smartphone,
  Inbox,
  Bot,
  ArrowDownLeft,
  ArrowUpRight,
  QrCode,
  Sparkles,
  Loader2,
} from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useI18n } from "@/lib/i18n";
import { getAdminWhatsappOverview } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/whatsapp")({
  ssr: false,
  component: AdminWhatsappPage,
});

const REFRESH_MS = 30_000;

function AdminWhatsappPage() {
  const { lang } = useI18n();
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);

  const q = useQuery({
    queryKey: ["admin", "whatsapp", "overview"],
    queryFn: () => getAdminWhatsappOverview(),
    refetchInterval: REFRESH_MS,
  });

  const totals = q.data?.totals;

  return (
    <AdminLayout title={t("تقارير واتساب", "WhatsApp Reports")}>
      {q.isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* KPI cards — reports only */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={Users}
              label={t("مستخدمون نشطون", "Active users")}
              value={totals?.users_with_wa ?? 0}
              tone="primary"
              hint={t("لديهم بيانات واتساب", "with WA data")}
            />
            <KpiCard
              icon={Smartphone}
              label={t("جلسات متصلة", "Connected sessions")}
              value={totals?.sessions_connected ?? 0}
              hint={`${totals?.sessions ?? 0} ${t("إجمالي", "total")}`}
              tone="emerald"
            />
            <KpiCard
              icon={QrCode}
              label={t("بانتظار مسح QR", "Waiting for QR")}
              value={totals?.sessions_qr ?? 0}
              tone="amber"
            />
            <KpiCard
              icon={Inbox}
              label={t("محادثات", "Conversations")}
              value={totals?.conversations ?? 0}
              hint={`${totals?.unread_total ?? 0} ${t("غير مقروء", "unread")}`}
              tone="blue"
            />
            <KpiCard
              icon={ArrowDownLeft}
              label={t("رسائل واردة (24س)", "Inbound (24h)")}
              value={totals?.msgs_in_24h ?? 0}
              tone="violet"
            />
            <KpiCard
              icon={ArrowUpRight}
              label={t("رسائل صادرة (24س)", "Outbound (24h)")}
              value={totals?.msgs_out_24h ?? 0}
              tone="cyan"
            />
            <KpiCard
              icon={Bot}
              label={t("ردود الذكاء (7أ)", "AI replies (7d)")}
              value={totals?.ai_calls_7d ?? 0}
              hint={`${totals?.ai_errors_7d ?? 0} ${t("خطأ", "errors")}`}
              tone="violet"
            />
            <KpiCard
              icon={Sparkles}
              label={t("توكِنز الذكاء (7أ)", "AI tokens (7d)")}
              value={totals?.ai_tokens_7d ?? 0}
              tone="amber"
            />
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

/* ---------------- helpers ---------------- */

function formatNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return n.toString();
}

type Tone = "primary" | "blue" | "emerald" | "violet" | "amber" | "red" | "cyan";
const TONE_BG: Record<Tone, string> = {
  primary: "from-primary/15 to-primary/5 text-primary",
  blue: "from-blue-500/15 to-blue-500/5 text-blue-600 dark:text-blue-400",
  emerald: "from-emerald-500/15 to-emerald-500/5 text-emerald-600 dark:text-emerald-400",
  violet: "from-violet-500/15 to-violet-500/5 text-violet-600 dark:text-violet-400",
  amber: "from-amber-500/15 to-amber-500/5 text-amber-600 dark:text-amber-400",
  red: "from-red-500/15 to-red-500/5 text-red-600 dark:text-red-400",
  cyan: "from-cyan-500/15 to-cyan-500/5 text-cyan-600 dark:text-cyan-400",
};

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  hint?: string;
  tone: Tone;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border bg-card p-4 hover:shadow-md transition-shadow"
    >
      <div className="flex items-center gap-3">
        <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${TONE_BG[tone]} flex items-center justify-center`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground truncate">{label}</div>
          <div className="text-2xl font-bold leading-tight">{formatNum(value)}</div>
          {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
        </div>
      </div>
    </motion.div>
  );
}
