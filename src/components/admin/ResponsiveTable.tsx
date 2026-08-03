import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ResponsiveColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T, idx: number) => ReactNode;
  mobileLabel?: string;
  mobileHide?: boolean;
  tabletHide?: boolean;
  desktopHide?: boolean;
  className?: string;
  headerClassName?: string;
  align?: "start" | "center" | "end";
}

interface ResponsiveTableProps<T> {
  columns: ResponsiveColumn<T>[];
  data: T[];
  keyOf: (row: T) => string;
  empty?: ReactNode;
  loading?: boolean;
  loadingContent?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
  onRowClick?: (row: T) => void;
}

export function ResponsiveTable<T>({
  columns,
  data,
  keyOf,
  empty,
  loading,
  loadingContent,
  rowClassName,
  onRowClick,
}: ResponsiveTableProps<T>) {
  if (loading) {
    return loadingContent ?? <div className="flex justify-center py-12 text-sm text-[var(--color-fg-muted)]">Loading…</div>;
  }

  if (!data || data.length === 0) {
    return empty ?? <div className="py-12 text-center text-sm text-[var(--color-fg-muted)]">No data</div>;
  }

  const mobileColumns = columns.filter((c) => !c.mobileHide);
  const tabletColumns = columns.filter((c) => !c.mobileHide && !c.tabletHide);
  const desktopColumns = columns;

  return (
    <>
      {/* Desktop / Tablet Table */}
      <table className="hidden md:table w-full text-sm">
        <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-1)]">
          <tr>
            {tabletColumns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "p-3 text-start font-semibold text-[var(--color-fg-muted)]",
                  col.align === "end" && "text-end",
                  col.align === "center" && "text-center",
                  col.headerClassName,
                )}
              >
                {col.header}
              </th>
            ))}
            <th className="p-3 w-16 text-end" />
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr
              key={keyOf(row)}
              className={cn(
                "border-b border-[var(--color-border)] hover:bg-[var(--color-surface-2)] transition-colors",
                onRowClick && "cursor-pointer",
                rowClassName?.(row),
              )}
              onClick={() => onRowClick?.(row)}
            >
              {tabletColumns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    "p-3 align-middle",
                    col.align === "end" && "text-end",
                    col.align === "center" && "text-center",
                    col.className,
                  )}
                >
                  {col.cell(row, idx)}
                </td>
              ))}
              <td className="p-3 text-end align-middle" />
            </tr>
          ))}
        </tbody>
      </table>

      {/* Desktop-only (lg+) Table with all columns */}
      <table className="hidden lg:table w-full text-sm absolute inset-0 -z-10">
        <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-1)]">
          <tr>
            {desktopColumns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "p-3 text-start font-semibold text-[var(--color-fg-muted)]",
                  col.align === "end" && "text-end",
                  col.align === "center" && "text-center",
                  col.headerClassName,
                )}
              >
                {col.header}
              </th>
            ))}
            <th className="p-3 w-16 text-end" />
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr
              key={keyOf(row)}
              className={cn(
                "border-b border-[var(--color-border)] hover:bg-[var(--color-surface-2)] transition-colors",
                onRowClick && "cursor-pointer",
                rowClassName?.(row),
              )}
              onClick={() => onRowClick?.(row)}
            >
              {desktopColumns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    "p-3 align-middle",
                    col.align === "end" && "text-end",
                    col.align === "center" && "text-center",
                    col.className,
                  )}
                >
                  {col.cell(row, idx)}
                </td>
              ))}
              <td className="p-3 text-end align-middle" />
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-3">
        {data.map((row, idx) => (
          <MobileCard key={keyOf(row)} columns={mobileColumns} row={row} idx={idx} />
        ))}
      </div>
    </>
  );
}

function MobileCard<T>({
  columns,
  row,
  idx,
}: {
  columns: ResponsiveColumn<T>[];
  row: T;
  idx: number;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-2.5">
      {columns.map((col) => (
        <div key={col.key} className="flex items-start justify-between gap-3 text-sm">
          {col.mobileLabel && (
            <span className="text-xs font-medium text-[var(--color-fg-muted)] shrink-0 min-w-[7rem]">
              {col.mobileLabel}
            </span>
          )}
          <div className={cn("flex-1 min-w-0 text-end", !col.mobileLabel && "basis-full")}>
            {col.cell(row, idx)}
          </div>
        </div>
      ))}
    </div>
  );
}