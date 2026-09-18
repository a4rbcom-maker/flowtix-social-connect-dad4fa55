import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/inbox-helpers";
import type { ConversationWithContact } from "@/types/wa-inbox.types";

// WhatsApp palette (light theme)
const WA = {
  selected: "#f0f2f5",
  hover: "#f5f6f6",
  badge: "#25d366",
  timeMuted: "#667781",
  text: "#111b21",
  textMuted: "#667781",
};

// WhatsApp-style deterministic avatar gradients per contact
const AVATAR_GRADIENTS = [
  "linear-gradient(135deg,#00a884,#25d366)",
  "linear-gradient(135deg,#5b7cfa,#7a9cff)",
  "linear-gradient(135deg,#e6885a,#f2a97e)",
  "linear-gradient(135deg,#8f6ee8,#ab8ff5)",
  "linear-gradient(135deg,#e2596b,#ef7c8b)",
  "linear-gradient(135deg,#129fbf,#43c1de)",
  "linear-gradient(135deg,#d9a123,#e9bc4a)",
  "linear-gradient(135deg,#0f9d8f,#35bfae)",
];
function avatarGradient(key: string | null | undefined): string {
  const k = key ?? "x";
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}

interface ConversationItemProps {
  conv: ConversationWithContact;
  isActive: boolean;
  onClick: () => void;
}

export function ConversationItem({ conv, isActive, onClick }: ConversationItemProps) {
  const name = conv.contact?.push_name || conv.contact?.name || conv.contact?.phone || "—";
  const preview = conv.last_message_preview || "";
  const unread = conv.unread_count > 0;

  return (
    <button
      onClick={onClick}
      style={isActive ? { backgroundColor: WA.selected } : undefined}
      className={cn(
        "w-full text-start px-3 py-2.5 transition-colors border-b",
        !isActive && "hover:bg-[var(--color-surface-2)] border-transparent hover:border-[var(--color-border)]/40",
        isActive && "border-transparent"
      )}
    >
      <div className="flex items-center gap-3">
        {/* Avatar — colored gradient circle like WhatsApp */}
        <div className="relative shrink-0">
          {conv.contact?.avatar_url ? (
            <img src={conv.contact.avatar_url} alt="" className="size-12 rounded-full object-cover" />
          ) : (
            <div
              className="size-12 rounded-full flex items-center justify-center text-white font-semibold text-base shadow-sm"
              style={{ background: avatarGradient(conv.contact?.phone ?? name) }}
            >
              {(conv.contact?.push_name || conv.contact?.name || conv.contact?.phone || "؟").trim().charAt(0)}
            </div>
          )}
          {conv.contact?.is_vip && (
            <span className="absolute -bottom-0.5 -end-0.5 size-4 rounded-full bg-[var(--color-warning)] border-2 border-[var(--color-surface-1)]" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span
              className="truncate"
              style={{ color: WA.text, fontSize: 15, fontWeight: unread ? 700 : 500 }}
            >
              {name}
            </span>
            <span
              className="shrink-0 text-[11px] font-medium"
              style={{ color: unread ? WA.badge : WA.timeMuted }}
            >
              {formatRelativeTime(conv.last_message_at)}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 mt-0.5">
            <p className="text-[13px] truncate" style={{ color: unread ? WA.text : WA.timeMuted, fontWeight: unread ? 600 : 400 }}>
              {preview}
            </p>

            <div className="flex items-center gap-1.5 shrink-0">
              {conv.is_starred && <Star className="size-3 text-[var(--color-warning)] fill-[var(--color-warning)]" />}
              {unread && (
                <span
                  className="min-w-[20px] h-5 px-1.5 rounded-full text-white text-[11px] font-bold flex items-center justify-center"
                  style={{ backgroundColor: WA.badge }}
                >
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
