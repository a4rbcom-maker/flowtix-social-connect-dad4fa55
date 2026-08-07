import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelativeTime, getInitials } from "@/lib/inbox-helpers";
import type { ConversationWithContact } from "@/types/wa-inbox.types";

interface ConversationItemProps {
  conv: ConversationWithContact;
  isActive: boolean;
  onClick: () => void;
}

export function ConversationItem({ conv, isActive, onClick }: ConversationItemProps) {
  const name = conv.contact?.push_name || conv.contact?.name || conv.contact?.phone || "—";
  const preview = conv.last_message_preview || "";

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-start p-3 border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-surface-2)]",
        isActive && "bg-[var(--color-primary)]/5 border-s-2 border-s-[var(--color-primary)]"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          {conv.contact?.avatar_url ? (
            <img src={conv.contact.avatar_url} alt="" className="size-11 rounded-full object-cover" />
          ) : (
            <div className="size-11 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center text-[var(--color-primary)] font-bold text-sm">
              {getInitials(conv.contact?.push_name || conv.contact?.name)}
            </div>
          )}
          {conv.contact?.is_vip && (
            <span className="absolute -bottom-0.5 -end-0.5 size-4 rounded-full bg-[var(--color-warning)] border-2 border-[var(--color-surface-1)]" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold truncate text-[var(--color-fg)]">{name}</span>
            <span className="text-[10px] text-[var(--color-fg-muted)] shrink-0">{formatRelativeTime(conv.last_message_at)}</span>
          </div>

          <div className="flex items-center justify-between gap-2 mt-0.5">
            <p className={cn(
              "text-xs truncate",
              conv.unread_count > 0 ? "text-[var(--color-fg)] font-medium" : "text-[var(--color-fg-muted)]"
            )}>
              {preview}
            </p>

            <div className="flex items-center gap-1.5 shrink-0">
              {conv.is_starred && <Star className="size-3 text-[var(--color-warning)] fill-[var(--color-warning)]" />}
              {conv.unread_count > 0 && (
                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[var(--color-primary)] text-white text-[10px] font-bold flex items-center justify-center">
                  {conv.unread_count > 99 ? "99+" : conv.unread_count}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}
