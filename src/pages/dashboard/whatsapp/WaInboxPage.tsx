import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Search, SendHorizontal, Star, Archive, ShieldAlert, CheckCircle2, StickyNote, Plus, Loader2, Paperclip, X, Image, FileVideo, FileAudio, File } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useWaConversations, useWaMessages, useWaInboxMutations } from "@/hooks/useWaInbox";
import { waInboxRepository } from "@/lib/wa-inbox";
import type { WaNote, WaMessage } from "@/types/wa-inbox.types";

interface MediaAttachment {
  file: File;
  previewUrl: string;
  type: "image" | "video" | "audio" | "document";
}

function formatTime(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function messageHasMedia(m: WaMessage): boolean {
  return !!(m.type && m.type !== "text" && m.type !== "buttons" && m.type !== "location" && m.type !== "contact");
}

function getMediaUrl(m: WaMessage): string | undefined {
  const meta = m.metadata as Record<string, unknown> | null;
  return (meta?.media_url as string) || (meta?.signed_url as string);
}

function getMediaMime(m: WaMessage): string | undefined {
  const meta = m.metadata as Record<string, unknown> | null;
  return (meta?.mime_type as string);
}

function getMediaFileName(m: WaMessage): string | undefined {
  const meta = m.metadata as Record<string, unknown> | null;
  return (meta?.file_name as string);
}

function guessMediaType(m: WaMessage): string {
  const mime = getMediaMime(m);
  if (m.type === "image" || mime?.startsWith("image/")) return "image";
  if (m.type === "video" || mime?.startsWith("video/")) return "video";
  if (m.type === "audio" || mime?.startsWith("audio/")) return "audio";
  return "document";
}

function getMediaTypeFromFile(file: File): "image" | "video" | "audio" | "document" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "document";
}

