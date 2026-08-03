import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Accent = "primary" | "success" | "warning" | "error" | "info" | "secondary";

const accentMap: Record<Accent, { bg: string; text: string; ring: string; shadow: string; trendBg: string; trendText: string }> = {
  primary:   { bg: "bg-[color-mix(in_oklab,var(--color-primary)_14%,transparent)]",   text: "text-[var(--color-primary-soft)]",   ring: "ring-[var(--color-primary)]/25",   shadow: "shadow-[0_4px_12px_-4px_rgba(109,94,252,0.5)]",   trendBg: "bg-[color-mix(in_oklab,var(--color-primary)_15%,transparent)]",   trendText: "text-[var(--color-primary-soft)]" },
  success:   { bg: "bg-[color-mix(in_oklab,var(--color-success)_14%,transparent)]",   text: "text-[var(--color-success)]",         ring: "ring-[var(--color-success)]/25",   shadow: "shadow-[0_4px_12px_-4px_rgba(16,185,129,0.4)]",  trendBg: "bg-[color-mix(in_oklab,var(--color-success)_15%,transparent)]",   trendText: "text-[var(--color-success)]" },
  warning:   { bg: "bg-[color-mix(in_oklab,var(--color-warning)_14%,transparent)]",   text: "text-[var(--color-warning)]",         ring: "ring-[var(--color-warning)]/25",   shadow: "shadow-[0_4px_12px_-4px_rgba(245,158,11,0.4)]",  trendBg: "bg-[color-mix(in_oklab,var(--color-warning)_15%,transparent)]",   trendText: "text-[var(--color-warning)]" },
  error:     { bg: "bg-[color-mix(in_oklab,var(--color-error)_14%,transparent)]",     text: "text-[var(--color-error)]",           ring: "ring-[var(--color-error)]/25",     shadow: "shadow-[0_4px_12px_-4px_rgba(244,63,94,0.4)]",   trendBg: "bg-[color-mix(in_oklab,var(--color-error)_15%,transparent)]",     trendText: "text-[var(--color-error)]" },
  info:      { bg: "bg-[color-mix(in_oklab,var(--color-info)_14%,transparent)]",      text: "text-[var(--color-info)]",            ring: "ring-[var(--color-info)]/25",      shadow: "shadow-[0_4px_12px_-4px_rgba(56,189,248,0.4)]",  trendBg: "bg-[color-mix(in_oklab,var(--color-info)_15%,transparent)]",      trendText: "text-[var(--color-info)]" },
  secondary: { bg: "bg-[color-mix(in_oklab,var(--color-secondary)_14%,transparent)]", text: "text-[var(--color-secondary-soft)]", ring: "ring-[var(--color-secondary)]/25", shadow: "shadow-[0_4px_12px_-4px_rgba(34,211,238,0.4)]",  trendBg: "bg-[color-mix(in_oklab,var(--color-secondary)_15%,transparent)]", trendText: "text-[var(--color-secondary-soft)]" },
};

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  className?: string;
  variant?: "default" | "hero";
  gradient?: boolean;
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  action,
  className,
  variant = "default",
  gradient = false,
}: PageHeaderProps) {
  if (variant === "hero") {
    return (
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-gradient-to-br from-[var(--color-surface)] via-[var(--color-surface)] to-[var(--color-surface-2)] p-6 shadow-[var(--shadow-sm)] sm:p-8",
          className,
        )}
      >
        {gradient && (
          <>
            <div className="pointer-events-none absolute -top-24 -end-20 size-60 rounded-full bg-gradient-to-br from-[var(--color-primary)]/15 to-transparent blur-3xl" aria-hidden />
            <div className="pointer-events-none absolute -bottom-16 -start-16 size-40 rounded-full bg-gradient-to-tr from-[var(--color-secondary)]/15 to-transparent blur-2xl" aria-hidden />
          </>
        )}
        <div className={cn("relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between")}>
          <div className="flex items-center gap-4">
            {Icon && (
              <div className="relative shrink-0">
                <div className="absolute inset-0 rounded-2xl gradient-brand opacity-30 blur-lg" aria-hidden />
                <div className="relative flex size-14 items-center justify-center rounded-2xl gradient-brand text-white shadow-[0_8px_24px_-8px_rgba(109,94,252,0.6)]">
                  <Icon className="size-6" aria-hidden />
                </div>
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-fg)] sm:text-3xl">{title}</h1>
              {description && <p className="mt-1 text-sm text-[var(--color-fg-muted)] sm:text-base">{description}</p>}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div className="flex size-10 sm:size-11 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)] text-[var(--color-primary-soft)]">
            <Icon className="size-5" aria-hidden />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-lg sm:text-xl md:text-2xl font-extrabold tracking-tight text-[var(--color-fg)] truncate">{title}</h1>
          {description && <p className="mt-0.5 text-xs sm:text-sm text-[var(--color-fg-muted)] line-clamp-2">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0 flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  trend?: { value: string; positive: boolean };
  sparkline?: number[];
  accent?: Accent;
  className?: string;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  sparkline,
  accent = "primary",
  className,
}: StatCardProps) {
  const a = accentMap[accent];

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)] transition-all duration-300 hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-md)]",
        className,
      )}
    >
      {/* Background gradient accent */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100",
          "bg-gradient-to-br",
          accent === "primary" && "from-[color-mix(in_oklab,var(--color-primary)_6%,transparent)] to-transparent",
          accent === "success" && "from-[color-mix(in_oklab,var(--color-success)_6%,transparent)] to-transparent",
          accent === "warning" && "from-[color-mix(in_oklab,var(--color-warning)_6%,transparent)] to-transparent",
          accent === "error" && "from-[color-mix(in_oklab,var(--color-error)_6%,transparent)] to-transparent",
          accent === "info" && "from-[color-mix(in_oklab,var(--color-info)_6%,transparent)] to-transparent",
          accent === "secondary" && "from-[color-mix(in_oklab,var(--color-secondary)_6%,transparent)] to-transparent",
        )}
        aria-hidden
      />

      <div className="relative">
        <div className="flex items-start justify-between gap-2">
          <div className={cn("flex size-10 items-center justify-center rounded-xl ring-1 transition-transform duration-300 group-hover:scale-110", a.bg, a.text, a.ring, a.shadow)}>
            <Icon className="size-5" aria-hidden />
          </div>
          {trend && (
            <div className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-bold", a.trendBg, a.trendText)}>
              {trend.positive ? (
                <TrendingUp className="size-3" aria-hidden />
              ) : (
                <TrendingDown className="size-3" aria-hidden />
              )}
              {trend.value}
            </div>
          )}
        </div>

        <p className="mt-4 text-3xl font-extrabold tracking-tight text-[var(--color-fg)]">{value}</p>
        <p className="mt-1 text-xs font-medium text-[var(--color-fg-muted)]">{label}</p>

        {sparkline && sparkline.length > 1 && (
          <div className="mt-3 -mb-1 h-10">
            <Sparkline values={sparkline} accent={accent} />
          </div>
        )}
      </div>
    </div>
  );
}

