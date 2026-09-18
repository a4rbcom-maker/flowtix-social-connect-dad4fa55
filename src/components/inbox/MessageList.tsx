import { useRef, useEffect, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatDateSeparator } from "@/lib/inbox-helpers";
import { MessageBubble } from "./MessageBubble";
import type { WaMessage } from "@/types/wa-inbox.types";

interface MessageListProps {
  messages: WaMessage[];
  searchQuery?: string;
  onCopyMessage: (msg: WaMessage) => void;
  onQuoteMessage: (msg: WaMessage) => void;
  onResendMessage: (msg: WaMessage) => void;
}

interface RenderItem {
  type: "message" | "separator";
  message?: WaMessage;
  dateKey?: string;
  label?: string;
}

function buildRenderItems(messages: WaMessage[]): RenderItem[] {
  const items: RenderItem[] = [];
  let lastDate = "";

  for (const msg of messages) {
    const dateStr = new Date(msg.created_at).toDateString();
    if (dateStr !== lastDate) {
      items.push({ type: "separator", dateKey: dateStr, label: formatDateSeparator(msg.created_at) });
      lastDate = dateStr;
    }
    items.push({ type: "message", message: msg });
  }

  return items;
}

export function MessageList({
  messages,
  searchQuery = "",
  onCopyMessage,
  onQuoteMessage,
  onResendMessage,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const items = buildRenderItems(messages);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => {
      const item = items[i];
      if (item.type === "separator") return 36;
      const msg = item.message!;
      if (msg.metadata && typeof msg.metadata === "object" && "media_url" in (msg.metadata as Record<string, unknown>)) return 220;
      return 56;
    },
    overscan: 8,
  });

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  const searchLower = searchQuery.trim().toLowerCase();
  const isMatch = (msg: WaMessage): boolean =>
    Boolean(searchLower && msg.body?.toLowerCase().includes(searchLower));

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-[var(--color-fg-muted)]">لا توجد رسائل بعد</p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5 scroll-smooth"
      style={{ backgroundColor: "#efeae2", backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260' viewBox='0 0 260 260'%3E%3Cg fill='%23dcd5c9' fill-opacity='0.35'%3E%3Cpath d='M-40 30c20-14 44-14 64 0s44 14 64 0 44-14 64 0 44 14 64 0 44-14 64 0v-30H-40z'/%3E%3Cpath d='M-40 190c20-14 44-14 64 0s44 14 64 0 44-14 64 0-44 14-64 0-44 14-64 0z'/%3E%3Ccircle cx='30' cy='110' r='3'/%3E%3Ccircle cx='150' cy='70' r='2.5'/%3E%3Ccircle cx='90' cy='150' r='2'/%3E%3Ccircle cx='210' cy='130' r='3'/%3E%3Ccircle cx='250' cy='40' r='2'/%3E%3Ccircle cx='70' cy='220' r='2.5'/%3E%3Ccircle cx='190' cy='210' r='2'/%3E%3C/g%3E%3C/svg%3E\")" }}
    >
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative", width: "100%" }}>
        {virtualizer.getVirtualItems().map((vItem) => {
          const item = items[vItem.index];
          if (item.type === "separator") {
            return (
              <div
                key={`sep-${item.dateKey}`}
                className="absolute left-0 right-0 flex justify-center"
                style={{ height: `${vItem.size}px`, transform: `translateY(${vItem.start}px)` }}
              >
                <span className="px-3 py-1 text-[10px] font-medium text-[var(--color-fg-muted)] bg-[var(--color-surface-2)] rounded-full">
                  {item.label}
                </span>
              </div>
            );
          }

          const msg = item.message!;
          return (
            <div
              key={msg.id}
              className="absolute left-0 right-0 py-0.5"
              style={{ height: `${vItem.size}px`, transform: `translateY(${vItem.start}px)` }}
            >
              <MessageBubble
                message={msg}
                isHighlighted={searchLower ? isMatch(msg) : undefined}
                onCopy={() => onCopyMessage(msg)}
                onQuote={() => onQuoteMessage(msg)}
                onResend={() => onResendMessage(msg)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
