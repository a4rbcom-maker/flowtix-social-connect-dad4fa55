import { useState, useMemo, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plug, Search, Plus, Wifi, WifiOff, AlertTriangle, Pause, Clock,
  Eye, Pencil, RefreshCw, Trash2, Copy, MoreVertical, Chrome, Globe,
  CheckCircle2, Loader2, Cookie, ShieldCheck, Puzzle,
  Sparkles, Activity, X, Server,
} from "lucide-react";
import { StatCard } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { InputIcon } from "@/components/ui/input-icon";
import { Textarea } from "@/components/ui/form";
import { Select } from "@/components/ui/dropdown";
import { Dialog, DialogHeader, DialogTitle, DialogClose, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { parseCookieStringDetailed, type CookieFormat } from "@/lib/cookie-parser";
import {
  useSessions,
  useSessionStats,
  useSessionMutations,
  SessionValidationError,
  SessionTransitionError,
  type FbSessionStatus,
} from "@/hooks/useFbSessions";

const statusConfig: Record<FbSessionStatus, {
  variant: "success" | "primary" | "default" | "warning" | "error";
  icon: typeof Wifi;
  dot: string;
  gradient: string;
  bg: string;
  ring: string;
}> = {
  connected:    { variant: "success", icon: CheckCircle2, dot: "bg-[var(--color-success)]",        gradient: "from-emerald-500/15 via-emerald-400/5 to-transparent",  bg: "bg-emerald-500/10",   ring: "ring-emerald-500/30" },
  connecting:   { variant: "primary", icon: Clock,        dot: "bg-[var(--color-primary)]",       gradient: "from-blue-500/15 via-blue-400/5 to-transparent",        bg: "bg-blue-500/10",       ring: "ring-blue-500/30" },
  disconnected: { variant: "default",  icon: WifiOff,      dot: "bg-[var(--color-fg-subtle)]",     gradient: "from-slate-500/10 via-slate-400/5 to-transparent",       bg: "bg-slate-500/10",      ring: "ring-slate-500/20" },
  expired:      { variant: "warning",  icon: Clock,        dot: "bg-[var(--color-warning)]",       gradient: "from-amber-500/15 via-amber-400/5 to-transparent",        bg: "bg-amber-500/10",      ring: "ring-amber-500/30" },
  error:        { variant: "error",    icon: AlertTriangle, dot: "bg-[var(--color-error)]",        gradient: "from-red-500/15 via-red-400/5 to-transparent",          bg: "bg-red-500/10",        ring: "ring-red-500/30" },
  paused:       { variant: "default",  icon: Pause,        dot: "bg-[var(--color-fg-subtle)]",     gradient: "from-slate-500/10 via-slate-400/5 to-transparent",       bg: "bg-slate-500/10",      ring: "ring-slate-500/20" },
  reconnecting: { variant: "primary", icon: RefreshCw,    dot: "bg-[var(--color-primary)]",       gradient: "from-blue-500/15 via-blue-400/5 to-transparent",        bg: "bg-blue-500/10",       ring: "ring-blue-500/30" },
};

const browserIcons: Record<string, typeof Chrome> = {
  Chrome, Firefox: Globe, Safari: Globe, Edge: Globe,
};

const FORMAT_LABELS: Record<CookieFormat, string> = {
  json: "Cookie-Editor (JSON)",
  netscape: "Netscape Cookie File",
  header: "Header String",
  "line-per-cookie": "Line per Cookie",
  unknown: "",
};

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d ago`;
  return date.toLocaleDateString();
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString();
}

export function SessionsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortBy, setSortBy] = useState("recent");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [sessionName, setSessionName] = useState("");
  const [cookieString, setCookieString] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [testingSessions, setTestingSessions] = useState<Set<string>>(new Set());
  const [localStatusOverrides, setLocalStatusOverrides] = useState<Record<string, FbSessionStatus>>({});
  const [confirmDelete, setConfirmDelete] = useState<{ sessionId: string; sessionName: string } | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  const { data: sessions, isLoading, error } = useSessions(statusFilter ? { status: statusFilter as FbSessionStatus } : undefined);
  const { data: stats } = useSessionStats();
  const mutations = useSessionMutations();
  const queryClient = useQueryClient();

  const cookieResult = cookieString ? parseCookieStringDetailed(cookieString) : null;
  const cookieValid = cookieResult ? cookieResult.missingEssential.length === 0 : false;

  const filtered = useMemo(() => {
    if (!sessions) return [];
    let result = sessions.filter((s) => !deletedIds.has(s.id));
    result = result.filter((s) =>
      (!search || s.name.toLowerCase().includes(search.toLowerCase()) || (s.fb_name ?? "").toLowerCase().includes(search.toLowerCase()))
    );
    if (sortBy === "recent") result = [...result].sort((a, b) => {
      const aTime = a.last_activity ? new Date(a.last_activity).getTime() : 0;
      const bTime = b.last_activity ? new Date(b.last_activity).getTime() : 0;
      return bTime - aTime;
    });
    if (sortBy === "name") result = [...result].sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === "status") result = [...result].sort((a, b) => a.status.localeCompare(b.status));
    return result;
  }, [sessions, search, sortBy, deletedIds]);

  function handleAction(action: string, sessionId: string, sessionName: string) {
    const onError = (err: Error) => {
      if (err instanceof SessionTransitionError) {
        toast({ type: "error", title: t("sessions.transitionError"), description: err.message });
      } else if (err instanceof SessionValidationError) {
        toast({ type: "error", title: t("common.validationError"), description: err.message });
      } else {
        toast({ type: "error", title: t("common.error"), description: err.message });
      }
    };
    switch (action) {
      case "delete":
        setConfirmDelete({ sessionId, sessionName });
        break;
      case "rename":
        break;
      case "reconnect":
        mutations.reconnect.mutate(sessionId, {
          onSuccess: () => toast({ type: "success", title: t("sessions.actions.reconnectDone"), description: sessionName }),
          onError,
        });
        break;
      case "refresh": {
        setTestingSessions((prev) => new Set(prev).add(sessionId));
        mutations.testConnection.mutate(sessionId, {
          onSuccess: (result) => {
            const authenticated = result.auth_state === "authenticated";
            // Update local override so the badge color/text changes immediately
            setLocalStatusOverrides((prev) => ({
              ...prev,
              [sessionId]: authenticated ? "connected" : "error",
            }));
            if (authenticated) {
              toast({ type: "success", title: t("sessions.actions.testDone"), description: sessionName });
            } else {
              toast({ type: "error", title: t("common.error"), description: result.message });
            }
          },
          onError: (err) => {
            setLocalStatusOverrides((prev) => ({ ...prev, [sessionId]: "error" }));
            onError(err);
          },
          onSettled: () => {
            setTestingSessions((prev) => {
              const next = new Set(prev);
              next.delete(sessionId);
              return next;
            });
          },
        });
        break;
      }
      case "pause":
        mutations.pause.mutate(sessionId, {
          onSuccess: () => toast({ type: "success", title: t("sessions.actions.pauseDone"), description: sessionName }),
          onError,
        });
        break;
      case "resume":
        mutations.resume.mutate(sessionId, {
          onSuccess: () => toast({ type: "success", title: t("sessions.actions.resumeDone"), description: sessionName }),
          onError,
        });
        break;
      case "disconnect":
        mutations.disconnect.mutate({ id: sessionId }, {
          onSuccess: () => toast({ type: "success", title: t("sessions.actions.disconnectDone"), description: sessionName }),
          onError,
        });
        break;
      case "duplicate":
        mutations.duplicate.mutate(sessionId, {
          onSuccess: () => toast({ type: "success", title: t("sessions.actions.duplicateDone"), description: sessionName }),
          onError,
        });
        break;
      default:
        toast({ type: "success", title: t(`sessions.actions.${action}Done`), description: sessionName });
    }
  }

  function handleAddSession() {
    setSessionName("");
    setCookieString("");
    setProxyUrl("");
    setShowAddDialog(true);
  }

  function handleCreateSession() {
    if (!sessionName.trim() || !cookieValid) return;
    mutations.create.mutate(
      { name: sessionName.trim(), browser: "Chrome", connectionMethod: "cookie", cookies: cookieString, proxyUrl: proxyUrl.trim() || null },
      {
        onSuccess: (result) => {
          mutations.connect.mutate(result.session.id, {
            onSuccess: () => {
              setShowAddDialog(false);
              setSessionName("");
              setCookieString("");
              setProxyUrl("");
              toast({ type: "success", title: t("sessions.add.success"), description: result.session.name });
            },
            onError: () => {
              setShowAddDialog(false);
              toast({ type: "success", title: t("sessions.add.success"), description: result.session.name });
            },
          });
        },
        onError: (err) => {
          if (err instanceof SessionValidationError) {
            toast({ type: "error", title: t("common.validationError"), description: err.message });
          } else {
            toast({ type: "error", title: t("common.error"), description: err.message });
          }
        },
      },
    );
  }

  if (error) {
    return <ErrorState title={t("common.error")} description={error.message} icon={AlertTriangle} action={{ label: t("common.retry"), onClick: () => window.location.reload() }} />;
  }

  const totalSessions = stats?.total ?? 0;
  const connectedSessions = stats?.connected ?? 0;

  return (
    <div className="space-y-6 animate-[fade-up_0.4s_ease-out]">
      {/* ─── Premium Hero Header ─── */}
      <div className="relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-gradient-to-br from-[var(--color-surface)] via-[var(--color-surface-2)] to-[var(--color-surface)] p-6 sm:p-8">
        <div className="absolute inset-0 bg-grid opacity-[0.04] [mask-image:radial-gradient(ellipse_at_top_left,black,transparent_70%)]" />
        <div className="absolute -top-20 -end-20 size-60 rounded-full bg-gradient-to-br from-[var(--color-primary)]/20 to-transparent blur-3xl" />
        <div className="absolute -bottom-12 -start-12 size-40 rounded-full bg-gradient-to-tr from-[var(--color-secondary)]/15 to-transparent blur-2xl" />

        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="relative">
              <div className="absolute inset-0 rounded-2xl bg-gradient-brand opacity-50 blur-xl" />
              <div className="relative flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-brand text-white shadow-[0_8px_24px_-8px_rgba(109,94,252,0.6)]">
                <Plug className="size-7" />
              </div>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-fg)] sm:text-3xl">{t("sessions.title")}</h1>
                <Badge variant="primary" className="gap-1">
                  <Sparkles className="size-3" />
                  {totalSessions}
                </Badge>
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-[var(--color-fg-muted)]">{t("sessions.subtitle")}</p>
            </div>
          </div>
          <Button onClick={handleAddSession} size="lg" className="gap-2 shadow-[0_8px_24px_-8px_rgba(109,94,252,0.6)]">
            <Plus className="size-5" />
            {t("sessions.add.title")}
          </Button>
        </div>
      </div>

      {/* ─── Stats with gradient accents ─── */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("sessions.stats.connected")}
          value={connectedSessions}
          icon={CheckCircle2}
        />
        <StatCard label={t("sessions.stats.disconnected")} value={stats?.disconnected ?? 0} icon={WifiOff} />
        <StatCard label={t("sessions.stats.expired")} value={stats?.expired ?? 0} icon={Clock} />
        <StatCard label={t("sessions.stats.total")} value={totalSessions} icon={Plug} />
      </div>

      {/* ─── Filters ─── */}
      <div className="flex flex-col gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:flex-row sm:items-center sm:gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--color-fg-subtle)]" aria-hidden />
          <Input type="search" placeholder={t("sessions.searchPlaceholder")} value={search} onChange={(e) => setSearch(e.target.value)} className="h-11 ps-10" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:w-auto">
          <div className="sm:w-40"><Select value={statusFilter} onValueChange={setStatusFilter} options={[{ value: "", label: t("sessions.filters.allStatuses") }, ...(["connected", "connecting", "disconnected", "expired", "error", "paused", "reconnecting"] as const).map((s) => ({ value: s, label: t(`sessions.status.${s}`) }))]} /></div>
          <div className="sm:w-36"><Select value={sortBy} onValueChange={setSortBy} options={[{ value: "recent", label: t("sessions.filters.sortRecent") }, { value: "name", label: t("sessions.filters.sortName") }, { value: "status", label: t("sessions.filters.sortStatus") }]} /></div>
        </div>
        {statusFilter && (
          <button onClick={() => setStatusFilter("")} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-3 py-2.5 text-xs font-semibold text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)]">
            <X className="size-3.5" />
            Clear
          </button>
        )}
      </div>

      {/* ─── Session list ─── */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <CardContent className="space-y-4 pt-6">
                <div className="flex items-center gap-3"><Skeleton className="size-11 rounded-full" /><div className="space-y-2 flex-1"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-24" /></div></div>
                <Skeleton className="h-6 w-24" />
                <div className="space-y-2">{Array.from({ length: 4 }).map((_, j) => <Skeleton key={j} className="h-3 w-full" />)}</div>
                <Skeleton className="h-9 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={sessions?.length === 0 ? t("sessions.empty.title") : "No matches"}
          description={sessions?.length === 0 ? t("sessions.empty.description") : t("sessions.searchPlaceholder")}
          icon={Plug}
          action={sessions?.length === 0 ? (
            <Button onClick={handleAddSession} size="lg" className="gap-2">
              <Plus className="size-4" />{t("sessions.add.title")}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => { setSearch(""); setStatusFilter(""); }}>Clear filters</Button>
          )}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((session) => (
            <SessionCard
              key={session.id}
              session={{ ...session, status: localStatusOverrides[session.id] ?? session.status }}
              onAction={handleAction}
              isTesting={testingSessions.has(session.id)}
            />
          ))}
        </div>
      )}

      {/* ─── Add Session Dialog — Cookie-based ─── */}
      <Dialog open={showAddDialog} onClose={() => setShowAddDialog(false)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-brand text-white">
              <Cookie className="size-4" />
            </div>
            {t("sessions.add.title")}
          </DialogTitle>
          <DialogClose onClose={() => setShowAddDialog(false)} />
        </DialogHeader>

        <DialogBody className="space-y-5">
          {/* Step 1: Name */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-gradient-brand text-xs font-bold text-white">1</span>
              <label className="text-sm font-semibold text-[var(--color-fg)]">{t("sessions.add.sessionName")}</label>
            </div>
            <InputIcon icon={Pencil} placeholder={t("sessions.add.sessionNamePlaceholder")} value={sessionName} onChange={(e) => setSessionName(e.target.value)} />
          </div>

          {/* Step 2: Cookies */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-gradient-brand text-xs font-bold text-white">2</span>
              <label className="text-sm font-semibold text-[var(--color-fg)]">{t("extract.cookiesLabel")}</label>
            </div>
            <Textarea className="min-h-[140px] w-full font-mono text-xs leading-relaxed"
              placeholder={t("extract.cookiesPlaceholderNew")} value={cookieString} onChange={(e) => setCookieString(e.target.value)} />
            {cookieResult && cookieResult.format !== "unknown" && (
              <div className="flex items-center gap-2 text-xs text-[var(--color-fg-subtle)]">
                <Eye className="size-3.5" />
                <span>{t("extract.cookieFormatDetected")}: <span className="font-semibold text-[var(--color-fg)]">{FORMAT_LABELS[cookieResult.format]}</span></span>
                <Badge variant="primary" className="text-[0.65rem]">{cookieResult.count} {t("extract.cookieCount")}</Badge>
              </div>
            )}
          </div>

          {/* Cookie validation status */}
          {cookieResult && (
            <div className={cn("rounded-xl border p-3 transition-all",
              cookieValid ? "border-[color-mix(in_oklab,var(--color-success)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-success)_10%,transparent)]"
                : "border-[color-mix(in_oklab,var(--color-warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-warning)_10%,transparent)]"
            )}>
              <div className="flex items-start gap-2">
                {cookieValid ? <CheckCircle2 className="size-5 text-[var(--color-success)] shrink-0" /> : <AlertTriangle className="size-5 text-[var(--color-warning)] shrink-0" />}
                <div className="text-sm flex-1">
                  <p className={cn("font-semibold", cookieValid ? "text-[var(--color-success)]" : "text-[var(--color-warning)]")}>
                    {cookieValid ? t("extract.cookiesValid") : t("extract.cookiesPartial")}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {cookieResult.foundEssential.map((k) => <Badge key={k} variant="success" className="text-xs">{k} ✓</Badge>)}
                    {cookieResult.missingEssential.map((k) => <Badge key={k} variant="warning" className="text-xs">{k} ✗</Badge>)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Proxy (optional) */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-gradient-brand text-xs font-bold text-white">3</span>
              <label className="text-sm font-semibold text-[var(--color-fg)]">{t("sessions.add.proxyLabel")}</label>
              <Badge variant="default" className="text-[0.65rem]">{t("sessions.add.proxyOptional")}</Badge>
            </div>
            <InputIcon
              icon={Server}
              dir="ltr"
              placeholder={t("sessions.add.proxyPlaceholder")}
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
            />
            <p className="text-xs text-[var(--color-fg-muted)]">{t("sessions.add.proxyDesc")}</p>
          </div>

          {/* Info sections side-by-side */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[color-mix(in_oklab,var(--color-success)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-success)_6%,transparent)] p-3">
              <div className="flex items-start gap-2">
                <ShieldCheck className="size-5 text-[var(--color-success)] shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-[var(--color-fg)]">{t("extract.cookiesSafe")}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">{t("extract.cookiesSafeDesc")}</p>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-[color-mix(in_oklab,var(--color-info)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-info)_6%,transparent)] p-3">
              <div className="flex items-start gap-2">
                <Puzzle className="size-5 text-[var(--color-primary)] shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-[var(--color-fg)]">{t("extract.cookieEditorBadge")}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">{t("extract.cookieEditorBadgeDesc")}</p>
                </div>
              </div>
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setShowAddDialog(false)}>{t("common.cancel")}</Button>
          <Button
            disabled={!sessionName.trim() || !cookieValid || mutations.create.isPending}
            onClick={handleCreateSession}
            className="gap-2 min-w-[140px]"
          >
            {mutations.create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Cookie className="size-4" />}
            {t("extract.connectCookie")}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* ─── Delete Confirmation Dialog (Yes / No) ─── */}
      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--color-error)_15%,transparent)] text-[var(--color-error)]">
              <Trash2 className="size-4" />
            </div>
            {t("sessions.deleteConfirm.title")}
          </DialogTitle>
          <DialogClose onClose={() => setConfirmDelete(null)} />
        </DialogHeader>

        <DialogBody>
          {confirmDelete && (
            <p className="text-sm text-[var(--color-fg)]">
              {t("sessions.deleteConfirm.question", { name: confirmDelete.sessionName })}
            </p>
          )}
        </DialogBody>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setConfirmDelete(null)}
            disabled={mutations.delete.isPending}
          >
            {t("common.no")}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (!confirmDelete) return;
              const { sessionId: id, sessionName: name } = confirmDelete;
              // 1) Optimistically remove from the list — instant UI feedback
              setDeletedIds((prev) => new Set(prev).add(id));
              setConfirmDelete(null);
              // 2) Also update the React Query cache so refetch doesn't bring it back
              try {
                queryClient.setQueryData<any[]>(["fb-sessions", undefined], (old) => old?.filter((s: any) => s.id !== id) ?? old);
              } catch {}
              // 3) Persist via mutation
              mutations.delete.mutate(id, {
                onSuccess: () => {
                  toast({ type: "success", title: t("sessions.actions.deleteDone"), description: name });
                },
                onError: (err) => {
                  // Restore the session on error
                  setDeletedIds((prev) => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                  });
                  const msg = err?.message || String(err);
                  if (err instanceof SessionValidationError) {
                    toast({ type: "error", title: t("common.validationError"), description: msg });
                  } else if (err instanceof SessionTransitionError) {
                    toast({ type: "error", title: t("sessions.transitionError"), description: msg });
                  } else {
                    toast({ type: "error", title: t("common.error"), description: msg });
                  }
                },
              });
            }}
            disabled={mutations.delete.isPending}
            className="gap-2 min-w-[100px]"
          >
            {mutations.delete.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {t("common.yes")}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Session Card (premium variant with hover gradient)
// ═══════════════════════════════════════════════════════════

function SessionCard({
  session,
  onAction,
  isTesting = false,
}: {
  session: { id: string; name: string; status: FbSessionStatus; fb_name?: string | null; fb_avatar_url?: string | null; browser?: string | null; created_at: string; last_activity?: string | null; last_connection?: string | null };
  onAction: (action: string, id: string, name: string) => void;
  isTesting?: boolean;
}) {
  const { t } = useTranslation();
  const mutations = useSessionMutations();
  const status = statusConfig[session.status];
  const StatusIcon = status.icon;
  const BrowserIcon = browserIcons[session.browser ?? ""] ?? Globe;
  const isLive = session.status === "connected" || session.status === "connecting" || session.status === "reconnecting";

  return (
    <Card className={cn(
      "group relative overflow-hidden border-[var(--color-border)] transition-all duration-300 hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-lg)]",
      isTesting && "ring-2 ring-[var(--color-primary)]/40 border-[var(--color-primary)]/60",
    )}>
      {/* Testing scan overlay */}
      {isTesting && (
        <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
          <div className="absolute inset-x-0 -top-1 h-1 bg-gradient-to-r from-transparent via-[var(--color-primary)] to-transparent animate-[scan_1.4s_ease-in-out_infinite]" />
        </div>
      )}

      {/* Status gradient overlay */}
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br opacity-50 transition-opacity duration-500 group-hover:opacity-100", status.gradient)} />

      {/* Live pulse */}
      {isLive && (
        <div className="pointer-events-none absolute end-3 top-3 flex size-3">
          <span className={cn("absolute inset-0 animate-[ping_2s_ease-in-out_infinite] rounded-full", status.dot, "opacity-75")} />
          <span className={cn("relative inline-flex size-3 rounded-full", status.dot)} />
        </div>
      )}

      <CardContent className="relative space-y-4 pt-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar fallback={session.fb_name ?? session.name} src={session.fb_avatar_url ?? undefined} size="md" />
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-[var(--color-fg)]">{session.name}</h3>
              <p className="truncate text-xs text-[var(--color-fg-subtle)]">{session.fb_name ?? "—"}</p>
            </div>
          </div>
          <SessionActionMenu sessionName={session.name} sessionId={session.id} sessionStatus={session.status} onAction={onAction} />
        </div>

        {/* Status badge */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("size-2.5 rounded-full", status.dot, isLive && "animate-pulse")} />
          <Badge variant={status.variant} className="gap-1.5 px-2.5 py-1 text-xs font-semibold">
            <StatusIcon className={cn("size-3.5", session.status === "connecting" && "animate-spin")} />
            {t(`sessions.status.${session.status}`)}
          </Badge>
          {isTesting && (
            <Badge variant="primary" className="gap-1.5 px-2.5 py-1 text-xs font-semibold animate-[fade-in_0.2s_ease-out]">
              <Loader2 className="size-3.5 animate-spin" />
              {t("sessions.actions.testing")}
            </Badge>
          )}
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-2 rounded-lg bg-[var(--color-surface-2)]/60 px-2.5 py-1.5">
            <BrowserIcon className="size-3.5 text-[var(--color-fg-subtle)] shrink-0" />
            <span className="truncate text-[var(--color-fg-muted)]">{session.browser ?? "—"}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-[var(--color-surface-2)]/60 px-2.5 py-1.5">
            <Clock className="size-3.5 text-[var(--color-fg-subtle)] shrink-0" />
            <span className="truncate text-[var(--color-fg-muted)]">{formatRelativeTime(session.created_at)}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-[var(--color-surface-2)]/60 px-2.5 py-1.5">
            <Activity className="size-3.5 text-[var(--color-fg-subtle)] shrink-0" />
            <span className="truncate text-[var(--color-fg-muted)]">{formatRelativeTime(session.last_activity ?? null)}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-[var(--color-surface-2)]/60 px-2.5 py-1.5">
            <Server className="size-3.5 text-[var(--color-fg-subtle)] shrink-0" />
            <span className="truncate text-[var(--color-fg-muted)]">{formatDateTime(session.last_connection ?? null)}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 border-t border-[var(--color-border)] pt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAction("refresh", session.id, session.name)}
            disabled={isTesting || mutations.delete.isPending}
            aria-busy={isTesting}
            className={cn(
              "flex-1 gap-1.5 transition-all",
              isTesting && "cursor-not-allowed opacity-80",
            )}
          >
            {isTesting ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                {t("sessions.actions.testing")}
              </>
            ) : (
              <>
                <Activity className="size-3.5" />
                {t("sessions.actions.test")}
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onAction("delete", session.id, session.name)}
            disabled={isTesting || mutations.delete.isPending}
            aria-label={t("sessions.actions.delete")}
            className="text-[var(--color-error)] hover:bg-[color-mix(in_oklab,var(--color-error)_10%,transparent)] hover:text-[var(--color-error)]"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════
// Action Menu (polished dropdown)
// ═══════════════════════════════════════════════════════════

function SessionActionMenu({
  sessionName,
  sessionId,
  sessionStatus,
  onAction,
}: {
  sessionName: string;
  sessionId: string;
  sessionStatus: FbSessionStatus;
  onAction: (action: string, id: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [showRenameInput, setShowRenameInput] = useState(false);
  const [renameValue, setRenameValue] = useState(sessionName);
  const mutations = useSessionMutations();
  const ref = useRef<HTMLDivElement>(null);

  const canReconnect = sessionStatus === "expired" || sessionStatus === "error";
  const canPause = sessionStatus === "connected";
  const canResume = sessionStatus === "paused";
  const canDisconnect = sessionStatus === "connected" || sessionStatus === "reconnecting" || sessionStatus === "connecting";

  const items = [
    { key: "rename", label: t("sessions.actions.rename"), icon: Pencil },
    { key: "reconnect", label: t("sessions.actions.reconnect"), icon: RefreshCw, hidden: !canReconnect },
    { key: "refresh", label: t("sessions.actions.refresh"), icon: Activity },
    { key: "pause", label: t("sessions.actions.pause"), icon: Pause, hidden: !canPause },
    { key: "resume", label: t("sessions.actions.resume"), icon: Wifi, hidden: !canResume },
    { key: "disconnect", label: t("sessions.actions.disconnect"), icon: WifiOff, hidden: !canDisconnect },
    { key: "duplicate", label: t("sessions.actions.duplicate"), icon: Copy },
    { key: "delete", label: t("sessions.actions.delete"), icon: Trash2, danger: true },
  ].filter((item) => !("hidden" in item && item.hidden));

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function handleRename() {
    if (!renameValue.trim() || renameValue === sessionName) {
      setShowRenameInput(false);
      return;
    }
    mutations.rename.mutate(
      { id: sessionId, name: renameValue.trim() },
      {
        onSuccess: () => {
          toast({ type: "success", title: t("sessions.actions.renameDone"), description: renameValue });
          setShowRenameInput(false);
          setOpen(false);
        },
        onError: (err) => toast({ type: "error", title: t("common.error"), description: err.message }),
      },
    );
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "rounded-lg p-1.5 text-[var(--color-fg-muted)] transition-all",
          "hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]",
          open && "bg-[var(--color-surface-2)] text-[var(--color-fg)]"
        )}
        aria-label="More actions"
      >
        <MoreVertical className="size-4" />
      </button>
      {open && (
        <ul className="absolute end-0 top-full z-50 mt-1 min-w-[14rem] overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-1 shadow-[var(--shadow-lg)] animate-[fade-in_0.15s_ease-out]">
          {showRenameInput ? (
            <li className="p-2">
              <div className="flex gap-2">
                <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="h-9 text-sm" autoFocus onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setShowRenameInput(false); }} />
                <Button size="sm" onClick={handleRename} disabled={mutations.rename.isPending} aria-label="Confirm rename">
                  {mutations.rename.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                </Button>
              </div>
            </li>
          ) : (
            items.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.key}>
                  <button
                    onClick={() => {
                      if (item.key === "rename") {
                        setRenameValue(sessionName);
                        setShowRenameInput(true);
                      } else {
                        onAction(item.key, sessionId, sessionName);
                        setOpen(false);
                      }
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      item.danger
                        ? "text-[var(--color-error)] hover:bg-[color-mix(in_oklab,var(--color-error)_10%,transparent)]"
                        : "text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                    )}
                  >
                    <Icon className="size-4" />{item.label}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
