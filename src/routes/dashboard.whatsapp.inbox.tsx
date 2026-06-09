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
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Switch } from "@/components/ui/switch";
import {
  listConversations,
  getConversationMessages,
  sendChatMessage,
  toggleConversationAi,
  markConversationRead,
  type ConversationRow,
  type ChatMessageRow,
} from "@/lib/wa-chat.functions";
import { resyncWaWebhook, sendWaWebhookTest } from "@/lib/wa.functions";

export const Route = createFileRoute("/dashboard/whatsapp/inbox")({
  ssr: false,
  component: InboxPage,
});

type FilterKey = "all" | "unread" | "ai";

function InboxPage() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const { user } = useAuth();
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const listFn = useServerFn(listConversations);
  const msgsFn = useServerFn(getConversationMessages);
  const sendFn = useServerFn(sendChatMessage);
  const toggleAiFn = useServerFn(toggleConversationAi);
  const markReadFn = useServerFn(markConversationRead);

  const [activeJid, setActiveJid] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
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
      return await fn();
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
    queryKey: ["wa-conversations"],
    queryFn: () => safeCall<ConversationRow[]>(() => listFn(), []),
    enabled: !!user,
    placeholderData: [],
    refetchInterval: 15000,
  });
  const msgsQuery = useQuery<ChatMessageRow[]>({
    queryKey: ["wa-messages", activeJid],
    queryFn: () =>
      activeJid
        ? safeCall<ChatMessageRow[]>(() => msgsFn({ data: { remoteJid: activeJid } }), [])
        : Promise.resolve([]),
    enabled: !!activeJid && !!user,
    placeholderData: [],
    refetchInterval: 5000,
  });
  const conversations = useMemo<ConversationRow[]>(
    () => (Array.isArray(convQuery.data) ? convQuery.data : []),
    [convQuery.data],
  );
  const messages = useMemo<ChatMessageRow[]>(
    () => (Array.isArray(msgsQuery.data) ? msgsQuery.data : []),
    [msgsQuery.data],
  );

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
        { event: "INSERT", schema: "public", table: "wa_messages", filter: `user_id=eq.${user.id}` },
        (payload) => {
          // Always refresh the conversation list so the new chat appears
          qc.invalidateQueries({ queryKey: ["wa-conversations"] });
          const row = payload.new as { remote_jid: string };
          if (activeJid && row.remote_jid === activeJid) {
            qc.invalidateQueries({ queryKey: ["wa-messages", activeJid] });
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
    if (!activeJid) return;
    const c = conversations.find((x) => x.remote_jid === activeJid);
    if (c && c.unread_count > 0) {
      markReadFn({ data: { id: c.id } }).then(() => {
        qc.invalidateQueries({ queryKey: ["wa-conversations"] });
      });
    }
  }, [activeJid, conversations, markReadFn, qc]);

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
      qc.invalidateQueries({ queryKey: ["wa-messages", activeJid] });
      qc.invalidateQueries({ queryKey: ["wa-conversations"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const aiToggleMut = useMutation({
    mutationFn: (vars: { id: string; enabled: boolean }) => toggleAiFn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-conversations"] }),
    onError: (err: Error) => toast.error(err.message),
  });

  const resyncFn = useServerFn(resyncWaWebhook);
  const testFn = useServerFn(sendWaWebhookTest);
  const resyncMut = useMutation({
    mutationFn: () => resyncFn(),
    onSuccess: (r) => {
      if (r.ok) {
        toast.success(isAr ? "تم إعادة الربط بنجاح" : "Webhook resynced", {
          description: r.webhookUrl ?? undefined,
        });
      } else {
        toast.error(isAr ? "تعذر إعادة الربط" : "Resync failed", {
          description: r.error ?? undefined,
        });
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const testMut = useMutation({
    mutationFn: () => testFn(),
    onSuccess: (r) => {
      if (r.ok) {
        toast.success(isAr ? "تم إرسال رسالة اختبار" : "Test message sent", {
          description: isAr ? "ستظهر خلال ثوانٍ إن كانت السلسلة سليمة" : "Should appear in seconds if the chain works",
        });
        setTimeout(() => qc.invalidateQueries({ queryKey: ["wa-conversations"] }), 1500);
      } else {
        toast.error(isAr ? "فشل الاختبار" : "Test failed", {
          description: r.error ?? `HTTP ${(r as any).status ?? "?"}`,
        });
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });
    mutationFn: (vars: { id: string; enabled: boolean }) => toggleAiFn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-conversations"] }),
    onError: (err: Error) => toast.error(err.message),
  });

  const filtered = useMemo(() => {
    const list = conversations;
    let out = list;
    if (filter === "unread") out = out.filter((c) => c.unread_count > 0);
    else if (filter === "ai") out = out.filter((c) => c.ai_enabled);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(
        (c) =>
          c.remote_jid.toLowerCase().includes(q) ||
          (c.contact_name ?? "").toLowerCase().includes(q) ||
          (c.last_message_text ?? "").toLowerCase().includes(q),
      );
    }
    return out;
  }, [conversations, search, filter]);

  const totalUnread = useMemo(
    () => conversations.reduce((s, c) => s + (c.unread_count || 0), 0),
    [conversations],
  );

  const activeConv = useMemo(
    () => conversations.find((c) => c.remote_jid === activeJid),
    [conversations, activeJid],
  );

  const toggleSound = () => {
    setSoundOn((p) => {
      const next = !p;
      try {
        localStorage.setItem("flowtix-inbox-sound", String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const Sidebar = (
    <aside dir={isAr ? "rtl" : "ltr"} className="flex h-full min-h-0 flex-col bg-card/60 backdrop-blur-sm">
      {/* Header */}
      <div className="border-b border-border/60 p-4">
        <div className="flex items-center gap-3">
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
          <div className="flex items-center gap-1">
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
        <div className="mt-3 flex items-center gap-1.5">
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
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
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
            <p className="px-6 text-sm font-medium">{t.empty}</p>
            <p className="px-6 text-xs text-muted-foreground">{t.emptyHint}</p>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2 px-4">
              <Link
                to="/dashboard/whatsapp/accounts"
                className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90"
              >
                {t.openAccounts}
              </Link>
              <button
                type="button"
                onClick={() => resyncMut.mutate()}
                disabled={resyncMut.isPending}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-muted/60 disabled:opacity-60"
                title={isAr ? "إعادة ربط الـ webhook بالخادم" : "Resync webhook with bridge"}
              >
                {resyncMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                {isAr ? "إعادة ربط الاستقبال" : "Resync receiver"}
              </button>
              <button
                type="button"
                onClick={() => testMut.mutate()}
                disabled={testMut.isPending}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-muted/60 disabled:opacity-60"
                title={isAr ? "اختبار وصول رسالة تجريبية" : "Send a test inbound message"}
              >
                {testMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {isAr ? "اختبار استقبال" : "Test inbound"}
              </button>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border/30">
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
    <section dir={isAr ? "rtl" : "ltr"} className="relative flex h-full min-h-0 flex-col bg-gradient-to-br from-primary/[0.04] via-background to-primary/[0.06]">
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
          <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-card/80 px-4 py-3 backdrop-blur">
            <div className="flex min-w-0 items-center gap-3">
              {isMobile && (
                <button
                  type="button"
                  onClick={() => setActiveJid(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-muted"
                  aria-label={t.backToList}
                >
                  <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
                </button>
              )}
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[oklch(0.52_0.28_290)] text-sm font-bold text-white shadow-md shadow-primary/20">
                {initials(activeConv?.contact_name ?? activeJid)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">
                  {activeConv?.contact_name ?? activeJid.replace(/@.*/, "")}
                </p>
                <p className="truncate text-xs text-muted-foreground" dir="ltr">
                  {activeConv?.contact_phone ? `+${activeConv.contact_phone}` : activeJid}
                </p>
              </div>
            </div>
            {activeConv && (
              <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-background/60 px-3 py-1.5">
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
            className="relative flex-1 space-y-1 overflow-y-auto px-3 py-4 sm:px-6"
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
            className="border-t border-border/60 bg-card/80 p-3 backdrop-blur"
          >
            <div className="flex items-end gap-2 rounded-2xl border border-input bg-background px-2.5 py-1.5 shadow-sm transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
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
                className="max-h-32 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted-foreground"
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
    <FullscreenInbox isAr={isAr} title={t.title} totalUnread={totalUnread}>
      <div className="h-full w-full overflow-hidden bg-card">
        {isMobile ? (
          <div className="h-full">
            {activeJid ? ChatPane : Sidebar}
          </div>
        ) : (
          <ResizablePanelGroup
            orientation="horizontal"
            className="h-full w-full"
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
      </div>
    </FullscreenInbox>
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
  const name = conv.contact_name ?? jid.replace(/@.*/, "");
  const phone = conv.contact_phone ? `+${conv.contact_phone}` : jid;
  return (
    <aside dir={isAr ? "rtl" : "ltr"} className="flex h-full min-h-0 flex-col bg-card/40 backdrop-blur-sm">
      {/* Contact header */}
      <div className="flex flex-col items-center gap-3 border-b border-border/60 p-5 text-center">
        <div className="relative">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[oklch(0.52_0.28_290)] text-2xl font-bold text-white shadow-lg shadow-primary/30">
            {initials(name)}
          </div>
          <span className="absolute bottom-1 right-1 h-4 w-4 rounded-full border-2 border-card bg-emerald-500" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold">{name}</h2>
          <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground" dir="ltr">
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
            onClick={() => toast.info(isAr ? "قريباً" : "Soon")}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background/60 px-2 py-2 text-[11px] font-semibold transition hover:border-primary/40 hover:bg-primary/5"
          >
            <UserPlus className="h-3.5 w-3.5 text-primary" />
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
      <div className="flex-1 overflow-y-auto p-4 text-sm">
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
    <div className="rounded-xl border border-border/60 bg-background/40 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-medium" dir={ltr ? "ltr" : undefined}>{value}</p>
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
        className={`flex w-full items-center gap-3 px-3 py-3 text-left transition ${
          active
            ? "bg-primary/10"
            : "hover:bg-muted/50"
        }`}
      >
        {active && (
          <span className="absolute top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-primary to-[oklch(0.52_0.28_290)] ltr:left-0 rtl:right-0" />
        )}
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[oklch(0.52_0.28_290)] text-sm font-bold text-white shadow-sm shadow-primary/20">
          {initials(conv.contact_name ?? conv.remote_jid)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className={`truncate text-sm ${conv.unread_count > 0 ? "font-bold" : "font-semibold"}`}>
              {conv.contact_name ?? conv.remote_jid.replace(/@.*/, "")}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground" dir="ltr">
              {formatRelative(conv.last_message_at, isAr)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <p className={`min-w-0 flex-1 truncate text-xs ${conv.unread_count > 0 ? "text-foreground" : "text-muted-foreground"}`}>
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
        <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground shadow">
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
    out.push(<ChatBubble key={m.id} m={m} isAr={isAr} />);
  }
  return out;
}

function ChatBubble({ m, isAr }: { m: ChatMessageRow; isAr: boolean }) {
  const isOut = m.direction === "out";
  return (
    <div className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
      <div
        className={`group max-w-[78%] px-3.5 py-2 text-sm shadow-sm sm:max-w-[70%] ${
          isOut
            ? "rounded-2xl rounded-br-md bg-gradient-to-br from-primary to-[oklch(0.55_0.28_295)] text-primary-foreground rtl:rounded-br-2xl rtl:rounded-bl-md"
            : "rounded-2xl rounded-bl-md border border-border/60 bg-card text-foreground rtl:rounded-bl-2xl rtl:rounded-br-md"
        }`}
      >
        {m.text_body ? (
          <p className="whitespace-pre-wrap break-words leading-relaxed">{m.text_body}</p>
        ) : (
          <p className="italic opacity-75">[{m.msg_type}]</p>
        )}
        <div
          className={`mt-1 flex items-center gap-1 text-[10px] ${
            isOut ? "justify-end text-primary-foreground/80" : "text-muted-foreground"
          }`}
          dir="ltr"
        >
          {m.is_ai && <Bot className="h-3 w-3" />}
          <span>{formatTime(m.created_at, isAr)}</span>
          {isOut && <CheckCheck className="h-3.5 w-3.5 opacity-90" />}
        </div>
      </div>
    </div>
  );
}
