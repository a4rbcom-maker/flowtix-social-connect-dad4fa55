import { Copy, Reply, RotateCw, Download, Check, CheckCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  formatTime,
  messageHasMedia,
  getMediaUrl,
  getMediaFileName,
  guessMediaType,
} from "@/lib/inbox-helpers";
import type { WaMessage } from "@/types/wa-inbox.types";

interface MessageBubbleProps {
  message: WaMessage;
  isHighlighted?: boolean;
  onCopy: () => void;
  onQuote: () => void;
  onResend: () => void;
}

export function MessageBubble({
  message,
  isHighlighted,
  onCopy,
  onQuote,
  onResend,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const { t } = useTranslation();
  const isOut = message.direction === "outbound";
  const hasMedia = messageHasMedia(message);
  const mediaUrl = getMediaUrl(message);
  const mediaType = guessMediaType(message);
  const fileName = getMediaFileName(message);

  const handleCopy = () => {
    if (message.body) {
      navigator.clipboard.writeText(message.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
    onCopy();
  };

  const renderStatusIcon = () => {
    if (!isOut) return null;
    if (message.status === "pending") return <span className="size-3 rounded-full border border-current opacity-50" />;
    if (message.status === "sent") return <Check className="size-3.5 inline" />;
    if (message.status === "delivered") return <CheckCheck className="size-3.5 inline" />;
    if (message.status === "read") return <CheckCheck className="size-3.5 inline text-blue-300" />;
    if (message.status === "failed") return <span className="text-red-300 text-[10px]">!</span>;
    return null;
  };

  return (
    <div className={cn("group flex px-1", isOut ? "justify-end" : "justify-start", isHighlighted && "bg-[var(--color-primary)]/5 -mx-1 px-2 rounded-lg")}>
      <div className={cn("relative max-w-[75%] sm:max-w-[65%]", isOut ? "items-end" : "items-start")}>
        <div className={cn(
          "px-3.5 py-2 rounded-2xl text-sm",
          isOut
            ? "bg-[var(--color-primary)] text-white rounded-ee-md"
            : "bg-[var(--color-surface-2)] text-[var(--color-fg)] rounded-es-md"
        )}>
          {hasMedia && mediaUrl && (
            <div className="mb-1.5 overflow-hidden rounded-lg">
              {mediaType === "image" && <img src={mediaUrl} alt="" className="max-w-full max-h-60 object-cover rounded" />}
              {mediaType === "video" && <video src={mediaUrl} controls className="max-w-full max-h-60 rounded" />}
              {mediaType === "audio" && <audio src={mediaUrl} controls className="max-w-full h-9" />}
              {mediaType === "document" && (
                <a
                  href={mediaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={fileName}
                  className={cn("flex items-center gap-2 p-2.5 rounded-lg", isOut ? "bg-white/10 hover:bg-white/15" : "bg-[var(--color-bg)] hover:bg-[var(--color-surface-3)]")}
                >
                  <Download className="size-5 shrink-0" />
                  <span className="text-xs truncate">{fileName || t("wa.inbox.message.file")}</span>
                </a>
              )}
            </div>
          )}

          {message.body && <p className="whitespace-pre-wrap break-words leading-relaxed">{message.body}</p>}

          <div className={cn("flex items-center gap-1 mt-0.5", isOut ? "text-white/50 justify-end" : "text-[var(--color-fg-muted)]")}>
            <span className="text-[10px]">{formatTime(message.created_at)}</span>
            {renderStatusIcon()}
          </div>
        </div>

        <div className={cn(
          "absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 bg-[var(--color-surface-2)] rounded-lg border border-[var(--color-border)] p-0.5 shadow-sm",
          isOut ? "start-0 -translate-x-full -ms-1" : "end-0 translate-x-full me-1"
        )}>
          <button onClick={handleCopy} className="size-6 flex items-center justify-center rounded hover:bg-[var(--color-surface-3)]" title="نسخ">
            {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3 text-[var(--color-fg-muted)]" />}
          </button>
          <button onClick={onQuote} className="size-6 flex items-center justify-center rounded hover:bg-[var(--color-surface-3)]" title="اقتباس">
            <Reply className="size-3 text-[var(--color-fg-muted)]" />
          </button>
          {message.status === "failed" && (
            <button onClick={onResend} className="size-6 flex items-center justify-center rounded hover:bg-[var(--color-surface-3)]" title="إعادة إرسال">
              <RotateCw className="size-3 text-[var(--color-fg-muted)]" />
            </button>
          )}
          {hasMedia && mediaUrl && (
            <a href={mediaUrl} target="_blank" rel="noopener noreferrer" download={fileName} className="size-6 flex items-center justify-center rounded hover:bg-[var(--color-surface-3)]" title="تنزيل">
              <Download className="size-3 text-[var(--color-fg-muted)]" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
