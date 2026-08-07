import { Star, Archive, CheckCircle2, X, StickyNote, Tag } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { getInitials, formatRelativeTime } from "@/lib/inbox-helpers";
import type { ConversationWithContact, WaNote } from "@/types/wa-inbox.types";

interface ContactPanelProps {
  conv: ConversationWithContact;
  notes: WaNote[];
  onAddNote: (body: string) => void;
  onToggleStatus: () => void;
  onClose: () => void;
  onStar: (v: boolean) => void;
  onArchive: (v: boolean) => void;
}

export function ContactPanel({
  conv,
  notes,
  onAddNote,
  onToggleStatus,
  onClose,
  onStar,
  onArchive,
}: ContactPanelProps) {
  const { t } = useTranslation();
  const [noteText, setNoteText] = useState("");
  const contact = conv.contact;
  const name = contact?.push_name || contact?.name || contact?.phone || "—";

  const handleAddNote = () => {
    if (!noteText.trim()) return;
    onAddNote(noteText.trim());
    setNoteText("");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] p-3">
        <p className="text-sm font-semibold text-[var(--color-fg)]">{t("wa.inbox.contact.title")}</p>
        <button onClick={onClose} className="size-7 flex items-center justify-center rounded-lg hover:bg-[var(--color-surface-2)] lg:hidden">
          <X className="size-4 text-[var(--color-fg-muted)]" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <div className="text-center">
          {contact?.avatar_url ? (
            <img src={contact.avatar_url} alt="" className="size-20 rounded-full object-cover mx-auto mb-2" />
          ) : (
            <div className="size-20 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center mx-auto mb-2 text-[var(--color-primary)] font-bold text-2xl">
              {getInitials(contact?.push_name || contact?.name)}
            </div>
          )}
          <p className="font-semibold text-sm text-[var(--color-fg)]">{name}</p>
          {contact?.phone && <p className="text-xs text-[var(--color-fg-muted)] mt-0.5" dir="ltr">{contact.phone}</p>}
          {contact?.company && <p className="text-xs text-[var(--color-fg-muted)] mt-0.5">{contact.company}</p>}
        </div>

        <div className="flex gap-1.5 justify-center flex-wrap">
          <button
            onClick={() => onStar(!conv.is_starred)}
            className={cn("size-8 flex items-center justify-center rounded-lg border transition-colors", conv.is_starred ? "border-[var(--color-warning)] bg-[var(--color-warning)]/10" : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]")}
          >
            <Star className={cn("size-3.5", conv.is_starred ? "fill-[var(--color-warning)] text-[var(--color-warning)]" : "text-[var(--color-fg-muted)]")} />
          </button>
          <button
            onClick={() => onArchive(!conv.is_archived)}
            className="size-8 flex items-center justify-center rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] transition-colors"
          >
            <Archive className="size-3.5 text-[var(--color-fg-muted)]" />
          </button>
          <button
            onClick={onToggleStatus}
            className={cn("size-8 flex items-center justify-center rounded-lg border transition-colors", conv.status === "resolved" ? "border-green-500 bg-green-500/10" : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]")}
          >
            <CheckCircle2 className={cn("size-3.5", conv.status === "resolved" ? "text-green-500" : "text-[var(--color-fg-muted)]")} />
          </button>
        </div>

        {contact?.tags && contact.tags.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-[var(--color-fg-muted)] mb-1.5 flex items-center gap-1.5">
              <Tag className="size-3" /> {t("wa.inbox.contact.tags")}
            </p>
            <div className="flex flex-wrap gap-1">
              {contact.tags.map((tag, i) => (
                <span key={i} className="px-2 py-0.5 text-[10px] rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]">{tag}</span>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1.5 text-xs">
          {contact?.message_count !== undefined && (
            <div className="flex justify-between">
              <span className="text-[var(--color-fg-muted)]">{t("wa.inbox.contact.messageCount")}</span>
              <span className="font-medium text-[var(--color-fg)]">{contact.message_count}</span>
            </div>
          )}
          {contact?.last_seen && (
            <div className="flex justify-between">
              <span className="text-[var(--color-fg-muted)]">{t("wa.inbox.contact.lastSeen")}</span>
              <span className="font-medium text-[var(--color-fg)]">{formatRelativeTime(contact.last_seen)}</span>
            </div>
          )}
          {contact?.created_at && (
            <div className="flex justify-between">
              <span className="text-[var(--color-fg-muted)]">{t("wa.inbox.contact.firstContact")}</span>
              <span className="font-medium text-[var(--color-fg)]">{formatRelativeTime(contact.created_at)}</span>
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <StickyNote className="size-3.5 text-[var(--color-warning)]" />
            <p className="text-xs font-semibold text-[var(--color-fg-muted)]">{t("wa.inbox.contact.notes")}</p>
          </div>
          <div className="space-y-1.5 mb-2 max-h-48 overflow-y-auto">
            {notes.length === 0 ? (
              <p className="text-xs text-[var(--color-fg-muted)] italic">{t("wa.inbox.contact.noNotes")}</p>
            ) : (
              notes.map((n) => (
                <div key={n.id} className="p-2 rounded-lg bg-[var(--color-warning)]/5 border border-[var(--color-warning)]/20">
                  <p className="text-xs text-[var(--color-fg)]">{n.body}</p>
                  <p className="text-[10px] text-[var(--color-fg-muted)] mt-1">{formatRelativeTime(n.created_at)}</p>
                </div>
              ))
            )}
          </div>
          <div className="flex gap-1.5">
            <input
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddNote()}
              placeholder={t("wa.inbox.contact.notePlaceholder")}
              className="flex-1 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-[var(--color-fg)] placeholder:text-[var(--color-fg-muted)] focus:outline-none focus:border-[var(--color-primary)]"
            />
            <button
              onClick={handleAddNote}
              disabled={!noteText.trim()}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-primary)] text-white disabled:opacity-40 hover:bg-[var(--color-primary)]/80 transition-colors"
            >
              {t("wa.inbox.contact.add")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
