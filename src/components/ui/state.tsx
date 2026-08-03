import { cn } from "@/lib/utils";
import { Loader2, Inbox } from "lucide-react";

export function LoadingState({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex items-center justify-center gap-3 py-12 text-[var(--color-fg-muted)]", className)}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-5 animate-spin text-[var(--color-primary)]" aria-hidden />
      <span className="text-sm">Loading…</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-[var(--color-border-strong)] py-16 text-center",
        className,
      )}
    >
      <div className="flex size-14 items-center justify-center rounded-2xl bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]">
        <Icon className="size-7" aria-hidden />
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-[var(--color-fg)]">{title}</h3>
        {description && (
          <p className="mx-auto max-w-sm text-sm text-[var(--color-fg-muted)]">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
