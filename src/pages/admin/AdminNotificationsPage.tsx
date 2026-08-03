import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Bell, Send, BellOff, Info, AlertTriangle, CheckCircle2, XCircle, Sparkles,
  Clock, Users, Megaphone, Pencil, Hash, CalendarClock,
  Mail, type LucideIcon,
} from "lucide-react";
import { PageHeader, StatCard } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { EmptyState, LoadingState } from "@/components/ui/state";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

interface BroadcastItem {
  id: string; title: string; body: string; type: string;
  sent_by_email: string; recipients: number; created_at: string;
}

type BroadcastType = "info" | "success" | "warning" | "error" | "system";
type FilterType = "all" | BroadcastType;

const TYPE_META: Record<BroadcastType, { icon: LucideIcon; label: string; accent: string; bg: string; ring: string; chip: string }> = {
  info:    { icon: Info,          label: "Info",    accent: "text-[var(--color-info)]",    bg: "bg-[color-mix(in_oklab,var(--color-info)_14%,transparent)]",    ring: "ring-[var(--color-info)]/25",    chip: "border-[color-mix(in_oklab,var(--color-info)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-info)_12%,transparent)] text-[var(--color-info)]" },
  success: { icon: CheckCircle2,  label: "Success", accent: "text-[var(--color-success)]", bg: "bg-[color-mix(in_oklab,var(--color-success)_14%,transparent)]", ring: "ring-[var(--color-success)]/25", chip: "border-[color-mix(in_oklab,var(--color-success)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-success)_12%,transparent)] text-[var(--color-success)]" },
  warning: { icon: AlertTriangle, label: "Warning", accent: "text-[var(--color-warning)]", bg: "bg-[color-mix(in_oklab,var(--color-warning)_14%,transparent)]", ring: "ring-[var(--color-warning)]/25", chip: "border-[color-mix(in_oklab,var(--color-warning)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-warning)_12%,transparent)] text-[var(--color-warning)]" },
  error:   { icon: XCircle,       label: "Error",   accent: "text-[var(--color-error)]",   bg: "bg-[color-mix(in_oklab,var(--color-error)_14%,transparent)]",   ring: "ring-[var(--color-error)]/25",   chip: "border-[color-mix(in_oklab,var(--color-error)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-error)_12%,transparent)] text-[var(--color-error)]" },
  system:  { icon: Sparkles,      label: "System",  accent: "text-[var(--color-primary-soft)]", bg: "bg-[color-mix(in_oklab,var(--color-primary)_14%,transparent)]", ring: "ring-[var(--color-primary)]/25", chip: "border-[color-mix(in_oklab,var(--color-primary)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)] text-[var(--color-primary-soft)]" },
};

const BROADCAST_TYPES: BroadcastType[] = ["info", "success", "warning", "error", "system"];

