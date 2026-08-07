import { MessageSquareOff, MessageCircle, AlertCircle, Loader2 } from "lucide-react";
import type { EmptyStateVariant } from "@/types/inbox.types";
import { useTranslation } from "react-i18next";

interface EmptyStateProps {
  variant: EmptyStateVariant;
  message?: string;
  onRetry?: () => void;
}

export function EmptyState({ variant, message, onRetry }: EmptyStateProps) {
  const { t } = useTranslation();

  const config = {
    "no-conv": { icon: MessageSquareOff, title: t("wa.inbox.empty.noConversation"), desc: t("wa.inbox.empty.noConversationDesc") },
    "no-msg": { icon: MessageCircle, title: t("wa.inbox.empty.selectConversation"), desc: t("wa.inbox.empty.selectConversationDesc") },
    "error": { icon: AlertCircle, title: t("wa.inbox.empty.error"), desc: message || t("wa.inbox.empty.errorDesc") },
    "loading": { icon: Loader2, title: t("wa.inbox.empty.loading"), desc: "" },
  }[variant];

  const Icon = config.icon;

  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
      <Icon className={`size-12 text-[var(--color-fg-muted)] ${variant === "loading" ? "animate-spin" : ""}`} />
      <div>
        <p className="text-sm font-semibold text-[var(--color-fg)]">{config.title}</p>
        {config.desc && <p className="mt-1 text-xs text-[var(--color-fg-muted)]">{config.desc}</p>}
      </div>
      {variant === "error" && onRetry && (
        <button onClick={onRetry} className="mt-2 rounded-lg bg-[var(--color-primary)] px-4 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-primary)]/80">
          {t("wa.inbox.empty.retry")}
        </button>
      )}
    </div>
  );
}