export function WaInboxPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<string>("open");
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [composerText, setComposerText] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [attachment, setAttachment] = useState<MediaAttachment | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filters: any = {};
  if (filter === "unread") filters.unread = true;
  else if (filter === "starred") filters.starred = true;
  else if (["open", "waiting", "resolved"].includes(filter)) filters.status = filter;

  const { data: conversations, isLoading } = useWaConversations(filters);
  const { data: messages } = useWaMessages(activeConvId ?? undefined);
  const muts = useWaInboxMutations();
  const [notes, setNotes] = useState<WaNote[]>([]);

  const activeConv = conversations?.find(c => c.id === activeConvId) ?? null;

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    if (!activeConvId) return;
    (async () => { try { const n = await waInboxRepository.getNotes(activeConvId); setNotes(n); } catch {} })();
  }, [activeConvId]);

  const handleSend = async () => {
    if ((!composerText.trim() && !attachment) || !activeConv) return;
    const text = composerText.trim() || undefined;

    let mediaUrl: string | undefined;
    let mediaType: string | undefined;
    let mimeType: string | undefined;
    let fileName: string | undefined;

    if (attachment) {
      setIsUploading(true);
      try {
        const uploaded = await waInboxRepository.uploadMedia(attachment.file);
        mediaUrl = uploaded.url;
        mimeType = uploaded.mimeType;
        fileName = uploaded.fileName;
        mediaType = attachment.type;
      } catch {
        setIsUploading(false);
        return;
      }
      setIsUploading(false);
    }

    muts.send.mutate({
      sessionId: activeConv.wa_session_id, conversationId: activeConv.id,
      workspaceId: activeConv.workspace_id!, contactJid: activeConv.contact?.jid || "",
      text, mediaType, mediaUrl, mimeType, fileName, caption: text,
    }, { onSuccess: () => { setComposerText(""); setAttachment(null); } });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const type = getMediaTypeFromFile(file);
    const previewUrl = URL.createObjectURL(file);
    setAttachment({ file, previewUrl, type });
    e.target.value = "";
  };

  const clearAttachment = () => {
    if (attachment) { URL.revokeObjectURL(attachment.previewUrl); setAttachment(null); }
  };

  const handleMarkRead = (id: string) => {
    setActiveConvId(id);
    muts.markRead.mutate(id);
  };

  return (
    <div className="flex h-[calc(100vh-180px)] sm:h-[calc(100vh-180px)] gap-0 border border-[var(--color-border)] rounded-xl overflow-hidden bg-[var(--color-bg)]">
      {/* LEFT: Conversation List */}
      <div className={cn(
        "shrink-0 border-e border-[var(--color-border)] flex flex-col bg-[var(--color-surface-1)] w-full sm:w-80",
        activeConvId ? "hidden sm:flex" : "flex"
      )}>
        <div className="p-3 border-b border-[var(--color-border)] space-y-2">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-[var(--color-fg-muted)]" />
            <input placeholder="بحث..." className="w-full ps-9 pe-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-sm" />
          </div>
          <div className="flex gap-1 overflow-x-auto -mx-1 px-1">
            {["open","unread","waiting","resolved","starred"].map(k => (
              <button key={k} onClick={() => setFilter(k)} className={cn("shrink-0 px-2.5 py-1 text-xs rounded-full transition-colors", filter === k ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]")}>{t(`wa.inbox.filters.${k}`)}</button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 m-2" />) :
            conversations?.length === 0 ? <p className="p-4 text-sm text-center text-[var(--color-fg-muted)]">{t("wa.inbox.empty.conversations")}</p> :
            conversations?.map(c => (
              <button key={c.id} onClick={() => handleMarkRead(c.id)} className={cn("w-full text-start p-3 border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-surface-2)]", activeConvId === c.id && "bg-[var(--color-primary)]/5 border-s-2 border-s-[var(--color-primary)]")}>
                <div className="flex items-start gap-3">
                  <div className="size-10 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center shrink-0 text-[var(--color-primary)] font-bold text-sm">{c.contact?.push_name?.[0] || c.contact?.name?.[0] || "?"}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold truncate">{c.contact?.push_name || c.contact?.name || c.contact?.phone || "—"}</span>
                      <span className="text-[10px] text-[var(--color-fg-muted)] shrink-0">{formatTime(c.last_message_at)}</span>
                    </div>
                    <p className="text-xs text-[var(--color-fg-muted)] truncate">{c.last_message_preview || ""}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {c.unread_count > 0 && <span className="size-5 rounded-full bg-[var(--color-primary)] text-white text-[10px] flex items-center justify-center">{c.unread_count}</span>}
                      {c.is_starred && <Star className="size-3 text-[var(--color-warning)]" />}
                    </div>
                  </div>
                </div>
              </button>
            ))
          }
        </div>
      </div>

      {/* MIDDLE: Chat */}
      <div className={cn(
        "flex-1 flex flex-col bg-[var(--color-bg)] min-w-0",
        activeConvId ? "flex" : "hidden sm:flex"
      )}>
        {!activeConv ? (
          <div className="flex-1 flex items-center justify-center text-[var(--color-fg-muted)] text-sm">{t("wa.inbox.empty.messages")}</div>
        ) : (
          <>
            <div className="p-3 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-surface-1)]">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center text-[var(--color-primary)] font-bold text-xs">{activeConv?.contact?.push_name?.[0] || "?"}</div>
                <div><p className="text-sm font-semibold">{activeConv?.contact?.push_name || activeConv?.contact?.phone || "—"}</p><p className="text-[10px] text-[var(--color-fg-muted)]">{activeConv?.contact?.phone}</p></div>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="size-7" onClick={() => muts.star.mutate({ id: activeConv.id, v: !activeConv.is_starred })}><Star className={cn("size-3.5", activeConv.is_starred && "fill-[var(--color-warning)] text-[var(--color-warning)]")} /></Button>
                <Button variant="ghost" size="icon" className="size-7" onClick={() => muts.archive.mutate({ id: activeConv.id, v: !activeConv.is_archived })}><Archive className="size-3.5" /></Button>
                <Button variant="ghost" size="icon" className="size-7" onClick={() => muts.spam.mutate({ id: activeConv.id, v: !activeConv.is_spam })}><ShieldAlert className="size-3.5" /></Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {(messages ?? []).map(m => {
                const isOut = m.direction === "outbound";
                const hasMedia = messageHasMedia(m);
                const mediaUrl = getMediaUrl(m);
                const mediaType = guessMediaType(m);
                const fileName = getMediaFileName(m);
                return (
                  <div key={m.id} className={cn("flex", isOut ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[70%] px-4 py-2 rounded-2xl text-sm", isOut ? "bg-[var(--color-primary)] text-white rounded-br-md" : "bg-[var(--color-surface-2)] text-[var(--color-fg)] rounded-bl-md")}>
                      {hasMedia && mediaUrl && (
                        <div className="mb-1 overflow-hidden rounded-lg">
                          {mediaType === "image" && <img src={mediaUrl} alt="" className="max-w-full max-h-60 object-cover rounded" />}
                          {mediaType === "video" && <video src={mediaUrl} controls className="max-w-full max-h-60 rounded" />}
                          {mediaType === "audio" && <audio src={mediaUrl} controls className="max-w-full h-10" />}
                          {mediaType === "document" && (
                            <a href={mediaUrl} target="_blank" rel="noopener noreferrer" className={cn("flex items-center gap-2 p-2 rounded", isOut ? "bg-white/10" : "bg-[var(--color-bg)]")}>
                              <File className="size-5 shrink-0" />
                              <span className="text-xs truncate">{fileName || "—"}</span>
                            </a>
                          )}
                        </div>
                      )}
                      {m.body && <p>{m.body}</p>}
                      <div className={cn("text-[10px] mt-1", isOut ? "text-white/60 text-end" : "text-[var(--color-fg-muted)]")}>{formatTime(m.created_at)} {isOut && "✓"}</div>
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>
            <div className="p-3 border-t border-[var(--color-border)] bg-[var(--color-surface-1)] space-y-2">
              {attachment && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)]">
                  {attachment.type === "image" && <Image className="size-5 text-[var(--color-primary)] shrink-0" />}
                  {attachment.type === "video" && <FileVideo className="size-5 text-[var(--color-primary)] shrink-0" />}
                  {attachment.type === "audio" && <FileAudio className="size-5 text-[var(--color-primary)] shrink-0" />}
                  {attachment.type === "document" && <File className="size-5 text-[var(--color-primary)] shrink-0" />}
                  <span className="text-xs truncate flex-1">{attachment.file.name}</span>
                  <button onClick={clearAttachment} className="shrink-0 p-0.5 rounded hover:bg-[var(--color-danger)]/10"><X className="size-4 text-[var(--color-fg-muted)]" /></button>
                </div>
              )}
              {attachment?.type === "image" && <img src={attachment.previewUrl} alt="" className="max-h-32 rounded-lg object-cover" />}
              <div className="flex gap-2">
                {!showNoteInput && (
                  <>
                    <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip" className="hidden" onChange={handleFileSelect} />
                    <Button size="icon" variant="ghost" className="size-9 rounded-xl shrink-0" title={t("wa.inbox.composer.attach")} onClick={() => fileInputRef.current?.click()}><Paperclip className="size-4" /></Button>
                  </>
                )}
                <input value={composerText} onChange={e => setComposerText(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSend()}
                  placeholder={showNoteInput ? t("wa.inbox.composer.notePlaceholder") : t("wa.inbox.composer.placeholder")}
                  className={cn("flex-1 rounded-xl border px-4 py-2 text-sm bg-[var(--color-bg)]", showNoteInput ? "border-[var(--color-warning)] bg-[var(--color-warning)]/5" : "border-[var(--color-border)]")} />
                <Button size="icon" className="size-9 rounded-xl shrink-0" variant="ghost" onClick={() => setShowNoteInput(!showNoteInput)}><StickyNote className={cn("size-4", showNoteInput && "text-[var(--color-warning)]")} /></Button>
                {showNoteInput ? (
                  <Button size="icon" className="size-9 rounded-xl shrink-0 bg-[var(--color-warning)] hover:bg-[var(--color-warning)]/80" onClick={() => {
                    if (composerText.trim() && activeConvId && activeConv) {
                      muts.addNote.mutate({ conversationId: activeConvId, workspaceId: activeConv.workspace_id!, userId: "", body: composerText.trim() }, { onSuccess: () => { setComposerText(""); setShowNoteInput(false); } });
                    }
                  }}><Plus className="size-4" /></Button>
                ) : (
                  <Button size="icon" className="size-9 rounded-xl shrink-0" onClick={handleSend} disabled={(!composerText.trim() && !attachment) || muts.send.isPending || isUploading}>{muts.send.isPending || isUploading ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}</Button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* RIGHT: Contact Panel */}
      {activeConv && (
        <div className="w-full sm:w-72 shrink-0 border-s border-[var(--color-border)] bg-[var(--color-surface-1)] p-4 space-y-4 overflow-y-auto">
          <div className="text-center">
            <div className="size-16 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center mx-auto mb-2 text-[var(--color-primary)] font-bold text-xl">{activeConv?.contact?.push_name?.[0] || "?"}</div>
            <p className="font-semibold text-sm">{activeConv?.contact?.push_name || "—"}</p>
            <p className="text-xs text-[var(--color-fg-muted)]">{activeConv?.contact?.phone}</p>
          </div>
          <div className="flex flex-wrap gap-1">
            <Button variant="outline" size="sm" className="text-[10px] h-7" onClick={() => muts.star.mutate({ id: activeConv.id, v: !activeConv.is_starred })}><Star className="size-3" /></Button>
            <Button variant="outline" size="sm" className="text-[10px] h-7" onClick={() => muts.archive.mutate({ id: activeConv.id, v: !activeConv.is_archived })}><Archive className="size-3" /></Button>
            <Button variant="outline" size="sm" className="text-[10px] h-7" onClick={() => muts.spam.mutate({ id: activeConv.id, v: !activeConv.is_spam })}><ShieldAlert className="size-3" /></Button>
            <Button variant="outline" size="sm" className="text-[10px] h-7" onClick={() => muts.setStatus.mutate({ id: activeConv.id, status: activeConv.status === "open" ? "resolved" : "open" })}><CheckCircle2 className="size-3" /></Button>
          </div>
          <div>
            <p className="text-xs font-semibold text-[var(--color-fg-muted)] mb-2">{t("wa.inbox.contact.notes")}</p>
            {notes.map(n => <p key={n.id} className="text-xs text-[var(--color-fg-muted)] bg-[var(--color-warning)]/5 border border-[var(--color-warning)]/20 rounded-lg p-2 mb-1">{n.body}</p>)}
          </div>
        </div>
      )}
    </div>
  );
}
