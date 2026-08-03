import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "./badge";

export interface SectionHeadingProps {
  badge?: string;
  title: string;
  subtitle?: string;
  align?: "start" | "center";
  className?: string;
}

export const SectionHeading = forwardRef<HTMLDivElement, SectionHeadingProps>(
  ({ badge, title, subtitle, align = "center", className }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col gap-3 sm:gap-4",
        align === "center" ? "items-center text-center mx-auto max-w-2xl" : "items-start text-start",
        className,
      )}
    >
      {badge && (
        <Badge variant="primary" className="animate-[fade-in_0.6s_ease-out]">
          {badge}
        </Badge>
      )}
      <h2 className="text-2xl font-extrabold tracking-tight text-balance sm:text-4xl md:text-[2.75rem] md:leading-[1.1]">
        {title}
      </h2>
      {subtitle && (
        <p className="text-sm text-[var(--color-fg-muted)] text-pretty sm:text-base sm:text-lg">
          {subtitle}
        </p>
      )}
    </div>
  ),
);
SectionHeading.displayName = "SectionHeading";

export const Section = forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <section
      ref={ref}
      className={cn("relative py-14 sm:py-20 md:py-28", className)}
      {...props}
    />
  ),
);
Section.displayName = "Section";
