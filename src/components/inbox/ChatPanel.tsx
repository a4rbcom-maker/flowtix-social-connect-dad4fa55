import { Search, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { EmptyState } from "./EmptyStates";
import type { ConversationWithContact, WaMessage } from "@/types/wa-inbox.types";
import type { SendInput } from "@/types/inbox.types";

interface ChatPanelProps {
  conv: ConversationWithContact | null;
  messages: WaMessage[];
  isLoading: boolean;
  draftText: string;
  onDraftChange: (text: string) => void;
  quotedMessage: WaMessage | null;
  onCancelQuote: () => void;
  onSend: (input: SendInput) => void;
  onStar: (v: boolean) => void;
  onArchive: (v: boolean) => void;
  onToggleContactPanel: () => void;
  onQuoteMessage: (msg: WaMessage) => void;
  sendIsPending: boolean;
  onContactTagToggle?: (tag: string) => void;
}

export function ChatPanel({
  conv,
  messages,
  isLoading: _isLoading,
  draftText,
  onDraftChange,
  quotedMessage,
  onCancelQuote,
  onSend,
  onStar,
  onArchive,
  onToggleContactPanel,
  onQuoteMessage,
  sendIsPending,
}: ChatPanelProps) {
  const { t } = useTranslation();
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  if (!conv) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState variant="no-msg" />
      </div>
    );
  }

  return (
    <>
      <ChatHeader
        conv={conv}
        onStar={onStar}
        onArchive={onArchive}
        onSpam={() => {}}
        onToggleContactPanel={onToggleContactPanel}
        showContactPanel={false}
      />

      {showSearch && (
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5 bg-[var(--color-surface-1)]">
          <Search className="size-4 text-[var(--color-fg-muted)] shrink-0" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("wa.inbox.searchInConversation")}
            className="flex-1 text-sm bg-transparent border-none outline-none text-[var(--color-fg)] placeholder:text-[var(--color-fg-muted)]"
            autoFocus
          />
          <button
            onClick={() => { setShowSearch(false); setSearchQuery(""); }}
            className="size-6 flex items-center justify-center rounded hover:bg-[var(--color-surface-2)]"
          >
            <X className="size-3.5 text-[var(--color-fg-muted)]" />
          </button>
        </div>
      )}

      <MessageList
        messages={messages}
        searchQuery={searchQuery}
        onCopyMessage={() => {}}
        onQuoteMessage={(msg) => { onQuoteMessage(msg); setShowSearch(false); }}
        onResendMessage={() => {}}
      />

      {quotedMessage && (
        <div className="border-t border-[var(--color-border)] px-4 py-2 bg-[var(--color-surface-2)] flex items-center gap-2">
          <div className="w-1 h-8 rounded-full bg-[var(--color-primary)] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-[var(--color-primary)] font-medium">{t("wa.inbox.quoting")}</p>
            <p className="text-xs text-[var(--color-fg-muted)] truncate">{quotedMessage.body || t("wa.inbox.message.media")}</p>
          </div>
          <button onClick={onCancelQuote} className="size-6 flex items-center justify-center rounded hover:bg-[var(--color-surface-3)]">
            <X className="size-3.5 text-[var(--color-fg-muted)]" />
          </button>
        </div>
      )}

      <Composer
        onSend={onSend}
        draftText={draftText}
        onDraftChange={onDraftChange}
        disabled={sendIsPending}
        contextMessages={messages.slice(-5)}
      />
    </>
  );
}