function Sparkline({ values, accent }: { values: number[]; accent: Accent }) {
  const width = 120;
  const height = 36;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);

  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  const colorVar =
    accent === "primary" ? "var(--color-primary)" :
    accent === "success" ? "var(--color-success)" :
    accent === "warning" ? "var(--color-warning)" :
    accent === "error" ? "var(--color-error)" :
    accent === "info" ? "var(--color-info)" :
    "var(--color-secondary)";

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
      <defs>
        <linearGradient id={`spark-${accent}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colorVar} stopOpacity="0.35" />
          <stop offset="100%" stopColor={colorVar} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        points={points}
        fill="none"
        stroke={colorVar}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#spark-${accent})`} />
    </svg>
  );
}

interface SectionHeaderProps {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  className?: string;
}

export function SectionHeader({ title, description, icon: Icon, action, className }: SectionHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      <div className="flex items-center gap-2.5 min-w-0">
        {Icon && (
          <div className="flex size-8 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--color-primary)_10%,transparent)] text-[var(--color-primary-soft)] shrink-0">
            <Icon className="size-4" aria-hidden />
          </div>
        )}
        <div className="min-w-0">
          <h3 className="text-base font-bold tracking-tight text-[var(--color-fg)] truncate">{title}</h3>
          {description && <p className="text-xs text-[var(--color-fg-muted)] truncate">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

interface StatChipProps {
  label: string;
  value: string | number;
  icon?: React.ComponentType<{ className?: string }>;
  accent?: Accent;
  className?: string;
}

export function StatChip({ label, value, icon: Icon, accent = "primary", className }: StatChipProps) {
  const a = accentMap[accent];
  return (
    <div className={cn("flex items-center gap-2.5 rounded-lg bg-[var(--color-surface-2)] px-3 py-2", className)}>
      {Icon && (
        <div className={cn("flex size-7 items-center justify-center rounded-md", a.bg, a.text)}>
          <Icon className="size-3.5" aria-hidden />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[0.65rem] font-bold uppercase tracking-wider text-[var(--color-fg-subtle)] truncate">{label}</p>
        <p className="text-sm font-extrabold text-[var(--color-fg)] truncate">{value}</p>
      </div>
    </div>
  );
}
