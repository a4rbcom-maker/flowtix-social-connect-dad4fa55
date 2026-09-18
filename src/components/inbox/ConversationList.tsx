import { Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { ConversationItem } from "./ConversationItem";
import { EmptyState } from "./EmptyStates";
import type { ConversationWithContact } from "@/types/wa-inbox.types";
import type { ConvFilter } from "@/types/inbox.types";

interface ConversationListProps {
  conversations: ConversationWithContact[];
  activeConvId: string | null;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  filter: ConvFilter;
  onFilterChange: (f: ConvFilter) => void;
  onSelectConv: (id: string) => void;
  isLoading: boolean;
}

export function ConversationList({
  conversations,
  activeConvId,
  searchQuery,
  onSearchChange,
  filter,
  onFilterChange,
  onSelectConv,
  isLoading,
}: ConversationListProps) {
  const { t } = useTranslation();

  const filters: { key: ConvFilter; label: string }[] = [
    { key: "all", label: t("wa.inbox.filters.all") },
    { key: "unread", label: t("wa.inbox.filters.unread") },
    { key: "starred", label: t("wa.inbox.filters.starred") },
    { key: "archived", label: t("wa.inbox.filters.archived") },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--color-border)] p-3 space-y-2.5 bg-[var(--color-surface-1)]">
        <div className="relative">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-[var(--color-fg-muted)]" />
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("wa.inbox.searchPlaceholder")}
            className="w-full ps-9 pe-3 py-2.5 rounded-full border border-transparent bg-[var(--color-surface-2)] text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-muted)] focus:outline-none focus:bg-[var(--color-bg)] focus:border-[var(--color-primary)] transition-colors"
          />
        </div>

        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => onFilterChange(f.key)}
              className={cn(
                "shrink-0 px-3.5 py-1.5 text-xs font-semibold rounded-full transition-all",
                filter === f.key
                  ? "bg-[#25d366] text-white shadow-sm"
                  : "bg-[var(--color-surface-2)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-3)]"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-[var(--color-bg)]">
        {isLoading ? (
          <div className="p-2 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-2.5 animate-pulse">
                <div className="size-12 rounded-full bg-[var(--color-surface-2)]" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-2/3 rounded bg-[var(--color-surface-2)]" />
                  <div className="h-3 w-4/5 rounded bg-[var(--color-surface-2)]" />
                </div>
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <EmptyState variant="no-conv" />
        ) : (
          conversations.map((c) => (
            <ConversationItem
              key={c.id}
              conv={c}
              isActive={c.id === activeConvId}
              onClick={() => onSelectConv(c.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
