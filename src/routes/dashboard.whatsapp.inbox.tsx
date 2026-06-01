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
  BotOff,
  Inbox as InboxIcon,
  Sparkles,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import {
  listConversations,
  getConversationMessages,
  sendChatMessage,
  toggleConversationAi,
  markConversationRead,
  type ConversationRow,
  type ChatMessageRow,
} from "@/lib/wa-chat.functions";

export const Route = createFileRoute("/dashboard/whatsapp/inbox")({
  ssr: false,
  component: InboxPage,
});

function InboxPage() {
  const { lang } = useI18n();
  const qc = useQueryClient();
  const listFn = useServerFn(listConversations);
  const msgsFn = useServerFn(getConversationMessages);
  const sendFn = useServerFn(sendChatMessage);
  const toggleAiFn = useServerFn(toggleConversationAi);
  const markReadFn = useServerFn(markConversationRead);

  const [activeJid, setActiveJid] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const t = lang === "ar"
    ? {
        title: "محادثات واتساب",
        subtitle: "كل المحادثات الواردة والصادرة في مكان واحد.",
        search: "ابحث برقم أو اسم…",
        empty: "ما فيش محادثات لسة.",
        emptyHint: "اربط حساب واتساب من «حساباتي» وانتظر أول رسالة.",
        openAccounts: "افتح حساباتي",
        you: "أنت",
        ai: "AI",
        selectChat: "اختر محادثة من القائمة لعرض الرسائل",
        typeMessage: "اكتب رسالة…",
        send: "إرسال",
        loading: "جارٍ التحميل…",
        aiOn: "AI مفعّل",
        aiOff: "AI متوقف",
        backToList: "رجوع",
        unread: "غير مقروء",
      }
    : {
        title: "WhatsApp Chats",
        subtitle: "All your incoming and outgoing conversations in one place.",
        search: "Search by number or name…",
        empty: "No conversations yet.",
        emptyHint: "Link a WhatsApp account from «My Accounts» and wait for the first message.",
        openAccounts: "Open My Accounts",
        you: "You",
        ai: "AI",
        selectChat: "Select a conversation to view messages",
        typeMessage: "Type a message…",
        send: "Send",
        loading: "Loading…",
        aiOn: "AI on",
        aiOff: "AI off",
        backToList: "Back",
        unread: "Unread",
      };

  // Conversations list (with realtime invalidation)
  const convQuery = useQuery<ConversationRow[]>({
    queryKey: ["wa-conversations"],
    queryFn: () => listFn(),
    refetchInterval: 15000,
  });

  // Active conversation messages
  const msgsQuery = useQuery<ChatMessageRow[]>({
    queryKey: ["wa-messages", activeJid],
    queryFn: () => (activeJid ? msgsFn({ data: { remoteJid: activeJid } }) : Promise.resolve([])),
    enabled: !!activeJid,
    refetchInterval: 5000,
  });

  // Realtime subscriptions
  useEffect(() => {
    const ch = supabase
      .channel("wa_inbox_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wa_conversations" },
        () => qc.invalidateQueries({ queryKey: ["wa-conversations"] }),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "wa_messages" },
        (payload) => {
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
  }, [qc, activeJid]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [msgsQuery.data?.length]);

  // Mark active conversation as read
  useEffect(() => {
    if (!activeJid || !convQuery.data) return;
    const c = convQuery.data.find((x) => x.remote_jid === activeJid);
    if (c && c.unread_count > 0) {
      markReadFn({ data: { id: c.id } }).then(() => {
        qc.invalidateQueries({ queryKey: ["wa-conversations"] });
      });
    }
  }, [activeJid, convQuery.data, markReadFn, qc]);

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
    mutationFn: (vars: { id: string; enabled: boolean }) =>
      toggleAiFn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-conversations"] }),
    onError: (err: Error) => toast.error(err.message),
  });

  const filtered = useMemo(() => {
    const list = convQuery.data ?? [];
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter(
      (c) =>
        c.remote_jid.toLowerCase().includes(q) ||
        (c.contact_name ?? "").toLowerCase().includes(q) ||
        (c.last_message_text ?? "").toLowerCase().includes(q),
    );
  }, [convQuery.data, search]);

  const activeConv = useMemo(
    () => (convQuery.data ?? []).find((c) => c.remote_jid === activeJid),
    [convQuery.data, activeJid],
  );

  return (
    <DashboardLayout title={t.title}>
      <div className="mx-auto max-w-7xl">
        <div className="grid h-[calc(100vh-10rem)] grid-cols-1 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm md:grid-cols-[340px_1fr]">
          {/* Sidebar list */}
          <aside
            className={`flex flex-col border-border/60 ltr:border-r rtl:border-l ${activeJid ? "hidden md:flex" : "flex"}`}
          >
            <div className="border-b border-border/60 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[oklch(0.66_0.26_320)] text-white">
                  <InboxIcon className="h-5 w-5" strokeWidth={2.5} />
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-base font-bold">{t.title}</h1>
                  <p className="truncate text-xs text-muted-foreground">{t.subtitle}</p>
                </div>
              </div>
              <div className="relative mt-3">
                <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground ltr:left-3 rtl:right-3" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.search}
                  className="w-full rounded-xl border border-input bg-background/60 px-10 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
            </div>

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
                  <Link
                    to="/dashboard/whatsapp/accounts"
                    className="mt-1 inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90"
                  >
                    {t.openAccounts}
                  </Link>
                </div>
              ) : (
                <ul className="divide-y divide-border/40">
                  {filtered.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setActiveJid(c.remote_jid)}
                        className={`flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-muted/50 ${
                          activeJid === c.remote_jid ? "bg-primary/5" : ""
                        }`}
                      >
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                          {(c.contact_name ?? c.remote_jid).slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-semibold">
                              {c.contact_name ?? c.remote_jid.replace(/@.*/, "")}
                            </span>
                            <span className="shrink-0 text-[10px] text-muted-foreground" dir="ltr">
                              {formatTime(c.last_message_at, lang)}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-2">
                            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                              {c.last_direction === "out" && (
                                <span className="font-medium text-primary">{t.you}: </span>
                              )}
                              {c.last_message_text ?? "—"}
                            </p>
                            {c.ai_enabled && (
                              <Bot className="h-3 w-3 shrink-0 text-primary" aria-label={t.ai} />
                            )}
                            {c.unread_count > 0 && (
                              <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                                {c.unread_count}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          {/* Chat pane */}
          <section className={`flex flex-col bg-muted/20 ${activeJid ? "flex" : "hidden md:flex"}`}>
            {!activeJid ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                  <Sparkles className="h-8 w-8 text-primary" />
                </div>
                <p className="max-w-sm text-sm text-muted-foreground">{t.selectChat}</p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-card px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setActiveJid(null)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-muted md:hidden"
                      aria-label={t.backToList}
                    >
                      <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
                    </button>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {(activeConv?.contact_name ?? activeJid).slice(0, 2).toUpperCase()}
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
                    <button
                      type="button"
                      onClick={() =>
                        aiToggleMut.mutate({ id: activeConv.id, enabled: !activeConv.ai_enabled })
                      }
                      disabled={aiToggleMut.isPending}
                      className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition ${
                        activeConv.ai_enabled
                          ? "bg-primary/15 text-primary hover:bg-primary/20"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {activeConv.ai_enabled ? <Bot className="h-3.5 w-3.5" /> : <BotOff className="h-3.5 w-3.5" />}
                      {activeConv.ai_enabled ? t.aiOn : t.aiOff}
                    </button>
                  )}
                </div>

                {/* Messages */}
                <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-4">
                  {msgsQuery.isLoading ? (
                    <div className="flex justify-center py-6">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    (msgsQuery.data ?? []).map((m) => (
                      <div
                        key={m.id}
                        className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                            m.direction === "out"
                              ? "bg-primary text-primary-foreground"
                              : "bg-card text-foreground"
                          }`}
                        >
                          {m.text_body ? (
                            <p className="whitespace-pre-wrap break-words leading-relaxed">{m.text_body}</p>
                          ) : (
                            <p className="italic opacity-75">[{m.msg_type}]</p>
                          )}
                          <div
                            className={`mt-1 flex items-center gap-1 text-[10px] ${
                              m.direction === "out" ? "text-primary-foreground/70 justify-end" : "text-muted-foreground"
                            }`}
                            dir="ltr"
                          >
                            {m.is_ai && <Bot className="h-3 w-3" />}
                            {formatTime(m.created_at, lang)}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Composer */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!draft.trim() || sendMut.isPending) return;
                    sendMut.mutate(draft.trim());
                  }}
                  className="flex items-end gap-2 border-t border-border/60 bg-card p-3"
                >
                  <textarea
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
                    className="max-h-32 flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                  <button
                    type="submit"
                    disabled={!draft.trim() || sendMut.isPending}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow hover:opacity-90 disabled:opacity-50"
                    aria-label={t.send}
                  >
                    {sendMut.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 rtl:rotate-180" />
                    )}
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      </div>
    </DashboardLayout>
  );
}

function formatTime(iso: string, lang: "ar" | "en"): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", {
    month: "short",
    day: "numeric",
  });
}
