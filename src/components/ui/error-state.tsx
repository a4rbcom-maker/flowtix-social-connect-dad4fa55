import { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import { Button } from "./button";

const errorStateVariants = cva(
  "flex flex-col items-center justify-center gap-5 py-20 text-center",
  {
    variants: {
      variant: {
        page: "min-h-[60vh]",
        inline: "rounded-2xl border border-dashed border-[var(--color-border-strong)] px-6",
      },
    },
    defaultVariants: { variant: "inline" },
  },
);

interface ErrorStateProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof errorStateVariants> {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: { label: string; onClick: () => void };
}

export const ErrorState = forwardRef<HTMLDivElement, ErrorStateProps>(
  ({ className, variant, title, description, icon: Icon = AlertTriangle, action, ...props }, ref) => (
    <div ref={ref} className={cn(errorStateVariants({ variant }), className)} {...props}>
      <div className="flex size-16 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--color-error)_12%,transparent)] text-[var(--color-error)]">
        <Icon className="size-8" aria-hidden />
      </div>
      <div className="space-y-2 max-w-md">
        <h3 className="text-lg font-bold text-[var(--color-fg)]">{title}</h3>
        {description && <p className="text-sm text-[var(--color-fg-muted)]">{description}</p>}
      </div>
      {action && (
        <Button variant="primary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  ),
);
ErrorState.displayName = "ErrorState";
