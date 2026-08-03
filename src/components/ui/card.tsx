import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type CardVariant = "default" | "elevated" | "glass" | "gradient" | "flat";
type CardHover = "none" | "lift" | "glow" | "border";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  hover?: CardHover;
}

const variantClasses: Record<CardVariant, string> = {
  default:
    "rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]",
  elevated:
    "rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-md)]",
  glass:
    "rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/80 backdrop-blur-xl shadow-[var(--shadow-md)]",
  gradient:
    "rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-md)] before:absolute before:inset-0 before:rounded-2xl before:bg-gradient-to-br before:from-[var(--color-primary)]/5 before:to-transparent before:pointer-events-none",
  flat:
    "rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)]",
};

const hoverClasses: Record<CardHover, string> = {
  none: "",
  lift: "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lg)] hover:border-[var(--color-border-strong)]",
  glow: "transition-all duration-200 hover:shadow-[var(--shadow-glow)] hover:border-[var(--color-border-strong)]",
  border: "transition-all duration-200 hover:border-[var(--color-primary)]/40",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = "default", hover = "none", ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative",
        variantClasses[variant],
        hoverClasses[hover],
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export const CardHeader = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1.5 p-6", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

export const CardTitle = forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn("text-lg font-bold leading-tight tracking-tight text-[var(--color-fg)]", className)}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

export const CardDescription = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-[var(--color-fg-muted)]", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

export const CardContent = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

export const CardFooter = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";
