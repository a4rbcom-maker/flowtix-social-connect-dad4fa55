import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { MessageCircle, Inbox, Search, Loader2 } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/dashboard/whatsapp/inbox")({
  ssr: false,
  component: InboxPage,
});

type ChatRow = {
  remote_jid: string;
  last_text: string | null;
  last_at: string;
  last_direction: "in" | "out";
  count: number;
};

type WaMessage = {
  id: string;
  remote_jid: string;
  direction: "in" | "out";
  text_body: string | null;
  msg_type: string;
  created_at: string;
};

function InboxPage() {
  const { lang } = useI18n();
  const [messages, setMessages] = useState<WaMessage[] | null>(null);
  const [search, setSearch] = useState("");

  const t = lang === "ar"
    ? {
        title: "دردشة واتساب",
        subtitle: "كل المحادثات الواردة والصادرة عبر جلسات واتساب المربوطة.",
        search: "ابحث برقم أو نص…",
        empty: "ما فيش محادثات لسة. اربط حساب واتساب أولاً من «حساباتي».",
        you: "أنت",
        loading: "جارٍ التحميل…",
      }
    : {
        title: "WhatsApp Chats",
        subtitle: "All incoming and outgoing conversations across linked WhatsApp sessions.",
        search: "Search by number or text…",
        empty: "No conversations yet. Link a WhatsApp account first from «My Accounts».",
        you: "You",
        loading: "Loading…",
      };

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("wa_messages")
        .select("id, remote_jid, direction, text_body, msg_type, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (active) setMessages((data as WaMessage[] | null) ?? []);
    })();

    const channel = supabase
      .channel("wa_messages_inbox")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "wa_messages" }, (payload) => {
        const row = payload.new as WaMessage;
        setMessages((prev) => (prev ? [row, ...prev] : [row]));
      })
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  const chats: ChatRow[] = useMemo(() => {
    if (!messages) return [];
    const map = new Map<string, ChatRow>();
    for (const m of messages) {
      const ex = map.get(m.remote_jid);
      if (!ex) {
        map.set(m.remote_jid, {
          remote_jid: m.remote_jid,
          last_text: m.text_body ?? `[${m.msg_type}]`,
          last_at: m.created_at,
          last_direction: m.direction,
          count: 1,
        });
      } else {
        ex.count += 1;
      }
    }
    let list = Array.from(map.values()).sort((a, b) => (a.last_at < b.last_at ? 1 : -1));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.remote_jid.toLowerCase().includes(q) ||
          (c.last_text ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [messages, search]);

  return (
    <DashboardLayout title={t.title}>
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[oklch(0.66_0.26_320)] text-white shadow-lg">
              <Inbox className="h-6 w-6" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">{t.title}</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">{t.subtitle}</p>
            </div>
          </div>

          <div className="mt-5 relative">
            <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground ltr:left-3 rtl:right-3" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.search}
              className="w-full rounded-xl border border-input bg-background/60 px-10 py-2.5 text-sm outline-none focus:border-primary"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden">
          {messages === null ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t.loading}
            </div>
          ) : chats.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
                <MessageCircle className="h-7 w-7 text-muted-foreground" />
              </div>
              <p className="max-w-md px-6 text-sm text-muted-foreground">{t.empty}</p>
              <Link
                to="/dashboard/whatsapp/accounts"
                className="mt-1 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:opacity-90"
              >
                {lang === "ar" ? "افتح حساباتي" : "Open My Accounts"}
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {chats.map((c) => (
                <li key={c.remote_jid} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {c.remote_jid.slice(-2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-foreground" dir="ltr">
                        {c.remote_jid.replace(/@.*/, "")}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground" dir="ltr">
                        {new Date(c.last_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {c.last_direction === "out" && <span className="font-medium text-primary">{t.you}: </span>}
                      {c.last_text}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    {c.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
