import { useTranslation } from "react-i18next";
import { Section, SectionHeading } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Users, Activity, Database, Zap, BarChart3, MessageSquare, Bot } from "lucide-react";

export function ProductPreview() {
  const { t } = useTranslation();

  const stats = [
    { icon: TrendingUp, value: "+248%", label: t("metrics.processed") },
    { icon: Users, value: "12.4k", label: t("metrics.users") },
    { icon: Activity, value: "99.9%", label: t("metrics.uptime") },
    { icon: Database, value: "8.2M", label: t("metrics.processed") },
  ];

  return (
    <Section>
      <div className="container-page">
        <SectionHeading
          badge={t("product.badge")}
          title={t("product.title")}
          subtitle={t("product.subtitle")}
        />

        <div className="relative mt-14 overflow-hidden rounded-3xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-[var(--shadow-xl)]">
          {/* Glow effect */}
          <div className="pointer-events-none absolute inset-0 bg-radial-glow opacity-50" aria-hidden />

          {/* Stats grid */}
          <div className="relative grid gap-px bg-[var(--color-border)] sm:grid-cols-4">
            {stats.map(({ icon: Icon, value, label }, i) => (
              <div
                key={i}
                className="group bg-[var(--color-surface)] p-6 transition-colors hover:bg-[var(--color-surface-2)]"
              >
                <div className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--color-primary)]/20 to-[var(--color-primary)]/5 text-[var(--color-primary-soft)] transition-transform group-hover:scale-110">
                  <Icon className="size-5" aria-hidden />
                </div>
                <p className="mt-4 text-3xl font-extrabold tracking-tight gradient-text">{value}</p>
                <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{label}</p>
              </div>
            ))}
          </div>

          {/* Interactive dashboard mockup */}
          <div className="relative grid gap-4 p-6 sm:p-8 lg:grid-cols-3">
            {/* Analytics chart */}
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5 lg:col-span-2">
              <div className="mb-4 flex items-center justify-between">
                <Badge variant="primary">{t("dashboard.analytics")}</Badge>
                <span className="flex items-center gap-1.5 text-xs text-[var(--color-fg-muted)]">
                  <span className="size-2 rounded-full bg-[var(--color-success)] animate-[pulse-glow_3s_ease-in-out_infinite]" />
                  Live
                </span>
              </div>
              <div className="flex h-40 items-end gap-1.5 sm:gap-2">
                {[35, 55, 42, 78, 60, 92, 68, 85, 73, 88, 65, 95].map((h, i) => (
                  <div key={i} className="flex-1 rounded-t gradient-brand opacity-80 transition-all hover:opacity-100" style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>

            {/* Contact list */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--color-fg)]">Contacts</span>
                <span className="text-[10px] text-[var(--color-fg-muted)]">3 new</span>
              </div>
              {[
                { name: "Sarah Johnson", status: "Active", dot: "success" },
                { name: "Ahmed Khan", status: "Syncing", dot: "warning" },
                { name: "Maria Rossi", status: "Active", dot: "success" },
              ].map((c, i) => (
                <div key={i} className="flex items-center gap-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2.5">
                  <div className="size-8 rounded-full gradient-brand flex items-center justify-center text-[10px] font-bold text-white">
                    {c.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium truncate">{c.name}</p>
                    <p className="text-[9px] text-[var(--color-fg-muted)]">{c.status}</p>
                  </div>
                  <span className={`size-1.5 rounded-full bg-[var(--color-${c.dot})]`} />
                </div>
              ))}
            </div>
          </div>

          {/* Feature strip */}
          <div className="relative border-t border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4 sm:p-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { icon: MessageSquare, label: "Messenger" },
                { icon: Bot, label: "AI Agents" },
                { icon: Zap, label: "Automation" },
                { icon: BarChart3, label: "Analytics" },
              ].map((f, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                  <div className="flex size-6 items-center justify-center rounded gradient-brand">
                    <f.icon className="size-3.5 text-white" />
                  </div>
                  <span className="text-xs font-medium">{f.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
