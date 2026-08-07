import { useState, useRef, useCallback } from "react";
import { Smile, Paperclip, X, Image as ImageIcon, FileVideo, FileAudio, File, SendHorizontal, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import EmojiPicker, { Theme } from "emoji-picker-react";
import { cn } from "@/lib/utils";
import { getMediaTypeFromFile, validateMediaSize } from "@/lib/inbox-helpers";
import type { SendInput, MediaAttachment } from "@/types/inbox.types";
import type { WaMessage } from "@/types/wa-inbox.types";

interface ComposerProps {
  onSend: (input: SendInput) => void;
  disabled?: boolean;
  draftText: string;
  onDraftChange: (text: string) => void;
  contextMessages?: WaMessage[];
}

export function Composer({ onSend, disabled, draftText, onDraftChange }: ComposerProps) {
  const { t } = useTranslation();
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [attachment, setAttachment] = useState<MediaAttachment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    if ((!draftText.trim() && !attachment) || disabled) return;
    onSend({ text: draftText.trim() || undefined, attachment: attachment ?? undefined });
    setAttachment(null);
    setError(null);
  }, [draftText, attachment, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = (file: File) => {
    const validation = validateMediaSize(file);
    if (!validation.valid) {
      setError(validation.error!);
      return;
    }
    const type = getMediaTypeFromFile(file);
    const previewUrl = URL.createObjectURL(file);
    setAttachment({ file, previewUrl, type, size: file.size });
    setError(null);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
    e.target.value = "";
    setShowAttachMenu(false);
  };

  const clearAttachment = () => {
    if (attachment) URL.revokeObjectURL(attachment.previewUrl);
    setAttachment(null);
  };

  const onEmojiClick = (emojiData: { emoji: string }) => {
    const cursor = textareaRef.current?.selectionStart ?? draftText.length;
    const newText = draftText.slice(0, cursor) + emojiData.emoji + draftText.slice(cursor);
    onDraftChange(newText);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.selectionStart = cursor + emojiData.emoji.length;
        textareaRef.current.selectionEnd = cursor + emojiData.emoji.length;
      }
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  };

  return (
    <div
      className="relative border-t border-[var(--color-border)] bg-[var(--color-surface-1)] p-3"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--color-primary)]/10 border-2 border-dashed border-[var(--color-primary)] rounded-xl m-2 pointer-events-none">
          <p className="text-sm font-medium text-[var(--color-primary)]">{t("wa.inbox.composer.dropHere")}</p>
        </div>
      )}

      {error && (
        <div className="mb-2 px-3 py-1.5 rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)] text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}><X className="size-3.5" /></button>
        </div>
      )}

      {showEmoji && (
        <div className="absolute bottom-full start-0 mb-2 z-30 shadow-[var(--shadow-xl)] rounded-xl overflow-hidden">
          <EmojiPicker onEmojiClick={onEmojiClick} width={320} height={400} theme={Theme.DARK} searchPlaceHolder={t("wa.inbox.composer.searchEmoji")} />
        </div>
      )}

      {attachment && (
        <div className="mb-2 flex items-center gap-2 p-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)]">
          {attachment.type === "image" && <ImageIcon className="size-5 text-[var(--color-primary)] shrink-0" />}
          {attachment.type === "video" && <FileVideo className="size-5 text-[var(--color-primary)] shrink-0" />}
          {attachment.type === "audio" && <FileAudio className="size-5 text-[var(--color-primary)] shrink-0" />}
          {attachment.type === "document" && <File className="size-5 text-[var(--color-primary)] shrink-0" />}
          <span className="text-xs truncate flex-1">
            {attachment.file instanceof File ? (attachment.file as File).name : t("wa.inbox.composer.recording")}
          </span>
          <button onClick={clearAttachment} className="shrink-0 size-5 flex items-center justify-center rounded hover:bg-[var(--color-danger)]/10">
            <X className="size-4 text-[var(--color-fg-muted)]" />
          </button>
        </div>
      )}

      {attachment?.type === "image" && (
        <img src={attachment.previewUrl} alt="" className="mb-2 max-h-32 rounded-lg object-cover" />
      )}

      <div className="flex items-end gap-1.5">
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => { setShowEmoji(v => !v); setShowAttachMenu(false); }}
            className={cn("size-9 flex items-center justify-center rounded-xl transition-colors", showEmoji ? "bg-[var(--color-surface-2)] text-[var(--color-primary)]" : "text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)]")}
            title={t("wa.inbox.composer.emoji")}
          >
            <Smile className="size-5" />
          </button>

          <div className="relative">
            <button
              onClick={() => { setShowAttachMenu(v => !v); setShowEmoji(false); }}
              className={cn("size-9 flex items-center justify-center rounded-xl transition-colors", showAttachMenu ? "bg-[var(--color-surface-2)] text-[var(--color-primary)]" : "text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)]")}
              title={t("wa.inbox.composer.attach")}
            >
              <Paperclip className="size-5" />
            </button>

            {showAttachMenu && (
              <div className="absolute bottom-full start-0 mb-2 z-30 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-xl shadow-[var(--shadow-lg)] p-1.5 min-w-[180px]">
                {[
                  { label: t("wa.inbox.composer.image"), icon: ImageIcon, accept: "image/*" },
                  { label: t("wa.inbox.composer.video"), icon: FileVideo, accept: "video/*" },
                  { label: t("wa.inbox.composer.audio"), icon: FileAudio, accept: "audio/*" },
                  { label: t("wa.inbox.composer.document"), icon: File, accept: ".pdf,.doc,.docx,.xls,.xlsx,.txt,.zip" },
                ].map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => {
                      if (fileInputRef.current) {
                        fileInputRef.current.accept = opt.accept;
                        fileInputRef.current.click();
                      }
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm hover:bg-[var(--color-surface-2)] transition-colors text-[var(--color-fg)]"
                  >
                    <opt.icon className="size-4 text-[var(--color-fg-muted)]" />
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <input ref={fileInputRef} type="file" className="hidden" onChange={onInputChange} />

        <textarea
          ref={textareaRef}
          value={draftText}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("wa.inbox.composer.placeholder")}
          rows={1}
          className="flex-1 resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2.5 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-muted)] focus:outline-none focus:border-[var(--color-primary)] transition-colors max-h-32"
          style={{ minHeight: "42px" }}
        />

        <button
          onClick={handleSend}
          disabled={(!draftText.trim() && !attachment) || disabled}
          className="size-9 shrink-0 flex items-center justify-center rounded-xl bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary)]/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {disabled ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
        </button>
      </div>
    </div>
  );
}
