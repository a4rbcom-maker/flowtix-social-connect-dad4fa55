import { cn } from "@/lib/utils";

export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="relative flex size-9 items-center justify-center rounded-xl gradient-brand shadow-[0_6px_18px_-6px_rgba(109,94,252,0.7)]">
        <svg viewBox="0 0 24 24" fill="none" className="size-5 text-white" aria-hidden>
          <path
            d="M4 7h11M4 12h16M4 17h8"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <circle cx="18.5" cy="7" r="2" fill="currentColor" />
        </svg>
      </span>
      {withText && (
        <span className="text-[1.05rem] font-extrabold tracking-tight text-[var(--color-fg)]">
          Flow<span className="text-[var(--color-primary-soft)]">Tix</span>
        </span>
      )}
    </span>
  );
}
