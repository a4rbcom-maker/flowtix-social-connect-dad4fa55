import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Select } from "./dropdown";
import { Input } from "./input";

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterConfig {
  key: string;
  label: string;
  options: FilterOption[];
}

interface FilterBarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filters?: FilterConfig[];
  filterValues?: Record<string, string>;
  onFilterChange?: (key: string, value: string) => void;
  onClear?: () => void;
  activeCount?: number;
  className?: string;
}

export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  filters = [],
  filterValues = {},
  onFilterChange,
  onClear,
  activeCount = 0,
  className,
}: FilterBarProps) {
  const { t } = useTranslation();

  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:flex-row sm:items-center sm:gap-2 sm:p-4", className)}>
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-fg-subtle)]" aria-hidden />
        <Input
          type="search"
          placeholder={searchPlaceholder ?? t("common.search")}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          className="ps-9"
        />
      </div>

      {filters.map((filter) => (
        <div key={filter.key} className="sm:w-44">
          <Select
            value={filterValues[filter.key] ?? ""}
            onValueChange={(v) => onFilterChange?.(filter.key, v)}
            options={[{ value: "", label: filter.label }, ...filter.options]}
            placeholder={filter.label}
          />
        </div>
      ))}

      {activeCount > 0 && (
        <button
          onClick={onClear}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm font-medium text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg)]"
        >
          <X className="size-4" />
          <span className="hidden sm:inline">{t("common.clear")}</span>
          {activeCount > 0 && (
            <span className="flex size-5 items-center justify-center rounded-full bg-[var(--color-primary)] text-[0.65rem] font-bold text-white">
              {activeCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
}

interface FilterChipProps {
  label: string;
  onRemove: () => void;
}

export function FilterChip({ label, onRemove }: FilterChipProps) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] py-1 ps-3 pe-1.5 text-xs font-medium text-[var(--color-fg-muted)]">
      {label}
      <button
        onClick={onRemove}
        className="flex size-4 items-center justify-center rounded-full text-[var(--color-fg-subtle)] transition-colors hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)]"
        aria-label={t("common.remove")}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
