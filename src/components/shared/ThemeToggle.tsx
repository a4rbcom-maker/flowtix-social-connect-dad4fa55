import { useTranslation } from "react-i18next";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const themes: { value: Theme; icon: typeof Sun; labelKey: string }[] = [
  { value: "light", icon: Sun, labelKey: "nav.switchLight" },
  { value: "dark", icon: Moon, labelKey: "nav.switchDark" },
  { value: "system", icon: Monitor, labelKey: "nav.switchSystem" },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();

  const current = themes.find((t) => t.value === theme) ?? themes[0];
  const Icon = current.icon;

  function cycle() {
    const idx = themes.findIndex((t) => t.value === theme);
    const next = themes[(idx + 1) % themes.length];
    setTheme(next.value);
  }

  return (
    <button
      type="button"
      onClick={cycle}
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-fg-muted)] transition-all duration-300 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)]",
        className,
      )}
      aria-label={t(current.labelKey)}
    >
      <Icon className="size-[1.15rem]" />
    </button>
  );
}

export function ThemeToggleFull({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();

  return (
    <div className={cn("flex items-center gap-1 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] p-1", className)}>
      {themes.map(({ value, icon: Icon, labelKey }) => (
        <button
          key={value}
          type="button"
          onClick={() => setTheme(value)}
          className={cn(
            "flex items-center justify-center rounded-md p-2 transition-all duration-200",
            theme === value
              ? "bg-[var(--color-bg)] text-[var(--color-fg)] shadow-sm"
              : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
          )}
          aria-label={t(labelKey)}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}
