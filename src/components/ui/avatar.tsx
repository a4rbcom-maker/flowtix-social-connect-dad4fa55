import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface AvatarProps {
  src?: string | null;
  alt?: string;
  fallback: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  showStatus?: boolean;
  ring?: boolean;
  ringColor?: string;
}

const sizeMap = { xs: "size-6 text-[0.6rem]", sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-12 text-base", xl: "size-16 text-lg" };
const statusSizeMap = { xs: "size-1.5", sm: "size-2", md: "size-2.5", lg: "size-3", xl: "size-3.5" };

export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(
  ({ src, alt, fallback, size = "md", className, showStatus, ring, ringColor }, ref) => (
    <div className="relative inline-block shrink-0">
      <div
        ref={ref}
        className={cn(
          "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
          sizeMap[size],
          ring && "ring-2 ring-offset-2 ring-offset-[var(--color-bg-elevated)]",
          ringColor ?? "ring-[var(--color-primary)]",
          className,
        )}
      >
        {src ? (
          <img src={src} alt={alt ?? fallback} className="size-full object-cover" />
        ) : (
          <span className="font-bold uppercase text-white gradient-brand select-none flex items-center justify-center size-full" aria-label={alt ?? fallback}>
            {fallback.slice(0, 2)}
          </span>
        )}
      </div>
      {showStatus && (
        <span className={cn("absolute bottom-0 end-0 rounded-full bg-[var(--color-success)] border-2 border-[var(--color-bg-elevated)]", statusSizeMap[size])} aria-label="Online" />
      )}
    </div>
  ),
);
Avatar.displayName = "Avatar";
