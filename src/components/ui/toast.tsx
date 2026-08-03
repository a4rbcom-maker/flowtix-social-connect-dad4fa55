import { useEffect, useState, useCallback } from "react";
import { X, CheckCircle2, AlertTriangle, XCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "warning" | "info";
type ToastPosition = "top-end" | "top-start" | "bottom-end" | "bottom-start";

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration?: number;
}

const icons: Record<ToastType, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const colors: Record<ToastType, string> = {
  success: "border-[color-mix(in_oklab,var(--color-success)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-success)_10%,transparent)]",
  error: "border-[color-mix(in_oklab,var(--color-error)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-error)_10%,transparent)]",
  warning: "border-[color-mix(in_oklab,var(--color-warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-warning)_10%,transparent)]",
  info: "border-[color-mix(in_oklab,var(--color-info)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-info)_10%,transparent)]",
};

let addToastFn: ((toast: Omit<Toast, "id">) => void) | null = null;

export function toast(toast: Omit<Toast, "id">) {
  addToastFn?.(toast);
}

const defaultPosition: ToastPosition = "top-end";

export function ToastContainer({ position = defaultPosition }: { position?: ToastPosition }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, t.duration ?? 5000);
  }, []);

  useEffect(() => {
    addToastFn = addToast;
    return () => { addToastFn = null; };
  }, [addToast]);

  const removeToast = (id: string) => setToasts((prev) => prev.filter((x) => x.id !== id));

  const posClasses: Record<ToastPosition, string> = {
    "top-end": "top-4 end-4",
    "top-start": "top-4 start-4",
    "bottom-end": "bottom-4 end-4",
    "bottom-start": "bottom-4 start-4",
  };

  return (
    <div className={cn("fixed z-[200] flex flex-col gap-3 w-full max-w-sm pointer-events-none", posClasses[position])}>
      {toasts.map((t) => {
        const Icon = icons[t.type];
        return (
          <div
            key={t.id}
            role="alert"
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-xl border p-4 shadow-[var(--shadow-lg)] animate-[slide-in-end_0.3s_ease-out]",
              colors[t.type],
            )}
          >
            <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--color-fg)]">{t.title}</p>
              {t.description && <p className="mt-1 text-xs text-[var(--color-fg-muted)]">{t.description}</p>}
            </div>
            <button onClick={() => removeToast(t.id)} className="shrink-0 rounded-md p-0.5 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]" aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
