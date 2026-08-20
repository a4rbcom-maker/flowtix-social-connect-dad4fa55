import { useState, useCallback } from "react";
import { useWaConversations, useWaMessages, useWaInboxMutations, useWaNotes } from "@/hooks/useWaInbox";
import { waInboxRepository } from "@/lib/wa-inbox";
import { useAuth } from "@/lib/authProvider";
import type { WaMessage } from "@/types/wa-inbox.types";
import type { ConvFilter, SendInput } from "@/types/inbox.types";
import { ConversationList } from "@/components/inbox/ConversationList";
import { ChatPanel } from "@/components/inbox/ChatPanel";
import { ContactPanel } from "@/components/inbox/ContactPanel";

export function WaInboxPage() {
  const { session: authSession } = useAuth();
  const [filter, setFilter] = useState<ConvFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [showContactPanel, setShowContactPanel] = useState(false);
  const [quotedMessage, setQuotedMessage] = useState<WaMessage | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const repoFilters = (() => {
    const f: Record<string, unknown> = {};
    if (filter === "unread") f.unread = true;
    else if (filter === "starred") f.starred = true;
    else if (filter === "archived") f.archived = true;
    return f;
  })();

  const { data: conversations, isLoading: convsLoading } = useWaConversations(repoFilters);
  const { data: messages, isLoading: msgsLoading } = useWaMessages(activeConvId ?? undefined);
  const { data: notes } = useWaNotes(activeConvId);
  const muts = useWaInboxMutations();

  const activeConv = conversations?.find((c) => c.id === activeConvId) ?? null;

  const handleSelectConv = useCallback((id: string) => {
    setActiveConvId(id);
    muts.markRead.mutate(id);
    setQuotedMessage(null);
  }, [muts]);

  const handleSend = useCallback(async (input: SendInput) => {
    if (!activeConv) return;

    const text = input.text?.trim() || undefined;
    if (!text && !input.attachment) return;

    let mediaUrl: string | undefined;
    let mediaType: string | undefined;
    let mimeType: string | undefined;
    let fileName: string | undefined;

    if (input.attachment) {
      const file = input.attachment.file as File;
      const uploaded = await waInboxRepository.uploadMedia(file, activeConv.workspace_id ?? undefined);
      mediaUrl = uploaded.url;
      mimeType = uploaded.mimeType;
      fileName = uploaded.fileName;
      mediaType = input.attachment.type;
      if (input.attachment.previewUrl) URL.revokeObjectURL(input.attachment.previewUrl);
    }

    muts.send.mutate({
      sessionId: activeConv.wa_session_id,
      conversationId: activeConv.id,
      workspaceId: activeConv.workspace_id!,
      contactJid: activeConv.contact?.jid || "",
      text, mediaType, mediaUrl, mimeType, fileName, caption: text,
    }, {
      onSuccess: () => {
        setDrafts(prev => { const n = { ...prev }; delete n[activeConv.id]; return n; });
        setQuotedMessage(null);
      },
    });
  }, [activeConv, muts]);

  const handleAddNote = useCallback((body: string) => {
    if (!activeConvId || !activeConv || !body.trim()) return;
    muts.addNote.mutate({
      conversationId: activeConvId,
      workspaceId: activeConv.workspace_id!,
      userId: authSession?.user?.id || "",
      body: body.trim(),
    });
  }, [activeConvId, activeConv, muts, authSession]);

  const draftText = activeConvId ? (drafts[activeConvId] ?? "") : "";
  const setDraftText = useCallback((text: string) => {
    if (!activeConvId) return;
    setDrafts(prev => ({ ...prev, [activeConvId]: text }));
  }, [activeConvId]);

  const filteredConversations = (() => {
    if (!conversations) return [];
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.trim().toLowerCase();
    return conversations.filter(c =>
      (c.contact?.push_name?.toLowerCase().includes(q)) ||
      (c.contact?.name?.toLowerCase().includes(q)) ||
      (c.contact?.phone?.includes(q)) ||
      (c.last_message_preview?.toLowerCase().includes(q))
    );
  })();

  return (
    <div className="flex h-[calc(100vh-180px)] gap-0 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)]">
      <div className={`shrink-0 border-e border-[var(--color-border)] bg-[var(--color-surface-1)] w-full sm:w-80 lg:w-96 flex-col ${activeConvId ? "hidden sm:flex" : "flex"}`}>
        <ConversationList
          conversations={filteredConversations}
          activeConvId={activeConvId}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          filter={filter}
          onFilterChange={setFilter}
          onSelectConv={handleSelectConv}
          isLoading={convsLoading}
        />
      </div>

      <div className={`flex-1 flex-col bg-[var(--color-bg)] min-w-0 ${activeConvId ? "flex" : "hidden sm:flex"}`}>
        <ChatPanel
          conv={activeConv}
          messages={messages ?? []}
          isLoading={msgsLoading}
          draftText={draftText}
          onDraftChange={setDraftText}
          quotedMessage={quotedMessage}
          onCancelQuote={() => setQuotedMessage(null)}
          onSend={handleSend}
          onStar={(v) => activeConv && muts.star.mutate({ id: activeConv.id, v })}
          onArchive={(v) => activeConv && muts.archive.mutate({ id: activeConv.id, v })}
          onToggleContactPanel={() => setShowContactPanel(v => !v)}
          onQuoteMessage={(msg) => setQuotedMessage(msg)}
          sendIsPending={muts.send.isPending}
          onContactTagToggle={() => {}}
        />
      </div>

      <div className={`${showContactPanel ? "block" : "hidden"} w-full lg:w-80 shrink-0 border-s border-[var(--color-border)] bg-[var(--color-surface-1)] overflow-y-auto`}>
        {activeConv && (
          <ContactPanel
            conv={activeConv}
            notes={notes ?? []}
            onAddNote={handleAddNote}
            onToggleStatus={() => muts.setStatus.mutate({ id: activeConv.id, status: activeConv.status === "open" ? "resolved" : "open" })}
            onClose={() => setShowContactPanel(false)}
            onStar={(v) => muts.star.mutate({ id: activeConv.id, v })}
            onArchive={(v) => muts.archive.mutate({ id: activeConv.id, v })}
          />
        )}
      </div>
    </div>
  );
}
