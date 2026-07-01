import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MessageCircle,
  Search,
  Loader2,
  Send,
  Bot,
  Inbox as InboxIcon,
  Sparkles,
  ArrowLeft,
  RefreshCw,
  Bell,
  BellOff,
  Smile,
  Paperclip,
  CheckCheck,
  Camera,
  Mic,
  FileText,
  Video as VideoIcon,
  X,
  Plus,
  Pencil,
  Trash2,
  Phone,
  UserPlus,
  StickyNote,
  Image as ImageIcon,
  Info,
  Sun,
  Moon,
} from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "@/lib/theme";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { buildRow } from "@/lib/customer-db";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Zap } from "lucide-react";
import {
  sendChatMessage,
  markConversationRead,
  type ConversationRow,
  type ChatMessageRow,
} from "@/lib/wa-chat.functions";
import {
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
  type QuickReply,
} from "@/lib/wa-automation.functions";

import { MediaLightbox, openMedia } from "@/components/whatsapp/MediaLightbox";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";

export const Route = createFileRoute("/dashboard/whatsapp/inbox")({
  ssr: false,
  component: InboxPage,
});

type FilterKey = "all" | "unread" | "ai";
type TimeRangeKey = "all" | "1d" | "7d" | "30d" | "90d";

function InboxPage() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const { user } = useAuth();
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const sendFn = useServerFn(sendChatMessage);
  const markReadFn = useServerFn(markConversationRead);



  const [activeJid, setActiveJid] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [timeRange, setTimeRange] = useState<TimeRangeKey>(() => {
    if (typeof window === "undefined") return "all";
    return (localStorage.getItem("flowtix-inbox-timerange") as TimeRangeKey) || "all";
  });
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("flowtix-inbox-timerange", timeRange);
  }, [timeRange]);
  const [draft, setDraft] = useState("");
  const [soundOn, setSoundOn] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("flowtix-inbox-sound") !== "false";
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const t = isAr
    ? {
        title: "المحادثات",
        subtitle: "كل محادثاتك الواردة والصادرة في مكان واحد.",
        search: "ابحث برقم أو اسم…",
        empty: "ما فيش محادثات لسة.",
        emptyHint: "اربط حساب واتساب من «حساباتي» وانتظر أول رسالة.",
        openAccounts: "افتح حساباتي",
        you: "أنت",
        ai: "AI",
        selectChat: "اختر محادثة من القائمة",
        selectChatHint: "اختر محادثة من اليمين لعرض الرسائل وبدء الرد على عملائك.",
        suggestAccounts: "اربط حساب واتساب",
        suggestAi: "جرّب الذكاء الاصطناعي",
        suggestImport: "استيراد جهات اتصال",
        typeMessage: "اكتب رسالة…",
        send: "إرسال",
        loading: "جارٍ التحميل…",
        aiBadge: "مساعد ذكي",
        aiOn: "مفعّل",
        aiOff: "متوقف",
        backToList: "رجوع",
        unread: "غير مقروء",
        all: "الكل",
        filterUnread: "غير مقروءة",
        filterAi: "AI مفعّل",
        refresh: "تحديث",
        soundOn: "إشعارات: مشغّلة",
        soundOff: "إشعارات: متوقفة",
        soon: "قريباً",
        photo: "صورة",
        voice: "رسالة صوتية",
        doc: "مستند",
        video: "فيديو",
        today: "اليوم",
        yesterday: "أمس",
      }
    : {
        title: "Conversations",
        subtitle: "All your incoming and outgoing messages in one place.",
        search: "Search by number or name…",
        empty: "No conversations yet.",
        emptyHint: "Link a WhatsApp account from “My Accounts” and wait for the first message.",
        openAccounts: "Open My Accounts",
        you: "You",
        ai: "AI",
        selectChat: "Select a conversation",
        selectChatHint: "Pick a chat from the list to view messages and reply to your customers.",
        suggestAccounts: "Link a WhatsApp account",
        suggestAi: "Try the AI assistant",
        suggestImport: "Import contacts",
        typeMessage: "Type a message…",
        send: "Send",
        loading: "Loading…",
        aiBadge: "AI assistant",
        aiOn: "On",
        aiOff: "Off",
        backToList: "Back",
        unread: "Unread",
        all: "All",
        filterUnread: "Unread",
        filterAi: "AI on",
        refresh: "Refresh",
        soundOn: "Sound: on",
        soundOff: "Sound: off",
        soon: "Coming soon",
        photo: "Photo",
        voice: "Voice message",
        doc: "Document",
        video: "Video",
        today: "Today",
        yesterday: "Yesterday",
      };

  // Data
  const safeCall = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      const result = await fn();
      return result ?? fallback;
    } catch (err) {
      if (err instanceof Response) {
        console.warn("[inbox] server fn returned Response", err.status);
        return fallback;
      }
      console.warn("[inbox] server fn error", err);
      return fallback;
    }
  };
  const convQuery = useQuery<ConversationRow[]>({
    queryKey: ["wa-conversations", user?.id],
    queryFn: () => safeCall<ConversationRow[]>(() => fetchInboxConversations(user!.id), []),
    enabled: !!user?.id,
    placeholderData: [],
    refetchInterval: 15000,
  });
  const msgsQuery = useQuery<ChatMessageRow[]>({
    queryKey: ["wa-messages", user?.id, activeJid],
    queryFn: () =>
      activeJid
        ? safeCall<ChatMessageRow[]>(() => fetchInboxMessages(user!.id, activeJid), [])
        : Promise.resolve([]),
    enabled: !!activeJid && !!user?.id,
    placeholderData: [],
    refetchInterval: 5000,
  });
  const conversations = useMemo<ConversationRow[]>(
    () => {
      const raw = Array.isArray(convQuery.data) ? convQuery.data : [];
      // Build set of contact_phones that have a "real" phone-JID conversation.
      // Only then we can safely hide the LID duplicate of that same contact.
      const phoneJidContacts = new Set<string>();
      for (const c of raw) {
        const local = c.remote_jid.split("@")[0] ?? "";
        const isLidLike = /^\d{14,}$/.test(local);
        if (!isLidLike && c.contact_phone) phoneJidContacts.add(c.contact_phone);
      }
      return raw.filter((c) => {
        const local = c.remote_jid.split("@")[0] ?? "";
        const isLidLike = /^\d{14,}$/.test(local);
        if (!isLidLike) return true;
        // Only hide the LID row if the same contact_phone also exists as a phone-JID row.
        return !(c.contact_phone && phoneJidContacts.has(c.contact_phone));
      });
    },
    [convQuery.data],
  );

  const messages = useMemo<ChatMessageRow[]>(
    () => (Array.isArray(msgsQuery.data) ? msgsQuery.data : []),
    [msgsQuery.data],
  );

  // Track connection so we can show the right empty-state CTA.
  const connQuery = useQuery<{ status: string } | null>({
    queryKey: ["wa-connection-state", user?.id],
    queryFn: () => safeCall(() => fetchInboxConnectionState(user!.id), null),
    enabled: !!user?.id,
    refetchInterval: 30000,
  });

  const quickRepliesQuery = useQuery<QuickReply[]>({
    queryKey: ["wa-quick-replies", user?.id],
    queryFn: () => safeCall<QuickReply[]>(() => fetchInboxQuickReplies(user!.id), []),
    enabled: !!user?.id,
  });




  // Realtime
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`wa_inbox_realtime:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wa_conversations", filter: `user_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ["wa-conversations"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wa_messages", filter: `user_id=eq.${user.id}` },
        (payload) => {
          // Always refresh the conversation list so the new chat appears
          qc.invalidateQueries({ queryKey: ["wa-conversations"] });
          const row = payload.new as { remote_jid?: string; direction?: string; raw?: { is_historical?: boolean } | null };
          if (activeJid && row.remote_jid === activeJid) {
            qc.invalidateQueries({ queryKey: ["wa-messages", user.id, activeJid] });
          }
          // Notification beep for new INCOMING messages only (skip outbound and historical sync)
          if (
            payload.eventType === "INSERT" &&
            row.direction === "in" &&
            !row.raw?.is_historical
          ) {
            playBeep();
          }
        },
      )

      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc, activeJid, user]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, activeJid]);

  // Mark active conversation read
  useEffect(() => {
    if (!activeJid || !user?.id) return;
    const c = conversations.find((x) => x.remote_jid === activeJid);
    if (c && c.unread_count > 0) {
      markReadFn({ data: { id: c.id } }).then(() => {
        qc.invalidateQueries({ queryKey: ["wa-conversations"] });
      }).catch((err: unknown) => console.warn("[inbox] mark read failed", err));
    }
  }, [activeJid, conversations, markReadFn, qc, user?.id]);

  // Textarea auto-grow
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft]);

  const sendMut = useMutation({
    mutationFn: (text: string) => sendFn({ data: { remoteJid: activeJid!, text } }),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["wa-messages", user?.id, activeJid] });
      qc.invalidateQueries({ queryKey: ["wa-conversations"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const aiToggleMut = useMutation({
    mutationFn: async (vars: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("wa_conversations")
        .update({ ai_enabled: vars.enabled })
        .eq("id", vars.id)
        .eq("user_id", user!.id);
      if (error) throw new Error(error.message);
      return { ok: true };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-conversations"] }),
    onError: (err: Error) => toast.error(err.message),
  });

  const filtered = useMemo(() => {
    const list = conversations;
    let out = list;
    if (filter === "unread") out = out.filter((c) => c.unread_count > 0);
    else if (filter === "ai") out = out.filter((c) => c.ai_enabled);
    if (timeRange !== "all") {
      const daysMap: Record<Exclude<TimeRangeKey, "all">, number> = { "1d": 1, "7d": 7, "30d": 30, "90d": 90 };
      const cutoff = Date.now() - daysMap[timeRange] * 24 * 60 * 60 * 1000;
      out = out.filter((c) => {
        const ts = c.last_message_at ? new Date(c.last_message_at).getTime() : 0;
        return ts >= cutoff;
      });
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(
        (c) =>
          c.remote_jid.toLowerCase().includes(q) ||
          (c.contact_phone ?? "").toLowerCase().includes(q) ||
          (c.contact_name ?? "").toLowerCase().includes(q) ||
          (c.last_message_text ?? "").toLowerCase().includes(q),
      );
    }
    return out;
  }, [conversations, search, filter, timeRange]);

  const totalUnread = useMemo(
    () => conversations.reduce((s, c) => s + (c.unread_count || 0), 0),
    [conversations],
  );

  const activeConv = useMemo(
    () => conversations.find((c) => c.remote_jid === activeJid),
    [conversations, activeJid],
  );

  // Notification beep via WebAudio (no asset needed, no autoplay issues once unlocked).
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioUnlockedRef = useRef(false);
  const soundOnRef = useRef(soundOn);
  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const unlock = () => {
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
        if (audioCtxRef.current.state === "suspended") void audioCtxRef.current.resume();
        audioUnlockedRef.current = true;
      } catch {
        /* ignore */
      }
    };
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart"];
    events.forEach((e) => window.addEventListener(e, unlock, { once: true, passive: true }));
    return () => {
      events.forEach((e) => window.removeEventListener(e, unlock));
    };
  }, []);

  const playBeep = () => {
    if (!soundOnRef.current) return;
    const ctx = audioCtxRef.current;
    if (!ctx || !audioUnlockedRef.current) return;
    try {
      if (ctx.state === "suspended") void ctx.resume();
      const now = ctx.currentTime;
      const playTone = (freq: number, start: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + start);
        gain.gain.exponentialRampToValueAtTime(0.25, now + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + start);
        osc.stop(now + start + duration + 0.02);
      };
      playTone(880, 0, 0.15);
      playTone(1175, 0.16, 0.18);
    } catch {
      /* ignore */
    }
  };

  const toggleSound = () => {
    setSoundOn((p) => {
      const next = !p;
      try {
        localStorage.setItem("flowtix-inbox-sound", String(next));
      } catch {
        /* ignore */
      }
      if (next) playBeep();
      return next;
    });
  };


  const Sidebar = (
    <aside dir={isAr ? "rtl" : "ltr"} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card/60 backdrop-blur-sm">
      {/* Header */}
      <div className="border-b border-border/60 p-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-[oklch(0.52_0.28_290)] text-white shadow-lg shadow-primary/20">
            <InboxIcon className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-bold">{t.title}</h1>
              {totalUnread > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                  {totalUnread}
                </span>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">{t.subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => qc.invalidateQueries({ queryKey: ["wa-conversations"] })}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
              aria-label={t.refresh}
              title={t.refresh}
            >
              <RefreshCw className={`h-4 w-4 ${convQuery.isFetching ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={toggleSound}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
              aria-label={soundOn ? t.soundOn : t.soundOff}
              title={soundOn ? t.soundOn : t.soundOff}
            >
              {soundOn ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground ltr:left-3 rtl:right-3" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.search}
            className="w-full rounded-2xl border border-input bg-background/80 px-10 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {/* Filters */}
        <div className="mt-3 flex max-w-full items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {([
            { k: "all" as FilterKey, label: t.all },
            { k: "unread" as FilterKey, label: t.filterUnread },
            { k: "ai" as FilterKey, label: t.filterAi },
          ]).map((f) => {
            const active = filter === f.k;
            return (
              <button
                key={f.k}
                type="button"
                onClick={() => setFilter(f.k)}
                className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                  active
                    ? "bg-gradient-to-r from-primary to-[oklch(0.52_0.28_290)] text-primary-foreground shadow-sm"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Time range */}
        <div className="mt-2 flex max-w-full items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {([
            { k: "all" as TimeRangeKey, label: isAr ? "كل الوقت" : "All time" },
            { k: "1d" as TimeRangeKey, label: isAr ? "24 ساعة" : "24h" },
            { k: "7d" as TimeRangeKey, label: isAr ? "7 أيام" : "7 days" },
            { k: "30d" as TimeRangeKey, label: isAr ? "30 يوم" : "30 days" },
            { k: "90d" as TimeRangeKey, label: isAr ? "90 يوم" : "90 days" },
          ]).map((f) => {
            const active = timeRange === f.k;
            return (
              <button
                key={f.k}
                type="button"
                onClick={() => setTimeRange(f.k)}
                className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                  active
                    ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {convQuery.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t.loading}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
              <MessageCircle className="h-6 w-6 text-muted-foreground" />
            </div>
            {connQuery.data?.status === "connected" ? (
              <>
                <p className="px-6 text-sm font-medium">
                  {isAr ? "لا توجد محادثات بعد." : "No conversations yet."}
                </p>
                <p className="px-6 text-xs text-muted-foreground">
                  {isAr
                    ? "بمجرد وصول رسالة جديدة على رقم واتساب المرتبط، ستظهر هنا تلقائيًا."
                    : "As soon as a new message arrives on the linked WhatsApp number, it will show up here automatically."}
                </p>
              </>
            ) : (
              <>
                <p className="px-6 text-sm font-medium">{t.empty}</p>
                <p className="px-6 text-xs text-muted-foreground">{t.emptyHint}</p>
                <Link
                  to="/dashboard/whatsapp/accounts"
                  className="mt-1 inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90"
                >
                  {t.openAccounts}
                </Link>
              </>
            )}

          </div>
        ) : (
          <ul className="divide-y divide-border/30 overflow-hidden">
            {filtered.map((c) => (
              <ConversationRow
                key={c.id}
                conv={c}
                active={activeJid === c.remote_jid}
                isAr={isAr}
                youLabel={t.you}
                mediaLabels={{ photo: t.photo, voice: t.voice, doc: t.doc, video: t.video }}
                onClick={() => setActiveJid(c.remote_jid)}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );

  const ChatPane = (
    <section dir={isAr ? "rtl" : "ltr"} className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-gradient-to-br from-primary/[0.04] via-background to-primary/[0.06]">
      {!activeJid ? (
        <EmptyChat
          isAr={isAr}
          title={t.selectChat}
          hint={t.selectChatHint}
          suggestions={[t.suggestAccounts, t.suggestAi, t.suggestImport]}
        />
      ) : (
        <>
          {/* Chat Header */}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 bg-card/80 px-3 py-3 backdrop-blur sm:px-4">
            <div className="flex min-w-0 items-center gap-3 overflow-hidden">
              {isMobile && (
                <button
                  type="button"
                  onClick={() => setActiveJid(null)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-muted"
                  aria-label={t.backToList}
                >
                  <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
                </button>
              )}
              <ContactAvatar
                name={activeConv?.contact_name ?? activeJid}
                src={activeConv?.profile_pic_url ?? null}
                size="md"
              />
              <div className="min-w-0 flex-1 overflow-hidden">
                <p className="truncate text-sm font-bold">
                  {activeConv?.contact_name ?? activeJid.replace(/@.*/, "")}
                </p>
                <p className="truncate text-xs text-muted-foreground" dir="ltr">
                  {activeConv?.contact_phone ? `+${activeConv.contact_phone}` : activeJid}
                </p>
              </div>
            </div>
            {activeConv && (
              <div className="flex max-w-[46vw] shrink-0 items-center gap-2 rounded-2xl border border-border/60 bg-background/60 px-2.5 py-1.5 sm:max-w-none sm:px-3">
                <Bot
                  className={`h-4 w-4 ${activeConv.ai_enabled ? "text-primary" : "text-muted-foreground"}`}
                />
                <div className="hidden flex-col sm:flex">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    {t.aiBadge}
                  </span>
                  <span
                    className={`text-[10px] font-semibold ${
                      activeConv.ai_enabled ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {activeConv.ai_enabled ? t.aiOn : t.aiOff}
                  </span>
                </div>
                <Switch
                  checked={activeConv.ai_enabled}
                  disabled={aiToggleMut.isPending}
                  onCheckedChange={(v) =>
                    aiToggleMut.mutate({ id: activeConv.id, enabled: Boolean(v) })
                  }
                />
              </div>
            )}
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="relative min-w-0 flex-1 space-y-1 overflow-x-hidden overflow-y-auto px-3 py-4 sm:px-6"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 0%, oklch(0.62 0.27 295 / 0.06), transparent 40%), radial-gradient(circle at 80% 100%, oklch(0.52 0.28 290 / 0.05), transparent 40%)",
            }}
          >
            {msgsQuery.isLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              renderMessagesWithDays(messages, isAr, t)
            )}
          </div>

          {/* Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim() || sendMut.isPending) return;
              sendMut.mutate(draft.trim());
            }}
            className="min-w-0 border-t border-border/60 bg-card/80 p-2.5 backdrop-blur sm:p-3"
          >
            <div className="flex min-w-0 items-end gap-1.5 rounded-2xl border border-input bg-background px-2 py-1.5 shadow-sm transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 sm:gap-2 sm:px-2.5">
              <button
                type="button"
                onClick={() => toast.info(t.soon)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-muted hover:text-primary"
                aria-label="emoji"
              >
                <Smile className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => toast.info(t.soon)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-muted hover:text-primary"
                aria-label="attach"
              >
                <Paperclip className="h-5 w-5" />
              </button>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="relative flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-2 text-xs font-semibold text-primary transition hover:bg-primary/10 sm:px-2.5"
                    aria-label={isAr ? "ردود جاهزة" : "Quick replies"}
                    title={isAr ? "ردود جاهزة" : "Quick replies"}
                  >
                    <Zap className="h-4 w-4" />
                    <span className="hidden sm:inline">{isAr ? "ردود جاهزة" : "Quick replies"}</span>
                    {(quickRepliesQuery.data?.length ?? 0) > 0 && (
                      <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold leading-none">
                        {quickRepliesQuery.data?.length}
                      </span>
                    )}
                  </button>
                </PopoverTrigger>

                <PopoverContent align="start" className="w-[min(92vw,420px)] p-0" sideOffset={8}>
                  <QuickRepliesMenu
                    isAr={isAr}
                    replies={quickRepliesQuery.data ?? []}
                    loading={quickRepliesQuery.isLoading || quickRepliesQuery.isFetching}
                    onInsert={(body: string) => {
                      setDraft((d) => (d ? `${d} ${body}` : body));
                      textareaRef.current?.focus();
                    }}
                  />
                </PopoverContent>
              </Popover>
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (draft.trim() && !sendMut.isPending) sendMut.mutate(draft.trim());
                  }
                }}
                placeholder={t.typeMessage}
                rows={1}
                className="max-h-32 min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted-foreground"
              />
              <button
                type="submit"
                disabled={!draft.trim() || sendMut.isPending}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[oklch(0.52_0.28_290)] text-primary-foreground shadow-md shadow-primary/30 transition hover:opacity-95 disabled:opacity-40"
                aria-label={t.send}
              >
                {sendMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 rtl:rotate-180" />
                )}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );

  const ContactPanel = activeConv ? (
    <ContactInfoPanel conv={activeConv} jid={activeJid!} isAr={isAr} />
  ) : (
    <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
      {isAr ? "اختر محادثة لعرض بيانات الجهة" : "Select a conversation to view contact info"}
    </div>
  );

  return (
    <DashboardLayout title={t.title}>
      <div
        dir={isAr ? "rtl" : "ltr"}
        className="h-[calc(100dvh-97px)] min-h-[520px] w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-border/60 bg-card md:h-[calc(100dvh-113px)]"
      >
        {isMobile ? (
          <div className="h-full min-w-0 overflow-hidden">
            {activeJid ? ChatPane : Sidebar}
          </div>
        ) : (
          <ResizablePanelGroup
            orientation="horizontal"
            className="h-full w-full min-w-0 overflow-hidden"
            id="wa-inbox-layout-v2"
            dir="ltr"
          >
            <ResizablePanel defaultSize="22%" minSize="16%" maxSize="32%" id="wa-contact">
              {ContactPanel}
            </ResizablePanel>
            <ResizableHandle withHandle className="bg-border/40" />
            <ResizablePanel defaultSize="52%" minSize="35%" id="wa-chat">
              {ChatPane}
            </ResizablePanel>
            <ResizableHandle withHandle className="bg-border/40" />
            <ResizablePanel defaultSize="26%" minSize="18%" maxSize="40%" id="wa-list">
              {Sidebar}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
        <MediaLightbox />
      </div>
    </DashboardLayout>
  );
}

// Fullscreen wrapper with top bar + back button
function FullscreenInbox({
  isAr,
  title,
  totalUnread,
  children,
}: {
  isAr: boolean;
  title: string;
  totalUnread: number;
  children: React.ReactNode;
}) {
  const { theme, toggleTheme } = useTheme();
  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      className="fixed inset-0 z-50 flex flex-col bg-gradient-to-br from-background via-background to-primary/5"
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-card/90 px-4 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/dashboard"
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-muted/60 px-3 text-sm font-semibold text-foreground transition hover:bg-primary/10 hover:text-primary"
          >
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
            <span>{isAr ? "رجوع" : "Back"}</span>
          </Link>
          <div className="hidden h-6 w-px bg-border md:block" />
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[oklch(0.52_0.28_290)] text-white shadow-md shadow-primary/20">
              <InboxIcon className="h-4 w-4" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold leading-tight">{title}</h1>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {isAr ? "صندوق الوارد" : "Unified Inbox"}
              </p>
            </div>
            {totalUnread > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                {totalUnread}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleTheme}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="theme"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <Link
            to="/dashboard"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            aria-label={isAr ? "إغلاق" : "Close"}
            title={isAr ? "خروج من المحادثة" : "Exit inbox"}
          >
            <X className="h-4 w-4" />
          </Link>
        </div>
      </header>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

function QuickRepliesMenu({
  isAr,
  replies,
  loading,
  onInsert,
}: {
  isAr: boolean;
  replies: QuickReply[];
  loading: boolean;
  onInsert: (body: string) => void;
}) {
  const qc = useQueryClient();
  const createFn = useServerFn(createQuickReply);
  const updateFn = useServerFn(updateQuickReply);
  const deleteFn = useServerFn(deleteQuickReply);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [editing, setEditing] = useState<QuickReply | null>(null);
  const [form, setForm] = useState({ shortcut: "", category: isAr ? "عام" : "General", body: "", sort_order: 0 });

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const reply of replies) set.add(reply.category?.trim() || (isAr ? "عام" : "General"));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [isAr, replies]);

  const filteredReplies = useMemo(() => {
    const q = search.trim().toLowerCase();
    return replies.filter((reply) => {
      const replyCategory = reply.category?.trim() || (isAr ? "عام" : "General");
      const matchesCategory = category === "all" || replyCategory === category;
      const matchesSearch =
        !q ||
        reply.shortcut.toLowerCase().includes(q) ||
        reply.body.toLowerCase().includes(q) ||
        replyCategory.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [category, isAr, replies, search]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["wa-quick-replies"] });
    qc.invalidateQueries({ queryKey: ["wa-quick-replies-mgmt"] });
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        shortcut: form.shortcut.trim(),
        category: form.category.trim() || (isAr ? "عام" : "General"),
        body: form.body.trim(),
        sort_order: Number(form.sort_order) || 0,
      };
      if (!payload.shortcut || !payload.body) throw new Error(isAr ? "اكتب الاختصار والنص" : "Shortcut and body are required");
      if (editing) return updateFn({ data: { id: editing.id, ...payload } });
      return createFn({ data: payload });
    },
    onSuccess: () => {
      toast.success(editing ? (isAr ? "تم تعديل الرد" : "Reply updated") : isAr ? "تم إضافة الرد" : "Reply added");
      setEditing(null);
      setForm({ shortcut: "", category: form.category || (isAr ? "عام" : "General"), body: "", sort_order: 0 });
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success(isAr ? "تم حذف الرد" : "Reply deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = (reply: QuickReply) => {
    setEditing(reply);
    setForm({
      shortcut: reply.shortcut,
      category: reply.category || (isAr ? "عام" : "General"),
      body: reply.body,
      sort_order: reply.sort_order ?? 0,
    });
  };

  return (
    <div dir={isAr ? "rtl" : "ltr"} className={isAr ? "text-right" : "text-left"}>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <p className="text-sm font-semibold">{isAr ? "الرسائل الجاهزة" : "Quick replies"}</p>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="space-y-2 border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground ltr:left-3 rtl:right-3" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isAr ? "بحث في الرسائل الجاهزة…" : "Search quick replies…"}
            className="h-9 w-full rounded-lg border border-input bg-background px-9 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setCategory("all")}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${category === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
          >
            {isAr ? "الكل" : "All"}
          </button>
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCategory(item)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${category === item ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-64 overflow-y-auto p-1.5">
        {filteredReplies.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            {isAr ? "لا توجد رسائل مطابقة." : "No matching replies."}
          </div>
        ) : (
          filteredReplies.map((reply) => (
            <div key={reply.id} className="group rounded-lg px-2 py-2 hover:bg-muted/70">
              <button type="button" onClick={() => onInsert(reply.body)} className="w-full text-start">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-primary">/{reply.shortcut}</span>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    {reply.category || (isAr ? "عام" : "General")}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm leading-5 text-foreground">{reply.body}</p>
              </button>
              <div className="mt-1 flex justify-end gap-1 opacity-100 sm:opacity-0 sm:transition sm:group-hover:opacity-100">
                <button type="button" onClick={() => startEdit(reply)} className="rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-primary" aria-label={isAr ? "تعديل" : "Edit"}>
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => deleteMut.mutate(reply.id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={isAr ? "حذف" : "Delete"}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2 border-t border-border bg-muted/20 p-3">
        <div className="grid grid-cols-2 gap-2">
          <input value={form.shortcut} onChange={(e) => setForm((f) => ({ ...f, shortcut: e.target.value }))} placeholder={isAr ? "اختصار" : "Shortcut"} className="h-9 rounded-lg border border-input bg-background px-2 text-sm outline-none focus:border-primary" />
          <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder={isAr ? "تصنيف" : "Category"} className="h-9 rounded-lg border border-input bg-background px-2 text-sm outline-none focus:border-primary" />
        </div>
        <textarea value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} rows={2} placeholder={isAr ? "نص الرسالة الجاهزة" : "Reply body"} className="w-full resize-none rounded-lg border border-input bg-background px-2 py-2 text-sm outline-none focus:border-primary" />
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => { setEditing(null); setForm({ shortcut: "", category: isAr ? "عام" : "General", body: "", sort_order: 0 }); }} className="text-xs font-medium text-muted-foreground hover:text-foreground">
            {editing ? (isAr ? "إلغاء التعديل" : "Cancel edit") : isAr ? "تفريغ" : "Clear"}
          </button>
          <button type="button" onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50">
            {saveMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {editing ? (isAr ? "حفظ التعديل" : "Save edit") : isAr ? "إضافة" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Contact info side panel (Bot-Xtra style)
function ContactInfoPanel({
  conv,
  jid,
  isAr,
}: {
  conv: ConversationRow;
  jid: string;
  isAr: boolean;
}) {
  const [tab, setTab] = useState<"info" | "notes" | "media">("info");
  const [saving, setSaving] = useState(false);
  const name = conv.contact_name ?? jid.replace(/@.*/, "");
  const phone = conv.contact_phone ? `+${conv.contact_phone}` : jid;

  async function handleSaveCustomer() {
    if (saving) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error(isAr ? "يجب تسجيل الدخول" : "Login required");
        return;
      }
      const rawPhone = conv.contact_phone ?? jid.replace(/@.*/, "");
      const row = buildRow({
        user_id: user.id,
        full_name: conv.contact_name ?? null,
        phone: rawPhone,
        notes: isAr ? "تم الحفظ من المحادثات" : "Saved from inbox",
      });
      if (row.phone_norm) {
        const { data: existing } = await supabase
          .from("customer_database")
          .select("id")
          .eq("user_id", user.id)
          .eq("phone_norm", row.phone_norm)
          .maybeSingle();
        if (existing) {
          toast.info(isAr ? "العميل محفوظ بالفعل" : "Already saved");
          return;
        }
      }
      const { error } = await supabase.from("customer_database").insert(row);
      if (error) throw error;
      toast.success(isAr ? "تم حفظ العميل في قاعدة بياناتك" : "Customer saved");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error((isAr ? "فشل الحفظ: " : "Save failed: ") + msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside dir={isAr ? "rtl" : "ltr"} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card/40 backdrop-blur-sm">
      {/* Contact header */}
      <div className="flex flex-col items-center gap-3 border-b border-border/60 p-5 text-center">
        <div className="relative">
          <ContactAvatar name={name} src={conv.profile_pic_url ?? null} size="lg" />
          <span className="absolute bottom-1 end-1 h-4 w-4 rounded-full border-2 border-card bg-emerald-500" />
        </div>
        <div className="min-w-0 max-w-full overflow-hidden">
          <h2 className="truncate text-base font-bold">{name}</h2>
          <p className="mt-0.5 inline-flex max-w-full items-center gap-1.5 truncate text-xs text-muted-foreground" dir="ltr">
            <Phone className="h-3 w-3" />
            {phone}
          </p>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {isAr ? "متصل الآن" : "Online"}
          </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleSaveCustomer}
            disabled={saving}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background/60 px-2 py-2 text-[11px] font-semibold transition hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : <UserPlus className="h-3.5 w-3.5 text-primary" />}
            {isAr ? "حفظ" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => toast.info(isAr ? "قريباً" : "Soon")}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background/60 px-2 py-2 text-[11px] font-semibold transition hover:border-primary/40 hover:bg-primary/5"
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            {isAr ? "تلخيص" : "Summary"}
          </button>

        </div>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 items-center justify-around border-b border-border/60 bg-background/30">
        {([
          { k: "info" as const, label: isAr ? "معلومات" : "Info", icon: Info },
          { k: "notes" as const, label: isAr ? "ملاحظات" : "Notes", icon: StickyNote },
          { k: "media" as const, label: isAr ? "وسائط" : "Media", icon: ImageIcon },
        ]).map((tb) => {
          const Icon = tb.icon;
          const active = tab === tb.k;
          return (
            <button
              key={tb.k}
              type="button"
              onClick={() => setTab(tb.k)}
              className={`relative flex flex-1 items-center justify-center gap-1.5 py-3 text-xs font-semibold transition ${
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tb.label}
              {active && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-gradient-to-r from-primary to-[oklch(0.52_0.28_290)]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 text-sm">
        {tab === "info" && (
          <div className="space-y-3">
            <InfoRow label={isAr ? "الاسم" : "Name"} value={name} />
            <InfoRow label={isAr ? "الهاتف" : "Phone"} value={phone} ltr />
            <InfoRow
              label={isAr ? "حالة المساعد" : "AI Assistant"}
              value={conv.ai_enabled ? (isAr ? "مفعّل" : "Enabled") : (isAr ? "متوقف" : "Off")}
            />
            <InfoRow
              label={isAr ? "غير مقروء" : "Unread"}
              value={String(conv.unread_count ?? 0)}
            />
            <InfoRow
              label={isAr ? "آخر نشاط" : "Last activity"}
              value={new Date(conv.last_message_at).toLocaleString(isAr ? "ar-EG" : "en-US")}
            />
          </div>
        )}
        {tab === "notes" && (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-xs text-muted-foreground">
            <StickyNote className="h-8 w-8 opacity-40" />
            <p>{isAr ? "لا توجد ملاحظات بعد" : "No notes yet"}</p>
          </div>
        )}
        {tab === "media" && (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-xs text-muted-foreground">
            <ImageIcon className="h-8 w-8 opacity-40" />
            <p>{isAr ? "لا توجد وسائط مشاركة" : "No shared media"}</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function InfoRow({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-background/40 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 min-w-0 truncate text-sm font-medium" dir={ltr ? "ltr" : undefined}>{value}</p>
    </div>
  );
}

function ContactAvatar({
  name,
  src,
  size,
}: {
  name: string;
  src: string | null;
  size: "sm" | "md" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const sizeClass =
    size === "lg"
      ? "h-20 w-20 text-2xl shadow-lg shadow-primary/30"
      : size === "md"
        ? "h-11 w-11 text-sm shadow-md shadow-primary/20"
        : "h-11 w-11 text-sm shadow-sm shadow-primary/20";

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${sizeClass} shrink-0 rounded-full object-cover ring-1 ring-border/50`}
      />
    );
  }

  return (
    <div className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[oklch(0.52_0.28_290)] font-bold text-white`}>
      {initials(name)}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Subcomponents
// ──────────────────────────────────────────────────────────────────────────

function ConversationRow({
  conv,
  active,
  isAr,
  youLabel,
  mediaLabels,
  onClick,
}: {
  conv: ConversationRow;
  active: boolean;
  isAr: boolean;
  youLabel: string;
  mediaLabels: { photo: string; voice: string; doc: string; video: string };
  onClick: () => void;
}) {
  const media = detectMedia(conv.last_message_text, mediaLabels);
  return (
    <li className="relative">
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full min-w-0 items-center gap-3 overflow-hidden px-3 py-3 text-start transition ${
          active
            ? "bg-primary/10"
            : "hover:bg-muted/50"
        }`}
      >
        {active && (
          <span className="absolute top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-primary to-[oklch(0.52_0.28_290)] ltr:left-0 rtl:right-0" />
        )}
        <ContactAvatar name={conv.contact_name ?? conv.remote_jid} src={conv.profile_pic_url ?? null} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className={`min-w-0 flex-1 truncate text-sm ${conv.unread_count > 0 ? "font-bold" : "font-semibold"}`}>
              {conv.contact_name ?? conv.remote_jid.replace(/@.*/, "")}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground" dir="ltr">
              {formatRelative(conv.last_message_at, isAr)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <p className={`block min-w-0 flex-1 truncate text-xs ${conv.unread_count > 0 ? "text-foreground" : "text-muted-foreground"}`}>
              {conv.last_direction === "out" && (
                <span className="font-medium text-primary">{youLabel}: </span>
              )}
              {media ? (
                <span className="inline-flex items-center gap-1 align-middle">
                  {media.icon}
                  <span>{media.label}</span>
                </span>
              ) : (
                conv.last_message_text ?? "—"
              )}
            </p>
            {conv.ai_enabled && (
              <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary" title="AI">
                <Bot className="h-2.5 w-2.5" />
              </span>
            )}
            {conv.unread_count > 0 && (
              <span className="shrink-0 rounded-full bg-gradient-to-br from-primary to-[oklch(0.52_0.28_290)] px-2 py-0.5 text-[10px] font-bold text-primary-foreground shadow-sm">
                {conv.unread_count}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

function EmptyChat({
  isAr,
  title,
  hint,
  suggestions,
}: {
  isAr: boolean;
  title: string;
  hint: string;
  suggestions: string[];
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-primary/15 to-primary/5 ring-1 ring-primary/20">
        <Sparkles className="h-9 w-9 text-primary" />
        <span className="absolute -end-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground shadow">
          ✦
        </span>
      </div>
      <div className="max-w-md">
        <h3 className="text-base font-bold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {suggestions.map((s, i) => (
          <span
            key={s}
            className={`rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary ${
              i === 0 ? "" : "opacity-80"
            }`}
          >
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

async function fetchInboxConversations(userId: string): Promise<ConversationRow[]> {
  const { data: sessionRow, error: sessionError } = await supabase
    .from("wa_sessions")
    .select("session_id, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (sessionError) throw new Error(sessionError.message);
  if (!sessionRow?.session_id || sessionRow.status !== "connected") return [];

  // NOTE: نجلب المحادثات لكل جلسات المستخدم (وليس session_id الحالي فقط)
  // لأن عند إعادة الربط يتم إنشاء session_id جديد وتظل المحادثات القديمة مرتبطة بالـ session_id السابق لنفس الرقم.
  const { data, error } = await supabase
    .from("wa_conversations")
    .select("id, session_id, remote_jid, contact_name, contact_phone, last_message_text, last_message_at, last_direction, unread_count, ai_enabled")
    .eq("user_id", userId)
    .eq("is_archived", false)
    .order("last_message_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Omit<ConversationRow, "profile_pic_url">[];
  if (!rows.length) return [];

  const { data: rawMessages } = await supabase
    .from("wa_messages")
    .select("remote_jid, text_body, msg_type, raw, wa_timestamp, created_at")
    .eq("user_id", userId)
    .in("remote_jid", rows.map((row) => row.remote_jid))
    .not("raw", "is", null)
    .order("wa_timestamp", { ascending: false })
    .limit(1000);



  const metaByJid = new Map<string, { phone: string | null; profile: string | null; preview: string | null }>();
  for (const msg of rawMessages ?? []) {
    const jid = String(msg.remote_jid ?? "");
    if (!jid) continue;
    const current = metaByJid.get(jid) ?? { phone: null, profile: null, preview: null };
    metaByJid.set(jid, {
      phone: current.phone ?? phoneFromRaw(msg.raw),
      profile: current.profile ?? profilePicFromRaw(msg.raw),
      preview: current.preview ?? previewTextFromRaw(msg.raw, msg.text_body, msg.msg_type),
    });
  }

  return rows.map((row) => {
    const meta = metaByJid.get(row.remote_jid);
    const isGroup = row.remote_jid.endsWith("@g.us");
    return {
      ...row,
      contact_phone: isGroup ? null : (meta?.phone ?? row.contact_phone),
      last_message_text: meta?.preview ?? row.last_message_text,
      profile_pic_url: meta?.profile ?? null,
    };
  });
}

async function fetchInboxMessages(userId: string, remoteJid: string): Promise<ChatMessageRow[]> {
  const { data: sessionRow, error: sessionError } = await supabase
    .from("wa_sessions")
    .select("session_id, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (sessionError) throw new Error(sessionError.message);
  if (!sessionRow?.session_id || sessionRow.status !== "connected") return [];

  const { data, error } = await supabase
    .from("wa_messages")
    .select("id, remote_jid, direction, status, text_body, msg_type, media_url, provider_message_id, wa_timestamp, created_at, raw")
    .eq("user_id", userId)
    .eq("session_id", sessionRow.session_id)
    .eq("remote_jid", remoteJid)
    .order("wa_timestamp", { ascending: true })
    .limit(1000);
  if (error) throw new Error(error.message);

  return Promise.all((data ?? []).map(async (row) => {
    const raw = asRecord(row.raw);
    const msgType = mediaTypeFromRaw(raw, row.msg_type);
    const storedMediaUrl = typeof row.media_url === "string" && row.media_url.trim() ? row.media_url.trim() : null;
    const rawMediaUrl = mediaUrlFromRaw(raw, msgType);
    const mediaUrl = await resolveInboxMediaUrl(preferInboxMediaUrl(storedMediaUrl, rawMediaUrl));
    const isAi = raw.ai === true;
    const rawDelivery = String(raw.delivery ?? "").toLowerCase();
    const queuedId = pickString(raw, "queuedId", "queued_id", "queueId", "queue_id", "requestId", "jobId");
    const deliveryError = pickString(raw, "error", "deliveryError", "lastError");
    const hasConfirmedDelivery = Boolean(
      row.provider_message_id || pickString(raw, "providerMessageId", "bridgeMessageId", "messageId", "id"),
    );
    const missingConfirmedDelivery =
      row.direction === "out" &&
      row.status === "sent" &&
      !hasConfirmedDelivery;
    const visibleStatus = missingConfirmedDelivery
      ? rawDelivery.includes("queued") || rawDelivery.includes("pending") || rawDelivery.includes("retrying")
        ? "pending"
        : "failed"
      : (row.status ?? (row.direction === "out" ? "sent" : "received"));
    const messageTime = new Date(row.wa_timestamp ?? row.created_at).getTime();
    const isStalePending = Boolean(
      row.direction === "out" &&
      visibleStatus === "pending" &&
      !hasConfirmedDelivery &&
      queuedId &&
      Number.isFinite(messageTime) &&
      Date.now() - messageTime > 120_000,
    );
    return {
      id: row.id,
      remote_jid: row.remote_jid,
      direction: row.direction as "in" | "out",
      status: visibleStatus,
      text_body: cleanMessageText(row.text_body, raw, msgType),
      msg_type: msgType,
      media_url: mediaUrl,
      created_at: row.wa_timestamp ?? row.created_at,
      is_ai: isAi,
      sender_name: pickString(raw, "pushName", "senderName", "notifyName", "contactName"),
      sender_phone: digits(pickString(raw, "participantPn", "senderPn", "phoneNumber")),
      delivery_state: rawDelivery || null,
      queued_id: queuedId,
      delivery_error: deliveryError,
      is_stale_pending: isStalePending,
    };
  }));
}


async function fetchInboxConnectionState(userId: string): Promise<{ status: string } | null> {
  const { data, error } = await supabase
    .from("wa_sessions")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.status ? { status: data.status } : null;
}

async function fetchInboxQuickReplies(userId: string): Promise<QuickReply[]> {
  const { data, error } = await supabase
    .from("wa_quick_replies")
    .select("id, shortcut, category, body, sort_order, created_at")
    .eq("user_id", userId)
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as QuickReply[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function digits(value: string | null): string | null {
  const cleaned = value?.replace(/[^0-9]/g, "") ?? "";
  return cleaned || null;
}

function phoneFromRaw(raw: unknown): string | null {
  const obj = asRecord(raw);
  return digits(pickString(obj, "normalizedContactPhone", "senderPn", "participantPn", "phoneNumber", "phone"));
}

function profilePicFromRaw(raw: unknown): string | null {
  const obj = asRecord(raw);
  return pickString(obj, "profilePicUrl", "groupProfilePicUrl", "avatarUrl", "picture", "photoUrl");
}

const MEDIA_TYPE_ALIASES: Record<string, string> = {
  image: "image",
  video: "video",
  audio: "audio",
  voice: "audio",
  ptt: "audio",
  document: "document",
  file: "document",
  doc: "document",
  sticker: "sticker",
  text: "text",
};

function mediaDataFromRaw(raw: unknown): Record<string, unknown> {
  return asRecord(asRecord(raw).mediaData);
}

function normalizeWaMessageType(value: string | null | undefined): string {
  const key = String(value ?? "").trim().toLowerCase();
  return MEDIA_TYPE_ALIASES[key] ?? (key || "text");
}

function mediaTypeFromRaw(raw: unknown, fallback?: string | null): string {
  const obj = asRecord(raw);
  const nested = asRecord(obj.message);
  const nestedKey = Object.keys(nested).find((key) => key.endsWith("Message"));
  const nestedType = nestedKey ? nestedKey.replace(/Message$/, "") : null;
  return normalizeWaMessageType(pickString(obj, "type", "messageType", "mediaType") ?? nestedType ?? fallback ?? "text");
}

function fallbackMimeType(msgType: string): string {
  if (msgType === "image") return "image/jpeg";
  if (msgType === "video") return "video/mp4";
  if (msgType === "audio") return "audio/ogg";
  if (msgType === "sticker") return "image/webp";
  if (msgType === "document") return "application/octet-stream";
  return "application/octet-stream";
}

function mediaUrlFromRaw(raw: unknown, fallbackType?: string | null): string | null {
  const obj = asRecord(raw);
  const media = mediaDataFromRaw(raw);
  const directUrl =
    pickString(media, "dataUrl", "url", "fileUrl", "downloadUrl", "mediaUrl") ??
    pickString(obj, "mediaUrl", "fileUrl", "url");
  if (directUrl?.startsWith("data:")) return directUrl;
  if (directUrl && /^(https?:)?\/\//i.test(directUrl)) return directUrl;

  const base64 = pickString(media, "base64", "fileData", "data");
  if (!base64) return null;
  const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  return `data:${pickString(media, "mimeType", "mimetype", "fileMimeType", "contentType") ?? fallbackMimeType(mediaTypeFromRaw(raw, fallbackType))};base64,${cleanBase64}`;
}

function waStoragePathFromUrl(url: string | null | undefined): string | null {
  const value = url?.trim() ?? "";
  if (!value) return null;
  if (value.startsWith("wa-media:")) return value.slice("wa-media:".length).replace(/^\/+/, "");
  if (value.startsWith("storage://wa-media/")) return value.slice("storage://wa-media/".length).replace(/^\/+/, "");
  return null;
}

function preferInboxMediaUrl(storedUrl: string | null, rawUrl: string | null): string | null {
  if (waStoragePathFromUrl(storedUrl)) return storedUrl;
  if (rawUrl?.startsWith("data:") || waStoragePathFromUrl(rawUrl)) return rawUrl;
  if (storedUrl && /^(https?:)?\/\//i.test(storedUrl)) return storedUrl;
  return rawUrl ?? storedUrl;
}

async function resolveInboxMediaUrl(url: string | null): Promise<string | null> {
  const storagePath = waStoragePathFromUrl(url);
  if (!storagePath) return url;
  const { data, error } = await supabase.storage.from("wa-media").createSignedUrl(storagePath, 60 * 60);
  if (error) {
    console.warn("[inbox] failed to sign WhatsApp media", error.message);
    return null;
  }
  return data.signedUrl;
}

function looksLikeInternalMediaPath(value: string | null | undefined): boolean {
  const text = value?.trim() ?? "";
  return Boolean(text) && /^(bridge|media|uploads?|files?)\//i.test(text);
}

function fileLabel(raw: unknown): string | null {
  const fileName = pickString(mediaDataFromRaw(raw), "fileName", "filename", "name");
  if (!fileName) return null;
  const parts = fileName.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? fileName;
}

function cleanMessageText(text: string | null | undefined, raw: unknown, msgType: string): string | null {
  const media = mediaDataFromRaw(raw);
  const caption = pickString(media, "caption") ?? pickString(asRecord(raw), "caption");
  if (caption && !looksLikeInternalMediaPath(caption)) return caption;
  const trimmed = text?.trim() ?? "";
  if (trimmed && !looksLikeInternalMediaPath(trimmed)) return trimmed;
  return normalizeWaMessageType(msgType) === "document" ? fileLabel(raw) : null;
}

function previewTextFromRaw(raw: unknown, currentText: string | null | undefined, fallbackType?: string | null): string | null {
  const msgType = mediaTypeFromRaw(raw, fallbackType);
  const cleaned = cleanMessageText(currentText, raw, msgType);
  if (cleaned) return cleaned;
  if (msgType === "image") return "[image]";
  if (msgType === "video") return "[video]";
  if (msgType === "audio") return "[audio]";
  if (msgType === "document") return "[file]";
  if (msgType === "sticker") return "[sticker]";
  return currentText?.trim() || null;
}

function initials(s: string): string {
  const cleaned = s.replace(/@.*/, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

function detectMedia(
  msg: string | null | undefined,
  labels: { photo: string; voice: string; doc: string; video: string },
): { icon: React.ReactElement; label: string } | null {
  if (!msg) return null;
  if (/\[image:/i.test(msg) || /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(msg))
    return { icon: <Camera className="h-3 w-3" />, label: labels.photo };
  if (/\[audio:/i.test(msg) || /\.(mp3|wav|ogg|m4a)(\?|$)/i.test(msg))
    return { icon: <Mic className="h-3 w-3" />, label: labels.voice };
  if (/\[video:/i.test(msg) || /\.(mp4|webm|mov)(\?|$)/i.test(msg))
    return { icon: <VideoIcon className="h-3 w-3" />, label: labels.video };
  if (/\[file:/i.test(msg) || /\.(pdf|docx?|xlsx?|pptx?|zip)(\?|$)/i.test(msg))
    return { icon: <FileText className="h-3 w-3" />, label: labels.doc };
  return null;
}

function formatTime(iso: string, isAr: boolean): string {
  return new Date(iso).toLocaleTimeString(isAr ? "ar-EG" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelative(iso: string, isAr: boolean): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return formatTime(iso, isAr);
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return isAr ? "أمس" : "Yest";
  return d.toLocaleDateString(isAr ? "ar-EG" : "en-US", { month: "short", day: "numeric" });
}

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

function dayLabel(iso: string, isAr: boolean, t: { today: string; yesterday: string }): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return t.today;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return t.yesterday;
  return d.toLocaleDateString(isAr ? "ar-EG" : "en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function renderMessagesWithDays(
  messages: ChatMessageRow[],
  isAr: boolean,
  t: { today: string; yesterday: string },
): React.ReactElement[] {
  const out: React.ReactElement[] = [];
  let lastDay = "";
  const isGroup = messages[0]?.remote_jid.endsWith("@g.us") ?? false;
  for (const m of messages) {
    const dk = dayKey(m.created_at);
    if (dk !== lastDay) {
      lastDay = dk;
      out.push(
        <div key={`day-${dk}-${m.id}`} className="my-3 flex justify-center">
          <span className="rounded-full border border-border/50 bg-card/80 px-3 py-1 text-[10px] font-semibold text-muted-foreground shadow-sm backdrop-blur">
            {dayLabel(m.created_at, isAr, t)}
          </span>
        </div>,
      );
    }
    out.push(<ChatBubble key={m.id} m={m} isAr={isAr} isGroup={isGroup} />);
  }
  return out;
}

function ChatBubble({ m, isAr, isGroup }: { m: ChatMessageRow; isAr: boolean; isGroup: boolean }) {
  const isOut = m.direction === "out";
  const showSender = isGroup && !isOut && (m.sender_name || m.sender_phone);
  const isPending = isOut && m.status === "pending";
  const isFailed = isOut && m.status === "failed";
  const isStalePending = isPending && m.is_stale_pending;
  return (
    <div dir="ltr" className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
      <div
        dir={isAr ? "rtl" : "ltr"}
        className={`group min-w-0 max-w-[86%] overflow-hidden px-3.5 py-2 text-sm shadow-sm sm:max-w-[72%] ${
          isFailed
            ? "rounded-2xl rounded-br-md border border-destructive/35 bg-destructive/10 text-foreground rtl:rounded-br-2xl rtl:rounded-bl-md"
            : isPending
              ? "rounded-2xl rounded-br-md border border-primary/25 bg-primary/10 text-foreground rtl:rounded-br-2xl rtl:rounded-bl-md"
              : isOut
                ? "rounded-2xl rounded-br-md bg-gradient-to-br from-primary to-[oklch(0.55_0.28_295)] text-primary-foreground rtl:rounded-br-2xl rtl:rounded-bl-md"
                : "rounded-2xl rounded-bl-md border border-border/60 bg-card text-foreground rtl:rounded-bl-2xl rtl:rounded-br-md"
        }`}
      >
        {showSender && (
          <p className="mb-1 text-[11px] font-semibold text-primary">
            {m.sender_name || (m.sender_phone ? `+${m.sender_phone}` : "")}
          </p>
        )}
        {m.media_url && m.msg_type === "image" && (
          <button
            type="button"
            onClick={() => openMedia({ url: m.media_url!, type: "image" })}
            className="mb-1.5 block overflow-hidden rounded-lg transition hover:opacity-90"
          >
            <img src={m.media_url} alt="" className="max-h-72 w-full object-cover" loading="lazy" />
          </button>
        )}
        {m.media_url && m.msg_type === "video" && (
          <button
            type="button"
            onClick={() => openMedia({ url: m.media_url!, type: "video" })}
            className="mb-1.5 block w-full overflow-hidden rounded-lg"
          >
            <video src={m.media_url} className="pointer-events-none max-h-72 w-full rounded-lg" />
          </button>
        )}
        {m.media_url && m.msg_type === "audio" && (
          <audio src={m.media_url} controls className="mb-1.5 w-full" />
        )}
        {m.media_url && m.msg_type === "document" && (
          <button
            type="button"
            onClick={() => openMedia({ url: m.media_url!, type: "document", name: m.text_body || undefined })}
            className={`mb-1.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs ${isOut ? "bg-white/15 hover:bg-white/25" : "bg-muted hover:bg-muted/70"}`}
          >
            <FileText className="h-4 w-4 shrink-0" />
            <span className="truncate text-start">{m.text_body || "Document"}</span>
          </button>
        )}
        {m.media_url && m.msg_type === "sticker" && (
          <button
            type="button"
            onClick={() => openMedia({ url: m.media_url!, type: "sticker" })}
            className="mb-1.5 block"
          >
            <img src={m.media_url} alt="sticker" className="max-h-32" />
          </button>
        )}
        {m.text_body ? (
          <p className="max-w-full whitespace-pre-wrap break-words text-start leading-relaxed [overflow-wrap:anywhere]">{m.text_body}</p>
        ) : !m.media_url ? (
          <p className="italic opacity-75">[{m.msg_type}]</p>
        ) : null}
        {(isPending || isFailed) && (
          <p className={`mt-1 text-[10px] font-semibold ${isFailed ? "text-destructive" : "text-muted-foreground"}`}>
            {isFailed
              ? isAr
                ? "فشل التسليم بعد إعادة المحاولة"
                : "Delivery failed after retries"
              : isStalePending
                ? isAr
                  ? `معلّقة داخل طابور Bot‑Xtra ولم تغادر للواتساب${m.queued_id ? ` — ${m.queued_id}` : ""}`
                  : `Stuck in Bot‑Xtra queue, not delivered to WhatsApp${m.queued_id ? ` — ${m.queued_id}` : ""}`
              : isAr
                ? "جارٍ تأكيد التسليم…"
                : "Confirming delivery…"}
          </p>
        )}
        <div
          className={`mt-1 flex items-center gap-1 text-[10px] ${
            isOut && !isPending && !isFailed ? "justify-end text-primary-foreground/80" : "justify-end text-muted-foreground"
          }`}
          dir="ltr"
        >
          {m.is_ai && <Bot className="h-3 w-3" />}
          <span>{formatTime(m.created_at, isAr)}</span>
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : isFailed ? (
            <X className="h-3.5 w-3.5 text-destructive" />
          ) : isOut && (
            <CheckCheck className={`h-3.5 w-3.5 ${m.status === "read" ? "text-emerald-200" : "opacity-90"}`} />
          )}
        </div>
      </div>
    </div>
  );
}