export function AdminNotificationsPage() {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language?.startsWith("ar");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<BroadcastType>("info");
  const [sending, setSending] = useState(false);
  const [broadcasts, setBroadcasts] = useState<BroadcastItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");

  const fetchBroadcasts = async () => {
    try {
      const { data } = await (supabase as any).rpc("admin_list_broadcasts", { p_limit: 30, p_offset: 0 });
      setBroadcasts((data ?? []) as BroadcastItem[]);
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { fetchBroadcasts(); }, []);

  const stats = useMemo(() => {
    const total = broadcasts.length;
    const recipients = broadcasts.reduce((sum, b) => sum + (b.recipients || 0), 0);
    const lastWeek = broadcasts.filter((b) => Date.now() - new Date(b.created_at).getTime() < 7 * 24 * 3600 * 1000).length;
    const typesCount = new Set(broadcasts.map((b) => b.type)).size;
    return { total, recipients, lastWeek, typesCount };
  }, [broadcasts]);

  const filtered = useMemo(
    () => filter === "all" ? broadcasts : broadcasts.filter((b) => b.type === filter),
    [broadcasts, filter],
  );

  const canSend = title.trim().length > 0 && body.trim().length > 0 && !sending;

  async function handleBroadcast() {
    if (!canSend) { toast({ type: "error", title: t("admin.notifications.titleAndBodyRequired", "Title and body are required") }); return; }
    setSending(true);
    try {
      const { data } = await (supabase as any).rpc("admin_broadcast_notification", { p_title: title.trim(), p_body: body.trim(), p_type: type });
      toast({ type: "success", title: t("admin.notifications.sent", "Sent to {{count}} recipients", { count: data }) });
      setTitle(""); setBody(""); fetchBroadcasts();
    } catch (e: any) { toast({ type: "error", title: e.message }); }
    finally { setSending(false); }
  }

  const filters: { key: FilterType; label: string; count: number }[] = [
    { key: "all",     label: t("admin.notifications.filterAll", "All"),       count: stats.total },
    ...BROADCAST_TYPES.map((k) => ({ key: k as FilterType, label: TYPE_META[k].label, count: broadcasts.filter((b) => b.type === k).length })),
  ];

  const currentMeta = TYPE_META[type];
  const CurrentIcon = currentMeta.icon;

  return (
    <div className="space-y-6 animate-[fade-up_0.4s_ease-out]">
      <PageHeader
        title={t("admin.notifications.title")}
        description={t("admin.notifications.desc", "Broadcast notifications to all platform users")}
        icon={Bell}
        variant="hero"
        gradient
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("admin.notifications.statTotal", "Total Broadcasts")} value={stats.total} icon={Megaphone} accent="primary" />
        <StatCard label={t("admin.notifications.statRecipients", "Recipients Reached")} value={stats.recipients} icon={Users} accent="info" />
        <StatCard label={t("admin.notifications.statWeek", "Sent This Week")} value={stats.lastWeek} icon={CalendarClock} accent="success" />
        <StatCard label={t("admin.notifications.statTypes", "Notification Types")} value={stats.typesCount} icon={Hash} accent="secondary" />
      </div>

      <Card hover="lift" className="overflow-hidden">
        <div className="pointer-events-none absolute -top-24 -end-20 size-56 rounded-full bg-gradient-to-br from-[var(--color-primary)]/15 to-transparent blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-16 -start-16 size-40 rounded-full bg-gradient-to-tr from-[var(--color-secondary)]/15 to-transparent blur-2xl" aria-hidden />

        <div className="relative grid gap-6 lg:grid-cols-[1.1fr_1fr] p-6">
          <div className="space-y-5">
            <div className="flex items-start gap-3">
              <div className="relative shrink-0">
                <div className="absolute inset-0 rounded-xl gradient-brand opacity-40 blur-md" aria-hidden />
                <div className="relative flex size-11 items-center justify-center rounded-xl gradient-brand text-white shadow-[0_8px_24px_-8px_rgba(109,94,252,0.7)]">
                  <Pencil className="size-5" />
                </div>
              </div>
              <div>
                <h2 className="text-base font-bold text-[var(--color-fg)]">{t("admin.notifications.compose")}</h2>
                <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">{t("admin.notifications.composeDesc", "Craft a notification and push it to all users in one go.")}</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5">
                  <span className="flex size-5 items-center justify-center rounded-md bg-[color-mix(in_oklab,var(--color-primary)_15%,transparent)] text-[var(--color-primary-soft)]">
                    <Sparkles className="size-3" />
                  </span>
                  {t("admin.notifications.typeLabel")}
                </Label>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {BROADCAST_TYPES.map((k) => {
                  const meta = TYPE_META[k];
                  const Icon = meta.icon;
                  const active = k === type;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setType(k)}
                      className={cn(
                        "group inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all",
                        active
                          ? meta.chip + " shadow-[var(--shadow-xs)]"
                          : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-fg-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]",
                      )}
                    >
                      <Icon className={cn("size-3.5", active ? "" : meta.accent)} />
                      {t(`admin.notifications.type.${k}`, meta.label)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("admin.notifications.notificationTitle")}</Label>
                <span className={cn("text-[0.65rem] font-mono", title.length > 100 ? "text-[var(--color-error)]" : "text-[var(--color-fg-subtle)]")}>{title.length}/120</span>
              </div>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("admin.notifications.titlePlaceholder")}
                maxLength={120}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("admin.notifications.notificationBody")}</Label>
                <span className={cn("text-[0.65rem] font-mono", body.length > 500 ? "text-[var(--color-error)]" : "text-[var(--color-fg-subtle)]")}>{body.length}/500</span>
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                maxLength={500}
                placeholder={t("admin.notifications.bodyPlaceholder")}
                className="w-full rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-3.5 py-2.5 text-sm text-[var(--color-fg)] shadow-sm transition-all placeholder:text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-3)] focus:border-[var(--color-primary)] focus:bg-[var(--color-surface)] focus:outline-none focus:ring-4 focus:ring-[var(--color-ring)] resize-y"
              />
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between pt-1">
              <p className="flex items-center gap-1.5 text-xs text-[var(--color-fg-subtle)]">
                <Users className="size-3" />
                {t("admin.notifications.reachHint", "Will be delivered to all active users")}
              </p>
              <Button onClick={handleBroadcast} disabled={!canSend} className="gap-2 w-full sm:w-auto">
                <Send className="size-4" />
                {sending ? t("admin.notifications.sending", "Sending…") : t("admin.notifications.broadcast")}
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[0.65rem] font-bold uppercase tracking-wider text-[var(--color-fg-subtle)]">{t("admin.notifications.preview", "Live Preview")}</p>
              <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.65rem] font-semibold", currentMeta.chip)}>
                <CurrentIcon className="size-3" />
                {t(`admin.notifications.type.${type}`, currentMeta.label)}
              </span>
            </div>

            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4 shadow-[var(--shadow-sm)]">
              <div className="flex items-start gap-3">
                <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg ring-1", currentMeta.bg, currentMeta.accent, currentMeta.ring)}>
                  <CurrentIcon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-[var(--color-fg)]">
                    {title.trim() || t("admin.notifications.previewTitlePlaceholder", "Your notification title…")}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-fg-muted)] line-clamp-4 whitespace-pre-wrap break-words">
                    {body.trim() || t("admin.notifications.previewBodyPlaceholder", "Your message will appear here for every user.")}
                  </p>
                  <p className="mt-2 text-[0.65rem] text-[var(--color-fg-subtle)]">{t("admin.notifications.previewJustNow", "just now")}</p>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 text-center">
                <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">{t("admin.notifications.previewStatTitle", "Title")}</p>
                <p className="mt-0.5 truncate text-sm font-bold text-[var(--color-fg)]">{title.trim() ? "✓" : "—"}</p>
              </div>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 text-center">
                <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">{t("admin.notifications.previewStatBody", "Body")}</p>
                <p className="mt-0.5 truncate text-sm font-bold text-[var(--color-fg)]">{body.trim() ? "✓" : "—"}</p>
              </div>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 text-center">
                <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">{t("admin.notifications.previewStatType", "Type")}</p>
                <p className={cn("mt-0.5 truncate text-sm font-bold", currentMeta.accent)}>{t(`admin.notifications.type.${type}`, currentMeta.label)}</p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card hover="lift" className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[var(--color-border)] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--color-secondary)_14%,transparent)] text-[var(--color-secondary)]">
              <Clock className="size-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-[var(--color-fg)]">{t("admin.notifications.history")}</h2>
              <p className="text-xs text-[var(--color-fg-muted)]">{t("admin.notifications.historyDesc", "{{count}} broadcasts · most recent first", { count: stats.total })}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1 rounded-lg bg-[var(--color-surface-2)] p-1 w-fit">
            {filters.map((f) => {
              const meta = f.key === "all" ? null : TYPE_META[f.key as BroadcastType];
              const FilterIcon = meta?.icon ?? Bell;
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[0.7rem] font-semibold transition-all",
                    filter === f.key
                      ? "bg-[var(--color-bg)] text-[var(--color-fg)] shadow-sm"
                      : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
                  )}
                >
                  <FilterIcon className={cn("size-3", filter === f.key ? "" : meta?.accent ?? "text-[var(--color-fg-subtle)]")} />
                  {f.label}
                  <span className={cn("rounded-full px-1.5 py-0.5 text-[0.6rem] font-bold", filter === f.key ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface-3)] text-[var(--color-fg-muted)]")}>
                    {f.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <CardContent className="p-0">
          {loading ? (
            <div className="p-6"><LoadingState /></div>
          ) : broadcasts.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={t("admin.notifications.noBroadcasts")}
                description={t("admin.notifications.noBroadcastsDesc", "When you send a notification, it will appear here.")}
                icon={BellOff}
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={t("admin.notifications.noFiltered", "No broadcasts in this filter")}
                description={t("admin.notifications.noFilteredDesc", "Try a different type or send a new broadcast.")}
                icon={BellOff}
              />
            </div>
          ) : (
            <ol className="relative">
              <span className={cn("absolute top-3 bottom-3 w-px bg-gradient-to-b from-[var(--color-border)] via-[var(--color-border-strong)] to-transparent", isRtl ? "right-[1.95rem]" : "left-[1.95rem]")} aria-hidden />
              {filtered.map((b, idx) => {
                const meta = TYPE_META[(b.type as BroadcastType)] ?? TYPE_META.info;
                const Icon = meta.icon;
                const dateLabel = new Date(b.created_at).toLocaleString(i18n.language?.startsWith("ar") ? "ar-EG" : "en-US", {
                  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                });
                return (
                  <li
                    key={b.id}
                    className={cn(
                      "group relative flex items-start gap-4 px-4 py-4 sm:px-5 sm:py-4 transition-colors hover:bg-[var(--color-surface-2)]/40",
                      idx !== filtered.length - 1 && "border-b border-[var(--color-border)]",
                    )}
                  >
                    <div className="relative shrink-0">
                      <div className={cn("flex size-10 items-center justify-center rounded-xl ring-1 shadow-[var(--shadow-xs)] transition-transform duration-300 group-hover:scale-105", meta.bg, meta.accent, meta.ring)}>
                        <Icon className="size-4" />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider", meta.chip)}>
                          <Icon className="size-2.5" />
                          {t(`admin.notifications.type.${b.type}`, meta.label)}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--color-fg-muted)]">
                          <Users className="size-2.5" />
                          {b.recipients.toLocaleString()}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[0.65rem] font-medium text-[var(--color-fg-subtle)]">
                          <CalendarClock className="size-3" />
                          {dateLabel}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm font-bold text-[var(--color-fg)] line-clamp-1">{b.title}</p>
                      <p className="mt-0.5 text-xs text-[var(--color-fg-muted)] line-clamp-2">{b.body}</p>
                      {b.sent_by_email && (
                        <p className="mt-1.5 flex items-center gap-1 text-[0.7rem] text-[var(--color-fg-subtle)]">
                          <Mail className="size-3" />
                          <span className="truncate">{t("admin.notifications.sentBy")} {b.sent_by_email}</span>
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
