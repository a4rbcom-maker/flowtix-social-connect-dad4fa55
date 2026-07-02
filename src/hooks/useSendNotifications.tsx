import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import type { SendLogRow, SendStatus } from "@/lib/notifications";

interface NotificationsCtx {
  items: SendLogRow[];
  unreadCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<NotificationsCtx | null>(null);

const RECENT_LIMIT = 30;

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { lang } = useI18n();
  const [items, setItems] = useState<SendLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = async () => {
    if (!user) {
      setItems([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("send_log")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT);
    setItems(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`send_log:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "send_log",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as SendLogRow;
          setItems((prev) => [row, ...prev].slice(0, RECENT_LIMIT));
          showStatusToast(row, lang);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "send_log",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as SendLogRow;
          const old = payload.old as SendLogRow;
          setItems((prev) => prev.map((it) => (it.id === row.id ? row : it)));
          if (old?.status !== row.status) showStatusToast(row, lang);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "send_log",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const old = payload.old as SendLogRow;
          setItems((prev) => prev.filter((it) => it.id !== old.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, lang]);

  const value = useMemo<NotificationsCtx>(
    () => ({
      items,
      unreadCount: items.filter((i) => !i.read).length,
      loading,
      refresh: fetchItems,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, loading]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSendNotifications() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSendNotifications must be used within NotificationsProvider");
  return ctx;
}

function isInternalArea(): boolean {
  if (typeof window === "undefined") return false;
  const p = window.location.pathname || "";
  // Only surface operational toasts inside authenticated internal areas.
  // Never show them on the public marketing site / landing / auth pages.
  return p.startsWith("/dashboard") || p.startsWith("/admin");
}

function showStatusToast(row: SendLogRow, lang: "ar" | "en") {
  if (!isInternalArea()) return;
  const map: Record<SendStatus, { ar: string; en: string }> = {
    pending: { ar: "قيد الانتظار", en: "Pending" },
    processing: { ar: "قيد المعالجة", en: "Processing" },
    success: { ar: "تم بنجاح", en: "Success" },
    failed: { ar: "فشل", en: "Failed" },
  };
  const status = row.status as SendStatus;
  const label = map[status]?.[lang] ?? (lang === "ar" ? "تحديث جديد" : "New update");
  const desc = `${label}${row.recipient ? ` — ${row.recipient}` : ""}`;
  if (status === "success") toast.success(row.title, { description: desc });
  else if (status === "failed") toast.error(row.title, { description: row.error_message || desc });
  else if (status === "processing") toast.loading(row.title, { description: desc, id: row.id });
  else toast(row.title, { description: desc });
}
