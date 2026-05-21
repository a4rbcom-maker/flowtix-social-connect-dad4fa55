import { createFileRoute } from "@tanstack/react-router";
import { Bot, Sparkles } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/dashboard/whatsapp/bot")({
  ssr: false,
  component: BotPage,
});

function BotPage() {
  const { lang } = useI18n();
  const t = lang === "ar"
    ? {
        title: "بوت واتساب",
        subtitle: "ردود تلقائية ذكية على رسائل واتساب باستخدام نماذج الذكاء الاصطناعي.",
        soon: "قيد التطوير",
        body: "هنا هتقدر تفعّل البوت، تحدد البرومبت، وتشوف ردود الذكاء الاصطناعي على عملاءك تلقائياً. متاح قريباً.",
      }
    : {
        title: "WhatsApp Bot",
        subtitle: "Smart auto-replies for WhatsApp messages powered by AI.",
        soon: "Coming Soon",
        body: "Enable the bot, set its prompt, and let AI handle customer replies automatically. Available soon.",
      };

  return (
    <DashboardLayout title={t.title}>
      <div className="mx-auto max-w-3xl">
        <div className="rounded-2xl border border-border/60 bg-card p-8 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[oklch(0.66_0.26_320)] text-white shadow-lg">
              <Bot className="h-6 w-6" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">{t.title}</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">{t.subtitle}</p>
            </div>
          </div>

          <div className="mt-8 flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 bg-muted/30 p-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <Sparkles className="h-7 w-7 text-primary" />
            </div>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
              {t.soon}
            </span>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{t.body}</p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
