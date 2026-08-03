import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Zap, Sparkles, Play, CheckCircle2, MessageSquare, Bot, Users, BarChart3, Image as ImageIcon, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function Hero() {
  const { t } = useTranslation();

  const features = [
    { icon: CheckCircle2, text: t("hero.trustSecure") },
    { icon: Zap, text: t("hero.trustFast") },
    { icon: Sparkles, text: t("hero.trustAI") },
  ];

  return (
    <section className="relative overflow-hidden pt-28 pb-16 sm:pt-36 sm:pb-28">
      {/* Background effects */}
      <div className="pointer-events-none absolute inset-0 bg-radial-glow" aria-hidden />
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-20 [mask-image:radial-gradient(70%_60%_at_50%_0%,black,transparent)]" aria-hidden />
      <div className="pointer-events-none absolute -top-20 start-1/2 size-72 -translate-x-1/2 rounded-full bg-[var(--color-primary)] opacity-[0.12] blur-[100px] sm:size-[36rem] sm:blur-[120px]" aria-hidden />
      <div className="pointer-events-none absolute top-1/3 start-1/4 size-64 rounded-full bg-[var(--color-primary-soft)] opacity-[0.08] blur-[80px]" aria-hidden />
      <div className="pointer-events-none absolute bottom-1/4 end-1/4 size-48 rounded-full bg-[var(--color-primary)] opacity-[0.06] blur-[60px]" aria-hidden />

      <div className="container-page relative z-10">
        {/* Badge + Title + Subtitle + CTAs */}
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <Badge variant="primary" className="mb-5 animate-[fade-in_0.5s_ease-out] sm:mb-6">
            <Sparkles className="size-3.5" aria-hidden />
            {t("hero.badge")}
          </Badge>

          <h1 className="animate-[fade-up_0.7s_ease-out] text-balance text-3xl font-extrabold leading-[1.15] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl sm:leading-[1.1]">
            {t("hero.title")}{" "}
            <span className="gradient-text">{t("hero.titleHighlight")}</span>
          </h1>

          <p className="mt-4 max-w-2xl animate-[fade-up_0.7s_ease-out_0.1s_both] text-pretty text-base text-[var(--color-fg-muted)] sm:mt-6 sm:text-lg">
            {t("hero.subtitle")}
          </p>

          <div className="mt-7 flex animate-[fade-up_0.7s_ease-out_0.2s_both] flex-col gap-3 sm:mt-9 sm:flex-row">
            <Button asChild size="lg" className="group w-full sm:w-auto">
              <Link to="/auth/register">
                {t("hero.ctaPrimary")}
                <ArrowRight className="transition-transform group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="secondary" className="w-full sm:w-auto">
              <Link to="#">
                <Play className="size-4" aria-hidden />
                {t("hero.ctaSecondary")}
              </Link>
            </Button>
          </div>

          <ul className="mt-8 flex animate-[fade-up_0.7s_ease-out_0.3s_both] flex-wrap items-center justify-center gap-x-5 gap-y-2.5 text-xs text-[var(--color-fg-muted)] sm:mt-10 sm:gap-x-6 sm:gap-y-3 sm:text-sm">
            {features.map((f, i) => (
              <li key={i} className="flex items-center gap-1.5 sm:gap-2">
                <f.icon className="size-3.5 text-[var(--color-primary-soft)] sm:size-4" aria-hidden />
                {f.text}
              </li>
            ))}
          </ul>
        </div>

        {/* Hero Illustration — Product Visual */}
        <div className="relative mx-auto mt-12 max-w-5xl animate-[fade-up_0.9s_ease-out_0.4s_both] sm:mt-16">
          {/* Glow backdrop */}
          <div className="absolute -inset-x-4 -top-4 bottom-0 rounded-2xl bg-gradient-to-b from-[var(--color-primary)]/15 to-transparent blur-2xl sm:-inset-x-8 sm:rounded-[2rem] sm:from-[var(--color-primary)]/20" aria-hidden />

          {/* Main dashboard preview */}
          <div className="relative overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-[var(--shadow-lg)] sm:rounded-2xl sm:shadow-[var(--shadow-xl)]">
            {/* Browser chrome */}
            <div className="flex items-center gap-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2.5 sm:gap-2 sm:px-4 sm:py-3">
              <span className="size-2.5 rounded-full bg-[var(--color-error)]/70 sm:size-3" />
              <span className="size-2.5 rounded-full bg-[var(--color-warning)]/70 sm:size-3" />
              <span className="size-2.5 rounded-full bg-[var(--color-success)]/70 sm:size-3" />
              <div className="mx-auto h-5 w-40 rounded-md bg-[var(--color-surface-2)] sm:h-6 sm:w-64" />
            </div>

            {/* Dashboard content */}
            <div className="grid gap-4 p-4 sm:grid-cols-4 sm:gap-6 sm:p-6">
              {/* Sidebar */}
              <div className="hidden sm:block space-y-2">
                <div className="flex items-center gap-2 rounded-lg bg-[var(--color-primary)]/10 px-3 py-2">
                  <div className="size-6 rounded gradient-brand" />
                  <span className="text-[10px] font-semibold">FlowTix</span>
                </div>
                {[
                  { icon: Users, label: "Contacts", active: true },
                  { icon: MessageSquare, label: "Messenger" },
                  { icon: Bot, label: "Automation" },
                  { icon: Globe, label: "WhatsApp" },
                  { icon: BarChart3, label: "Analytics" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg px-3 py-2 text-[10px] text-[var(--color-fg-muted)]">
                    <item.icon className="size-3.5" />
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>

              {/* Main content area */}
              <div className="sm:col-span-3 space-y-3">
                {/* Top stats row */}
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  {[
                    { label: "Contacts", value: "12.4k", delta: "+8.2%" },
                    { label: "Messages", value: "847k", delta: "+24%" },
                    { label: "Campaigns", value: "23", delta: "+3" },
                  ].map((s, i) => (
                    <div key={i} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2.5 sm:p-3">
                      <p className="text-[9px] text-[var(--color-fg-muted)]">{s.label}</p>
                      <p className="mt-0.5 text-base font-bold sm:text-lg">{s.value}</p>
                      <p className="text-[9px] text-[var(--color-success)]">{s.delta}</p>
                    </div>
                  ))}
                </div>

                {/* Chart */}
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 sm:p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-[10px] font-medium">Activity</span>
                    <span className="text-[9px] text-[var(--color-success)]">Live</span>
                  </div>
                  <div className="flex h-20 items-end gap-1 sm:gap-1.5">
                    {[35, 55, 42, 78, 60, 92, 68, 85, 73, 88, 65, 95].map((h, i) => (
                      <div key={i} className="flex-1 rounded-t gradient-brand opacity-80" style={{ height: `${h}%` }} />
                    ))}
                  </div>
                </div>

                {/* Contact list */}
                <div className="space-y-1.5">
                  {[
                    { name: "Sarah Johnson", status: "Active", color: "success" },
                    { name: "Ahmed Khan", status: "Syncing", color: "warning" },
                  ].map((c, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2 sm:gap-3 sm:p-2.5">
                      <div className="size-7 rounded-full gradient-brand flex items-center justify-center text-[9px] font-bold text-white">
                        {c.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-medium truncate">{c.name}</p>
                        <p className="text-[9px] text-[var(--color-fg-muted)]">{c.status}</p>
                      </div>
                      <span className={`size-1.5 rounded-full bg-[var(--color-${c.color})]`} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Floating notifications */}
          <div className="absolute -end-4 top-12 hidden animate-[float_6s_ease-in-out_infinite] rounded-xl border border-[var(--color-border-strong)] glass-strong px-3 py-2 shadow-[var(--shadow-lg)] sm:block">
            <div className="flex items-center gap-2 text-[11px] font-medium">
              <span className="size-2 rounded-full bg-[var(--color-success)] animate-[pulse-glow_3s_ease-in-out_infinite]" />
              {t("metrics.uptime")} 99.9%
            </div>
          </div>
          <div className="absolute -start-4 bottom-20 hidden animate-[float_7s_ease-in-out_infinite_0.5s] rounded-xl border border-[var(--color-border-strong)] glass-strong px-3 py-2 shadow-[var(--shadow-lg)] sm:block">
            <div className="flex items-center gap-2 text-[11px] font-medium">
              <Sparkles className="size-3.5 text-[var(--color-primary-soft)]" />
              AI Active
            </div>
          </div>
          <div className="absolute -end-6 bottom-4 hidden animate-[float_8s_ease-in-out_infinite_1s] rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 shadow-[var(--shadow-lg)] sm:block">
            <div className="flex items-center gap-2 text-[11px]">
              <div className="flex size-5 items-center justify-center rounded-full bg-[var(--color-primary)]/10">
                <ImageIcon className="size-3 text-[var(--color-primary-soft)]" />
              </div>
              <span className="font-medium">284</span>
              <span className="text-[var(--color-fg-muted)]">new</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
