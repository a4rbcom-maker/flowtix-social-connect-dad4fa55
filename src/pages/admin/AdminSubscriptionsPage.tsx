import { useState, useEffect, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { CreditCard, Search, Building, Package, AlertTriangle, CheckCircle2, XCircle, DollarSign, Plus, Loader2, User, UserCheck, Sparkles, ArrowRight } from "lucide-react";
import type { AdminUserListItem } from "@/types/admin.types";
import { PageHeader, StatCard } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { Dialog, DialogHeader, DialogTitle, DialogClose, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Select } from "@/components/ui/dropdown";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { EmptyState, LoadingState } from "@/components/ui/state";
import { Avatar } from "@/components/ui/avatar";
import { toast } from "@/components/ui/toast";
import { formatCurrency } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { adminRepository } from "@/lib/admin-repository";

interface SubscriptionRow {
  id: string; user_id: string; user_email: string; user_name: string;
  plan_id: string; plan_name: string;
  plan_interval: string; plan_price_cents: number; plan_currency: string;
  status: string; current_period_start: string; current_period_end: string;
  trial_end: string | null; canceled_at: string | null;
  days_remaining: number | null; created_at: string;
}
interface Stats { total: number; active: number; expiring: number; expired: number; mrr_cents: number; }
type Filter = "all" | "active" | "expiring" | "expired";

export function AdminSubscriptionsPage() {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [subs, setSubs] = useState<SubscriptionRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [sRes, stRes] = await Promise.all([
        (supabase as any).rpc("admin_list_subscriptions", { p_search: search || null, p_status: filter === "all" ? null : filter, p_limit: 100, p_offset: 0 }),
        (supabase as any).rpc("admin_subscriptions_stats"),
      ]);
      if (sRes.error) { toast({ type: "error", title: sRes.error.message }); }
      else setSubs((sRes.data ?? []) as SubscriptionRow[]);
      if (stRes.error) { toast({ type: "error", title: stRes.error.message }); }
      else if (stRes.data?.[0]) setStats(stRes.data[0] as Stats);
    } catch (e: any) { toast({ type: "error", title: e.message }); }
    finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, [filter, search]);

  const filters: { key: Filter; label: string; count: number; accent: "primary" | "success" | "warning" | "error"; icon: typeof Package }[] = [
    { key: "all", label: t("admin.subscriptions.all", "All"), count: stats?.total ?? 0, accent: "primary", icon: Package },
    { key: "active", label: t("admin.subscriptions.active", "Active"), count: stats?.active ?? 0, accent: "success", icon: CheckCircle2 },
    { key: "expiring", label: t("admin.subscriptions.expiring", "Expiring"), count: stats?.expiring ?? 0, accent: "warning", icon: AlertTriangle },
    { key: "expired", label: t("admin.subscriptions.expired", "Expired"), count: stats?.expired ?? 0, accent: "error", icon: XCircle },
  ];

  const mrrCents = stats?.mrr_cents ?? 0;
  const activeCount = stats?.active ?? 0;
  const totalCount = stats?.total ?? 0;
  const mrr = formatCurrency(mrrCents, "USD");
  const activeRatio = totalCount > 0 ? Math.round((activeCount / totalCount) * 100) : 0;
  const dateLocale = i18n.language?.startsWith("ar") ? "ar-EG" : "en-US";

  return (
    <div className="space-y-6 animate-[fade-up_0.4s_ease-out]">
      <PageHeader
        title={t("admin.subscriptions.title")}
        description={t("admin.subscriptions.desc", "Manage every active subscription across all workspaces.")}
        icon={CreditCard}
        variant="hero"
        gradient
        action={
          <Button onClick={() => setAddOpen(true)} variant="primary" className="gap-2 w-full sm:w-auto">
            <Plus className="size-4" />
            {t("admin.subscriptions.addSubscription", "Add Subscription")}
          </Button>
        }
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("admin.subscriptions.total", "Total")} value={stats?.total ?? 0} icon={Package} accent="primary" />
        <StatCard label={t("admin.subscriptions.active", "Active")} value={stats?.active ?? 0} icon={CheckCircle2} accent="success" />
        <StatCard label={t("admin.subscriptions.expiring", "Expiring")} value={stats?.expiring ?? 0} icon={AlertTriangle} accent="warning" />
        <StatCard label={t("admin.subscriptions.expired", "Expired")} value={stats?.expired ?? 0} icon={XCircle} accent="error" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card hover="lift" className="relative overflow-hidden">
          <div className="pointer-events-none absolute -top-16 -end-16 size-44 rounded-full bg-gradient-to-br from-[var(--color-success)]/15 to-transparent blur-3xl" aria-hidden />
          <CardContent className="relative p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--color-success)_14%,transparent)] text-[var(--color-success)] ring-1 ring-[var(--color-success)]/25 shadow-[0_4px_12px_-4px_rgba(16,185,129,0.4)]">
                <DollarSign className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--color-fg-muted)]">{t("admin.subscriptions.mrr", "MRR")}</p>
                <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">{t("admin.subscriptions.mrrHint", "Monthly Recurring Revenue")}</p>
              </div>
            </div>
            <div className="mt-4 flex items-end justify-between gap-3">
              <p className="text-3xl font-extrabold tracking-tight text-[var(--color-fg)] sm:text-4xl">{mrr}</p>
              <Badge variant="success" className="gap-1 shrink-0">
                <CheckCircle2 className="size-3" />
                {activeRatio}% {t("admin.subscriptions.active", "active")}
              </Badge>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--color-success)] to-[var(--color-secondary)] transition-all duration-700"
                style={{ width: `${activeRatio}%` }}
                aria-hidden
              />
            </div>
          </CardContent>
        </Card>

        <Card hover="lift" className="relative overflow-hidden">
          <div className="pointer-events-none absolute -bottom-16 -start-16 size-44 rounded-full bg-gradient-to-tr from-[var(--color-primary)]/15 to-transparent blur-3xl" aria-hidden />
          <CardContent className="relative p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-[var(--color-fg-muted)]">{t("admin.subscriptions.listTitle", "Subscriptions")}</p>
                <p className="text-3xl font-extrabold tracking-tight text-[var(--color-fg)] sm:text-4xl">
                  {loading ? "—" : totalCount}
                </p>
                <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">{t("admin.subscriptions.totalUsers", "across all users")}</p>
              </div>
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--color-primary)_14%,transparent)] text-[var(--color-primary-soft)] ring-1 ring-[var(--color-primary)]/25">
                <CreditCard className="size-5" />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-1.5 rounded-lg bg-[var(--color-surface-2)] p-1 w-fit">
              {filters.map((f) => {
                const Icon = f.icon;
                const active = filter === f.key;
                return (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                      active ? "bg-[var(--color-bg)] text-[var(--color-fg)] shadow-sm" : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                    }`}
                  >
                    <Icon className={`size-3.5 ${active ? "text-[var(--color-" + (f.accent === "primary" ? "primary-soft" : f.accent) + ")]" : ""}`} />
                    {f.label}
                    <span className={`rounded-full px-1.5 py-0.5 text-[0.65rem] font-bold ${active ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface-3)] text-[var(--color-fg-muted)]"}`}>
                      {f.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 relative">
              <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--color-fg-subtle)]" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("admin.subscriptions.search", "Search by user or plan...")}
                className="h-10 w-full rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] ps-10 pe-10 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] shadow-[var(--shadow-xs)] transition-all hover:bg-[var(--color-surface-3)] focus:border-[var(--color-primary)] focus:bg-[var(--color-surface)] focus:outline-none focus:ring-4 focus:ring-[var(--color-ring)]"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute end-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-[var(--color-fg-subtle)] transition-colors hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)]"
                  aria-label="Clear"
                >
                  <XCircle className="size-3.5" />
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card hover="lift" className="overflow-hidden">
        {loading ? (
          <div className="p-6"><LoadingState /></div>
        ) : subs.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={t("admin.subscriptions.empty", "No subscriptions found")}
              description={search
                ? t("admin.subscriptions.emptySearch", "Try clearing your search or changing the filter.")
                : t("admin.subscriptions.emptyDesc", "Send your first subscription to get started.")}
              icon={CreditCard}
              action={!search && (
                <Button onClick={() => setAddOpen(true)} className="gap-2">
                  <Plus className="size-4" />
                  {t("admin.subscriptions.addSubscription", "Add Subscription")}
                </Button>
              )}
            />
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("admin.subscriptions.colUser", "User")}</TableHead>
                    <TableHead>{t("admin.subscriptions.colPlan", "Plan")}</TableHead>
                    <TableHead>{t("admin.subscriptions.colStatus", "Status")}</TableHead>
                    <TableHead>{t("admin.subscriptions.colPeriod", "Period")}</TableHead>
                    <TableHead className="text-end">{t("admin.subscriptions.colPrice", "Price")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subs.map((s) => {
                    const isExpiringSoon = s.days_remaining !== null && s.days_remaining <= 7 && s.days_remaining >= 0;
                    const isExpired = s.days_remaining !== null && s.days_remaining < 0;
                    const isActive = s.status === "active" && !isExpired;
const initials = s.user_name?.slice(0, 2).toUpperCase() || s.user_email?.slice(0, 2).toUpperCase() || "U";
                    const periodStart = s.current_period_start ? new Date(s.current_period_start) : null;
                    const periodEnd = s.current_period_end ? new Date(s.current_period_end) : null;
                    const now = Date.now();
                    const progressPct = periodStart && periodEnd && periodEnd.getTime() > periodStart.getTime()
                      ? Math.min(100, Math.max(0, ((now - periodStart.getTime()) / (periodEnd.getTime() - periodStart.getTime())) * 100))
                      : 0;
                    return (
                      <TableRow key={s.id} className="group">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar fallback={initials} size="sm" />
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-[var(--color-fg)] truncate">{s.user_name || s.user_email}</p>
                              <p className="text-[0.7rem] text-[var(--color-fg-subtle)] truncate">{s.user_email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--color-secondary)_14%,transparent)] text-[var(--color-secondary)]">
                              <Package className="size-3.5" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-[var(--color-fg)] truncate">{s.plan_name}</p>
                              <p className="text-[0.7rem] text-[var(--color-fg-muted)] capitalize">{s.plan_interval}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {isActive && !isExpiringSoon && <Badge variant="success" className="gap-1"><CheckCircle2 className="size-3" />{t("admin.subscriptions.active", "Active")}</Badge>}
                          {isActive && isExpiringSoon && <Badge variant="warning" className="gap-1"><AlertTriangle className="size-3" />{t("admin.subscriptions.expiring", "Expiring")}</Badge>}
                          {(!isActive || isExpired) && <Badge variant="error" className="gap-1"><XCircle className="size-3" />{t("admin.subscriptions.expired", "Expired")}</Badge>}
                        </TableCell>
                        <TableCell>
                          <div className="min-w-[140px] space-y-1.5">
                            {periodEnd ? (
                              <>
                                <div className="flex items-center justify-between gap-2 text-[0.7rem]">
                                  <span className="text-[var(--color-fg-muted)]">{new Date(periodEnd).toLocaleDateString(dateLocale, { month: "short", day: "numeric", year: "numeric" })}</span>
                                  {s.days_remaining !== null && (
                                    <span className={`font-semibold ${isExpiringSoon ? "text-[var(--color-warning)]" : isExpired ? "text-[var(--color-error)]" : "text-[var(--color-success)]"}`}>
                                      {isExpired ? `${Math.abs(s.days_remaining)}d overdue` : `${s.days_remaining}d`}
                                    </span>
                                  )}
                                </div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                                  <div
                                    className={`h-full rounded-full transition-all duration-700 ${
                                      isExpired
                                        ? "bg-[var(--color-error)]"
                                        : isExpiringSoon
                                          ? "bg-[var(--color-warning)]"
                                          : "bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)]"
                                    }`}
                                    style={{ width: `${isExpired ? 100 : progressPct}%` }}
                                    aria-hidden
                                  />
                                </div>
                              </>
                            ) : (
                              <span className="text-xs text-[var(--color-fg-subtle)]">—</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-end">
                          <p className="text-sm font-extrabold text-[var(--color-fg)]">{formatCurrency(s.plan_price_cents, s.plan_currency)}</p>
                          <p className="text-[0.7rem] text-[var(--color-fg-muted)]">/{s.plan_interval === "yearly" ? t("admin.subscriptions.year", "year") : t("admin.subscriptions.month", "month")}</p>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-3 p-3">
              {subs.map((s) => {
                const isExpiringSoon = s.days_remaining !== null && s.days_remaining <= 7 && s.days_remaining >= 0;
                const isExpired = s.days_remaining !== null && s.days_remaining < 0;
                const isActive = s.status === "active" && !isExpired;
                const initials = s.user_name?.slice(0, 2).toUpperCase() || s.user_email?.slice(0, 2).toUpperCase() || "U";
                return (
                  <div key={s.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <Avatar fallback={initials} size="sm" />
                        <span className="text-sm font-semibold truncate">{s.user_name || s.user_email}</span>
                      </div>
                      <div className="text-end shrink-0">
                        <p className="text-sm font-extrabold text-[var(--color-fg)]">{formatCurrency(s.plan_price_cents, s.plan_currency)}</p>
                        <p className="text-[0.65rem] text-[var(--color-fg-muted)]">/{s.plan_interval === "yearly" ? t("admin.subscriptions.year", "year") : t("admin.subscriptions.month", "month")}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--color-fg-muted)]">{t("admin.subscriptions.colPlan", "Plan")}</span>
                      <span className="font-semibold truncate ms-2 capitalize">{s.plan_name} · {s.plan_interval}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--color-fg-muted)]">{t("admin.subscriptions.colStatus", "Status")}</span>
                      {isActive && !isExpiringSoon && <Badge variant="success" className="gap-1"><CheckCircle2 className="size-3" />{t("admin.subscriptions.active", "Active")}</Badge>}
                      {isActive && isExpiringSoon && <Badge variant="warning" className="gap-1"><AlertTriangle className="size-3" />{t("admin.subscriptions.expiring", "Expiring")}</Badge>}
                      {(!isActive || isExpired) && <Badge variant="error" className="gap-1"><XCircle className="size-3" />{t("admin.subscriptions.expired", "Expired")}</Badge>}
                    </div>
                    {s.current_period_end && (
                      <div className="flex items-center justify-between text-xs border-t border-[var(--color-border)] pt-2">
                        <span className="text-[var(--color-fg-muted)]">{t("admin.subscriptions.colPeriod", "Period")}</span>
                        <div className="text-end">
                          <p className="text-xs">{new Date(s.current_period_end).toLocaleDateString(dateLocale, { month: "short", day: "numeric", year: "numeric" })}</p>
                          {s.days_remaining !== null && (
                            <p className={`text-[0.7rem] font-semibold ${isExpiringSoon ? "text-[var(--color-warning)]" : isExpired ? "text-[var(--color-error)]" : "text-[var(--color-success)]"}`}>
                              {isExpired ? `${Math.abs(s.days_remaining)}d overdue` : `${s.days_remaining}d remaining`}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>
      {addOpen && <AddSubscriptionDialog open={addOpen} onClose={() => setAddOpen(false)} onAdded={() => { setAddOpen(false); refresh(); }} />}
    </div>
  );
}

function AddSubscriptionDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const { t } = useTranslation();
  const [userSearch, setUserSearch] = useState("");
  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUserListItem | null>(null);
  const [showList, setShowList] = useState(false);
  const [searching, setSearching] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [planId, setPlanId] = useState("");
  const [plans, setPlans] = useState<Array<{ id: string; name: string; plan_interval?: string; price_cents?: number; currency?: string }>>([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { (async () => {
    try {
      const pRes = await (supabase as any).rpc("admin_list_plans");
      if (pRes.data) setPlans((pRes.data as any[]).filter((p: any) => p.is_active).map((p: any) => ({ id: p.id, name: p.name, plan_interval: p.plan_interval ?? p.interval, price_cents: p.price_cents, currency: p.currency })));
    } catch {}
  })(); }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!userSearch.trim()) { setUsers([]); setSearching(false); return; }
    setSearching(true);
    timerRef.current = setTimeout(async () => {
      try { setUsers(await adminRepository.listUsers({ search: userSearch.trim(), limit: 20 })); }
      catch { setUsers([]); }
      finally { setSearching(false); }
    }, 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [userSearch]);

  useEffect(() => { setHighlightIndex(0); }, [users]);

  useEffect(() => {
    if (!showList) return;
    function onClick(e: MouseEvent) { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShowList(false); }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showList]);

  const selectUser = (u: AdminUserListItem) => {
    setSelectedUser(u);
    setShowList(false);
    setUserSearch("");
  };

  const handleSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!showList) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, Math.max(users.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const u = users[highlightIndex];
      if (u) selectUser(u);
    } else if (e.key === "Escape") {
      setShowList(false);
    }
  };

  const handleCreate = async () => {
    if (!selectedUser || !planId) { toast({ type: "error", title: t("admin.subscriptions.selectUser", "Select a user and plan") }); return; }
    setLoading(true);
    try {
      await adminRepository.createSubscription({ user_id: selectedUser.user_id, plan_id: planId, status: "active" });
      toast({ type: "success", title: t("admin.settings.created") });
      onAdded();
    } catch (e: any) {
      toast({ type: "error", title: e.message?.includes("already_subscribed") ? t("admin.subscriptions.alreadySubscribed", "User already subscribed to this plan") : e.message });
    } finally { setLoading(false); }
  };

  const selectedPlan = plans.find((p) => p.id === planId);
  const canSubmit = !!selectedUser && !!planId;

  return (
    <Dialog open={open} onClose={onClose} className="sm:max-w-xl">
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-24 -end-20 size-56 rounded-full bg-gradient-to-br from-[var(--color-primary)]/25 to-transparent blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-20 -start-16 size-44 rounded-full bg-gradient-to-tr from-[var(--color-secondary)]/20 to-transparent blur-2xl" aria-hidden />
        <DialogHeader className="relative items-start gap-3 border-b border-[var(--color-border)] bg-gradient-to-br from-[var(--color-surface-2)] to-transparent px-6 py-5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="relative shrink-0">
              <div className="absolute inset-0 rounded-xl gradient-brand opacity-40 blur-md" aria-hidden />
              <div className="relative flex size-11 items-center justify-center rounded-xl gradient-brand text-white shadow-[0_8px_24px_-8px_rgba(109,94,252,0.7)]">
                <CreditCard className="size-5" />
              </div>
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base sm:text-lg">{t("admin.subscriptions.addSubscription")}</DialogTitle>
              <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">
                {t("admin.subscriptions.addSubtitle", "Assign a plan to a workspace in seconds")}
              </p>
            </div>
          </div>
          <DialogClose onClose={onClose} />
        </DialogHeader>

        <DialogBody className="space-y-5 px-6 py-5">
          <div ref={boxRef} className="relative space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5">
                <span className="flex size-5 items-center justify-center rounded-md bg-[color-mix(in_oklab,var(--color-primary)_15%,transparent)] text-[var(--color-primary-soft)]">
                  <User className="size-3" />
                </span>
                {t("admin.subscriptions.selectUser", "Select User")}
              </Label>
              {selectedUser && (
                <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
                  {t("admin.subscriptions.selected", "Selected")}
                </span>
              )}
            </div>

            {selectedUser ? (
              <div className="group flex items-center justify-between gap-3 rounded-xl border border-[var(--color-primary)]/30 bg-[color-mix(in_oklab,var(--color-primary)_6%,var(--color-surface-2))] p-3 shadow-[var(--shadow-xs)] transition-all">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar
                    src={selectedUser.avatar_url}
                    alt={selectedUser.full_name || selectedUser.email}
                    fallback={selectedUser.full_name || selectedUser.email}
                    size="md"
                    ring
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--color-fg)]">{selectedUser.full_name || selectedUser.email}</p>
                    <p className="truncate text-xs text-[var(--color-fg-muted)]">{selectedUser.email}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <Building className="size-3 text-[var(--color-fg-subtle)]" />
                      <span className="truncate text-[0.7rem] font-medium text-[var(--color-fg-muted)]">{selectedUser.email}</span>
                    </div>
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => { setSelectedUser(null); setUserSearch(""); setShowList(true); setTimeout(() => inputRef.current?.focus(), 0); }}>
                  {t("common.change", "Change")}
                </Button>
              </div>
            ) : (
              <>
                <div className="group relative">
                  <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--color-fg-subtle)] transition-colors group-focus-within:text-[var(--color-primary-soft)]" />
                  <input
                    ref={inputRef}
                    type="search"
                    value={userSearch}
                    onChange={(e) => { setUserSearch(e.target.value); setShowList(true); }}
                    onFocus={() => setShowList(true)}
                    onKeyDown={handleSearchKey}
                    placeholder={t("admin.subscriptions.searchUser", "Search user by name or email…")}
                    className="h-11 w-full rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] ps-10 pe-10 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] shadow-[var(--shadow-xs)] transition-all hover:bg-[var(--color-surface-3)] focus:border-[var(--color-primary)] focus:bg-[var(--color-surface)] focus:outline-none focus:ring-4 focus:ring-[var(--color-ring)]"
                  />
                  {userSearch && (
                    <button
                      type="button"
                      onClick={() => { setUserSearch(""); inputRef.current?.focus(); }}
                      className="absolute end-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-[var(--color-fg-subtle)] transition-colors hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)]"
                      aria-label="Clear"
                    >
                      <XCircle className="size-3.5" />
                    </button>
                  )}
                </div>

                {showList && (
                  <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-xl)] animate-[scale-in_0.15s_ease-out]">
                    {searching ? (
                      <div className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-[var(--color-fg-muted)]">
                        <Loader2 className="size-4 animate-spin text-[var(--color-primary-soft)]" />
                        {t("common.loading", "Loading…")}
                      </div>
                    ) : users.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 px-4 py-7 text-center">
                        <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--color-surface-2)] text-[var(--color-fg-subtle)]">
                          <Search className="size-4" />
                        </div>
                        <p className="text-sm font-medium text-[var(--color-fg)]">
                          {userSearch.trim()
                            ? t("admin.subscriptions.noUsers", "No users found")
                            : t("admin.subscriptions.searchPrompt", "Type to search users")}
                        </p>
                        {userSearch.trim() && (
                          <p className="text-xs text-[var(--color-fg-subtle)]">
                            {t("admin.subscriptions.tryDifferent", "Try a different name or email")}
                          </p>
                        )}
                      </div>
                    ) : (
                      <ul role="listbox" className="max-h-64 overflow-y-auto p-1.5">
                        <li className="px-2.5 pb-1.5 pt-1 text-[0.65rem] font-bold uppercase tracking-wider text-[var(--color-fg-subtle)]">
                          {t("admin.subscriptions.resultsCount", "{{count}} result", { count: users.length })}
                        </li>
                        {users.map((u, idx) => (
                          <li key={u.user_id}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={idx === highlightIndex}
                              onClick={() => selectUser(u)}
                              onMouseEnter={() => setHighlightIndex(idx)}
                              className={`group flex w-full items-center gap-3 rounded-lg border border-transparent px-2.5 py-2 text-start transition-all ${
                                idx === highlightIndex
                                  ? "border-[var(--color-primary)]/30 bg-[color-mix(in_oklab,var(--color-primary)_10%,transparent)]"
                                  : "hover:border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                              }`}
                            >
                              <Avatar
                                src={u.avatar_url}
                                alt={u.full_name || u.email}
                                fallback={u.full_name || u.email}
                                size="sm"
                              />
                              <div className="min-w-0 flex-1">
                                <p className={`truncate text-sm font-semibold ${idx === highlightIndex ? "text-[var(--color-fg)]" : "text-[var(--color-fg)]"}`}>
                                  {u.full_name || u.email}
                                </p>
                                <p className="truncate text-xs text-[var(--color-fg-muted)]">{u.email}</p>
                              </div>
                              <Badge variant="default" className="max-w-[120px] shrink-0 gap-1">
                                <Building className="size-2.5" />
                                <span className="truncate">{u.email}</span>
                              </Badge>
                              <ArrowRight className={`size-3.5 shrink-0 transition-all ${idx === highlightIndex ? "translate-x-0 text-[var(--color-primary-soft)] opacity-100 rtl:rotate-180" : "-translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100"}`} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <span className="flex size-5 items-center justify-center rounded-md bg-[color-mix(in_oklab,var(--color-secondary)_18%,transparent)] text-[var(--color-secondary)]">
                <Sparkles className="size-3" />
              </span>
              {t("admin.plans.title", "Plan")}
            </Label>
            <Select value={planId} onValueChange={setPlanId} options={[{ value: "", label: t("admin.subscriptions.selectPlan", "Select plan") }, ...plans.map(p => ({ value: p.id, label: `${p.name}  ·  ${formatCurrency(p.price_cents ?? 0, p.currency)}/${p.plan_interval === "yearly" ? "yr" : "mo"}` }))]} />

            {selectedPlan ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-gradient-to-br from-[color-mix(in_oklab,var(--color-secondary)_8%,var(--color-surface-2))] to-[var(--color-surface-2)] p-3.5 shadow-[var(--shadow-xs)] animate-[fade-up_0.3s_ease-out]">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--color-secondary)_18%,transparent)] text-[var(--color-secondary)]">
                    <Sparkles className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[var(--color-fg)] truncate">{selectedPlan.name}</p>
                    <p className="text-[0.7rem] font-medium uppercase tracking-wider text-[var(--color-fg-muted)]">
                      {selectedPlan.plan_interval === "yearly" ? t("admin.subscriptions.yearly", "Yearly billing") : t("admin.subscriptions.monthly", "Monthly billing")}
                    </p>
                  </div>
                </div>
                <div className="text-end shrink-0">
                  <p className="text-base font-extrabold text-[var(--color-fg)] leading-none">
                    {formatCurrency(selectedPlan.price_cents ?? 0, selectedPlan.currency)}
                  </p>
                  <p className="text-[0.7rem] text-[var(--color-fg-muted)] mt-0.5">
                    /{selectedPlan.plan_interval === "yearly" ? "year" : "month"}
                  </p>
                </div>
              </div>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-[var(--color-fg-subtle)] ps-1">
                <Sparkles className="size-3" />
                {t("admin.subscriptions.planHint", "Choose a plan to continue")}
              </p>
            )}
          </div>

          {canSubmit && (
            <div className="flex items-center gap-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/60 px-3.5 py-2.5 animate-[fade-up_0.3s_ease-out]">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--color-success)_15%,transparent)] text-[var(--color-success)]">
                <CheckCircle2 className="size-4" />
              </div>
              <p className="text-xs text-[var(--color-fg-muted)]">
                {t("admin.subscriptions.readyToCreate", "Ready to create subscription for")}{" "}
                <span className="font-semibold text-[var(--color-fg)]">{selectedUser?.email}</span>
              </p>
            </div>
          )}
        </DialogBody>

        <DialogFooter className="flex-col-reverse gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-6 py-4 sm:flex-row sm:justify-between">
          <p className="text-xs text-[var(--color-fg-subtle)] hidden sm:block">
            {t("admin.subscriptions.footerHint", "The subscription will be activated immediately")}
          </p>
          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <Button variant="ghost" onClick={onClose} className="flex-1 sm:flex-none">{t("common.cancel")}</Button>
            <Button onClick={handleCreate} disabled={loading || !canSubmit} className="flex-1 sm:flex-none gap-2">
              {loading ? <Loader2 className="size-4 animate-spin" /> : <UserCheck className="size-4" />}
              {t("admin.subscriptions.addSubscription")}
            </Button>
          </div>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
