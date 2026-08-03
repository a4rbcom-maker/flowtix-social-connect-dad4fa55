import { useTranslation } from "react-i18next";
import { Menu, Bell, Search, X, Check, Clock } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/authProvider";
import { supabase } from "@/lib/supabase";
import { Avatar } from "@/components/ui/avatar";
import { Dropdown } from "@/components/ui/dropdown";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeToggleFull } from "./ThemeToggle";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";

function NotificationPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<Array<{ id: string; title: string; body: string; type: string; read_at: string | null; created_at: string }>>([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const [nRes, cRes] = await Promise.all([
          (supabase as any).rpc("user_get_notifications", { p_limit: 20, p_unread_only: false }),
          (supabase as any).rpc("user_unread_count"),
        ]);
        if (nRes.data) setItems(nRes.data);
        if (cRes.data != null) setUnread(Number(cRes.data));
      } catch {}
    })();
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
  }, [open, onClose]);

  if (!open) return null;

  const accentMap: Record<string, string> = {
    success: "bg-[var(--color-success)]", info: "bg-[var(--color-info)]", primary: "bg-[var(--color-primary)]", warning: "bg-[var(--color-warning)]", error: "bg-[var(--color-error)]",
    system: "bg-[var(--color-primary)]",
  };
  const getAccentKey = (type: string) => {
    if (type === "info" || type === "success" || type === "warning" || type === "error" || type === "primary" || type === "system") return type;
    return "info";
  };

  async function markRead(id: string) {
    try { await (supabase as any).rpc("user_mark_notification_read", { p_id: id }); setItems(prev => prev.map(i => i.id === id ? { ...i, read_at: new Date().toISOString() } : i)); setUnread(prev => Math.max(0, prev - 1)); } catch {}
  }
  async function markAllRead() {
    try { await (supabase as any).rpc("user_mark_all_read"); setItems(prev => prev.map(i => ({ ...i, read_at: i.read_at || new Date().toISOString() }))); setUnread(0); } catch {}
  }

  return (
    <div ref={ref} className="absolute end-0 top-full mt-2 w-[22rem] overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-lg)] animate-[fade-in_0.15s_ease-out] z-50">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <div><h3 className="text-sm font-semibold text-[var(--color-fg)]">{t("dashboard.notifications")}</h3><p className="text-xs text-[var(--color-fg-subtle)]">{unread} unread</p></div>
        <button onClick={onClose} className="rounded-md p-1 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] transition-colors" aria-label="Close"><X className="size-4" /></button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {items.length === 0 ? <p className="px-4 py-8 text-center text-sm text-[var(--color-fg-subtle)]">{t("dashboard.noNotifications")}</p> : items.map((n) => {
          const a = accentMap[getAccentKey(n.type)] ?? accentMap.info;
          const time = n.created_at ? new Date(n.created_at).toLocaleString().split(",")[0] : "";
          return (
            <div key={n.id} onClick={() => { if (!n.read_at) markRead(n.id); }}
              className={cn("flex items-start gap-3 border-b border-[var(--color-border)] px-4 py-3 transition-colors hover:bg-[var(--color-surface-2)] cursor-pointer", !n.read_at && "bg-[color-mix(in_oklab,var(--color-primary)_4%,transparent)]")}>
              <div className={cn("mt-1.5 size-2 shrink-0 rounded-full", a, !n.read_at && "ring-4 ring-[color-mix(in_oklab,currentColor_25%,transparent)]")} />
              <div className="flex-1 min-w-0"><p className="text-sm font-medium text-[var(--color-fg)] truncate">{n.title}</p><p className="text-xs text-[var(--color-fg-muted)] truncate">{n.body}</p>
                <div className="flex items-center gap-1.5 mt-0.5"><Clock className="size-3 text-[var(--color-fg-subtle)]" /><span className="text-[0.65rem] text-[var(--color-fg-subtle)]">{time}</span>
                  {n.read_at && <span className="text-[0.65rem] text-[var(--color-success)]">✓ Read</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-surface-2)]/50 px-4 py-2">
        <button onClick={markAllRead} className="text-xs font-semibold text-[var(--color-primary-soft)] hover:underline flex items-center gap-1 transition-colors"><Check className="size-3" />{t("dashboard.markAllRead")}</button>
        <button onClick={onClose} className="text-xs font-semibold text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] flex items-center gap-1 transition-colors">{t("common.close")}</button>
      </div>
    </div>
  );
}

function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      setQuery("");
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const quickResults = [
    { label: t("pages.dashboard.title"), to: "/dashboard" },
    { label: t("nav.fbSessions"), to: "/dashboard/facebook/sessions" },
    { label: t("pages.tasks.title"), to: "/dashboard/tasks" },
  ].filter(r => !query || r.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center pt-[15vh] px-4">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative z-10 w-full max-w-xl rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-xl)] animate-[scale-in_0.2s_ease-out] overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--color-border)]">
          <Search className="size-5 text-[var(--color-primary-soft)] shrink-0" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("dashboard.searchPlaceholder")}
            className="flex-1 bg-transparent text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[0.65rem] font-medium text-[var(--color-fg-muted)]">ESC</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {quickResults.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-[var(--color-fg-muted)]">No results</p>
          ) : (
            quickResults.map((r) => (
              <button
                key={r.to}
                onClick={() => { navigate(r.to); onClose(); }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start transition-colors hover:bg-[var(--color-surface-2)]"
              >
                <Search className="size-3.5 text-[var(--color-fg-subtle)]" aria-hidden />
                <span className="text-sm text-[var(--color-fg)]">{r.label}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function Header({ onMenuClick, onSearchClick }: { onMenuClick: () => void; onSearchClick: () => void }) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [notifOpen, setNotifOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await (supabase as any).rpc("user_unread_count");
        if (data != null) setUnreadCount(Number(data));
      } catch {}
    })();
  }, []);

  const userItems = [
    { key: "profile", label: t("dashboard.userMenu.profile") },
    { key: "settings", label: t("dashboard.userMenu.settings") },
    { key: "logout", label: t("dashboard.userMenu.logout"), danger: true },
  ];

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 sm:gap-3 border-b border-[var(--color-border)] glass px-3 sm:px-6">
      <button
        onClick={onMenuClick}
        className="shrink-0 rounded-lg p-2 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] lg:hidden transition-colors"
        aria-label={t("nav.openMenu")}
      >
        <Menu className="size-5" />
      </button>

      {/* Logo on desktop */}
      <div className="hidden lg:flex items-center ms-1">
        <span className="scale-90 origin-start">
          <Logo />
        </span>
      </div>

      {/* Search - hides text on mobile, shows only icon */}
      <button
        onClick={onSearchClick}
        className="flex items-center gap-2 h-10 w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-fg-subtle)] transition-all duration-200 hover:bg-[var(--color-surface-2)] hover:border-[var(--color-border-strong)] focus-within:border-[var(--color-primary)]/50 focus-within:ring-2 focus-within:ring-[var(--color-primary)]/10"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 text-start truncate hidden sm:inline">{t("dashboard.search")}</span>
        <kbd className="hidden md:inline-flex items-center rounded border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[0.65rem] font-medium text-[var(--color-fg-muted)]">⌘K</kbd>
      </button>

      <div className="ms-auto flex items-center gap-1 sm:gap-2 shrink-0">
        <div className="hidden sm:block">
          <ThemeToggleFull />
        </div>
        <div className="hidden sm:block">
          <LanguageSwitcher />
        </div>

        <div className="relative">
          <button
            onClick={() => setNotifOpen((v) => !v)}
            className={cn(
              "relative rounded-lg p-2 text-[var(--color-fg-muted)] transition-all duration-200 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]",
              notifOpen && "bg-[var(--color-surface-2)] text-[var(--color-fg)]",
            )}
            aria-label={t("dashboard.notifications")}
          >
            <Bell className={cn("size-5", unreadCount > 0 && "animate-[wiggle_0.5s_ease-in-out]")} />
            {unreadCount > 0 && (
              <span className="absolute -end-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-[var(--color-error)] text-[0.6rem] font-bold text-white ring-2 ring-[var(--color-bg)]">
                {unreadCount}
              </span>
            )}
          </button>
          <NotificationPanel open={notifOpen} onClose={() => setNotifOpen(false)} />
        </div>

        <Dropdown
          trigger={
            <button className="flex items-center gap-2 rounded-lg p-1.5 transition-colors hover:bg-[var(--color-surface-2)]">
              <Avatar fallback={profile?.full_name ?? "FT"} src={profile?.avatar_url} size="sm" />
            </button>
          }
          items={userItems}
          onSelect={(key) => {
            if (key === "profile") navigate("/dashboard/profile");
            if (key === "settings") navigate("/dashboard/profile");
            if (key === "logout") {
              supabase.auth.signOut();
            }
          }}
        />
      </div>
    </header>
  );
}

export { GlobalSearch };
