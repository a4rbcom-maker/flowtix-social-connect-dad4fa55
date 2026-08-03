import { forwardRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface InputIconProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ComponentType<{ className?: string }>;
  error?: boolean;
}

export const InputIcon = forwardRef<HTMLInputElement, InputIconProps>(
  ({ className, icon: Icon, error, type = "text", ...props }, ref) => (
    <div className="relative">
      {Icon && (
        <Icon className="pointer-events-none absolute start-3.5 top-1/2 size-[1.15rem] -translate-y-1/2 text-[var(--color-fg-subtle)]" aria-hidden />
      )}
      <input
        ref={ref}
        type={type}
        className={cn(
          "flex h-12 w-full rounded-xl border bg-[var(--color-surface-2)] px-3.5 py-2.5 text-sm text-[var(--color-fg)] shadow-sm transition-all duration-200",
          "placeholder:text-[var(--color-fg-subtle)] placeholder:font-normal",
          "focus-visible:outline-none focus-visible:border-[var(--color-primary)] focus-visible:bg-[var(--color-surface)] focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          Icon ? "ps-11" : "",
          error
            ? "border-[var(--color-error)] focus-visible:border-[var(--color-error)] focus-visible:ring-[color-mix(in_oklab,var(--color-error)_20%,transparent)]"
            : "border-[var(--color-border-strong)] hover:border-[var(--color-primary-soft)]",
          className,
        )}
        {...props}
      />
    </div>
  ),
);
InputIcon.displayName = "InputIcon";

interface PasswordInputIconProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  icon?: React.ComponentType<{ className?: string }>;
  error?: boolean;
}

export const PasswordInputIcon = forwardRef<HTMLInputElement, PasswordInputIconProps>(
  ({ className, icon: Icon, error, ...props }, ref) => {
    const [visible, setVisible] = useState(false);
    return (
      <div className="relative">
        {Icon && (
          <Icon className="pointer-events-none absolute start-3.5 top-1/2 size-[1.15rem] -translate-y-1/2 text-[var(--color-fg-subtle)]" aria-hidden />
        )}
        <input
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn(
            "flex h-12 w-full rounded-xl border bg-[var(--color-surface-2)] px-3.5 py-2.5 text-sm text-[var(--color-fg)] shadow-sm transition-all duration-200",
            "placeholder:text-[var(--color-fg-subtle)] placeholder:font-normal",
            "focus-visible:outline-none focus-visible:border-[var(--color-primary)] focus-visible:bg-[var(--color-surface)] focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "ps-11 pe-11",
            error
              ? "border-[var(--color-error)] focus-visible:border-[var(--color-error)] focus-visible:ring-[color-mix(in_oklab,var(--color-error)_20%,transparent)]"
              : "border-[var(--color-border-strong)] hover:border-[var(--color-primary-soft)]",
            className,
          )}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute end-3.5 top-1/2 -translate-y-1/2 text-[var(--color-fg-subtle)] transition-colors hover:text-[var(--color-fg)]"
          tabIndex={-1}
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff className="size-[1.15rem]" /> : <Eye className="size-[1.15rem]" />}
        </button>
      </div>
    );
  },
);
PasswordInputIcon.displayName = "PasswordInputIcon";
