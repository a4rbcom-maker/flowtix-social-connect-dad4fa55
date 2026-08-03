import { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative flex w-full gap-3 rounded-xl border p-4 text-sm transition-colors",
  {
    variants: {
      variant: {
        default: "border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-fg)]",
        success:
          "border-[color-mix(in_oklab,var(--color-success)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-success)_10%,transparent)] text-[var(--color-fg)]",
        warning:
          "border-[color-mix(in_oklab,var(--color-warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-warning)_10%,transparent)] text-[var(--color-fg)]",
        error:
          "border-[color-mix(in_oklab,var(--color-error)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-error)_10%,transparent)] text-[var(--color-fg)]",
        info:
          "border-[color-mix(in_oklab,var(--color-info)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-info)_10%,transparent)] text-[var(--color-fg)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

const icons = {
  default: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
  info: Info,
} as const;

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  onClose?: () => void;
}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = "default", onClose, children, ...props }, ref) => {
    const Icon = icons[variant ?? "default"];
    return (
      <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
        <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="flex-1">{children}</div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-0.5 text-[var(--color-fg-subtle)] transition-colors hover:text-[var(--color-fg)]"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    );
  },
);
Alert.displayName = "Alert";

export { alertVariants };
