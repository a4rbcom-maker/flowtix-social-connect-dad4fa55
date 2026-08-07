import { Star, Archive, ShieldAlert, PanelRightClose, PanelRightOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/inbox-helpers";
import { useTranslation } from "react-i18next";
import type { ConversationWithContact } from "@/types/wa-inbox.types";

interface ChatHeaderProps {
  conv: ConversationWithContact;
  onStar: (v: boolean) => void;
  onArchive: (v: boolean) => void;
  onSpam: (v: boolean) => void;
  onToggleContactPanel: () => void;
  showContactPanel: boolean;
}

export function ChatHeader({
  conv,
  onStar,
  onArchive,
  onSpam,
  onToggleContactPanel,
  showContactPanel,
}: ChatHeaderProps) {
  const { t } = useTranslation();
  const name = conv.contact?.push_name || conv.contact?.name || conv.contact?.phone || "—";

  const statusColors: Record<string, string> = {
    open: "bg-green-500/10 text-green-600",
    waiting: "bg-amber-500/10 text-amber-600",
    resolved: "bg-blue-500/10 text-blue-600",
  };

  return (
    <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-2.5">
      <div className="flex items-center gap-3 min-w-0">
        {conv.contact?.avatar_url ? (
          <img src={conv.contact.avatar_url} alt="" className="size-9 rounded-full object-cover shrink-0" />
        ) : (
          <div className="size-9 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center text-[var(--color-primary)] font-bold text-xs shrink-0">
            {getInitials(conv.contact?.push_name || conv.contact?.name)}
          </div>
        )}

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold truncate text-[var(--color-fg)]">{name}</p>
            {conv.status && (
              <span className={cn("shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded", statusColors[conv.status] || statusColors.open)}>
                {t(`wa.inbox.status.${conv.status}`)}
              </span>
            )}
          </div>
          <p className="text-[11px] text-[var(--color-fg-muted)] truncate">
            {conv.contact?.phone}
            {conv.contact?.last_seen && ` • ${t("wa.inbox.lastSeen")}: ${new Date(conv.contact.last_seen).toLocaleString()}`}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={() => onStar(!conv.is_starred)}
          className="size-8 flex items-center justify-center rounded-lg hover:bg-[var(--color-surface-2)] transition-colors"
          title={t("wa.inbox.actions.star")}
        >
          <Star className={cn("size-4", conv.is_starred ? "fill-[var(--color-warning)] text-[var(--color-warning)]" : "text-[var(--color-fg-muted)]")} />
        </button>
        <button
          onClick={() => onArchive(!conv.is_archived)}
          className="size-8 flex items-center justify-center rounded-lg hover:bg-[var(--color-surface-2)] transition-colors"
          title={t("wa.inbox.actions.archive")}
        >
          <Archive className="size-4 text-[var(--color-fg-muted)]" />
        </button>
        <button
          onClick={() => onSpam(!conv.is_spam)}
          className="size-8 flex items-center justify-center rounded-lg hover:bg-[var(--color-surface-2)] transition-colors"
          title={t("wa.inbox.actions.spam")}
        >
          <ShieldAlert className="size-4 text-[var(--color-fg-muted)]" />
        </button>
        <div className="w-px h-5 bg-[var(--color-border)] mx-1" />
        <button
          onClick={onToggleContactPanel}
          className="size-8 flex items-center justify-center rounded-lg hover:bg-[var(--color-surface-2)] transition-colors"
          title={t("wa.inbox.actions.togglePanel")}
        >
          {showContactPanel ? (
            <PanelRightClose className="size-4 text-[var(--color-fg-muted)]" />
          ) : (
            <PanelRightOpen className="size-4 text-[var(--color-fg-muted)]" />
          )}
        </button>
      </div>
    </div>
  );
}
