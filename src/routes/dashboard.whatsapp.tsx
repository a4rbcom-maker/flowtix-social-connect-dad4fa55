import { createFileRoute } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/dashboard/whatsapp")({
  component: WhatsAppPage,
});

function WhatsAppPage() {
  const { lang } = useI18n();
  const t = lang === "ar"
    ? { title: "واتساب بوت", soon: "قريباً", desc: "هذه الميزة قيد التطوير وستكون متاحة قريباً." }
    : { title: "WhatsApp Bot", soon: "Coming soon", desc: "This feature is under development and will be available soon." };
  return (
    <DashboardLayout title={t.title}>
      <div className="mx-auto max-w-2xl rounded-2xl border border-border/50 bg-card p-10 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-[oklch(0.66_0.26_320)] text-white shadow-lg">
          <MessageCircle className="h-8 w-8" strokeWidth={2.5} />
        </div>
        <h1 className="text-2xl font-bold text-foreground">{t.title}</h1>
        <p className="mt-2 inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{t.soon}</p>
        <p className="mt-4 text-sm text-muted-foreground">{t.desc}</p>
      </div>
    </DashboardLayout>
  );
}
